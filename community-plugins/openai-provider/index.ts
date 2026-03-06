/**
 * OpenAI API 兼容 Provider 插件
 * 实现 AIProviderPlugin 接口，支持 OpenAI、Ollama、LocalAI 等兼容服务
 */

import OpenAI from 'openai';
import type {
  AIProviderPlugin,
  ChatMessage,
  ChatOptions,
  StreamEvent,
  ToolExecutor,
  HeartbeatCallback,
  PluginConfig,
} from '../../src/plugins/types';

// ==================== 内部状态 ====================

let client: OpenAI | null = null;
let model: string = 'gpt-4o-mini';
let baseURL: string = 'https://api.openai.com/v1';

// ==================== 常量 ====================

const MAX_TOOL_CALL_DEPTH = 20;

/**
 * 从错误对象中提取完整的错误信息链（包括 cause）
 * OpenAI SDK 的 APIConnectionError 会将真正的网络错误藏在 cause 中
 */
function extractFullErrorMessage(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  
  const parts: string[] = [err.message];
  let current: unknown = (err as Error & { cause?: unknown }).cause;
  let depth = 0;
  
  while (current && depth < 5) {
    if (current instanceof Error) {
      parts.push(current.message);
      current = (current as Error & { cause?: unknown }).cause;
    } else {
      parts.push(String(current));
      break;
    }
    depth++;
  }
  
  const status = (err as Error & { status?: number }).status;
  if (status) {
    parts.unshift(`[HTTP ${status}]`);
  }
  
  return parts.join(' \u2192 ');
}
const MAX_TOOL_RESULT_CHARS = 4000;
const KEEP_RECENT_TOOL_ROUNDS = 2;

// 匹配 <tool_call>...</tool_call> 标签（MLX server / 本地模型的 tool call 格式）
const TOOL_CALL_TAG_RE = /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/g;
// 匹配 <think>...</think> 标签
const THINK_TAG_RE = /<think>[\s\S]*?<\/think>/g;

// ==================== 工具函数 ====================

/**
 * 从文本内容中解析 <tool_call> 标签（兼容 MLX server 等不返回标准 tool_calls 字段的后端）
 */
function parseToolCallsFromContent(
  content: string
): Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }> {
  const results: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }> = [];
  let match: RegExpExecArray | null;
  const re = new RegExp(TOOL_CALL_TAG_RE.source, 'g');
  while ((match = re.exec(content)) !== null) {
    try {
      const parsed = JSON.parse(match[1]);
      if (parsed.name) {
        results.push({
          id: `tool-${Date.now()}-${results.length}`,
          type: 'function',
          function: {
            name: parsed.name,
            arguments: typeof parsed.arguments === 'string'
              ? parsed.arguments
              : JSON.stringify(parsed.arguments ?? {}),
          },
        });
      }
    } catch {
      // JSON 解析失败，跳过
    }
  }
  return results;
}

/**
 * 清理模型输出中的 <think> 和 <tool_call> 标签，返回纯文本
 */
function cleanModelOutput(content: string): string {
  return content
    .replace(THINK_TAG_RE, '')
    .replace(TOOL_CALL_TAG_RE, '')
    .trim();
}

/**
 * 检测字符串末尾是否有不完整的标签前缀
 * 返回匹配的部分长度（0 表示无匹配）
 * 例如：findPartialTag("hello<thi", "<think>") → 4（匹配 "<thi"）
 */
function findPartialTag(text: string, tag: string): number {
  for (let len = Math.min(tag.length - 1, text.length); len > 0; len--) {
    if (text.endsWith(tag.substring(0, len))) {
      return len;
    }
  }
  return 0;
}

function truncateToolResult(content: string, maxChars: number): string {
  if (content.length <= maxChars) return content;
  return content.slice(0, maxChars) + `\n...(内容已截断，原始 ${content.length} 字符)`;
}

function convertTools(tools?: ChatOptions['tools']): OpenAI.Chat.ChatCompletionTool[] | undefined {
  if (!tools || tools.length === 0) return undefined;

  return tools.map(tool => ({
    type: 'function' as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.input_schema,
    },
  }));
}

function convertMessages(messages: ChatMessage[]): OpenAI.Chat.ChatMessage[] {
  return messages.map(msg => {
    // 处理内容 - OpenAI 支持 text 和 image_content
    let content: string | OpenAI.Chat.ChatCompletionContentPart[];

    if (typeof msg.content === 'string') {
      content = msg.content;
    } else if (Array.isArray(msg.content)) {
      content = msg.content.map(block => {
        if ('text' in block) {
          return {
            type: 'text' as const,
            text: block.text,
          };
        } else if ('source' in block) {
          // 图片内容
          return {
            type: 'image_url' as const,
            image_url: {
              url: `data:${block.source.media_type};base64,${block.source.data}`,
            },
          };
        }
        return { type: 'text' as const, text: '' };
      });
    } else {
      content = '';
    }

    return {
      role: msg.role === 'assistant' ? 'assistant' as const : 'user' as const,
      content,
    };
  });
}

function buildChatMessages(messages: ChatMessage[], system?: string): OpenAI.Chat.ChatMessage[] {
  const chatMessages: OpenAI.Chat.ChatMessage[] = [];
  if (system) {
    // 本地模型注入 /no_think 指令，防止 Qwen3 等模型陷入思考而不执行工具
    const isLocal = shouldUseOllamaExtraBody(baseURL);
    const systemContent = isLocal ? `/no_think\n${system}` : system;
    chatMessages.push({ role: 'system', content: systemContent });
  }
  chatMessages.push(...convertMessages(messages));
  return chatMessages;
}

function shouldUseOllamaExtraBody(url: string): boolean {
  return url.includes('localhost') || url.includes('127.0.0.1') || url.includes('ollama');
}

function applyOllamaContextWindow(
  params: OpenAI.Chat.ChatCompletionCreateParams & { extra_body?: Record<string, unknown> }
): void {
  if (!shouldUseOllamaExtraBody(baseURL)) {
    return;
  }

  const numCtx = parseInt(process.env.OPENAI_NUM_CTX || '0', 10);
  if (Number.isFinite(numCtx) && numCtx > 0) {
    params.extra_body = { num_ctx: numCtx };
  }
}

function extractTextFromResponse(response: OpenAI.Chat.ChatCompletion): string {
  const message = response.choices[0]?.message;
  if (!message) return '';

  // 检查是否有工具调用
  if (message.tool_calls && message.tool_calls.length > 0) {
    // 返回包含工具调用的标记
    const toolCallsInfo = message.tool_calls
      .map(tc => `[调用工具 ${tc.function.name}: ${tc.function.arguments}]`)
      .join('\n');
    return toolCallsInfo;
  }

  return message.content || '';
}

// ==================== 插件实现 ====================

const openaiProvider: AIProviderPlugin = {
  name: 'openai-provider',
  version: '1.0.0',
  description: 'OpenAI API 兼容 Provider - 支持 OpenAI、Ollama、LocalAI 等',

  async init(config: PluginConfig): Promise<void> {
    const apiKey = config.apiKey || process.env.OPENAI_API_KEY || 'dummy';
    baseURL = config.baseURL || process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';

    client = new OpenAI({
      apiKey,
      baseURL,
      timeout: 60000,
      maxRetries: 3,
    });

    // 如果配置了模型，使用配置的值
    if (config.model) {
      model = config.model;
    } else if (process.env.AI_MODEL) {
      model = process.env.AI_MODEL;
    }
  },

  async chat(
    messages: ChatMessage[],
    options?: ChatOptions
  ): Promise<unknown> {
    if (!client) {
      throw new Error('OpenAI client not initialized. Call init() first.');
    }

    const chatMessages = buildChatMessages(messages, options?.system);
    const tools = convertTools(options?.tools);

    const params: OpenAI.Chat.ChatCompletionCreateParams & { extra_body?: Record<string, unknown> } = {
      model,
      messages: chatMessages,
      max_tokens: options?.maxTokens || 4096,
      temperature: options?.temperature,
      tools,
      stream: false,
    };

    applyOllamaContextWindow(params);

    if (options?.stopSequences) {
      params.stop = options.stopSequences;
    }

    try {
      const response = await client.chat.completions.create(params);
      return response;
    } catch (err) {
      const detail = extractFullErrorMessage(err);
      throw new Error(`OpenAI API 请求失败 (${baseURL}): ${detail}`);
    }
  },

  async *chatStream(
    messages: ChatMessage[],
    options?: ChatOptions
  ): AsyncGenerator<StreamEvent> {
    if (!client) {
      throw new Error('OpenAI client not initialized. Call init() first.');
    }

    const chatMessages = buildChatMessages(messages, options?.system);
    const tools = convertTools(options?.tools);

    const params: OpenAI.Chat.ChatCompletionCreateParams & {
      extra_body?: Record<string, unknown>;
      stream_options?: { include_usage?: boolean };
    } = {
      model,
      messages: chatMessages,
      max_tokens: options?.maxTokens || 4096,
      temperature: options?.temperature,
      tools,
      stream: true,
      stream_options: { include_usage: true },
    };

    applyOllamaContextWindow(params);

    // 对 Ollama 本地模型启用 thinking（通过 extra_body）
    if (shouldUseOllamaExtraBody(baseURL)) {
      params.extra_body = { ...params.extra_body, think: true };
    }

    if (options?.stopSequences) {
      params.stop = options.stopSequences;
    }

    let stream;
    try {
      stream = await client.chat.completions.create(params);
    } catch (err) {
      const detail = extractFullErrorMessage(err);
      throw new Error(`OpenAI API 流式请求失败 (${baseURL}): ${detail}`);
    }

    let finalContent = '';
    let finishReason: string | null = null;
    let usage: { input_tokens?: number; output_tokens?: number } | undefined;
    // 收集完整的 tool_calls 数据（流式 delta 需要逐步拼装）
    const collectedToolCalls: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }> = [];

    // 流式标签状态机（兼容 MLX server 等将思考/工具调用放在 content 中的后端）
    let tagState: 'normal' | 'think' | 'tool_call' = 'normal';
    // 部分标签缓冲（处理标签被拆分到多个 chunk 的边界情况）
    let tagBuffer = '';
    // <tool_call> 内容保留在 finalContent 中（供正则解析），但不 yield 给 CLI

    for await (const chunk of stream) {
      const choice = chunk.choices[0];
      const delta = choice?.delta;

      if (chunk.usage) {
        usage = {
          input_tokens: chunk.usage.prompt_tokens ?? usage?.input_tokens,
          output_tokens: chunk.usage.completion_tokens ?? usage?.output_tokens,
        };
      }

      // Ollama thinking: delta.reasoning 字段
      const reasoning = (delta as Record<string, unknown>)?.reasoning;
      if (typeof reasoning === 'string' && reasoning) {
        yield { type: 'thinking', text: reasoning };
      }

      if (delta?.content) {
        // 处理 <think> 和 <tool_call> 标签：拦截并分流
        let remaining = tagBuffer + delta.content;
        tagBuffer = '';

        while (remaining.length > 0) {
          if (tagState === 'think') {
            const endIdx = remaining.indexOf('</think>');
            if (endIdx !== -1) {
              const thinkText = remaining.substring(0, endIdx);
              if (thinkText) yield { type: 'thinking', text: thinkText };
              tagState = 'normal';
              remaining = remaining.substring(endIdx + '</think>'.length);
            } else {
              const partial = findPartialTag(remaining, '</think>');
              if (partial > 0) {
                const thinkText = remaining.substring(0, remaining.length - partial);
                if (thinkText) yield { type: 'thinking', text: thinkText };
                tagBuffer = remaining.substring(remaining.length - partial);
              } else {
                yield { type: 'thinking', text: remaining };
              }
              remaining = '';
            }
          } else if (tagState === 'tool_call') {
            const endIdx = remaining.indexOf('</tool_call>');
            if (endIdx !== -1) {
              // 内容加入 finalContent（含标签，用于后续解析），但不 yield 给 CLI
              finalContent += remaining.substring(0, endIdx) + '</tool_call>';
              tagState = 'normal';
              remaining = remaining.substring(endIdx + '</tool_call>'.length);
            } else {
              const partial = findPartialTag(remaining, '</tool_call>');
              if (partial > 0) {
                finalContent += remaining.substring(0, remaining.length - partial);
                tagBuffer = remaining.substring(remaining.length - partial);
              } else {
                finalContent += remaining;
              }
              remaining = '';
            }
          } else {
            // normal 状态：查找最近的 <think> 或 <tool_call> 标签
            const thinkIdx = remaining.indexOf('<think>');
            const toolIdx = remaining.indexOf('<tool_call>');
            // 找最近的标签
            let nearestTag: 'think' | 'tool_call' | null = null;
            let nearestIdx = remaining.length;
            if (thinkIdx !== -1 && thinkIdx < nearestIdx) { nearestIdx = thinkIdx; nearestTag = 'think'; }
            if (toolIdx !== -1 && toolIdx < nearestIdx) { nearestIdx = toolIdx; nearestTag = 'tool_call'; }

            if (nearestTag) {
              const textBefore = remaining.substring(0, nearestIdx);
              if (textBefore) {
                finalContent += textBefore;
                yield { type: 'text', text: textBefore };
              }
              const tagLen = nearestTag === 'think' ? '<think>'.length : '<tool_call>'.length;
              // tool_call 开标签写入 finalContent（供后续正则解析），但不 yield 给 CLI
              if (nearestTag === 'tool_call') {
                finalContent += '<tool_call>';
              }
              tagState = nearestTag;
              remaining = remaining.substring(nearestIdx + tagLen);
            } else {
              // 检查末尾是否有不完整的标签
              const partialThink = findPartialTag(remaining, '<think>');
              const partialTool = findPartialTag(remaining, '<tool_call>');
              const partial = Math.max(partialThink, partialTool);
              if (partial > 0) {
                const text = remaining.substring(0, remaining.length - partial);
                if (text) {
                  finalContent += text;
                  yield { type: 'text', text: text };
                }
                tagBuffer = remaining.substring(remaining.length - partial);
              } else {
                finalContent += remaining;
                yield { type: 'text', text: remaining };
              }
              remaining = '';
            }
          }
        }
      }

      if (delta?.tool_calls && delta.tool_calls.length > 0) {
        for (const tc of delta.tool_calls) {
          const idx = tc.index ?? collectedToolCalls.length;
          // 首次出现该 index，初始化条目
          if (!collectedToolCalls[idx]) {
            collectedToolCalls[idx] = {
              id: tc.id || `tool-${Date.now()}-${idx}`,
              type: 'function',
              function: { name: '', arguments: '' },
            };
          }
          // 拼装 name 和 arguments（流式 delta 逐步累积）
          if (tc.function?.name) {
            collectedToolCalls[idx].function.name += tc.function.name;
          }
          if (tc.function?.arguments) {
            collectedToolCalls[idx].function.arguments += tc.function.arguments;
          }
          // 注意：不在 delta 中 yield tool_use，因为 arguments 还不完整
          // 完整的 tool_use 事件在流结束后统一发送（见下方 done 事件处理）
        }
      }

      if (choice?.finish_reason) {
        finishReason = choice.finish_reason;
      }
    }

    // 兼容 MLX server：如果标准 tool_calls 为空，从 finalContent 中解析 <tool_call> 标签
    if (collectedToolCalls.length === 0 && finalContent.includes('<tool_call>')) {
      const parsed = parseToolCallsFromContent(finalContent);
      collectedToolCalls.push(...parsed);
      if (parsed.length > 0) {
        finishReason = 'tool_calls';
      }
    }

    // 清理 content 中残留的 <think> 和 <tool_call> 标签
    finalContent = cleanModelOutput(finalContent);

    // 流结束后，发送完整的 tool_use 事件（arguments 已完整拼装）
    for (const tc of collectedToolCalls) {
      if (tc.function.name) {
        let parsedInput: unknown;
        try { parsedInput = JSON.parse(tc.function.arguments || '{}'); } catch { parsedInput = {}; }
        yield {
          type: 'tool_use',
          id: tc.id,
          name: tc.function.name,
          input: parsedInput,
        };
      }
    }

    // 构建完整的 OpenAI 格式响应对象，供 handleToolUse 使用
    const toolCalls = collectedToolCalls.length > 0 ? collectedToolCalls : undefined;
    yield {
      type: 'done',
      message: {
        stop_reason: finishReason || 'stop',
        usage,
        choices: [{ message: { content: finalContent, tool_calls: toolCalls } }],
      },
    };
  },

  async handleToolUse(
    response: unknown,
    messages: ChatMessage[],
    executeTool: ToolExecutor,
    options?: ChatOptions,
    heartbeat?: HeartbeatCallback
  ): Promise<string> {
    const openaiResponse = response as OpenAI.Chat.ChatCompletion;
    const message = openaiResponse.choices[0]?.message;

    if (!message?.tool_calls || message.tool_calls.length === 0) {
      return message?.content || '';
    }

    // 构建助手消息（包含工具调用信息）
    const toolCallSummary = message.tool_calls.map((tc: { function: { name: string; arguments: string } }) => {
      let args: unknown;
      try { args = JSON.parse(tc.function.arguments || '{}'); } catch { args = {}; }
      return `[调用工具 ${tc.function.name}(${JSON.stringify(args)})]`;
    }).join('\n');
    messages.push({ role: 'assistant', content: toolCallSummary });

    // 执行工具调用
    for (const tc of message.tool_calls) {
      heartbeat?.();

      const tcTyped = tc as { function: { name: string; arguments: string } };
      let input: unknown;
      try {
        input = JSON.parse(tcTyped.function.arguments || '{}');
      } catch {
        input = {};
      }

      let resultContent: string;
      try {
        const result = await executeTool(tcTyped.function.name, input);
        const resultStr = typeof result === 'string' ? result : JSON.stringify(result);
        resultContent = truncateToolResult(resultStr, MAX_TOOL_RESULT_CHARS);
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        resultContent = `[工具执行失败] ${errorMsg}`;
      }

      // 使用简洁的纯文本格式（对小模型更友好）
      messages.push({
        role: 'user',
        content: `[工具 ${tcTyped.function.name} 执行结果]\n${resultContent}`,
      });

      heartbeat?.();
    }

    // 递归调用直到没有更多工具调用
    const maxDepth = options?.maxTokens ? Math.floor(options.maxTokens / 100) : MAX_TOOL_CALL_DEPTH;
    if (messages.length > maxDepth * 2) {
      return '已达到最大工具调用深度';
    }

    // 使用流式调用获取后续响应（避免非流式在本地模型上更慢）
    let nextContent = '';
    let nextToolCalls: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }> = [];
    let nextMessage: unknown = null;

    for await (const event of this.chatStream(messages, options)) {
      heartbeat?.();
      if (event.type === 'text') {
        nextContent += event.text;
      } else if (event.type === 'done') {
        nextMessage = event.message;
        const msg = event.message as { choices?: Array<{ message?: { tool_calls?: typeof nextToolCalls } }> };
        nextToolCalls = msg.choices?.[0]?.message?.tool_calls || [];
      }
    }

    // 检查是否有新的工具调用
    if (nextToolCalls.length > 0) {
      return this.handleToolUse(nextMessage, messages, executeTool, options, heartbeat);
    }

    return nextContent || '';
  },

  getModel(): string {
    return model;
  },

  setModel(newModel: string): void {
    model = newModel;
  },
};

export default openaiProvider;

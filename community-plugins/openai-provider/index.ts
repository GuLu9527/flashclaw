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
const MAX_TOOL_RESULT_CHARS = 4000;
const KEEP_RECENT_TOOL_ROUNDS = 2;

// ==================== 工具函数 ====================

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
    chatMessages.push({ role: 'system', content: system });
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

    const response = await client.chat.completions.create(params);
    return response;
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

    const stream = await client.chat.completions.create(params);

    let finalContent = '';
    let finishReason: string | null = null;
    let usage: { input_tokens?: number; output_tokens?: number } | undefined;
    // 收集完整的 tool_calls 数据（流式 delta 需要逐步拼装）
    const collectedToolCalls: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }> = [];

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
        finalContent += delta.content;
        yield { type: 'text', text: delta.content };
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

    // 添加助手消息（包含工具调用）
    const assistantMsg: ChatMessage = {
      role: 'assistant',
      content: message.content || '',
    };
    messages.push(assistantMsg);

    // 执行工具调用
    for (const tc of message.tool_calls) {
      heartbeat?.();

      let input: unknown;
      try {
        input = JSON.parse(tc.function.arguments || '{}');
      } catch {
        input = {};
      }

      try {
        const result = await executeTool(tc.function.name, input);
        const resultStr = typeof result === 'string'
          ? result
          : JSON.stringify(result);

        // 添加工具结果消息
        messages.push({
          role: 'user',
          content: truncateToolResult(resultStr, MAX_TOOL_RESULT_CHARS),
        });
      } catch (error) {
        // 工具执行失败
        const errorMsg = error instanceof Error ? error.message : String(error);
        messages.push({
          role: 'user',
          content: `[工具执行失败] ${errorMsg}`,
        });
      }

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

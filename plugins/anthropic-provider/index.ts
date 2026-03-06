/**
 * Anthropic AI Provider 插件
 * 实现 AIProviderPlugin 接口，支持 Claude 等模型
 */

import Anthropic from '@anthropic-ai/sdk';
import type {
  AIProviderPlugin,
  ChatMessage,
  ChatOptions,
  StreamEvent,
  ToolExecutor,
  HeartbeatCallback,
  PluginConfig,
  ImageBlock,
  TextBlock,
  ToolDefinition,
} from '../../src/plugins/types';

// ==================== 内部状态 ====================

let client: Anthropic | null = null;
let model: string = 'claude-sonnet-4-20250514';
let baseURL: string | undefined;

// ==================== 内部常量和工具函数 ====================

const MAX_TOOL_CALL_DEPTH = 20;

/**
 * 从错误对象中提取完整的错误信息链（包括 cause）
 * Anthropic SDK 的 APIConnectionError 会将真正的网络错误藏在 cause 中
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
  
  // 附加 HTTP 状态码（如果是 API 错误）
  const status = (err as Error & { status?: number }).status;
  if (status) {
    parts.unshift(`[HTTP ${status}]`);
  }
  
  return parts.join(' → ');
}
const MAX_TOOL_RESULT_CHARS = 4000;
const KEEP_RECENT_TOOL_ROUNDS = 2;
const MOCK_RESPONSE_PREFIX = process.env.FLASHCLAW_MOCK_RESPONSE_PREFIX || 'MOCK';
const MOCK_TOOL_MARKER = process.env.FLASHCLAW_MOCK_TOOL_MARKER || '[tool:send_message]';

function truncateToolResult(content: string, maxChars: number): string {
  if (content.length <= maxChars) return content;
  return content.slice(0, maxChars) + `\n...(内容已截断，原始 ${content.length} 字符)`;
}

function compressToolHistory(
  messages: Anthropic.MessageParam[],
  keepRecentRounds: number,
): Anthropic.MessageParam[] {
  const toolRoundIndices: number[] = [];
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (msg.role === 'assistant' && Array.isArray(msg.content)) {
      const hasToolUse = (msg.content as Anthropic.ContentBlock[]).some(
        (b) => b.type === 'tool_use'
      );
      if (hasToolUse) toolRoundIndices.push(i);
    }
  }

  if (toolRoundIndices.length <= keepRecentRounds) return messages;

  const compressCount = toolRoundIndices.length - keepRecentRounds;
  const toCompress = new Set(toolRoundIndices.slice(0, compressCount));

  const result: Anthropic.MessageParam[] = [];
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];

    if (toCompress.has(i) && msg.role === 'assistant' && Array.isArray(msg.content)) {
      const summaryParts: string[] = [];
      for (const block of msg.content as Anthropic.ContentBlock[]) {
        if (block.type === 'tool_use') {
          const inputStr = JSON.stringify(block.input);
          const inputPreview = inputStr.length > 80 ? inputStr.slice(0, 80) + '...' : inputStr;
          summaryParts.push(`[已执行工具 ${block.name}(${inputPreview})]`);
        } else if (block.type === 'text' && (block as Anthropic.TextBlock).text) {
          summaryParts.push((block as Anthropic.TextBlock).text);
        }
      }
      result.push({ role: 'assistant', content: summaryParts.join('\n') || '[工具调用]' });

      if (i + 1 < messages.length && messages[i + 1].role === 'user') {
        const nextMsg = messages[i + 1];
        if (Array.isArray(nextMsg.content)) {
          const resultParts: string[] = [];
          for (const block of nextMsg.content as Anthropic.ToolResultBlockParam[]) {
            if (block.type === 'tool_result') {
              const contentStr = typeof block.content === 'string' ? block.content : '';
              const preview = contentStr.length > 100 ? contentStr.slice(0, 100) + '...' : contentStr;
              resultParts.push(block.is_error ? `[失败: ${preview}]` : `[成功: ${preview}]`);
            }
          }
          result.push({ role: 'user', content: resultParts.join('\n') || '[工具结果]' });
          i++;
        } else {
          result.push(nextMsg);
          i++;
        }
      }
    } else {
      result.push(msg);
    }
  }

  return result;
}

function extractText(response: Anthropic.Message): string {
  const textBlocks = response.content.filter(
    (block): block is Anthropic.TextBlock => block.type === 'text'
  );
  return textBlocks.map(block => block.text).join('');
}

function isMockMode(): boolean {
  return process.env.FLASHCLAW_MOCK_API === '1';
}

function contentToText(content: ChatMessage['content']): string {
  if (typeof content === 'string') return content;
  return content
    .filter((block): block is TextBlock => block.type === 'text')
    .map(block => block.text)
    .join('');
}

function getLastUserText(messages: ChatMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const msg = messages[i];
    if (msg.role === 'user') {
      return contentToText(msg.content);
    }
  }
  return '';
}

function shouldMockToolUse(prompt: string, tools?: ToolDefinition[]): boolean {
  if (!tools || tools.length === 0) return false;
  if (process.env.FLASHCLAW_MOCK_FORCE_TOOL === '1') return true;
  return prompt.includes(MOCK_TOOL_MARKER);
}

function buildMockMessage(params: {
  content: Array<TextBlock | { type: 'tool_use'; id: string; name: string; input: unknown }>;
  stopReason: 'end_turn' | 'tool_use';
  model: string;
}): Anthropic.Message {
  return {
    id: `mock-${Date.now()}`,
    type: 'message',
    role: 'assistant',
    model: params.model,
    content: params.content as Anthropic.Message['content'],
    stop_reason: params.stopReason,
    stop_sequence: null,
    usage: {
      input_tokens: 1,
      output_tokens: 1,
      cache_creation_input_tokens: null,
      cache_read_input_tokens: null,
      cache_creation: null,
      server_tool_use: null,
      service_tier: 'standard',
    },
  };
}

async function createMockResponse(messages: ChatMessage[], options?: ChatOptions): Promise<Anthropic.Message> {
  const prompt = getLastUserText(messages);
  const tools = options?.tools;
  const useTool = shouldMockToolUse(prompt, tools);

  if (useTool && tools && tools.length > 0) {
    const toolName = tools.find(t => t.name === 'send_message')?.name || tools[0].name;
    const toolInput = { content: `${MOCK_RESPONSE_PREFIX} TOOL: ${prompt}` };
    return buildMockMessage({
      model,
      stopReason: 'tool_use',
      content: [
        {
          type: 'tool_use',
          id: 'mock_tool_1',
          name: toolName,
          input: toolInput,
        },
      ],
    });
  }

  return buildMockMessage({
    model,
    stopReason: 'end_turn',
    content: [{ type: 'text', text: `${MOCK_RESPONSE_PREFIX}: ${prompt}` }],
  });
}

async function streamFollowUp(
  messages: Anthropic.MessageParam[],
  options?: ChatOptions,
  heartbeat?: HeartbeatCallback
): Promise<Anthropic.Message> {
  if (!client) {
    throw new Error('Provider not initialized. Call init() first.');
  }

  const params: Anthropic.MessageCreateParams = {
    model: model,
    max_tokens: options?.maxTokens ?? 4096,
    messages,
    stream: true,
  };

  if (options?.system) {
    params.system = options.system;
  }

  if (options?.tools && options.tools.length > 0) {
    params.tools = options.tools as unknown as Anthropic.Tool[];
  }

  let stream;
  try {
    stream = await client.messages.create(params);
  } catch (err) {
    const detail = extractFullErrorMessage(err);
    throw new Error(`Anthropic API 后续请求失败 (${baseURL || 'default'}): ${detail}`);
  }

  let finalMessage: Anthropic.Message | null = null;
  const contentBlocks: Array<Anthropic.TextBlock | Anthropic.ToolUseBlock> = [];
  const partialJsonParts = new Map<number, string[]>();

  for await (const event of stream as AsyncIterable<Anthropic.MessageStreamEvent>) {
    heartbeat?.();

    if (event.type === 'message_start') {
      finalMessage = event.message as Anthropic.Message;
    } else if (event.type === 'content_block_start') {
      const block = event.content_block;
      if (block.type === 'text') {
        contentBlocks[event.index] = { type: 'text' as const, text: '', citations: null };
      } else if (block.type === 'tool_use') {
        contentBlocks[event.index] = {
          type: 'tool_use' as const,
          id: block.id,
          name: block.name,
          input: {},
        };
        partialJsonParts.set(event.index, []);
      }
    } else if (event.type === 'content_block_delta') {
      const delta = event.delta;
      if ('text' in delta) {
        const block = contentBlocks[event.index];
        if (block?.type === 'text') {
          block.text += delta.text;
        }
      } else if ('partial_json' in delta) {
        const parts = partialJsonParts.get(event.index);
        if (parts) {
          parts.push(delta.partial_json);
        }
      }
    } else if (event.type === 'content_block_stop') {
      const block = contentBlocks[event.index];
      if (block?.type === 'tool_use') {
        const parts = partialJsonParts.get(event.index);
        if (parts && parts.length > 0) {
          try {
            block.input = JSON.parse(parts.join(''));
          } catch {
            block.input = {};
          }
        }
      }
    } else if (event.type === 'message_delta') {
      if (finalMessage) {
        finalMessage.stop_reason = event.delta.stop_reason ?? finalMessage.stop_reason;
        if (event.usage) {
          finalMessage.usage.output_tokens = event.usage.output_tokens;
        }
      }
    }
  }

  if (!finalMessage) {
    throw new Error('工具链后续请求未收到响应');
  }

  finalMessage.content = contentBlocks.filter(
    (block): block is Anthropic.TextBlock | Anthropic.ToolUseBlock => block != null
  );

  return finalMessage;
}

async function handleToolUseInternal(
  response: Anthropic.Message,
  messages: Anthropic.MessageParam[],
  executeTool: ToolExecutor,
  options?: ChatOptions,
  depth: number = 0,
  heartbeat?: HeartbeatCallback
): Promise<string> {
  if (depth >= MAX_TOOL_CALL_DEPTH) {
    return extractText(response) || `[工具调用链过深（超过 ${MAX_TOOL_CALL_DEPTH} 轮），已强制终止]`;
  }

  const toolUseBlocks = response.content.filter(
    (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use'
  );

  if (toolUseBlocks.length === 0) {
    return extractText(response);
  }

  let newMessages: Anthropic.MessageParam[] = [
    ...messages,
    {
      role: 'assistant' as const,
      content: response.content,
    },
  ];

  const toolResults: Anthropic.ToolResultBlockParam[] = [];

  for (const toolUse of toolUseBlocks) {
    heartbeat?.();
    try {
      const result = await executeTool(toolUse.name, toolUse.input);
      const content = typeof result === 'string' ? result : JSON.stringify(result);
      toolResults.push({
        type: 'tool_result',
        tool_use_id: toolUse.id,
        content: truncateToolResult(content, MAX_TOOL_RESULT_CHARS),
      });
    } catch (error) {
      toolResults.push({
        type: 'tool_result',
        tool_use_id: toolUse.id,
        content: `工具执行失败: ${(error as Error).message}`,
        is_error: true,
      });
    }
  }

  heartbeat?.();

  newMessages.push({
    role: 'user',
    content: toolResults,
  });

  if (depth >= KEEP_RECENT_TOOL_ROUNDS) {
    newMessages = compressToolHistory(newMessages, KEEP_RECENT_TOOL_ROUNDS);
  }

  const nextResponse = await streamFollowUp(newMessages, options, heartbeat);

  if (nextResponse.stop_reason === 'tool_use') {
    return handleToolUseInternal(nextResponse, newMessages, executeTool, options, depth + 1, heartbeat);
  }

  return extractText(nextResponse);
}

// ==================== Provider 实现 ====================

const anthropicProvider: AIProviderPlugin = {
  name: 'anthropic-provider',
  version: '1.0.0',
  description: 'Anthropic AI Provider - 支持 Claude 等模型',

  async init(config: PluginConfig): Promise<void> {
    model = config.model as string || process.env.AI_MODEL || process.env.ANTHROPIC_MODEL || (isMockMode() ? 'mock-model' : 'claude-sonnet-4-20250514');

    if (isMockMode()) {
      client = null;
      return;
    }

    const apiKey = config.apiKey as string || process.env.ANTHROPIC_AUTH_TOKEN || process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error('Missing API key: ANTHROPIC_AUTH_TOKEN or ANTHROPIC_API_KEY');
    }

    baseURL = config.baseURL as string || process.env.ANTHROPIC_BASE_URL || undefined;

    client = new Anthropic({
      apiKey,
      baseURL,
      maxRetries: 0,
      timeout: config.timeout ? Number(config.timeout) : 60000,
    });
  },

  async chat(
    messages: ChatMessage[],
    options?: ChatOptions
  ): Promise<Anthropic.Message> {
    if (isMockMode()) {
      return createMockResponse(messages, options);
    }

    if (!client) {
      throw new Error('Provider not initialized. Call init() first.');
    }

    const params: Anthropic.MessageCreateParams = {
      model: model,
      max_tokens: options?.maxTokens ?? 4096,
      messages: messages.map(msg => ({
        role: msg.role,
        content: msg.content,
      })),
    };

    if (options?.system) {
      params.system = options.system;
    }

    if (options?.tools && options.tools.length > 0) {
      params.tools = options.tools as unknown as Anthropic.Tool[];
    }

    if (options?.temperature !== undefined) {
      params.temperature = options.temperature;
    }

    if (options?.stopSequences && options.stopSequences.length > 0) {
      params.stop_sequences = options.stopSequences;
    }

    try {
      return await client.messages.create(params);
    } catch (err) {
      const detail = extractFullErrorMessage(err);
      throw new Error(`Anthropic API 请求失败 (${baseURL || 'default'}): ${detail}`);
    }
  },

  async *chatStream(
    messages: ChatMessage[],
    options?: ChatOptions
  ): AsyncGenerator<StreamEvent> {
    if (isMockMode()) {
      const response = await createMockResponse(messages, options);
      for (const block of response.content) {
        if (block.type === 'text') {
          yield { type: 'text', text: block.text };
        } else if (block.type === 'tool_use') {
          yield {
            type: 'tool_use',
            id: block.id,
            name: block.name,
            input: block.input,
          };
        }
      }
      yield { type: 'done', message: response };
      return;
    }

    if (!client) {
      throw new Error('Provider not initialized. Call init() first.');
    }

    const params: Anthropic.MessageCreateParams = {
      model: model,
      max_tokens: options?.maxTokens ?? 4096,
      messages: messages.map(msg => ({
        role: msg.role,
        content: msg.content,
      })),
      stream: true,
    };

    if (options?.system) {
      params.system = options.system;
    }

    if (options?.tools && options.tools.length > 0) {
      params.tools = options.tools as unknown as Anthropic.Tool[];
    }

    if (options?.temperature !== undefined) {
      params.temperature = options.temperature;
    }

    let stream;
    try {
      stream = await client.messages.create(params);
    } catch (err) {
      const detail = extractFullErrorMessage(err);
      throw new Error(`Anthropic API 请求失败 (${baseURL || 'default'}): ${detail}`);
    }

    let finalMessage: Anthropic.Message | null = null;
    const contentBlocks: Array<Anthropic.TextBlock | Anthropic.ToolUseBlock> = [];
    const partialJsonParts = new Map<number, string[]>();

    for await (const event of stream as AsyncIterable<Anthropic.MessageStreamEvent>) {
      if (event.type === 'message_start') {
        finalMessage = event.message as Anthropic.Message;
      } else if (event.type === 'content_block_start') {
        const block = event.content_block;
        if (block.type === 'text') {
          contentBlocks[event.index] = { type: 'text' as const, text: '', citations: null };
        } else if (block.type === 'tool_use') {
          contentBlocks[event.index] = {
            type: 'tool_use' as const,
            id: block.id,
            name: block.name,
            input: {},
          };
          partialJsonParts.set(event.index, []);
        }
      } else if (event.type === 'content_block_delta') {
        const delta = event.delta;
        if ('text' in delta) {
          const block = contentBlocks[event.index];
          if (block?.type === 'text') {
            block.text += delta.text;
          }
          yield { type: 'text', text: delta.text };
        } else if ('partial_json' in delta) {
          const parts = partialJsonParts.get(event.index);
          if (parts) {
            parts.push(delta.partial_json);
          }
        }
      } else if (event.type === 'content_block_stop') {
        const block = contentBlocks[event.index];
        if (block?.type === 'tool_use') {
          const parts = partialJsonParts.get(event.index);
          if (parts && parts.length > 0) {
            try {
              block.input = JSON.parse(parts.join(''));
            } catch {
              block.input = {};
            }
          }
        }
      } else if (event.type === 'message_delta') {
        if (finalMessage) {
          finalMessage.stop_reason = event.delta.stop_reason ?? finalMessage.stop_reason;
          if (event.usage) {
            finalMessage.usage.output_tokens = event.usage.output_tokens;
          }
        }
      }
    }

    if (finalMessage) {
      finalMessage.content = contentBlocks.filter(
        (block): block is Anthropic.TextBlock | Anthropic.ToolUseBlock => block != null
      );

      for (const block of finalMessage.content) {
        if (block.type === 'tool_use') {
          yield {
            type: 'tool_use',
            id: block.id,
            name: block.name,
            input: block.input,
          };
        }
      }

      yield { type: 'done', message: finalMessage };
    }
  },

  async handleToolUse(
    response: unknown,
    messages: ChatMessage[],
    executeTool: ToolExecutor,
    options?: ChatOptions,
    heartbeat?: HeartbeatCallback
  ): Promise<string> {
    const anthropicResponse = response as Anthropic.Message;

    if (isMockMode()) {
      const toolUseBlocks = anthropicResponse.content.filter(
        (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use'
      );

      if (toolUseBlocks.length === 0) {
        return extractText(anthropicResponse);
      }

      const results: string[] = [];
      for (const toolUse of toolUseBlocks) {
        heartbeat?.();
        const result = await executeTool(toolUse.name, toolUse.input);
        results.push(typeof result === 'string' ? result : JSON.stringify(result));
      }
      return results.join('\n');
    }

    const apiMessages: Anthropic.MessageParam[] = messages.map(msg => ({
      role: msg.role as 'user' | 'assistant',
      content: msg.content,
    }));

    return handleToolUseInternal(anthropicResponse, apiMessages, executeTool, options, 0, heartbeat);
  },

  getModel(): string {
    return model;
  },

  setModel(newModel: string): void {
    model = newModel;
  },
};

export default anthropicProvider;

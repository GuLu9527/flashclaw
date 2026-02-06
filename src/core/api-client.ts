/**
 * FlashClaw API 客户端
 * 直接调用 Anthropic API，支持 MiniMax 等兼容 API
 * 
 * 特性：
 * - 支持多模型提供商
 * - 工具调用 (Tool Use)
 * - 流式响应 (Streaming)
 * - 错误重试
 */

import Anthropic from '@anthropic-ai/sdk';

// ==================== 类型定义 ====================

/**
 * API 配置
 */
export interface ApiConfig {
  /** API 密钥 */
  apiKey: string;
  /** 自定义 API 端点（支持 MiniMax 等兼容 API） */
  baseURL?: string;
  /** 模型名称 */
  model?: string;
  /** 最大重试次数 */
  maxRetries?: number;
  /** 请求超时时间（毫秒） */
  timeout?: number;
}

/**
 * 图片内容块
 */
export interface ImageBlock {
  type: 'image';
  source: {
    type: 'base64';
    media_type: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp';
    data: string;
  };
}

/**
 * 文本内容块
 */
export interface TextBlock {
  type: 'text';
  text: string;
}

/**
 * 消息内容类型
 */
export type MessageContent = string | (TextBlock | ImageBlock)[];

/**
 * 聊天消息
 */
export interface ChatMessage {
  /** 角色：user 或 assistant */
  role: 'user' | 'assistant';
  /** 消息内容 - 可以是纯文本或包含图片的数组 */
  content: MessageContent;
}

/**
 * 工具定义 Schema
 */
export interface ToolSchema {
  /** 工具名称 */
  name: string;
  /** 工具描述 */
  description: string;
  /** 参数 JSON Schema */
  input_schema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

/**
 * 聊天选项
 */
export interface ChatOptions {
  /** 系统提示词 */
  system?: string;
  /** 可用工具列表 */
  tools?: ToolSchema[];
  /** 最大输出 token 数 */
  maxTokens?: number;
  /** 温度参数 (0-1) */
  temperature?: number;
  /** 停止序列 */
  stopSequences?: string[];
}

/**
 * 流式事件类型
 */
export type StreamEvent = 
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'done'; message: Anthropic.Message };

/**
 * 工具执行器类型
 */
export type ToolExecutor = (name: string, params: unknown) => Promise<unknown>;

// ==================== Mock API (E2E) ====================

const MOCK_RESPONSE_PREFIX = process.env.FLASHCLAW_MOCK_RESPONSE_PREFIX || 'MOCK';
const MOCK_TOOL_MARKER = process.env.FLASHCLAW_MOCK_TOOL_MARKER || '[tool:send_message]';

function contentToText(content: MessageContent): string {
  if (typeof content === 'string') return content;
  return content
    .filter(block => block.type === 'text')
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

function shouldMockToolUse(prompt: string, tools?: ToolSchema[]): boolean {
  if (!tools || tools.length === 0) return false;
  if (process.env.FLASHCLAW_MOCK_FORCE_TOOL === '1') return true;
  return prompt.includes(MOCK_TOOL_MARKER);
}

function buildMockMessage(params: {
  content: Array<TextBlock | { type: 'tool_use'; id: string; name: string; input: unknown }>;
  stopReason: 'end_turn' | 'tool_use';
  model: string;
}): Anthropic.Message {
  const message = {
    id: `mock-${Date.now()}`,
    type: 'message',
    role: 'assistant',
    model: params.model,
    content: params.content,
    stop_reason: params.stopReason,
    stop_sequence: null,
    usage: {
      input_tokens: 1,
      output_tokens: 1,
    },
  };
  return message as unknown as Anthropic.Message;
}

// ==================== API 客户端实现 ====================

/**
 * FlashClaw API 客户端
 * 
 * @example
 * ```typescript
 * const client = new ApiClient({
 *   apiKey: process.env.ANTHROPIC_API_KEY!,
 * });
 * 
 * const response = await client.chat([
 *   { role: 'user', content: '你好！' }
 * ]);
 * 
 * console.log(response.content[0]);
 * ```
 */
export class ApiClient {
  private client: Anthropic;
  private model: string;
  private maxRetries: number;
  private timeout: number;
  
  constructor(config: ApiConfig) {
    this.client = new Anthropic({
      apiKey: config.apiKey,
      baseURL: config.baseURL,
      maxRetries: 0,  // 禁用 SDK 重试，由 chat() 方法统一处理
      timeout: config.timeout ?? 60000,
    });
    this.model = config.model || 'claude-sonnet-4-20250514'; // 注意：调用方应传入 DEFAULT_AI_MODEL
    this.maxRetries = config.maxRetries ?? 3;
    this.timeout = config.timeout ?? 60000;
  }
  
  /**
   * 发送消息并获取回复
   * 
   * @param messages - 聊天消息历史
   * @param options - 聊天选项
   * @returns API 响应消息
   * 
   * @example
   * ```typescript
   * const response = await client.chat(
   *   [{ role: 'user', content: '解释量子计算' }],
   *   { system: '你是一位物理学教授', maxTokens: 1024 }
   * );
   * ```
   */
  async chat(
    messages: ChatMessage[],
    options?: ChatOptions
  ): Promise<Anthropic.Message> {
    const params: Anthropic.MessageCreateParams = {
      model: this.model,
      max_tokens: options?.maxTokens ?? 4096,
      messages: messages.map(msg => ({
        role: msg.role,
        content: msg.content,
      })),
    };
    
    // 添加系统提示词
    if (options?.system) {
      params.system = options.system;
    }
    
    // 添加工具
    if (options?.tools && options.tools.length > 0) {
      params.tools = options.tools;
    }
    
    // 添加温度
    if (options?.temperature !== undefined) {
      params.temperature = options.temperature;
    }
    
    // 添加停止序列
    if (options?.stopSequences && options.stopSequences.length > 0) {
      params.stop_sequences = options.stopSequences;
    }
    
    // 发送请求，带重试
    let lastError: Error | null = null;
    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      try {
        const response = await this.client.messages.create(params);
        return response;
      } catch (error) {
        lastError = error as Error;
        
        // 判断是否可重试
        if (this.isRetryableError(error)) {
          // 指数退避
          const delay = Math.min(1000 * Math.pow(2, attempt), 10000);
          await this.sleep(delay);
          continue;
        }
        
        // 不可重试的错误直接抛出
        throw error;
      }
    }
    
    throw lastError || new Error('API 请求失败');
  }
  
  /**
   * 流式发送消息
   * 
   * @param messages - 聊天消息历史
   * @param options - 聊天选项
   * @returns 异步迭代器，产生流式事件
   * 
   * @example
   * ```typescript
   * for await (const event of client.chatStream(messages)) {
   *   if (event.type === 'text') {
   *     process.stdout.write(event.text);
   *   }
   * }
   * ```
   */
  async *chatStream(
    messages: ChatMessage[],
    options?: ChatOptions
  ): AsyncGenerator<StreamEvent> {
    const params: Anthropic.MessageCreateParams = {
      model: this.model,
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
      params.tools = options.tools;
    }
    
    if (options?.temperature !== undefined) {
      params.temperature = options.temperature;
    }
    
    const stream = await this.client.messages.create(params);
    
    // 处理流式响应
    let finalMessage: Anthropic.Message | null = null;
    
    // 追踪所有 content blocks（text 和 tool_use），从流式事件中组装完整消息
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
          // 累积文本内容并实时输出
          const block = contentBlocks[event.index];
          if (block?.type === 'text') {
            block.text += delta.text;
          }
          yield { type: 'text', text: delta.text };
        } else if ('partial_json' in delta) {
          // 累积工具调用的 JSON 片段
          const parts = partialJsonParts.get(event.index);
          if (parts) {
            parts.push(delta.partial_json);
          }
        }
      } else if (event.type === 'content_block_stop') {
        // tool_use block 完成后，从累积的片段解析完整 JSON
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
        // 更新 stop_reason 和 usage
        if (finalMessage) {
          finalMessage.stop_reason = event.delta.stop_reason ?? finalMessage.stop_reason;
          if (event.usage) {
            finalMessage.usage.output_tokens = event.usage.output_tokens;
          }
        }
      }
    }
    
    // 从收集的流式数据组装完整消息（无需再发 API 请求）
    if (finalMessage) {
      finalMessage.content = contentBlocks.filter(
        (block): block is Anthropic.TextBlock | Anthropic.ToolUseBlock => block != null
      );
      
      // 发出 tool_use 事件
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
  }
  
  /**
   * 处理工具调用
   * 自动执行工具并获取最终回复
   * 
   * @param response - 包含工具调用的 API 响应
   * @param messages - 原始消息历史
   * @param executeTool - 工具执行函数
   * @param options - 聊天选项（用于后续请求）
   * @returns 最终文本回复
   * 
   * @example
   * ```typescript
   * const response = await client.chat(messages, { tools });
   * 
   * if (response.stop_reason === 'tool_use') {
   *   const finalText = await client.handleToolUse(
   *     response,
   *     messages,
   *     async (name, params) => {
   *       // 执行工具逻辑
   *       return { result: 'done' };
   *     }
   *   );
   * }
   * ```
   */
  async handleToolUse(
    response: Anthropic.Message,
    messages: ChatMessage[],
    executeTool: ToolExecutor,
    options?: ChatOptions
  ): Promise<string> {
    // 将 ChatMessage[] 转换为 Anthropic.MessageParam[] 后调用内部方法
    const apiMessages: Anthropic.MessageParam[] = messages.map(msg => ({
      role: msg.role as 'user' | 'assistant',
      content: msg.content,
    }));
    return this.handleToolUseInternal(response, apiMessages, executeTool, options);
  }
  
  /** 最大工具调用递归深度，防止无限递归导致栈溢出 */
  private static readonly MAX_TOOL_CALL_DEPTH = 20;

  /**
   * 内部工具调用处理（保持完整的 Anthropic.MessageParam[] 格式）
   * 递归时不需要格式转换，保持 tool_use 和 tool_result 的完整结构
   */
  private async handleToolUseInternal(
    response: Anthropic.Message,
    messages: Anthropic.MessageParam[],
    executeTool: ToolExecutor,
    options?: ChatOptions,
    depth: number = 0
  ): Promise<string> {
    // 防止无限递归
    if (depth >= ApiClient.MAX_TOOL_CALL_DEPTH) {
      return this.extractText(response) || `[工具调用链过深（超过 ${ApiClient.MAX_TOOL_CALL_DEPTH} 轮），已强制终止]`;
    }
    // 检查是否有工具调用
    const toolUseBlocks = response.content.filter(
      (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use'
    );
    
    if (toolUseBlocks.length === 0) {
      // 没有工具调用，提取文本回复
      return this.extractText(response);
    }
    
    // 在已有消息基础上追加 assistant 回复（包含完整的 tool_use blocks）
    const newMessages: Anthropic.MessageParam[] = [
      ...messages,
      {
        role: 'assistant' as const,
        content: response.content,
      },
    ];
    
    // 执行所有工具并收集结果
    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    
    for (const toolUse of toolUseBlocks) {
      try {
        const result = await executeTool(toolUse.name, toolUse.input);
        toolResults.push({
          type: 'tool_result',
          tool_use_id: toolUse.id,
          content: typeof result === 'string' ? result : JSON.stringify(result),
        });
      } catch (error) {
        // 工具执行失败，返回错误信息
        toolResults.push({
          type: 'tool_result',
          tool_use_id: toolUse.id,
          content: `工具执行失败: ${(error as Error).message}`,
          is_error: true,
        });
      }
    }
    
    // 添加工具结果（完整的 tool_result blocks）
    newMessages.push({
      role: 'user',
      content: toolResults,
    });
    
    // 发送后续请求
    const params: Anthropic.MessageCreateParams = {
      model: this.model,
      max_tokens: options?.maxTokens ?? 4096,
      messages: newMessages,
    };
    
    if (options?.system) {
      params.system = options.system;
    }
    
    if (options?.tools && options.tools.length > 0) {
      params.tools = options.tools;
    }
    
    const nextResponse = await this.client.messages.create(params);
    
    // 递归处理多轮工具调用，保持完整消息结构
    if (nextResponse.stop_reason === 'tool_use') {
      return this.handleToolUseInternal(nextResponse, newMessages, executeTool, options, depth + 1);
    }
    
    return this.extractText(nextResponse);
  }
  
  /**
   * 从响应中提取文本内容
   * 
   * @param response - API 响应
   * @returns 文本内容
   */
  extractText(response: Anthropic.Message): string {
    const textBlocks = response.content.filter(
      (block): block is Anthropic.TextBlock => block.type === 'text'
    );
    return textBlocks.map(block => block.text).join('');
  }
  
  /**
   * 获取当前使用的模型
   */
  getModel(): string {
    return this.model;
  }
  
  /**
   * 设置模型
   * 
   * @param model - 模型名称
   */
  setModel(model: string): void {
    this.model = model;
  }
  
  /**
   * 判断错误是否可重试
   */
  private isRetryableError(error: unknown): boolean {
    if (error instanceof Anthropic.APIError) {
      // 429 Rate Limit, 500+ Server Error 可重试
      return error.status === 429 || error.status >= 500;
    }
    // 网络错误可重试
    if (error instanceof Error && error.message.includes('fetch')) {
      return true;
    }
    return false;
  }
  
  /**
   * 延迟函数
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

class MockApiClient extends ApiClient {
  private mockModel = 'mock-model';

  constructor() {
    super({ apiKey: 'mock' });
  }

  override async chat(
    messages: ChatMessage[],
    options?: ChatOptions
  ): Promise<Anthropic.Message> {
    const prompt = getLastUserText(messages);
    const tools = options?.tools;
    const useTool = shouldMockToolUse(prompt, tools);

    if (useTool && tools && tools.length > 0) {
      const toolName = tools.find(t => t.name === 'send_message')?.name || tools[0].name;
      const toolInput = { content: `${MOCK_RESPONSE_PREFIX} TOOL: ${prompt}` };
      return buildMockMessage({
        model: this.mockModel,
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

    const text = `${MOCK_RESPONSE_PREFIX}: ${prompt}`;
    return buildMockMessage({
      model: this.mockModel,
      stopReason: 'end_turn',
      content: [{ type: 'text', text }],
    });
  }

  override async *chatStream(
    messages: ChatMessage[],
    options?: ChatOptions
  ): AsyncGenerator<StreamEvent> {
    const response = await this.chat(messages, options);
    const text = this.extractText(response);
    if (text) {
      yield { type: 'text', text };
    }
    yield { type: 'done', message: response };
  }

  override async handleToolUse(
    response: Anthropic.Message,
    _messages: ChatMessage[],
    executeTool: ToolExecutor
  ): Promise<string> {
    const toolUseBlocks = response.content.filter(
      (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use'
    );

    if (toolUseBlocks.length === 0) {
      return this.extractText(response);
    }

    const results: string[] = [];
    for (const toolUse of toolUseBlocks) {
      const result = await executeTool(toolUse.name, toolUse.input);
      results.push(typeof result === 'string' ? result : JSON.stringify(result));
    }
    return results.join('\n');
  }

  override extractText(response: Anthropic.Message): string {
    const textBlocks = response.content.filter(
      (block): block is Anthropic.TextBlock => block.type === 'text'
    );
    return textBlocks.map(block => block.text).join('');
  }

  override getModel(): string {
    return this.mockModel;
  }

  override setModel(model: string): void {
    this.mockModel = model;
  }
}

// ==================== 工厂函数 ====================

/**
 * 创建默认 API 客户端
 * 从环境变量读取配置
 * 
 * @returns API 客户端实例，如果配置缺失则返回 null
 */
export function createApiClient(): ApiClient | null {
  if (process.env.FLASHCLAW_MOCK_API === '1') {
    return new MockApiClient();
  }
  // 支持两种环境变量名（兼容不同配置）
  const apiKey = process.env.ANTHROPIC_AUTH_TOKEN || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return null;
  }
  
  return new ApiClient({
    apiKey,
    baseURL: process.env.ANTHROPIC_BASE_URL,
    model: process.env.AI_MODEL || process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514',
    maxRetries: process.env.API_MAX_RETRIES ? (parseInt(process.env.API_MAX_RETRIES, 10) || undefined) : undefined,
    timeout: process.env.API_TIMEOUT ? (parseInt(process.env.API_TIMEOUT, 10) || undefined) : undefined,
  });
}

// ==================== 全局单例 ====================

// 声明全局类型
declare global {
  // eslint-disable-next-line no-var
  var __flashclaw_api_client: ApiClient | null | undefined;
}

/**
 * 获取全局 API 客户端单例
 * 确保 jiti 热加载的插件访问同一实例
 * 
 * @returns API 客户端实例，如果配置缺失则返回 null
 */
export function getApiClient(): ApiClient | null {
  if (global.__flashclaw_api_client === undefined) {
    global.__flashclaw_api_client = createApiClient();
  }
  return global.__flashclaw_api_client;
}

/**
 * 重置 API 客户端（用于配置变更后重新初始化）
 */
export function resetApiClient(): void {
  global.__flashclaw_api_client = undefined;
}

/**
 * FlashClaw 插件类型定义
 * 乐高式架构 - 放进去就能用
 */

// 插件配置
export interface PluginConfig {
  [key: string]: unknown;
}

// 工具上下文
export interface ToolContext {
  chatId: string;
  groupId: string;
  userId: string;  // 用户 ID，用于用户级别记忆
  sendMessage: (content: string) => Promise<void>;
  sendImage: (imageData: string, caption?: string) => Promise<void>;  // 发送图片（data URL 或 base64）
}

// 工具执行结果
export interface ToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
}

// 附件类型
export interface Attachment {
  type: 'image' | 'video' | 'audio' | 'file';
  content?: string;      // data URL (图片) 或本地路径
  mimeType?: string;
  fileName?: string;
  fileKey?: string;      // 飞书文件 key（用于下载）
}

// 消息
export interface Message {
  id: string;
  chatId: string;
  senderId: string;
  senderName: string;
  content: string;
  timestamp: string;
  chatType: 'p2p' | 'group';
  platform: string;
  // 扩展字段
  attachments?: Attachment[];   // 附件列表
  mentions?: string[];          // 被 @ 的用户
  replyToMessageId?: string;    // 回复的消息 ID
  raw?: unknown;                // 平台原始消息
}

// 消息处理器
export type MessageHandler = (message: Message) => Promise<void>;

// 工具 Schema (Anthropic 格式)
export interface ToolSchema {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

// 插件清单 (plugin.json)
export interface PluginManifest {
  name: string;
  version: string;
  type: 'tool' | 'channel' | 'provider';
  description: string;
  author?: string;
  main: string;
  config?: Record<string, {
    type: string;
    required?: boolean;
    env?: string;
    default?: unknown;
  }>;
  dependencies?: string[];
}

// 工具插件接口
export interface ToolPlugin {
  name: string;
  version: string;
  description: string;
  
  // 单工具模式：使用 schema
  schema?: ToolSchema;
  // 多工具模式：使用 tools 数组
  tools?: ToolSchema[];
  
  init?(config: PluginConfig): Promise<void>;
  // 单工具：execute(params, context)
  // 多工具：execute(toolName, params, context)
  execute(paramsOrToolName: unknown, contextOrParams?: ToolContext | unknown, context?: ToolContext): Promise<ToolResult>;
  reload?(): Promise<void>;
  cleanup?(): Promise<void>;
}

// 发送消息选项
export interface SendMessageOptions {
  // "正在思考..." 占位消息 ID，如果提供则更新该消息
  placeholderMessageId?: string;
  // 附件列表
  attachments?: Attachment[];
}

// 发送消息结果
export interface SendMessageResult {
  messageId?: string;
  success: boolean;
  error?: string;
}

// 渠道插件接口
export interface ChannelPlugin {
  name: string;
  version: string;

  init(config: PluginConfig): Promise<void>;
  start(): Promise<void>;
  stop(): Promise<void>;

  onMessage(handler: MessageHandler): void;
  sendMessage(chatId: string, content: string, options?: SendMessageOptions): Promise<SendMessageResult>;

  // 可选的高级方法
  updateMessage?(messageId: string, content: string): Promise<void>;
  deleteMessage?(messageId: string): Promise<void>;
  sendImage?(chatId: string, imageData: string | Buffer, caption?: string): Promise<SendMessageResult>;
  sendFile?(chatId: string, filePath: string, fileName?: string): Promise<SendMessageResult>;

  reload?(): Promise<void>;
}

// ==================== AI Provider 相关类型 ====================

// 图片内容块
export interface ImageBlock {
  type: 'image';
  source: {
    type: 'base64';
    media_type: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp';
    data: string;
  };
}

// 文本内容块
export interface TextBlock {
  type: 'text';
  text: string;
}

// 消息内容类型
export type MessageContent = string | (TextBlock | ImageBlock)[];

// 聊天消息
export interface ChatMessage {
  /** 角色：user 或 assistant */
  role: 'user' | 'assistant';
  /** 消息内容 - 可以是纯文本或包含图片的数组 */
  content: MessageContent;
}

// 工具定义 Schema (Anthropic 格式)
export interface ToolDefinition {
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

// 聊天选项
export interface ChatOptions {
  /** 系统提示词 */
  system?: string;
  /** 可用工具列表 */
  tools?: ToolDefinition[];
  /** 最大输出 token 数 */
  maxTokens?: number;
  /** 温度参数 (0-1) */
  temperature?: number;
  /** 停止序列 */
  stopSequences?: string[];
}

// 流式事件类型
export type StreamEvent =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'done'; message: unknown };

// 工具执行器类型
export type ToolExecutor = (name: string, params: unknown) => Promise<unknown>;

/**
 * 心跳回调 - 用于通知外层（如 agent-runner）工具链仍在活动中
 * 调用此函数可重置活动超时计时器，防止长工具链被误判为超时
 */
export type HeartbeatCallback = () => void;

// AI Provider 插件接口
export interface AIProviderPlugin {
  name: string;
  version: string;
  description: string;

  // 发送聊天消息
  chat(messages: ChatMessage[], options?: ChatOptions): Promise<unknown>;

  // 流式聊天
  chatStream(messages: ChatMessage[], options?: ChatOptions): AsyncGenerator<StreamEvent>;

  // 处理工具调用
  handleToolUse(
    response: unknown,
    messages: ChatMessage[],
    executeTool: ToolExecutor,
    options?: ChatOptions,
    heartbeat?: HeartbeatCallback
  ): Promise<string>;

  // 获取当前模型
  getModel(): string;

  // 设置模型
  setModel(model: string): void;

  // 初始化（可选）
  init?(config: PluginConfig): Promise<void>;

  // 清理资源（可选）
  cleanup?(): Promise<void>;
}

// 插件类型
export type Plugin = ToolPlugin | ChannelPlugin | AIProviderPlugin;

// 类型守卫
export function isToolPlugin(plugin: Plugin): plugin is ToolPlugin {
  return ('schema' in plugin || 'tools' in plugin) && 'execute' in plugin;
}

export function isChannelPlugin(plugin: Plugin): plugin is ChannelPlugin {
  return 'onMessage' in plugin && 'sendMessage' in plugin;
}

export function isAIProviderPlugin(plugin: unknown): plugin is AIProviderPlugin {
  return (
    typeof plugin === 'object' &&
    plugin !== null &&
    'name' in plugin &&
    'version' in plugin &&
    'chat' in plugin &&
    'chatStream' in plugin &&
    'handleToolUse' in plugin &&
    'getModel' in plugin &&
    'setModel' in plugin
  );
}

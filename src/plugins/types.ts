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
  type: 'tool' | 'channel';
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
  schema: ToolSchema;
  
  init?(config: PluginConfig): Promise<void>;
  execute(params: unknown, context: ToolContext): Promise<ToolResult>;
  reload?(): Promise<void>;
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

// 插件类型
export type Plugin = ToolPlugin | ChannelPlugin;

// 类型守卫
export function isToolPlugin(plugin: Plugin): plugin is ToolPlugin {
  return 'schema' in plugin && 'execute' in plugin;
}

export function isChannelPlugin(plugin: Plugin): plugin is ChannelPlugin {
  return 'onMessage' in plugin && 'sendMessage' in plugin;
}

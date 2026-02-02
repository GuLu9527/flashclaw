/**
 * FlashClaw 消息平台抽象层类型定义
 * 所有消息平台客户端都必须实现这些接口
 */

/**
 * 统一消息格式
 */
export interface Message {
  /** 消息唯一 ID */
  id: string;
  /** 聊天/群组 ID */
  chatId: string;
  /** 聊天类型 */
  chatType: 'p2p' | 'group';
  /** 发送者 ID */
  senderId: string;
  /** 发送者名称 */
  senderName: string;
  /** 消息内容 */
  content: string;
  /** 时间戳 (ISO 8601) */
  timestamp: string;
  /** 来源平台 */
  platform: string;
  /** @提及列表 */
  mentions?: Array<{
    id: string;
    name: string;
  }>;
  /** 原始消息数据（平台特定） */
  raw?: unknown;
}

/**
 * 消息处理器函数类型
 */
export type MessageHandler = (message: Message) => Promise<void>;

/**
 * 消息客户端接口
 * 所有消息平台必须实现此接口
 */
export interface MessageClient {
  /** 平台标识符 */
  readonly platform: string;
  
  /** 平台显示名称 */
  readonly displayName: string;

  /**
   * 启动客户端，开始接收消息
   * @param handler 消息处理回调
   */
  start(handler: MessageHandler): void;

  /**
   * 停止客户端
   */
  stop(): void;

  /**
   * 发送文本消息
   * @param chatId 目标聊天 ID
   * @param text 消息内容
   */
  sendTextMessage(chatId: string, text: string): Promise<void>;

  /**
   * 判断是否应该在群聊中响应
   * @param message 消息对象
   * @returns 是否应该响应
   */
  shouldRespondInGroup(message: Message): boolean;

  /**
   * 检查是否被 @提及
   * @param message 消息对象
   * @returns 是否被提及
   */
  isBotMentioned(message: Message): boolean;
}

/**
 * 客户端配置
 */
export interface ClientConfig {
  /** 平台标识符 */
  platform: string;
  /** 是否启用 */
  enabled: boolean;
  /** 平台特定配置 */
  options: Record<string, unknown>;
}

/**
 * 客户端工厂函数类型
 */
export type ClientFactory = (config: ClientConfig) => MessageClient;

/**
 * 客户端注册表
 */
export interface ClientRegistry {
  /** 注册客户端工厂 */
  register(platform: string, factory: ClientFactory): void;
  /** 创建客户端实例 */
  create(config: ClientConfig): MessageClient | null;
  /** 获取所有支持的平台 */
  getSupportedPlatforms(): string[];
}

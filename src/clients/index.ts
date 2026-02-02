/**
 * FlashClaw 消息客户端管理器
 * 统一管理所有消息平台客户端
 */

import pino from 'pino';
import { MessageClient, Message, MessageHandler } from './types.js';
import { createFeishuClient } from './feishu.js';
import { createDingtalkClient } from './dingtalk.js';
// 未来添加更多平台：
// import { createTelegramClient } from './telegram.js';

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: { target: 'pino-pretty', options: { colorize: true } }
});

/**
 * 客户端管理器
 * 负责创建、启动和管理所有消息平台客户端
 */
export class ClientManager {
  private clients: MessageClient[] = [];
  private messageHandler: MessageHandler | null = null;
  private running = false;

  /**
   * 初始化所有配置的客户端
   */
  initialize(): void {
    // 尝试创建飞书客户端
    const feishuClient = createFeishuClient();
    if (feishuClient) {
      this.clients.push(feishuClient);
      logger.info({ platform: 'feishu' }, 'Feishu client initialized');
    }

    // 尝试创建钉钉客户端
    const dingtalkClient = createDingtalkClient();
    if (dingtalkClient) {
      this.clients.push(dingtalkClient);
      logger.info({ platform: 'dingtalk' }, 'DingTalk client initialized');
    }

    // 未来添加更多平台：
    // const telegramClient = createTelegramClient();
    // if (telegramClient) {
    //   this.clients.push(telegramClient);
    //   logger.info({ platform: 'telegram' }, 'Telegram client initialized');
    // }

    if (this.clients.length === 0) {
      throw new Error('No message clients configured. Please set up at least one platform (FEISHU_APP_ID/FEISHU_APP_SECRET or DINGTALK_APP_KEY/DINGTALK_APP_SECRET).');
    }

    logger.info({ 
      platforms: this.clients.map(c => c.platform),
      count: this.clients.length 
    }, 'Message clients initialized');
  }

  /**
   * 启动所有客户端
   * @param handler 统一的消息处理回调
   */
  start(handler: MessageHandler): void {
    if (this.running) {
      logger.warn('ClientManager already running');
      return;
    }

    this.messageHandler = handler;
    this.running = true;

    for (const client of this.clients) {
      try {
        client.start(handler);
        logger.info({ platform: client.platform }, 'Client started');
      } catch (err) {
        logger.error({ platform: client.platform, err }, 'Failed to start client');
      }
    }

    logger.info({ count: this.clients.length }, 'All message clients started');
  }

  /**
   * 停止所有客户端
   */
  stop(): void {
    if (!this.running) return;

    for (const client of this.clients) {
      try {
        client.stop();
        logger.info({ platform: client.platform }, 'Client stopped');
      } catch (err) {
        logger.error({ platform: client.platform, err }, 'Failed to stop client');
      }
    }

    this.running = false;
    this.messageHandler = null;
    logger.info('All message clients stopped');
  }

  /**
   * 发送消息到指定聊天
   * 自动选择正确的客户端（基于 chatId 前缀或存储的映射）
   * @param chatId 聊天 ID
   * @param text 消息内容
   * @param platform 可选，指定平台
   */
  async sendMessage(chatId: string, text: string, platform?: string): Promise<void> {
    const client = this.getClientForChat(chatId, platform);
    if (!client) {
      throw new Error(`No client found for chat ${chatId}`);
    }
    await client.sendTextMessage(chatId, text);
  }

  /**
   * 获取指定聊天的客户端
   * @param chatId 聊天 ID
   * @param platform 可选，指定平台
   */
  getClientForChat(chatId: string, platform?: string): MessageClient | null {
    // 如果指定了平台，直接查找
    if (platform) {
      return this.clients.find(c => c.platform === platform) || null;
    }

    // 根据 chatId 格式推断平台
    // 飞书: oc_xxx 或 ou_xxx
    if (chatId.startsWith('oc_') || chatId.startsWith('ou_')) {
      return this.clients.find(c => c.platform === 'feishu') || null;
    }
    
    // 钉钉: cidXXX 或纯数字
    if (chatId.startsWith('cid') || /^\d+$/.test(chatId)) {
      return this.clients.find(c => c.platform === 'dingtalk') || null;
    }

    // 默认返回第一个客户端
    return this.clients[0] || null;
  }

  /**
   * 获取所有客户端
   */
  getClients(): MessageClient[] {
    return [...this.clients];
  }

  /**
   * 获取指定平台的客户端
   */
  getClient(platform: string): MessageClient | null {
    return this.clients.find(c => c.platform === platform) || null;
  }

  /**
   * 检查是否应该在群聊中响应
   */
  shouldRespondInGroup(message: Message): boolean {
    const client = this.getClientForChat(message.chatId, message.platform);
    if (!client) return false;
    return client.shouldRespondInGroup(message);
  }

  /**
   * 检查是否被 @提及
   */
  isBotMentioned(message: Message): boolean {
    const client = this.getClientForChat(message.chatId, message.platform);
    if (!client) return false;
    return client.isBotMentioned(message);
  }

  /**
   * 获取已启用的平台列表
   */
  getEnabledPlatforms(): string[] {
    return this.clients.map(c => c.platform);
  }

  /**
   * 获取平台显示名称
   */
  getPlatformDisplayName(platform: string): string {
    const client = this.clients.find(c => c.platform === platform);
    return client?.displayName || platform;
  }
}

// 导出类型
export * from './types.js';

// 导出各平台客户端（供直接使用）
export { FeishuClient, createFeishuClient } from './feishu.js';
export { DingtalkClient, createDingtalkClient } from './dingtalk.js';
// 未来添加：
// export { TelegramClient, createTelegramClient } from './telegram.js';

/**
 * 创建并初始化客户端管理器
 */
export function createClientManager(): ClientManager {
  const manager = new ClientManager();
  manager.initialize();
  return manager;
}

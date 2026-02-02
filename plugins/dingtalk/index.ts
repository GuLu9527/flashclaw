/**
 * 钉钉通讯渠道插件
 * 使用 Stream API (WebSocket) - 无需公网服务器！
 * 文档: https://open.dingtalk.com/document/orgapp/stream
 */

import pino from 'pino';
import { ChannelPlugin, PluginConfig, MessageHandler, Message } from '../../src/plugins/types.js';

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: { target: 'pino-pretty', options: { colorize: true } }
});

/**
 * 钉钉插件配置接口
 */
interface DingtalkPluginConfig extends PluginConfig {
  appKey: string;
  appSecret: string;
  robotCode?: string;
}

/**
 * 钉钉渠道插件实现
 */
class DingtalkChannelPlugin implements ChannelPlugin {
  name = 'dingtalk';
  version = '1.0.0';

  // 配置
  private config: DingtalkPluginConfig | null = null;
  
  // 消息处理
  private messageHandler: MessageHandler | null = null;
  
  // 消息去重
  private seenMessages: Map<string, number> = new Map();
  private readonly SEEN_TTL_MS = 10 * 60 * 1000; // 10分钟
  
  // 运行状态
  private running = false;
  private accessToken: string = '';
  private ws: any = null;

  /**
   * 初始化插件
   * @param config 插件配置，包含 appKey 和 appSecret
   */
  async init(config: PluginConfig): Promise<void> {
    const dingtalkConfig = config as DingtalkPluginConfig;
    const { appKey, appSecret } = dingtalkConfig;
    
    if (!appKey || !appSecret) {
      throw new Error('钉钉插件需要 appKey 和 appSecret 配置');
    }

    this.config = dingtalkConfig;
    logger.info({ plugin: this.name }, '钉钉插件初始化完成');
  }

  /**
   * 启动 WebSocket 连接，开始接收消息
   */
  async start(): Promise<void> {
    if (this.running) {
      logger.warn({ plugin: this.name }, '钉钉插件已在运行中');
      return;
    }

    if (!this.config) {
      throw new Error('钉钉插件未初始化，请先调用 init()');
    }

    this.running = true;

    try {
      // 获取访问令牌
      await this.getAccessToken();
      
      // 注册 Stream 回调
      const { endpoint, ticket } = await this.registerCallback();
      
      // 连接 WebSocket
      await this.connectWebSocket(endpoint, ticket);
      
      logger.info({ plugin: this.name }, '钉钉 Stream 客户端已启动');
    } catch (err) {
      this.running = false;
      logger.error({ err, plugin: this.name }, '启动钉钉插件失败');
      throw err;
    }
  }

  /**
   * 停止插件
   */
  async stop(): Promise<void> {
    if (!this.running) return;
    
    this.running = false;
    this.messageHandler = null;
    
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    
    logger.info({ plugin: this.name }, '钉钉插件已停止');
  }

  /**
   * 注册消息处理器
   * @param handler 消息处理回调函数
   */
  onMessage(handler: MessageHandler): void {
    this.messageHandler = handler;
  }

  /**
   * 发送文本消息
   * @param chatId 会话 ID
   * @param content 消息内容
   */
  async sendMessage(chatId: string, content: string): Promise<void> {
    if (!this.config) {
      throw new Error('钉钉插件未初始化');
    }

    try {
      // 确保有访问令牌
      if (!this.accessToken) {
        await this.getAccessToken();
      }

      const response = await fetch('https://api.dingtalk.com/v1.0/robot/oToMessages/batchSend', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-acs-dingtalk-access-token': this.accessToken,
        },
        body: JSON.stringify({
          robotCode: this.config.robotCode || this.config.appKey,
          userIds: [], // 将根据 chatId 类型决定
          msgKey: 'sampleText',
          msgParam: JSON.stringify({ content }),
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(`发送消息失败: ${JSON.stringify(errorData)}`);
      }

      logger.info({ chatId, length: content.length, plugin: this.name }, '消息发送成功');
    } catch (err) {
      logger.error({ chatId, err, plugin: this.name }, '发送消息失败');
      throw err;
    }
  }

  /**
   * 重新加载插件（热重载支持）
   */
  async reload(): Promise<void> {
    if (this.config) {
      await this.stop();
      await this.init(this.config);
      await this.start();
      logger.info({ plugin: this.name }, '钉钉插件已重新加载');
    }
  }

  /**
   * 获取钉钉访问令牌
   */
  private async getAccessToken(): Promise<string> {
    if (!this.config) {
      throw new Error('钉钉插件未初始化');
    }

    const params = new URLSearchParams({
      appkey: this.config.appKey,
      appsecret: this.config.appSecret,
    });
    
    const tokenResponse = await fetch(`https://oapi.dingtalk.com/gettoken?${params}`);
    const data = await tokenResponse.json() as { errcode: number; access_token?: string; errmsg?: string };
    
    if (data.errcode !== 0 || !data.access_token) {
      throw new Error(`获取访问令牌失败: ${data.errmsg || '未知错误'}`);
    }
    
    this.accessToken = data.access_token;
    return this.accessToken;
  }

  /**
   * 注册 Stream API 回调
   */
  private async registerCallback(): Promise<{ endpoint: string; ticket: string }> {
    if (!this.config) {
      throw new Error('钉钉插件未初始化');
    }

    const response = await fetch('https://api.dingtalk.com/v1.0/gateway/connections/open', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-acs-dingtalk-access-token': this.accessToken,
      },
      body: JSON.stringify({
        clientId: this.config.appKey,
        clientSecret: this.config.appSecret,
        subscriptions: [
          { type: 'EVENT', topic: '/v1.0/im/bot/messages/get' }
        ],
        ua: 'flashclaw',
      }),
    });

    const data = await response.json() as { endpoint?: string; ticket?: string };
    
    if (!data.endpoint || !data.ticket) {
      throw new Error('注册 Stream 回调失败');
    }

    return { endpoint: data.endpoint, ticket: data.ticket };
  }

  /**
   * 连接 WebSocket
   */
  private async connectWebSocket(endpoint: string, ticket: string): Promise<void> {
    // 动态导入 ws 模块
    const WebSocket = (await import('ws')).default;
    
    const wsUrl = `${endpoint}?ticket=${ticket}`;
    this.ws = new WebSocket(wsUrl);

    this.ws.on('open', () => {
      logger.info({ plugin: this.name }, '钉钉 WebSocket 已连接');
    });

    this.ws.on('message', async (data: Buffer) => {
      try {
        const message = JSON.parse(data.toString());
        await this.handleWebSocketMessage(message);
      } catch (err) {
        logger.error({ err, plugin: this.name }, '处理 WebSocket 消息时出错');
      }
    });

    this.ws.on('close', () => {
      logger.warn({ plugin: this.name }, '钉钉 WebSocket 已断开');
      if (this.running) {
        // 自动重连
        setTimeout(() => this.reconnect(), 5000);
      }
    });

    this.ws.on('error', (err: Error) => {
      logger.error({ err, plugin: this.name }, '钉钉 WebSocket 出错');
    });
  }

  /**
   * 重新连接 WebSocket
   */
  private async reconnect(): Promise<void> {
    if (!this.running) return;
    
    try {
      logger.info({ plugin: this.name }, '正在重新连接钉钉 WebSocket...');
      await this.getAccessToken();
      const { endpoint, ticket } = await this.registerCallback();
      await this.connectWebSocket(endpoint, ticket);
    } catch (err) {
      logger.error({ err, plugin: this.name }, '重连失败');
      setTimeout(() => this.reconnect(), 10000);
    }
  }

  /**
   * 处理 WebSocket 消息
   */
  private async handleWebSocketMessage(data: any): Promise<void> {
    // 处理心跳
    if (data.type === 'SYSTEM' && data.headers?.topic === 'ping') {
      this.ws?.send(JSON.stringify({
        code: 200,
        headers: data.headers,
        message: 'OK',
        data: 'pong',
      }));
      return;
    }

    // 处理消息事件
    if (data.type === 'CALLBACK' && data.headers?.topic === '/v1.0/im/bot/messages/get') {
      const payload = typeof data.data === 'string' ? JSON.parse(data.data) : data.data;
      
      // 确认收到消息
      this.ws?.send(JSON.stringify({
        code: 200,
        headers: data.headers,
        message: 'OK',
        data: 'OK',
      }));

      await this.handleMessageEvent(payload);
    }
  }

  /**
   * 检查消息是否重复（去重）
   */
  private isDuplicate(messageId: string): boolean {
    const now = Date.now();
    
    // 垃圾回收过期的条目
    for (const [k, ts] of this.seenMessages) {
      if (now - ts > this.SEEN_TTL_MS) {
        this.seenMessages.delete(k);
      }
    }
    
    if (!messageId) return false;
    if (this.seenMessages.has(messageId)) return true;
    
    this.seenMessages.set(messageId, now);
    return false;
  }

  /**
   * 处理收到的消息事件
   */
  private async handleMessageEvent(data: any): Promise<void> {
    const conversationId = data.conversationId;
    const msgId = data.msgId;
    
    if (!conversationId || !msgId) return;

    // 去重检查
    if (this.isDuplicate(msgId)) {
      logger.debug({ messageId: msgId }, '重复消息，已忽略');
      return;
    }

    // 目前只处理文本消息
    if (data.msgtype !== 'text' || !data.text?.content) {
      logger.debug({ msgtype: data.msgtype }, '非文本消息，已忽略');
      return;
    }

    const content = data.text.content.trim();
    if (!content) return;

    // 构建统一消息对象
    const msg: Message = {
      id: msgId,
      chatId: conversationId,
      senderId: data.senderStaffId || 'unknown',
      senderName: data.senderNick || data.senderStaffId || 'Unknown',
      content: content,
      timestamp: data.createAt || new Date().toISOString(),
      chatType: data.conversationType === '2' ? 'group' : 'p2p',
      platform: 'dingtalk',
    };

    logger.info({ chatId: conversationId, plugin: this.name }, '收到消息');

    // 调用消息处理器
    if (this.messageHandler) {
      await this.messageHandler(msg);
    }
  }
}

// 导出默认插件实例
const plugin: ChannelPlugin = new DingtalkChannelPlugin();
export default plugin;

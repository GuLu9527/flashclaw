/**
 * DingTalk (钉钉) Client for FlashClaw
 * Implements MessageClient interface
 * Uses Stream API (WebSocket) - no public server required!
 */

import pino from 'pino';
import { MessageClient, Message, MessageHandler } from './types.js';

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: { target: 'pino-pretty', options: { colorize: true } }
});

export interface DingtalkConfig {
  appKey: string;
  appSecret: string;
  robotCode?: string;
}

/**
 * DingTalk client using Stream API (WebSocket long connection)
 * No public server/domain/ngrok needed!
 * 
 * Documentation: https://open.dingtalk.com/document/orgapp/stream
 */
export class DingtalkClient implements MessageClient {
  readonly platform = 'dingtalk';
  readonly displayName = '钉钉';

  private config: DingtalkConfig;
  private messageHandler: MessageHandler | null = null;
  private seenMessages: Map<string, number> = new Map();
  private readonly SEEN_TTL_MS = 10 * 60 * 1000; // 10 minutes
  private running = false;
  private accessToken: string = '';
  private ws: any = null;

  constructor(config: DingtalkConfig) {
    const { appKey, appSecret } = config;
    
    if (!appKey || !appSecret) {
      throw new Error('DINGTALK_APP_KEY and DINGTALK_APP_SECRET are required');
    }

    this.config = config;
  }

  /**
   * Check if we've already processed this message (deduplication)
   */
  private isDuplicate(messageId: string): boolean {
    const now = Date.now();
    
    // Garbage-collect old entries
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
   * Get access token from DingTalk
   */
  private async getAccessToken(): Promise<string> {
    const response = await fetch('https://oapi.dingtalk.com/gettoken', {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });
    
    const params = new URLSearchParams({
      appkey: this.config.appKey,
      appsecret: this.config.appSecret,
    });
    
    const tokenResponse = await fetch(`https://oapi.dingtalk.com/gettoken?${params}`);
    const data = await tokenResponse.json() as { errcode: number; access_token?: string; errmsg?: string };
    
    if (data.errcode !== 0 || !data.access_token) {
      throw new Error(`Failed to get access token: ${data.errmsg || 'Unknown error'}`);
    }
    
    this.accessToken = data.access_token;
    return this.accessToken;
  }

  /**
   * Register callback for Stream API
   */
  private async registerCallback(): Promise<{ endpoint: string; ticket: string }> {
    // 使用钉钉 Stream API 注册回调
    // 文档: https://open.dingtalk.com/document/orgapp/stream
    
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
      throw new Error('Failed to register Stream callback');
    }

    return { endpoint: data.endpoint, ticket: data.ticket };
  }

  /**
   * Connect to WebSocket
   */
  private async connectWebSocket(endpoint: string, ticket: string): Promise<void> {
    // 动态导入 ws 模块
    const WebSocket = (await import('ws')).default;
    
    const wsUrl = `${endpoint}?ticket=${ticket}`;
    this.ws = new WebSocket(wsUrl);

    this.ws.on('open', () => {
      logger.info({ platform: this.platform }, 'DingTalk WebSocket connected');
    });

    this.ws.on('message', async (data: Buffer) => {
      try {
        const message = JSON.parse(data.toString());
        await this.handleWebSocketMessage(message);
      } catch (err) {
        logger.error({ err, platform: this.platform }, 'Error handling WebSocket message');
      }
    });

    this.ws.on('close', () => {
      logger.warn({ platform: this.platform }, 'DingTalk WebSocket closed');
      if (this.running) {
        // 重连
        setTimeout(() => this.reconnect(), 5000);
      }
    });

    this.ws.on('error', (err: Error) => {
      logger.error({ err, platform: this.platform }, 'DingTalk WebSocket error');
    });
  }

  /**
   * Reconnect WebSocket
   */
  private async reconnect(): Promise<void> {
    if (!this.running) return;
    
    try {
      logger.info({ platform: this.platform }, 'Reconnecting DingTalk WebSocket...');
      await this.getAccessToken();
      const { endpoint, ticket } = await this.registerCallback();
      await this.connectWebSocket(endpoint, ticket);
    } catch (err) {
      logger.error({ err, platform: this.platform }, 'Failed to reconnect');
      setTimeout(() => this.reconnect(), 10000);
    }
  }

  /**
   * Handle incoming WebSocket message
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
   * Handle incoming message event
   */
  private async handleMessageEvent(data: any): Promise<void> {
    const conversationId = data.conversationId;
    const msgId = data.msgId;
    
    if (!conversationId || !msgId) return;

    // Deduplication
    if (this.isDuplicate(msgId)) {
      logger.debug({ messageId: msgId }, 'Duplicate message, ignoring');
      return;
    }

    // Only handle text messages for now
    if (data.msgtype !== 'text' || !data.text?.content) {
      logger.debug({ msgtype: data.msgtype }, 'Non-text message, ignoring');
      return;
    }

    const content = data.text.content.trim();
    if (!content) return;

    // Build unified message object
    const msg: Message = {
      id: msgId,
      chatId: conversationId,
      chatType: data.conversationType === '1' ? 'p2p' : 'group',
      senderId: data.senderStaffId || data.senderId || '',
      senderName: data.senderNick || 'Unknown',
      content: content,
      timestamp: data.createAt ? new Date(parseInt(data.createAt)).toISOString() : new Date().toISOString(),
      platform: this.platform,
      mentions: data.atUsers?.map((u: any) => ({ id: u.dingtalkId, name: u.staffId || '' })) || [],
      raw: data,
    };

    logger.info({ chatId: conversationId, platform: this.platform }, 'Message received');

    // Call message handler
    if (this.messageHandler) {
      await this.messageHandler(msg);
    }
  }

  /**
   * Start the client
   */
  async start(handler: MessageHandler): Promise<void> {
    if (this.running) {
      logger.warn('DingTalk client already running');
      return;
    }

    this.messageHandler = handler;
    this.running = true;

    try {
      await this.getAccessToken();
      const { endpoint, ticket } = await this.registerCallback();
      await this.connectWebSocket(endpoint, ticket);
      logger.info({ platform: this.platform }, 'DingTalk Stream client started');
    } catch (err) {
      this.running = false;
      logger.error({ err, platform: this.platform }, 'Failed to start DingTalk client');
      throw err;
    }
  }

  /**
   * Stop the client
   */
  stop(): void {
    if (!this.running) return;
    
    this.running = false;
    this.messageHandler = null;
    
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    
    logger.info({ platform: this.platform }, 'DingTalk client stopped');
  }

  /**
   * Send a text message to a conversation
   */
  async sendTextMessage(chatId: string, text: string): Promise<void> {
    try {
      // 确保有 access token
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
          msgParam: JSON.stringify({ content: text }),
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(`Failed to send message: ${JSON.stringify(errorData)}`);
      }

      logger.info({ chatId, length: text.length, platform: this.platform }, 'Message sent');
    } catch (err) {
      logger.error({ chatId, err, platform: this.platform }, 'Failed to send message');
      throw err;
    }
  }

  /**
   * Check if the message mentions the bot
   */
  isBotMentioned(message: Message): boolean {
    // 钉钉会在 atUsers 中包含被 @ 的机器人
    return (message.mentions?.length || 0) > 0;
  }

  /**
   * Check if we should respond in a group chat
   */
  shouldRespondInGroup(message: Message): boolean {
    // Always respond if mentioned
    if (this.isBotMentioned(message)) return true;

    const text = message.content;
    const t = text.toLowerCase();

    // Question marks
    if (/[？?]$/.test(text)) return true;

    // English question words
    if (/\b(why|how|what|when|where|who|help)\b/.test(t)) return true;

    // Chinese request verbs
    const verbs = ['帮', '麻烦', '请', '能否', '可以', '解释', '看看', '排查', '分析', '总结', '写', '改', '修', '查', '对比', '翻译'];
    if (verbs.some(k => text.includes(k))) return true;

    // Direct address
    if (/^(bot|助手|智能体|flashclaw)[\s,:，：]/i.test(text)) return true;

    return false;
  }
}

/**
 * Create a DingTalk client from environment variables
 */
export function createDingtalkClient(): DingtalkClient | null {
  const appKey = process.env.DINGTALK_APP_KEY;
  const appSecret = process.env.DINGTALK_APP_SECRET;
  const robotCode = process.env.DINGTALK_ROBOT_CODE;
  
  if (!appKey || !appSecret) {
    return null;
  }
  
  return new DingtalkClient({ appKey, appSecret, robotCode });
}

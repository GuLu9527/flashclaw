/**
 * Feishu (Lark) Client for FlashClaw
 * Implements MessageClient interface
 * Uses WebSocket long connection - no public server required!
 */

import * as lark from '@larksuiteoapi/node-sdk';
import pino from 'pino';
import { MessageClient, Message, MessageHandler } from './types.js';

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: { target: 'pino-pretty', options: { colorize: true } }
});

export interface FeishuConfig {
  appId: string;
  appSecret: string;
}

/**
 * Feishu client using WebSocket long connection
 * No public server/domain/ngrok needed!
 */
export class FeishuClient implements MessageClient {
  readonly platform = 'feishu';
  readonly displayName = '飞书';

  private client: lark.Client;
  private wsClient: lark.WSClient;
  private messageHandler: MessageHandler | null = null;
  private seenMessages: Map<string, number> = new Map();
  private readonly SEEN_TTL_MS = 10 * 60 * 1000; // 10 minutes
  private running = false;

  constructor(config: FeishuConfig) {
    const { appId, appSecret } = config;
    
    if (!appId || !appSecret) {
      throw new Error('FEISHU_APP_ID and FEISHU_APP_SECRET are required');
    }

    const sdkConfig = {
      appId,
      appSecret,
      domain: lark.Domain.Feishu,
      appType: lark.AppType.SelfBuild,
    };

    this.client = new lark.Client(sdkConfig);
    
    // Create WebSocket client for long connection (official SDK pattern)
    this.wsClient = new lark.WSClient({
      ...sdkConfig,
      loggerLevel: lark.LoggerLevel.info,
    });
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
   * Start the WebSocket connection and listen for messages
   */
  start(handler: MessageHandler): void {
    if (this.running) {
      logger.warn('Feishu client already running');
      return;
    }

    this.messageHandler = handler;
    this.running = true;

    // Create event dispatcher according to official documentation
    const eventDispatcher = new lark.EventDispatcher({}).register({
      'im.message.receive_v1': async (data: any) => {
        logger.info({ chatId: data?.message?.chat_id, platform: this.platform }, 'Message received');
        try {
          await this.handleMessageEvent(data);
        } catch (err) {
          logger.error({ err, platform: this.platform }, 'Error handling message event');
        }
      },
    });

    // Start WebSocket client with event dispatcher
    this.wsClient.start({ eventDispatcher });
    logger.info({ platform: this.platform }, 'Feishu WebSocket client started');
  }

  /**
   * Stop the client
   */
  stop(): void {
    if (!this.running) return;
    
    this.running = false;
    this.messageHandler = null;
    // Note: lark SDK doesn't expose a stop method for WSClient
    logger.info({ platform: this.platform }, 'Feishu client stopped');
  }

  /**
   * Handle incoming message event
   */
  private async handleMessageEvent(data: any): Promise<void> {
    const { message } = data;
    const chatId = message?.chat_id;
    
    if (!chatId) return;

    // Deduplication - Feishu may deliver the same event more than once
    if (this.isDuplicate(message?.message_id)) {
      logger.debug({ messageId: message?.message_id }, 'Duplicate message, ignoring');
      return;
    }

    // Only handle text messages for now
    if (message?.message_type !== 'text' || !message?.content) {
      logger.debug({ messageType: message?.message_type }, 'Non-text message, ignoring');
      return;
    }

    // Parse content
    let content = '';
    try {
      const parsed = JSON.parse(message.content);
      content = (parsed?.text || '').trim();
    } catch {
      return;
    }

    if (!content) return;

    // Extract mentions
    const mentions: Message['mentions'] = [];
    if (Array.isArray(message?.mentions)) {
      for (const mention of message.mentions) {
        mentions.push({
          id: mention.id?.open_id || mention.id?.user_id || '',
          name: mention.name || '',
        });
      }
    }

    // Clean up @mentions from text
    const cleanContent = content.replace(/@_user_\d+\s*/g, '').trim();

    // Build unified message object
    const msg: Message = {
      id: message.message_id || '',
      chatId: chatId,
      chatType: message.chat_type === 'p2p' ? 'p2p' : 'group',
      senderId: data.sender?.sender_id?.open_id || '',
      senderName: data.sender?.sender_id?.open_id || 'Unknown',
      content: cleanContent,
      timestamp: message.create_time 
        ? new Date(parseInt(message.create_time)).toISOString()
        : new Date().toISOString(),
      platform: this.platform,
      mentions,
      raw: data,
    };

    // Call message handler
    if (this.messageHandler) {
      await this.messageHandler(msg);
    }
  }

  /**
   * Send a text message to a chat
   */
  async sendTextMessage(chatId: string, text: string): Promise<void> {
    try {
      await this.client.im.message.create({
        params: { receive_id_type: 'chat_id' },
        data: {
          receive_id: chatId,
          msg_type: 'text',
          content: JSON.stringify({ text }),
        },
      });
    } catch (err) {
      logger.error({ chatId, err, platform: this.platform }, 'Failed to send message');
      throw err;
    }
  }

  /**
   * Check if the message mentions the bot (has any mentions)
   */
  isBotMentioned(message: Message): boolean {
    return (message.mentions?.length || 0) > 0;
  }

  /**
   * Check if we should respond in a group chat
   * Uses smart detection to avoid spamming
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

    // Direct address (customize this list)
    if (/^(bot|助手|智能体|flashclaw)[\s,:，：]/i.test(text)) return true;

    return false;
  }
}

/**
 * Create a Feishu client from environment variables
 */
export function createFeishuClient(): FeishuClient | null {
  const appId = process.env.FEISHU_APP_ID;
  const appSecret = process.env.FEISHU_APP_SECRET;
  
  if (!appId || !appSecret) {
    return null;
  }
  
  return new FeishuClient({ appId, appSecret });
}

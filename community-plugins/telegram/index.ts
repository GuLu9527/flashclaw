/**
 * FlashClaw Telegram 渠道插件
 * 
 * 功能：
 * - 长轮询模式收发消息（无需公网服务器）
 * - 私聊 + 群聊（@ 触发 / 回复触发）
 * - 图片收发（下载 → base64，发送 base64/Buffer）
 * - 消息编辑/删除（"正在思考..." 更新）
 * - HTTP 代理支持（Bot API + 文件下载统一走代理）
 * 
 * 依赖：grammy (Telegram Bot Framework)
 * 
 * 配置环境变量：
 *   TELEGRAM_BOT_TOKEN  - Bot Token（从 @BotFather 获取）
 *   TELEGRAM_PROXY      - 可选，HTTP 代理地址（如 http://127.0.0.1:7890）
 */

import { Bot, Context, InputFile, type ApiClientOptions } from 'grammy';
import { run, type RunnerHandle } from '@grammyjs/runner';
import { createLogger } from '../../src/logger.js';
import type {
  ChannelPlugin,
  PluginConfig,
  MessageHandler,
  Message,
  SendMessageOptions,
  SendMessageResult,
} from '../../src/plugins/types.js';

const logger = createLogger('TelegramPlugin');

// Telegram 消息长度限制
const MAX_TEXT_LENGTH = 4096;
// 去重 TTL (5 分钟)
const DEDUP_TTL_MS = 5 * 60 * 1000;

/**
 * 将长文本分块（Telegram 单条消息上限 4096 字符）
 */
function chunkText(text: string, limit = MAX_TEXT_LENGTH): string[] {
  if (text.length <= limit) return [text];
  
  const chunks: string[] = [];
  let remaining = text;
  
  while (remaining.length > 0) {
    if (remaining.length <= limit) {
      chunks.push(remaining);
      break;
    }
    // 尝试在换行处断开
    let cutIdx = remaining.lastIndexOf('\n', limit);
    if (cutIdx <= 0) cutIdx = remaining.lastIndexOf(' ', limit);
    if (cutIdx <= 0) cutIdx = limit;
    
    chunks.push(remaining.slice(0, cutIdx));
    remaining = remaining.slice(cutIdx).trimStart();
  }
  
  return chunks;
}

/**
 * 创建代理 fetch（通过 undici ProxyAgent）
 * 同时用于 grammY Bot API 请求和 Telegram 文件下载
 */
async function createProxyFetch(proxyUrl: string): Promise<typeof fetch | null> {
  try {
    const { ProxyAgent } = await import('undici');
    const agent = new ProxyAgent(proxyUrl);
    return ((url: string | URL | Request, init?: RequestInit) => {
      // Node.js 22+ 要求发送 body 时必须设置 duplex: 'half'
      const opts: Record<string, unknown> = { ...init, dispatcher: agent };
      if (init?.body) {
        opts.duplex = 'half';
      }
      return fetch(url, opts as RequestInit);
    }) as typeof fetch;
  } catch (err) {
    logger.warn({ err }, '加载 undici ProxyAgent 失败，将直接连接');
    return null;
  }
}

// ============================================================================
// 插件实现
// ============================================================================

const plugin: ChannelPlugin = {
  name: 'telegram',
  version: '1.0.0',

  // 内部状态
  _bot: null as Bot | null,
  _runner: null as RunnerHandle | null,
  _handler: null as MessageHandler | null,
  _botUsername: '' as string,
  _botId: 0 as number,
  _seenUpdates: new Map<number, number>() as Map<number, number>,
  _token: '' as string,
  _proxyUrl: '' as string,
  _proxyFetch: null as (typeof fetch) | null,  // 代理 fetch，文件下载复用
  _allowedUsers: null as Set<number> | null,   // 用户白名单（null = 不限制）
  _cleanupInterval: null as NodeJS.Timeout | null,  // 去重缓存清理定时器

  async init(config: PluginConfig): Promise<void> {
    const token = (config.botToken as string || process.env.TELEGRAM_BOT_TOKEN || '').trim();
    if (!token) {
      throw new Error(
        'Telegram Bot Token 未配置。\n'
        + '  1. 在 Telegram 中找 @BotFather，发送 /newbot 创建机器人\n'
        + '  2. 设置环境变量 TELEGRAM_BOT_TOKEN=你的Token\n'
        + '  3. 或运行 flashclaw init 进行配置',
      );
    }
    this._token = token;
    this._proxyUrl = (config.proxy as string || process.env.TELEGRAM_PROXY || '').trim();

    // 用户白名单：只允许指定的 Telegram 用户 ID 使用 Bot
    const allowedRaw = (config.allowedUsers as string || process.env.TELEGRAM_ALLOWED_USERS || '').trim();
    if (allowedRaw) {
      this._allowedUsers = new Set(
        allowedRaw.split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n))
      );
      logger.info({ count: (this._allowedUsers as Set<number>).size }, '⚡ 用户白名单已启用');
    }
    
    logger.info({ hasProxy: !!this._proxyUrl }, '⚡ Telegram 插件已初始化');
  },

  onMessage(handler: MessageHandler): void {
    this._handler = handler;
  },

  async start(): Promise<void> {
    const token = this._token as string;
    const proxyUrl = this._proxyUrl as string;
    
    // 构建 Bot 配置
    let clientOptions: ApiClientOptions | undefined;
    
    if (proxyUrl) {
      logger.info({ proxy: proxyUrl }, '使用代理连接 Telegram');
      const proxyFetch = await createProxyFetch(proxyUrl);
      if (proxyFetch) {
        this._proxyFetch = proxyFetch;
        // grammY 的 client.fetch 选项用于替换所有 API 请求的 fetch
        clientOptions = {
          fetch: proxyFetch as unknown as NonNullable<ApiClientOptions['fetch']>,
        };
      }
    }
    
    const bot = new Bot(token, clientOptions ? { client: clientOptions } : undefined);
    this._bot = bot;
    
    // 获取 Bot 信息
    try {
      const me = await bot.api.getMe();
      this._botUsername = me.username || '';
      this._botId = me.id;
      logger.info({ username: this._botUsername, id: this._botId }, '⚡ Telegram Bot 已连接');
    } catch (err) {
      logger.error({ err }, 'Telegram getMe 失败，请检查 Token 和网络/代理');
      throw err;
    }
    
    // 注册消息处理（新消息 + 编辑消息统一走 _handleUpdate）
    bot.on('message', async (ctx: Context) => {
      try {
        await this._handleUpdate(ctx);
      } catch (err) {
        logger.error({ err, chatId: ctx.chat?.id }, '处理 Telegram 消息失败');
      }
    });
    
    bot.on('edited_message', async (ctx: Context) => {
      try {
        await this._handleUpdate(ctx);
      } catch (err) {
        logger.error({ err, chatId: ctx.chat?.id }, '处理 Telegram 编辑消息失败');
      }
    });
    
    // 错误处理
    bot.catch((err) => {
      logger.error({ err: err.error, ctx: err.ctx?.chat?.id }, 'Telegram Bot 错误');
    });
    
    // 启动长轮询（使用 grammyjs/runner 支持并发）
    try {
      this._runner = run(bot, {
        runner: {
          fetch: {
            timeout: 30,
            allowed_updates: ['message', 'edited_message', 'callback_query'],
          },
          silent: true,
        },
      });
      
      logger.info({ username: `@${this._botUsername}` }, '⚡ Telegram 长轮询已启动');
    } catch (err) {
      // 如果 runner 不可用，回退到普通轮询
      logger.warn({ err }, 'grammyjs/runner 不可用，回退到 bot.start()');
      bot.start({
        allowed_updates: ['message', 'edited_message', 'callback_query'],
        onStart: () => {
          logger.info({ username: `@${this._botUsername}` }, '⚡ Telegram 轮询已启动（回退模式）');
        },
      });
    }
    
    // 定期清理去重缓存
    this._cleanupInterval = setInterval(() => {
      const now = Date.now();
      for (const [id, ts] of (this._seenUpdates as Map<number, number>)) {
        if (now - ts > DEDUP_TTL_MS) {
          (this._seenUpdates as Map<number, number>).delete(id);
        }
      }
    }, 60_000);
    (this._cleanupInterval as NodeJS.Timeout).unref?.();
  },

  async stop(): Promise<void> {
    // 停止清理定时器
    if (this._cleanupInterval) {
      clearInterval(this._cleanupInterval as NodeJS.Timeout);
      this._cleanupInterval = null;
    }
    
    // 停止 runner 或 bot
    if (this._runner) {
      const runner = this._runner as RunnerHandle;
      if (runner.isRunning()) {
        await runner.stop();
      }
      this._runner = null;
    } else if (this._bot) {
      await (this._bot as Bot).stop();
    }
    
    this._bot = null;
    this._proxyFetch = null;
    (this._seenUpdates as Map<number, number>).clear();
    
    logger.info('⚡ Telegram 插件已停止');
  },

  async sendMessage(chatId: string, content: string, options?: SendMessageOptions): Promise<SendMessageResult> {
    const bot = this._bot as Bot;
    if (!bot) {
      return { success: false, error: 'Telegram Bot 未启动' };
    }
    
    try {
      const chunks = chunkText(content);
      let lastMessageId: number | undefined;
      
      for (const chunk of chunks) {
        const result = await bot.api.sendMessage(chatId, chunk, {
          parse_mode: undefined, // 纯文本，避免格式解析错误
        });
        lastMessageId = result.message_id;
      }
      
      // 返回 chatId:messageId 格式，与 updateMessage/deleteMessage 保持一致
      return {
        success: true,
        messageId: lastMessageId ? `${chatId}:${lastMessageId}` : undefined,
      };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      logger.error({ chatId, err }, '发送 Telegram 消息失败');
      return { success: false, error };
    }
  },

  async updateMessage(messageId: string, content: string): Promise<void> {
    const bot = this._bot as Bot;
    if (!bot) return;
    
    // messageId 格式：chatId:messageId
    const parts = messageId.split(':');
    if (parts.length !== 2) {
      logger.warn({ messageId }, 'updateMessage: messageId 格式无效，需要 chatId:messageId');
      return;
    }
    
    const [chatId, msgId] = parts;
    
    try {
      const text = content.slice(0, MAX_TEXT_LENGTH);
      await bot.api.editMessageText(chatId, parseInt(msgId, 10), text);
    } catch (err) {
      // "message is not modified" 不是真正的错误
      const errMsg = err instanceof Error ? err.message : String(err);
      if (!errMsg.includes('message is not modified')) {
        logger.warn({ messageId, err }, '编辑 Telegram 消息失败');
      }
    }
  },

  async deleteMessage(messageId: string): Promise<void> {
    const bot = this._bot as Bot;
    if (!bot) return;
    
    const parts = messageId.split(':');
    if (parts.length !== 2) return;
    
    const [chatId, msgId] = parts;
    
    try {
      await bot.api.deleteMessage(chatId, parseInt(msgId, 10));
    } catch (err) {
      logger.warn({ messageId, err }, '删除 Telegram 消息失败');
    }
  },

  async sendImage(chatId: string, imageData: string | Buffer, caption?: string): Promise<SendMessageResult> {
    const bot = this._bot as Bot;
    if (!bot) {
      return { success: false, error: 'Telegram Bot 未启动' };
    }
    
    try {
      let file: InputFile;
      
      if (Buffer.isBuffer(imageData)) {
        file = new InputFile(imageData, 'image.png');
      } else if (typeof imageData === 'string') {
        // 支持 data URL 和纯 base64
        let base64 = imageData;
        if (imageData.startsWith('data:')) {
          const match = imageData.match(/^data:[^;]+;base64,(.+)$/);
          base64 = match ? match[1] : imageData;
        }
        const buffer = Buffer.from(base64, 'base64');
        file = new InputFile(buffer, 'image.png');
      } else {
        return { success: false, error: '不支持的图片格式' };
      }
      
      const result = await bot.api.sendPhoto(chatId, file, {
        caption: caption?.slice(0, 1024), // Telegram caption 限制 1024 字符
      });
      
      return {
        success: true,
        messageId: `${chatId}:${result.message_id}`,
      };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      logger.error({ chatId, err }, '发送 Telegram 图片失败');
      return { success: false, error };
    }
  },

  // ── 内部方法 ─────────────────────────────────────────────

  /**
   * 使用代理或全局 fetch 下载文件
   */
  _fetchWithProxy(url: string, init?: RequestInit): Promise<Response> {
    const proxyFetch = this._proxyFetch as (typeof fetch) | null;
    return (proxyFetch || fetch)(url, init);
  },

  /**
   * 处理收到的消息（新消息 + 编辑消息统一入口）
   */
  async _handleUpdate(ctx: Context): Promise<void> {
    const handler = this._handler as MessageHandler | null;
    if (!handler) return;
    
    const msg = ctx.message || ctx.editedMessage;
    if (!msg) return;
    
    // 去重
    const updateId = ctx.update.update_id;
    if ((this._seenUpdates as Map<number, number>).has(updateId)) return;
    (this._seenUpdates as Map<number, number>).set(updateId, Date.now());
    
    const chat = msg.chat;
    const from = msg.from;
    if (!from) return;
    
    // 忽略 Bot 自己发的消息
    if (from.id === (this._botId as number)) return;
    
    // 用户白名单检查
    const allowed = this._allowedUsers as Set<number> | null;
    if (allowed && !allowed.has(from.id)) {
      logger.debug({ userId: from.id }, '用户不在白名单中，忽略');
      return;
    }
    
    // 判断聊天类型
    const isGroup = chat.type === 'group' || chat.type === 'supergroup';
    const isPrivate = chat.type === 'private';
    
    // 群聊中检查是否被 @ 或回复
    let isMentioned = false;
    const botUsername = this._botUsername as string;
    
    if (isGroup) {
      // 检查文本中的 @mention entity
      if (msg.entities) {
        for (const entity of msg.entities) {
          if (entity.type === 'mention') {
            const mentionText = (msg.text || '').slice(entity.offset, entity.offset + entity.length);
            if (mentionText.toLowerCase() === `@${botUsername.toLowerCase()}`) {
              isMentioned = true;
              break;
            }
          }
        }
      }
      // 检查 caption 中的 @mention entity（图片附带文字）
      if (!isMentioned && msg.caption_entities) {
        for (const entity of msg.caption_entities) {
          if (entity.type === 'mention') {
            const mentionText = (msg.caption || '').slice(entity.offset, entity.offset + entity.length);
            if (mentionText.toLowerCase() === `@${botUsername.toLowerCase()}`) {
              isMentioned = true;
              break;
            }
          }
        }
      }
      // 检查回复是否是对 Bot 的消息
      if (!isMentioned && msg.reply_to_message?.from?.id === (this._botId as number)) {
        isMentioned = true;
      }
    }
    
    // 群聊但未 @ 且不是回复 Bot，跳过
    if (isGroup && !isMentioned) return;
    
    // 提取文本内容
    let textContent = msg.text || msg.caption || '';
    
    // 移除 @bot 前缀
    if (botUsername) {
      textContent = textContent.replace(new RegExp(`@${botUsername}\\s*`, 'gi'), '').trim();
    }
    
    if (!textContent && !msg.photo && !msg.document) {
      return; // 无内容可处理
    }
    
    // 构建附件
    const attachments: Message['attachments'] = [];
    
    // 处理图片（取最大尺寸）
    if (msg.photo && msg.photo.length > 0) {
      const largest = msg.photo[msg.photo.length - 1];
      try {
        const file = await ctx.api.getFile(largest.file_id);
        if (file.file_path) {
          const url = `https://api.telegram.org/file/bot${this._token}/${file.file_path}`;
          // 通过代理下载（如果配置了代理）
          const response = await this._fetchWithProxy(url);
          if (response.ok) {
            const buffer = Buffer.from(await response.arrayBuffer());
            const base64 = `data:image/jpeg;base64,${buffer.toString('base64')}`;
            attachments.push({
              type: 'image',
              content: base64,
              mimeType: 'image/jpeg',
            });
          }
        }
      } catch (err) {
        logger.warn({ err, fileId: largest.file_id }, '下载 Telegram 图片失败');
      }
    }
    
    // 构建 FlashClaw Message
    const message: Message = {
      id: `tg-${msg.message_id}-${chat.id}`,
      chatId: String(chat.id),
      senderId: String(from.id),
      senderName: [from.first_name, from.last_name].filter(Boolean).join(' ') || from.username || String(from.id),
      content: textContent || '[图片]',
      timestamp: new Date(msg.date * 1000).toISOString(),
      chatType: isPrivate ? 'p2p' : 'group',
      platform: 'telegram',
      attachments: attachments.length > 0 ? attachments : undefined,
      mentions: isMentioned ? [botUsername] : undefined,
      replyToMessageId: msg.reply_to_message ? `${chat.id}:${msg.reply_to_message.message_id}` : undefined,
      raw: ctx.update,
    };
    
    await handler(message);
  },
} as ChannelPlugin & Record<string, unknown>;

export default plugin;

/**
 * 飞书通讯渠道插件 v2.0
 * 参考 feishu-openclaw 项目实现
 * 
 * 功能：
 * - WebSocket 长连接（无需公网服务器）
 * - 图片收发
 * - 视频/文件/音频支持
 * - 富文本 (post) 消息解析
 * - "正在思考..." 提示
 * - 群聊智能响应
 * - 消息更新/删除
 */

import * as lark from '@larksuiteoapi/node-sdk';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import pino from 'pino';
import { 
  ChannelPlugin, 
  PluginConfig, 
  MessageHandler, 
  Message, 
  Attachment,
  SendMessageOptions,
  SendMessageResult 
} from '../../src/plugins/types.js';

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: { target: 'pino-pretty', options: { colorize: true } }
});

// ─── 配置 ────────────────────────────────────────────────────────

const MAX_IMAGE_MB = Number(process.env.FEISHU_MAX_IMAGE_MB ?? 12);
const MAX_FILE_MB = Number(process.env.FEISHU_MAX_FILE_MB ?? 40);
const THINKING_THRESHOLD_MS = Number(process.env.FEISHU_THINKING_THRESHOLD_MS ?? 2500);
const DEBUG = process.env.FEISHU_DEBUG === '1';

// ─── 工具函数 ─────────────────────────────────────────────────────

/**
 * 解码 HTML 实体
 */
function decodeHtmlEntities(s: string): string {
  return String(s ?? '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'");
}

/**
 * 规范化飞书文本
 * - 转换 HTML 标签
 * - 修复列表格式（-\n1 → - 1）
 */
function normalizeFeishuText(raw: string): string {
  let t = String(raw ?? '');

  // 转换 HTML 块为换行
  t = t.replace(/<\s*br\s*\/?>/gi, '\n');
  t = t.replace(/<\s*\/p\s*>\s*<\s*p\s*>/gi, '\n');
  t = t.replace(/<\s*p\s*>/gi, '');
  t = t.replace(/<\s*\/p\s*>/gi, '');

  // 移除剩余标签
  t = t.replace(/<[^>]+>/g, '');

  t = decodeHtmlEntities(t);

  // 规范化换行
  t = t.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  t = t.replace(/\n{3,}/g, '\n\n');

  // 修复飞书列表问题："-\n1" -> "- 1"
  t = t.replace(/(^|\n)([-*•])\n(?=\S)/g, '$1$2 ');
  t = t.replace(/(^|\n)(\d+[.)])\n(?=\S)/g, '$1$2 ');

  return t.trim();
}

/**
 * 根据扩展名猜测 MIME 类型
 */
function guessMimeByExt(filePath: string): string {
  const ext = path.extname(filePath || '').toLowerCase().replace(/^\./, '');
  const mimeMap: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    mp4: 'video/mp4',
    mov: 'video/quicktime',
    mp3: 'audio/mpeg',
    wav: 'audio/wav',
    m4a: 'audio/mp4',
    opus: 'audio/opus',
  };
  return mimeMap[ext] || 'application/octet-stream';
}

/**
 * 判断是否为图片路径
 */
function isImagePath(p: string): boolean {
  return /\.(png|jpg|jpeg|gif|webp|bmp)$/i.test(p);
}

/**
 * 判断是否为视频路径
 */
function isVideoPath(p: string): boolean {
  return /\.(mp4|mov|avi|mkv|webm)$/i.test(p);
}

/**
 * 判断是否为音频路径
 */
function isAudioPath(p: string): boolean {
  return /\.(opus|mp3|wav|m4a|aac|ogg)$/i.test(p);
}

/**
 * 文件转 data URL
 */
function fileToDataUrl(filePath: string, mimeType: string): string {
  const buf = fs.readFileSync(filePath);
  const b64 = buf.toString('base64');
  return `data:${mimeType};base64,${b64}`;
}

type ResponseField = 'message_id' | 'image_key' | 'file_key';

type ClosableWsClient = lark.WSClient & {
  close: () => Promise<void> | void;
};

function hasCloseMethod(client: lark.WSClient): client is ClosableWsClient {
  return typeof (client as { close?: unknown }).close === 'function';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object';
}

function extractResponseData(value: unknown): unknown {
  if (isRecord(value) && 'data' in value) {
    return (value as { data?: unknown }).data;
  }
  return value;
}

function getResponseStringField(response: unknown, field: ResponseField): string | undefined {
  const data = extractResponseData(response);
  if (!isRecord(data)) return undefined;
  const candidate = data[field];
  return typeof candidate === 'string' ? candidate : undefined;
}

function isNodeReadableStream(value: unknown): value is NodeJS.ReadableStream {
  return isRecord(value) && typeof value.pipe === 'function';
}

function isWebReadableStream(value: unknown): boolean {
  return isRecord(value) && typeof value.getReader === 'function';
}

/**
 * 将流转换为 Node.js 可读流
 */
function toNodeReadableStream(maybeStream: unknown): Readable | null {
  if (!maybeStream) return null;
  if (isNodeReadableStream(maybeStream)) return maybeStream;
  if (isWebReadableStream(maybeStream) && typeof Readable.fromWeb === 'function') {
    const webStream = maybeStream as unknown as Parameters<typeof Readable.fromWeb>[0];
    return Readable.fromWeb(webStream);
  }
  return null;
}

/**
 * 判断群聊中是否应该响应
 */
function shouldRespondInGroup(text: string, mentions: string[]): boolean {
  // 被 @ 了
  if (mentions.length > 0) return true;
  
  const t = text.toLowerCase();
  
  // 以问号结尾
  if (/[？?]$/.test(text)) return true;
  
  // 包含疑问词
  if (/\b(why|how|what|when|where|who|help)\b/.test(t)) return true;
  
  // 包含请求类动词
  const verbs = ['帮', '麻烦', '请', '能否', '可以', '解释', '看看', '排查', '分析', '总结', '写', '改', '修', '查', '对比', '翻译'];
  if (verbs.some((k) => text.includes(k))) return true;
  
  // 用名字呼唤
  if (/^(bot|助手|智能体|小助手|机器人)[\s,:，：]/i.test(text)) return true;
  
  return false;
}

// ─── 插件配置 ─────────────────────────────────────────────────────

interface FeishuPluginConfig extends PluginConfig {
  appId: string;
  appSecret: string;
}

// ─── 飞书渠道插件 ─────────────────────────────────────────────────

class FeishuChannelPlugin implements ChannelPlugin {
  name = 'feishu';
  version = '2.0.0';

  private client: lark.Client | null = null;
  private wsClient: lark.WSClient | null = null;
  private messageHandler: MessageHandler | null = null;
  private seenMessages: Map<string, number> = new Map();
  private readonly SEEN_TTL_MS = 10 * 60 * 1000;
  private running = false;
  private config: FeishuPluginConfig | null = null;

  // ─── 生命周期 ───────────────────────────────────────────────────

  async init(config: PluginConfig): Promise<void> {
    const feishuConfig = config as FeishuPluginConfig;
    const { appId, appSecret } = feishuConfig;

    if (!appId || !appSecret) {
      throw new Error('飞书插件需要 appId 和 appSecret 配置');
    }

    this.config = feishuConfig;

    const sdkConfig = {
      appId,
      appSecret,
      domain: lark.Domain.Feishu,
      appType: lark.AppType.SelfBuild,
    };

    this.client = new lark.Client(sdkConfig);
    this.wsClient = new lark.WSClient({
      ...sdkConfig,
      loggerLevel: lark.LoggerLevel.info,
    });

    logger.info({ plugin: this.name }, '飞书插件初始化完成');
  }

  onMessage(handler: MessageHandler): void {
    this.messageHandler = handler;
    logger.info({ plugin: this.name }, '消息处理器已注册');
  }

  async start(): Promise<void> {
    if (this.running) {
      logger.warn({ plugin: this.name }, '飞书插件已在运行中');
      return;
    }

    if (!this.wsClient) {
      throw new Error('飞书插件未初始化');
    }

    if (!this.messageHandler) {
      logger.warn({ plugin: this.name }, '警告：消息处理器未设置');
    }

    this.running = true;

    const eventDispatcher = new lark.EventDispatcher({}).register({
      'im.message.receive_v1': async (data: any) => {
        try {
          await this.handleMessageEvent(data);
        } catch (err) {
          logger.error({ err, plugin: this.name }, '处理消息事件时出错');
        }
      },
    });

    this.wsClient.start({ eventDispatcher });
    logger.info({ plugin: this.name }, '飞书 WebSocket 已启动');
  }

  async stop(): Promise<void> {
    this.running = false;
    
    // 关闭 WebSocket 客户端
    // 注意：@larksuiteoapi/node-sdk 的 WSClient 没有暴露显式的 close 方法
    // 通过释放引用让垃圾回收器清理底层连接
    if (this.wsClient) {
      // 尝试调用 close 方法（如果存在）
      if (hasCloseMethod(this.wsClient)) {
        try {
          await this.wsClient.close();
        } catch (err) {
          logger.debug({ err, plugin: this.name }, 'WSClient.close() 调用失败');
        }
      }
      this.wsClient = null;
    }
    
    // 清理 HTTP 客户端引用
    this.client = null;
    
    // 清理消息去重缓存
    this.seenMessages.clear();
    
    logger.info({ plugin: this.name }, '飞书插件已停止');
  }

  async reload(): Promise<void> {
    if (!this.config) return;
    logger.info({ plugin: this.name }, '🔄 热重载中...');
    await this.stop();
    await this.init(this.config);
    await this.start();
    logger.info({ plugin: this.name }, '✅ 热重载完成');
  }

  // ─── 消息发送 ───────────────────────────────────────────────────

  async sendMessage(chatId: string, content: string, options?: SendMessageOptions): Promise<SendMessageResult> {
    if (!this.client) {
      return { success: false, error: '飞书插件未初始化' };
    }

    try {
      // 如果有占位消息，更新它
      if (options?.placeholderMessageId) {
        await this.updateMessage(options.placeholderMessageId, content);
        return { success: true, messageId: options.placeholderMessageId };
      }

      // 发送新消息
      const res = await this.client.im.message.create({
        params: { receive_id_type: 'chat_id' },
        data: {
          receive_id: chatId,
          msg_type: 'text',
          content: JSON.stringify({ text: content }),
        },
      });

      const messageId = getResponseStringField(res, 'message_id');
      logger.info({ chatId, length: content.length, plugin: this.name }, '消息发送成功');
      return { success: true, messageId };
    } catch (err: any) {
      logger.error({ chatId, err, plugin: this.name }, '发送消息失败');
      return { success: false, error: err?.message || String(err) };
    }
  }

  async updateMessage(messageId: string, content: string): Promise<void> {
    if (!this.client) throw new Error('飞书插件未初始化');

    // 飞书只支持更新卡片消息，普通文本消息会失败
    // 抛出错误让主程序执行降级逻辑（删除并重发）
    try {
      await this.client.im.message.patch({
        path: { message_id: messageId },
        data: {
          content: JSON.stringify({ text: content }),
        },
      });
      logger.debug({ messageId, plugin: this.name }, '消息已更新');
    } catch (err: any) {
      // 普通文本消息无法更新，抛出错误触发降级
      logger.debug({ messageId, plugin: this.name }, '消息更新失败，将触发降级发送');
      throw new Error('飞书不支持更新普通文本消息');
    }
  }

  async deleteMessage(messageId: string): Promise<void> {
    if (!this.client) throw new Error('飞书插件未初始化');

    await this.client.im.message.delete({
      path: { message_id: messageId },
    });
    logger.debug({ messageId, plugin: this.name }, '消息已删除');
  }

  async sendImage(chatId: string, imageData: string | Buffer, caption?: string): Promise<SendMessageResult> {
    if (!this.client) {
      return { success: false, error: '飞书插件未初始化' };
    }

    let imagePath: string | undefined;
    let isTemp = false;

    try {

      // 处理不同格式的图片数据
      if (typeof imageData === 'string') {
        if (imageData.startsWith('data:')) {
          // data URL
          const match = imageData.match(/^data:([^;]+);base64,(.*)$/);
          if (!match) {
            return { success: false, error: '无效的 data URL' };
          }
          const b64 = match[2];
          imagePath = path.join(os.tmpdir(), `feishu_upload_${Date.now()}.png`);
          fs.writeFileSync(imagePath, Buffer.from(b64, 'base64'));
          isTemp = true;
        } else if (imageData.startsWith('http')) {
          // HTTP URL - 需要先下载
          return { success: false, error: '暂不支持 HTTP URL 图片' };
        } else {
          // 本地路径
          imagePath = imageData;
        }
      } else {
        // Buffer
        imagePath = path.join(os.tmpdir(), `feishu_upload_${Date.now()}.png`);
        fs.writeFileSync(imagePath, imageData);
        isTemp = true;
      }

      // 上传图片
      const uploadRes = await this.client.im.image.create({
        data: {
          image_type: 'message',
          image: fs.createReadStream(imagePath),
        },
      });

      const imageKey = getResponseStringField(uploadRes, 'image_key');
      if (!imageKey) {
        throw new Error('上传图片失败：未获取到 image_key');
      }

      // 发送图片消息
      const sendRes = await this.client.im.message.create({
        params: { receive_id_type: 'chat_id' },
        data: {
          receive_id: chatId,
          msg_type: 'image',
          content: JSON.stringify({ image_key: imageKey }),
        },
      });

      // 如果有说明文字，再发一条
      if (caption?.trim()) {
        await this.sendMessage(chatId, caption.trim());
      }

      const messageId = getResponseStringField(sendRes, 'message_id');
      logger.info({ chatId, plugin: this.name }, '图片发送成功');
      return { success: true, messageId };
    } catch (err: any) {
      logger.error({ chatId, err, plugin: this.name }, '发送图片失败');
      return { success: false, error: err?.message || String(err) };
    } finally {
      // 清理临时文件（无论成功还是失败都要清理）
      if (isTemp && imagePath) {
        try { fs.unlinkSync(imagePath); } catch {}
      }
    }
  }

  async sendFile(chatId: string, filePath: string, fileName?: string): Promise<SendMessageResult> {
    if (!this.client) {
      return { success: false, error: '飞书插件未初始化' };
    }

    try {
      const actualFileName = fileName || path.basename(filePath);
      const ext = path.extname(filePath).toLowerCase().replace('.', '');

      // 根据文件类型选择上传方式
      let fileType: 'stream' | 'mp4' | 'opus';
      let msgType: 'file' | 'media' | 'audio';

      if (isImagePath(filePath)) {
        // 图片走 sendImage
        return this.sendImage(chatId, filePath);
      } else if (ext === 'mp4') {
        fileType = 'mp4';
        msgType = 'media';
      } else if (ext === 'opus') {
        fileType = 'opus';
        msgType = 'audio';
      } else {
        fileType = 'stream';
        msgType = 'file';
      }

      const uploadRes = await this.client.im.file.create({
        data: {
          file_type: fileType,
          file_name: actualFileName,
          file: fs.createReadStream(filePath),
        },
      });

      const fileKey = getResponseStringField(uploadRes, 'file_key');
      if (!fileKey) {
        throw new Error('上传文件失败：未获取到 file_key');
      }

      const sendRes = await this.client.im.message.create({
        params: { receive_id_type: 'chat_id' },
        data: {
          receive_id: chatId,
          msg_type: msgType,
          content: JSON.stringify({ file_key: fileKey }),
        },
      });

      const messageId = getResponseStringField(sendRes, 'message_id');
      logger.info({ chatId, fileName: actualFileName, plugin: this.name }, '文件发送成功');
      return { success: true, messageId };
    } catch (err: any) {
      logger.error({ chatId, err, plugin: this.name }, '发送文件失败');
      return { success: false, error: err?.message || String(err) };
    }
  }

  // ─── 消息去重 ───────────────────────────────────────────────────

  private isDuplicate(messageId: string): boolean {
    const now = Date.now();
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

  // ─── 图片下载 ───────────────────────────────────────────────────

  private async downloadImage(messageId: string, imageKey: string): Promise<string | null> {
    if (!this.client) return null;

    const tmpPath = path.join(os.tmpdir(), `feishu_recv_${Date.now()}_${Math.random().toString(16).slice(2)}.png`);

    try {
      if (DEBUG) {
        logger.debug({ messageId, imageKey, plugin: this.name }, '下载图片中...');
      }

      const response = await this.client.im.messageResource.get({
        path: { message_id: messageId, file_key: imageKey },
        params: { type: 'image' },
      });

      const payload = extractResponseData(response);

      // 处理不同的响应格式
      if (payload && typeof payload.writeFile === 'function') {
        await payload.writeFile(tmpPath);
      } else if (payload && typeof payload.getReadableStream === 'function') {
        const rs = payload.getReadableStream();
        const nodeRs = toNodeReadableStream(rs);
        if (!nodeRs) throw new Error('getReadableStream() 返回非流');
        const out = fs.createWriteStream(tmpPath);
        await pipeline(nodeRs, out);
      } else if (payload && typeof payload.pipe === 'function') {
        const out = fs.createWriteStream(tmpPath);
        await pipeline(payload, out);
      } else if (Buffer.isBuffer(payload)) {
        fs.writeFileSync(tmpPath, payload);
      } else if (payload instanceof ArrayBuffer) {
        fs.writeFileSync(tmpPath, Buffer.from(payload));
      } else {
        throw new Error(`未知响应类型: ${typeof payload}`);
      }

      // 大小检查
      const st = fs.statSync(tmpPath);
      const maxBytes = MAX_IMAGE_MB * 1024 * 1024;
      if (st.size > maxBytes) {
        fs.unlinkSync(tmpPath);
        throw new Error(`图片过大 (${st.size} bytes > ${maxBytes})`);
      }

      if (DEBUG) {
        logger.debug({ messageId, size: st.size, plugin: this.name }, '图片下载完成');
      }

      // 转为 data URL
      const dataUrl = fileToDataUrl(tmpPath, 'image/png');
      
      // 清理临时文件
      try { fs.unlinkSync(tmpPath); } catch {}
      
      return dataUrl;
    } catch (err: any) {
      logger.error({ messageId, imageKey, err: err?.message, plugin: this.name }, '下载图片失败');
      try { fs.unlinkSync(tmpPath); } catch {}
      return null;
    }
  }

  // ─── 文件下载 ───────────────────────────────────────────────────

  private async downloadFile(messageId: string, fileKey: string, fileName: string, type: 'file' | 'image' = 'file'): Promise<string | null> {
    if (!this.client) return null;

    const ext = path.extname(fileName || '') || '.bin';
    const tmpPath = path.join(os.tmpdir(), `feishu_recv_${Date.now()}_${Math.random().toString(16).slice(2)}${ext}`);

    try {
      const response = await this.client.im.messageResource.get({
        path: { message_id: messageId, file_key: fileKey },
        params: { type },
      });

      const payload = extractResponseData(response);

      if (payload && typeof payload.writeFile === 'function') {
        await payload.writeFile(tmpPath);
      } else if (payload && typeof payload.getReadableStream === 'function') {
        const rs = payload.getReadableStream();
        const nodeRs = toNodeReadableStream(rs);
        if (!nodeRs) throw new Error('getReadableStream() 返回非流');
        const out = fs.createWriteStream(tmpPath);
        await pipeline(nodeRs, out);
      } else if (payload && typeof payload.pipe === 'function') {
        const out = fs.createWriteStream(tmpPath);
        await pipeline(payload, out);
      } else if (Buffer.isBuffer(payload)) {
        fs.writeFileSync(tmpPath, payload);
      } else {
        throw new Error(`未知响应类型: ${typeof payload}`);
      }

      // 大小检查
      const st = fs.statSync(tmpPath);
      const maxBytes = MAX_FILE_MB * 1024 * 1024;
      if (st.size > maxBytes) {
        fs.unlinkSync(tmpPath);
        throw new Error(`文件过大 (${st.size} bytes > ${maxBytes})`);
      }

      logger.debug({ messageId, fileName, size: st.size, plugin: this.name }, '文件下载完成');
      return tmpPath;
    } catch (err: any) {
      logger.error({ messageId, fileKey, err: err?.message, plugin: this.name }, '下载文件失败');
      try { fs.unlinkSync(tmpPath); } catch {}
      return null;
    }
  }

  // ─── 富文本解析 ─────────────────────────────────────────────────

  private extractFromPostJson(postJson: any): { text: string; imageKeys: string[] } {
    const lines: string[] = [];
    const imageKeys: string[] = [];

    const inline = (node: any): string => {
      if (!node) return '';
      if (Array.isArray(node)) return node.map(inline).join('');
      if (typeof node !== 'object') return '';

      const tag = node.tag;
      if (typeof tag === 'string') {
        if (tag === 'text') return String(node.text ?? '');
        if (tag === 'a') return String(node.text ?? node.href ?? '');
        if (tag === 'at') return node.user_name ? `@${node.user_name}` : '@';
        if (tag === 'md') return String(node.text ?? '');
        if (tag === 'img') {
          if (node.image_key) imageKeys.push(String(node.image_key));
          return '[图片]';
        }
        if (tag === 'file') return '[文件]';
        if (tag === 'media') return '[视频]';
        if (tag === 'hr') return '\n';
        if (tag === 'code_block') {
          const lang = String(node.language || '').trim();
          const code = String(node.text || '');
          return `\n\n\`\`\`${lang ? ` ${lang}` : ''}\n${code}\n\`\`\`\n\n`;
        }
      }

      // 递归处理子节点
      let acc = '';
      for (const v of Object.values(node)) {
        if (v && (typeof v === 'object' || Array.isArray(v))) acc += inline(v);
      }
      return acc;
    };

    if (postJson?.title) {
      lines.push(normalizeFeishuText(postJson.title));
    }

    const content = postJson?.content;
    if (Array.isArray(content)) {
      for (const paragraph of content) {
        if (Array.isArray(paragraph)) {
          const joined = paragraph.map(inline).join('');
          const normalized = normalizeFeishuText(joined);
          if (normalized) lines.push(normalized);
        } else {
          const normalized = normalizeFeishuText(inline(paragraph));
          if (normalized) lines.push(normalized);
        }
      }
    } else if (content) {
      const normalized = normalizeFeishuText(inline(content));
      if (normalized) lines.push(normalized);
    }

    return {
      text: lines.join('\n').replace(/\n{3,}/g, '\n\n').trim(),
      imageKeys: [...new Set(imageKeys)],
    };
  }

  // ─── 构建消息对象 ───────────────────────────────────────────────

  private async buildMessage(message: any, sender: any): Promise<Message | null> {
    const messageId = message?.message_id;
    const messageType = message?.message_type;
    const rawContent = message?.content;
    const chatId = message?.chat_id;
    const chatType = message?.chat_type;

    let text = '';
    const attachments: Attachment[] = [];
    const mentions: string[] = [];

    // 提取 @ 提及
    if (Array.isArray(message?.mentions)) {
      for (const m of message.mentions) {
        if (m?.name) mentions.push(m.name);
      }
    }

    // 根据消息类型解析
    switch (messageType) {
      case 'text': {
        try {
          const parsed = JSON.parse(rawContent);
          text = normalizeFeishuText(parsed?.text ?? '');
        } catch {
          text = '';
        }
        break;
      }

      case 'post': {
        try {
          const parsed = JSON.parse(rawContent);
          const { text: postText, imageKeys } = this.extractFromPostJson(parsed);
          text = postText;

          // 下载嵌入的图片
          for (const key of imageKeys.slice(0, 4)) {
            const dataUrl = await this.downloadImage(messageId, key);
            if (dataUrl) {
              attachments.push({
                type: 'image',
                content: dataUrl,
                mimeType: 'image/png',
                fileName: 'feishu.png',
              });
            }
          }
        } catch (err: any) {
          logger.error({ err: err?.message, plugin: this.name }, '解析 post 消息失败');
        }
        break;
      }

      case 'image': {
        try {
          const parsed = JSON.parse(rawContent);
          const imageKey = parsed?.image_key;
          if (imageKey) {
            const dataUrl = await this.downloadImage(messageId, imageKey);
            if (dataUrl) {
              attachments.push({
                type: 'image',
                content: dataUrl,
                mimeType: 'image/png',
                fileName: 'feishu.png',
              });
            }
            text = '[图片]';
          }
        } catch (err: any) {
          text = '[图片]';
          logger.error({ err: err?.message, plugin: this.name }, '解析图片消息失败');
        }
        break;
      }

      case 'media': {
        try {
          const parsed = JSON.parse(rawContent);
          const fileKey = parsed?.file_key;
          const fileName = parsed?.file_name || 'video.mp4';
          const thumbKey = parsed?.image_key;

          text = `[视频] ${fileName}`;

          // 下载缩略图
          if (thumbKey) {
            const dataUrl = await this.downloadImage(messageId, thumbKey);
            if (dataUrl) {
              attachments.push({
                type: 'image',
                content: dataUrl,
                mimeType: 'image/png',
                fileName: 'video-thumb.png',
              });
            }
          }

          // 下载视频文件
          if (fileKey) {
            const filePath = await this.downloadFile(messageId, fileKey, fileName, 'file');
            if (filePath) {
              attachments.push({
                type: 'video',
                content: `file://${filePath}`,
                fileName,
              });
            }
          }
        } catch (err: any) {
          text = '[视频]';
          logger.error({ err: err?.message, plugin: this.name }, '解析视频消息失败');
        }
        break;
      }

      case 'file': {
        try {
          const parsed = JSON.parse(rawContent);
          const fileKey = parsed?.file_key;
          const fileName = parsed?.file_name || 'file.bin';

          text = `[文件] ${fileName}`;

          if (fileKey) {
            const filePath = await this.downloadFile(messageId, fileKey, fileName, 'file');
            if (filePath) {
              attachments.push({
                type: 'file',
                content: `file://${filePath}`,
                fileName,
              });
            }
          }
        } catch (err: any) {
          text = '[文件]';
          logger.error({ err: err?.message, plugin: this.name }, '解析文件消息失败');
        }
        break;
      }

      case 'audio': {
        try {
          const parsed = JSON.parse(rawContent);
          const fileKey = parsed?.file_key;
          const fileName = parsed?.file_name || 'audio.opus';

          text = `[语音] ${fileName}`;

          if (fileKey) {
            const filePath = await this.downloadFile(messageId, fileKey, fileName, 'file');
            if (filePath) {
              attachments.push({
                type: 'audio',
                content: `file://${filePath}`,
                fileName,
              });
            }
          }
        } catch (err: any) {
          text = '[语音]';
          logger.error({ err: err?.message, plugin: this.name }, '解析语音消息失败');
        }
        break;
      }

      default:
        logger.debug({ messageType, plugin: this.name }, '不支持的消息类型');
        return null;
    }

    // 清理 @提及 标记
    text = text.replace(/@_user_\d+\s*/g, '').trim();

    if (!text && attachments.length === 0) {
      return null;
    }

    // 构建时间戳
    let timestamp = new Date().toISOString();
    if (message.create_time) {
      const ms = parseInt(message.create_time, 10);
      if (!isNaN(ms)) {
        timestamp = new Date(ms).toISOString();
      }
    }

    return {
      id: messageId,
      chatId,
      senderId: sender?.sender_id?.open_id || 'unknown',
      senderName: sender?.sender_id?.open_id ? `user_${sender.sender_id.open_id.slice(-6)}` : 'Unknown',
      content: text || '[附件]',
      timestamp,
      chatType: chatType === 'p2p' ? 'p2p' : 'group',
      platform: 'feishu',
      attachments: attachments.length > 0 ? attachments : undefined,
      mentions: mentions.length > 0 ? mentions : undefined,
    };
  }

  // ─── 消息事件处理 ───────────────────────────────────────────────

  private async handleMessageEvent(data: any): Promise<void> {
    const { message, sender } = data || {};
    const chatId = message?.chat_id;
    const messageId = message?.message_id;
    const chatType = message?.chat_type;

    if (!chatId || !messageId) {
      logger.debug({ plugin: this.name }, '消息缺少 chatId 或 messageId');
      return;
    }

    // 去重
    if (this.isDuplicate(messageId)) {
      logger.debug({ messageId, plugin: this.name }, '重复消息，已忽略');
      return;
    }

    // 构建消息对象
    const msg = await this.buildMessage(message, sender);
    if (!msg) {
      return;
    }

    // 群聊智能响应
    if (chatType === 'group') {
      const mentions = msg.mentions || [];
      const hasAttachment = (msg.attachments?.length || 0) > 0;

      logger.debug({ 
        chatId, 
        mentions, 
        content: msg.content.slice(0, 50),
        hasAttachment,
        plugin: this.name 
      }, '>>> 群聊响应检查');

      // 纯附件消息需要 @ 才响应
      if (hasAttachment && mentions.length === 0 && (!msg.content || msg.content === '[图片]' || msg.content === '[附件]')) {
        logger.debug({ chatId, plugin: this.name }, '群聊附件消息未 @，忽略');
        return;
      }

      // 纯文本消息应用智能响应规则
      if (!hasAttachment && !shouldRespondInGroup(msg.content, mentions)) {
        logger.debug({ chatId, mentions, content: msg.content, plugin: this.name }, '群聊消息不满足响应条件，忽略');
        return;
      }
    }

    logger.info({
      chatId,
      chatType: msg.chatType,
      content: msg.content.slice(0, 50),
      attachments: msg.attachments?.length || 0,
      plugin: this.name,
    }, '>>> 收到飞书消息');

    // 调用消息处理器
    if (this.messageHandler) {
      await this.messageHandler(msg);
    } else {
      logger.warn({ plugin: this.name }, '消息处理器未设置，消息被丢弃');
    }
  }
}

// 导出默认插件实例
const plugin: ChannelPlugin = new FeishuChannelPlugin();
export default plugin;

/**
 * FlashClaw 主入口
 * ⚡ 闪电龙虾 - 快如闪电的 AI 助手
 */

import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { isIP } from 'net';
import pino from 'pino';
import { z } from 'zod';

import { paths, ensureDirectories, getBuiltinPluginsDir } from './paths.js';
import { pluginManager } from './plugins/manager.js';
import { loadFromDir, watchPlugins, stopWatching } from './plugins/loader.js';
import { ChannelPlugin, Message, MessageHandler, SendMessageResult, ToolContext } from './plugins/types.js';
import { ApiClient, getApiClient } from './core/api-client.js';
import { MemoryManager, getMemoryManager } from './core/memory.js';
import {
  BOT_NAME,
  MAIN_GROUP_FOLDER,
  IPC_POLL_INTERVAL,
  TIMEZONE,
  HISTORY_CONTEXT_LIMIT,
  THINKING_THRESHOLD_MS,
  MAX_DIRECT_FETCH_CHARS,
  MAX_IPC_FILE_BYTES,
  MAX_IPC_MESSAGE_CHARS,
  MAX_IPC_CHAT_ID_CHARS,
  MAX_IMAGE_BYTES,
  MESSAGE_QUEUE_MAX_SIZE,
  MESSAGE_QUEUE_MAX_CONCURRENT,
  MESSAGE_QUEUE_PROCESSING_TIMEOUT_MS,
  MESSAGE_QUEUE_MAX_RETRIES
} from './config.js';
import { RegisteredGroup, Session } from './types.js';
import {
  initDatabase,
  storeMessage,
  storeChatMetadata,
  getMessagesSince,
  getChatHistory,
  messageExists,
  getAllTasks,
  getAllChats
} from './db.js';
import { startSchedulerLoop, stopScheduler, wake } from './task-scheduler.js';
import { startHealthServer, stopHealthServer } from './health.js';
import { runAgent, writeTasksSnapshot, writeGroupsSnapshot, AvailableGroup } from './agent-runner.js';
import { loadJson, saveJson } from './utils.js';
import { MessageQueue, QueuedMessage } from './message-queue.js';
import { isCommand, handleCommand, CommandContext, shouldSuggestCompact, getCompactSuggestion } from './commands.js';
import { getSessionStats as getTrackerStats, resetSession as resetTrackerSession, checkCompactThreshold, getContextWindowSize } from './session-tracker.js';
import Database from 'better-sqlite3';

// 声明全局数据库变量类型（与 db.ts 保持一致）
declare global {
  // eslint-disable-next-line no-var
  var __flashclaw_db: Database.Database | undefined;
  // eslint-disable-next-line no-var
  var __flashclaw_run_agent: typeof runAgent | undefined;
  // eslint-disable-next-line no-var
  var __flashclaw_registered_groups: Map<string, RegisteredGroup> | undefined;
}

// ⚡ FlashClaw Logger
const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: { target: 'pino-pretty', options: { colorize: true } }
});

// ==================== 渠道管理 ====================
/**
 * 渠道管理器 - 管理所有已启用的通讯渠道插件
 */
class ChannelManager {
  private channels: ChannelPlugin[] = [];
  private enabledPlatforms: string[] = [];
  
  async initialize(): Promise<void> {
    this.channels = pluginManager.getActiveChannels();
    this.enabledPlatforms = this.channels.map(c => c.name);
    
    if (this.channels.length === 0) {
      throw new Error('没有启用任何通讯渠道');
    }
  }
  
  async start(onMessage: MessageHandler): Promise<void> {
    for (const channel of this.channels) {
      channel.onMessage(onMessage);
      await channel.start();
      logger.info({ channel: channel.name }, '⚡ 渠道已启动');
    }
  }
  
  async sendMessage(chatId: string, content: string, platform?: string): Promise<SendMessageResult> {
    // 如果指定了平台，使用指定的渠道
    if (platform) {
      const channel = this.channels.find(c => c.name === platform);
      if (channel) {
        return await channel.sendMessage(chatId, content);
      }
    }
    // 否则尝试所有渠道
    for (const channel of this.channels) {
      try {
        return await channel.sendMessage(chatId, content);
      } catch (err) {
        logger.debug({ channel: channel.name, chatId, err }, '渠道发送消息失败，尝试下一个');
        continue;
      }
    }
    return { success: false, error: `无法发送消息到 ${chatId}` };
  }
  
  async updateMessage(messageId: string, content: string, platform?: string): Promise<void> {
    // 如果指定了平台，使用指定的渠道
    if (platform) {
      const channel = this.channels.find(c => c.name === platform);
      if (channel?.updateMessage) {
        await channel.updateMessage(messageId, content);
        return;
      }
    }
    // 尝试所有支持更新的渠道
    for (const channel of this.channels) {
      if (channel.updateMessage) {
        try {
          await channel.updateMessage(messageId, content);
          return;
        } catch (err) {
          logger.debug({ channel: channel.name, messageId, err }, '渠道更新消息失败，尝试下一个');
          continue;
        }
      }
    }
  }
  
  async deleteMessage(messageId: string, platform?: string): Promise<void> {
    if (platform) {
      const channel = this.channels.find(c => c.name === platform);
      if (channel?.deleteMessage) {
        await channel.deleteMessage(messageId);
        return;
      }
    }
    for (const channel of this.channels) {
      if (channel.deleteMessage) {
        try {
          await channel.deleteMessage(messageId);
          return;
        } catch (err) {
          logger.debug({ channel: channel.name, messageId, err }, '渠道删除消息失败，尝试下一个');
          continue;
        }
      }
    }
  }
  
  getEnabledPlatforms(): string[] {
    return this.enabledPlatforms;
  }
  
  getPlatformDisplayName(platform: string): string {
    const names: Record<string, string> = {
      'feishu': '飞书',
    };
    return names[platform] || platform;
  }
  
  shouldRespondInGroup(msg: Message): boolean {
    // 检查是否被 @ 或提到机器人名称
    const botName = process.env.BOT_NAME || 'FlashClaw';
    return msg.content.includes(`@${botName}`) || 
           msg.content.toLowerCase().includes(botName.toLowerCase());
  }
}

// ==================== 全局状态 ====================
let channelManager: ChannelManager;
let apiClient: ApiClient | null;
let memoryManager: MemoryManager;
let sessions: Session = {};
let registeredGroups: Record<string, RegisteredGroup> = {};
let lastAgentTimestamp: Record<string, string> = {};
let messageQueue: MessageQueue<Message>;
let isShuttingDown = false;

// 直接网页抓取触发（避免模型不触发工具）
const WEB_FETCH_TOOL_NAME = 'web_fetch';
const WEB_FETCH_INTENT_RE = /(抓取|获取|读取|访问|打开|爬取|网页|网站|链接|fetch|web)/i;
const WEB_FETCH_URL_RE = /https?:\/\/[^\s<>()]+/i;
const WEB_FETCH_DOMAIN_RE = /(?:^|[^A-Za-z0-9.-])((?:[A-Za-z0-9-]+\.)+[A-Za-z]{2,})(:\d{2,5})?(\/[^\s<>()]*)?/i;
const TRAILING_PUNCT_RE = /[)\],.。，;；!！?？]+$/;

// ==================== 状态管理 ====================

// 默认的 main 群组配置模板（用于自动注册新会话）
const DEFAULT_MAIN_GROUP: RegisteredGroup = {
  name: 'main',
  folder: MAIN_GROUP_FOLDER,
  trigger: '@',  // 默认 @ 触发
  added_at: new Date().toISOString()
};

function loadState(): void {
  const dataDir = paths.data();
  const statePath = path.join(dataDir, 'router_state.json');
  const state = loadJson<{ last_timestamp?: string; last_agent_timestamp?: Record<string, string> }>(statePath, {});
  lastAgentTimestamp = state.last_agent_timestamp || {};
  sessions = loadJson(path.join(dataDir, 'sessions.json'), {});
  registeredGroups = loadJson(path.join(dataDir, 'registered_groups.json'), {});
  
  // 确保有 main 群组配置模板（用于自动注册）
  const hasMainGroup = Object.values(registeredGroups).some(g => g.folder === MAIN_GROUP_FOLDER);
  if (!hasMainGroup) {
    // 用占位符 ID 注册 main 模板，实际会话会在收到消息时动态注册
    registeredGroups['__main_template__'] = DEFAULT_MAIN_GROUP;
    logger.info('⚡ 已初始化 main 群组模板');
  }
  
  logger.info({ groupCount: Object.keys(registeredGroups).length }, '⚡ 状态已加载');
}

function saveState(): void {
  const dataDir = paths.data();
  saveJson(path.join(dataDir, 'router_state.json'), { last_agent_timestamp: lastAgentTimestamp });
  saveJson(path.join(dataDir, 'sessions.json'), sessions);
}

function registerGroup(chatId: string, group: RegisteredGroup): void {
  registeredGroups[chatId] = group;
  saveJson(path.join(paths.data(), 'registered_groups.json'), registeredGroups);
  
  // 同步更新全局 Map
  if (global.__flashclaw_registered_groups) {
    global.__flashclaw_registered_groups.set(chatId, group);
  }

  // 创建群组文件夹
  const groupDir = path.join(paths.groups(), group.folder);
  fs.mkdirSync(path.join(groupDir, 'logs'), { recursive: true });

  logger.info({ chatId, name: group.name, folder: group.folder }, '⚡ 群组已注册');
}

/**
 * 获取可用群组列表
 */
function getAvailableGroups(): AvailableGroup[] {
  const chats = getAllChats();
  const registeredIds = new Set(Object.keys(registeredGroups));

  return chats
    .filter(c => c.jid !== '__group_sync__')
    .map(c => ({
      jid: c.jid,
      name: c.name,
      lastActivity: c.last_message_time,
      isRegistered: registeredIds.has(c.jid)
    }));
}

// ==================== 消息处理 ====================
/**
 * 判断是否应该触发 Agent
 */
function shouldTriggerAgent(msg: Message, group: RegisteredGroup): boolean {
  const isMainGroup = group.folder === MAIN_GROUP_FOLDER;

  // 主群组响应所有消息
  if (isMainGroup) {
    return true;
  }

  // 私聊始终响应
  if (msg.chatType === 'p2p') {
    return true;
  }

  // 群聊：如果有 mentions（被 @），说明渠道插件已经验证过了
  if (msg.mentions && msg.mentions.length > 0) {
    return true;
  }

  // 群聊使用智能检测（检查消息内容）
  if (channelManager.shouldRespondInGroup(msg)) {
    return true;
  }

  return false;
}

export function extractFirstUrl(text: string): string | null {
  const match = text.match(WEB_FETCH_URL_RE);
  if (match) {
    return match[0].replace(TRAILING_PUNCT_RE, '');
  }

  const domainMatch = text.match(WEB_FETCH_DOMAIN_RE);
  if (!domainMatch) return null;
  const host = domainMatch[1];
  const port = domainMatch[2] ?? '';
  const path = domainMatch[3] ?? '';
  const candidate = `https://${host}${port}${path}`;
  return candidate.replace(TRAILING_PUNCT_RE, '');
}

export function isPrivateIpv4(ip: string): boolean {
  const parts = ip.split('.').map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => Number.isNaN(part))) return false;

  const [a, b] = parts;
  if (a === 0) return true;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  return false;
}

export function isPrivateIpv6(ip: string): boolean {
  const normalized = ip.toLowerCase();
  if (normalized === '::' || normalized === '::1') return true;
  if (normalized.startsWith('fe80:')) return true;
  if (normalized.startsWith('fec0:')) return true;
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true;

  if (normalized.includes('::ffff:')) {
    const ipv4Part = normalized.split('::ffff:')[1];
    if (ipv4Part && isPrivateIpv4(ipv4Part)) return true;
  }

  return false;
}

export function isPrivateIp(ip: string): boolean {
  const family = isIP(ip);
  if (family === 4) return isPrivateIpv4(ip);
  if (family === 6) return isPrivateIpv6(ip);
  return false;
}

export function isBlockedHostname(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase();
  if (normalized === 'localhost') return true;
  return (
    normalized.endsWith('.localhost') ||
    normalized.endsWith('.local') ||
    normalized.endsWith('.internal')
  );
}

export function estimateBase64Bytes(content: string): number | null {
  if (!content) return null;
  const raw = content.startsWith('data:') ? content.split(',')[1] ?? '' : content;
  const normalized = raw.replace(/\s+/g, '');
  if (!normalized) return 0;
  const padding = normalized.endsWith('==') ? 2 : normalized.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((normalized.length * 3) / 4) - padding);
}

export function truncateText(text: string, maxLength: number): { text: string; truncated: boolean } {
  if (text.length <= maxLength) {
    return { text, truncated: false };
  }
  return { text: `${text.slice(0, maxLength)}\n\n...（内容已截断）`, truncated: true };
}

export function formatDirectWebFetchResponse(url: string, result: { success: boolean; data?: unknown; error?: string }): string {
  if (!result.success) {
    return `❌ 抓取失败: ${result.error || '未知错误'}`;
  }

  const data = result.data as { content?: unknown; title?: unknown; status?: unknown; finalUrl?: unknown; contentType?: unknown; bytes?: unknown } | undefined;
  const content = typeof data?.content === 'string'
    ? data.content
    : typeof result.data === 'string'
      ? result.data
      : JSON.stringify(result.data ?? {}, null, 2);

  const { text } = truncateText(content, MAX_DIRECT_FETCH_CHARS);
  const lines: string[] = [];
  lines.push(`✅ 已抓取: ${typeof data?.finalUrl === 'string' ? data.finalUrl : url}`);

  if (typeof data?.title === 'string' && data.title.trim()) {
    lines.push(`📝 标题: ${data.title.trim()}`);
  }
  if (typeof data?.status === 'number') {
    lines.push(`📡 状态: ${data.status}`);
  }
  if (typeof data?.contentType === 'string') {
    lines.push(`📄 类型: ${data.contentType}`);
  }
  if (typeof data?.bytes === 'number') {
    lines.push(`📦 大小: ${data.bytes} bytes`);
  }

  lines.push('');
  lines.push(text);

  return lines.join('\n');
}

async function tryHandleDirectWebFetch(msg: Message, group: RegisteredGroup): Promise<boolean> {
  const content = msg.content?.trim();
  if (!content) return false;

  if (!WEB_FETCH_INTENT_RE.test(content)) return false;
  const url = extractFirstUrl(content);
  if (!url) return false;

  let urlObj: URL;
  try {
    urlObj = new URL(url);
  } catch {
    await sendMessage(msg.chatId, `${BOT_NAME}: URL 格式不合法`, msg.platform);
    return true;
  }

  if (!['http:', 'https:'].includes(urlObj.protocol)) {
    await sendMessage(msg.chatId, `${BOT_NAME}: 只支持 HTTP/HTTPS 协议`, msg.platform);
    return true;
  }

  const allowPrivate = process.env.WEB_FETCH_ALLOW_PRIVATE === '1';
  const hostname = urlObj.hostname;
  if (!allowPrivate && (isBlockedHostname(hostname) || (isIP(hostname) && isPrivateIp(hostname)))) {
    await sendMessage(msg.chatId, `${BOT_NAME}: 目标地址禁止访问内网`, msg.platform);
    return true;
  }

  const toolInfo = pluginManager.getTool(WEB_FETCH_TOOL_NAME);
  if (!toolInfo) {
    await sendMessage(msg.chatId, `${BOT_NAME}: 未检测到 web_fetch 插件，请先安装后再使用。`, msg.platform);
    return true;
  }

  const toolContext: ToolContext = {
    chatId: msg.chatId,
    groupId: group.folder,
    userId: msg.senderId,
    sendMessage: async (text: string) => {
      await sendMessage(msg.chatId, `${BOT_NAME}: ${text}`, msg.platform);
    }
  };

  const normalizedUrl = urlObj.toString();
  logger.info({ chatId: msg.chatId, url: normalizedUrl }, '⚡ 触发直接网页抓取');

  let result: { success: boolean; data?: unknown; error?: string };
  try {
    const { plugin, isMultiTool } = toolInfo;
    result = isMultiTool
      ? await plugin.execute(WEB_FETCH_TOOL_NAME, { url: normalizedUrl, allowPrivate }, toolContext)
      : await plugin.execute({ url: normalizedUrl, allowPrivate }, toolContext);
  } catch (error) {
    result = { success: false, error: error instanceof Error ? error.message : String(error) };
  }

  const response = formatDirectWebFetchResponse(normalizedUrl, result);
  await sendMessage(msg.chatId, `${BOT_NAME}: ${response}`, msg.platform);
  return true;
}

/**
 * 处理队列中的消息
 */
async function processQueuedMessage(queuedMsg: QueuedMessage<Message>): Promise<void> {
  const msg = queuedMsg.data;
  const chatId = msg.chatId;
  const group = registeredGroups[chatId];

  logger.info({ chatId, msgId: msg.id }, '>>> 开始处理队列消息');

  if (!group) {
    logger.info({ chatId }, '群组未注册，跳过');
    return;
  }

  // 获取自上次交互以来的消息
  const sinceTimestamp = lastAgentTimestamp[chatId] || '';
  logger.info({ chatId, sinceTimestamp }, '>>> 查询新消息');
  
  const missedMessages = getMessagesSince(chatId, sinceTimestamp, BOT_NAME);
  logger.info({ chatId, count: missedMessages.length }, '>>> 获取到消息数量');

  if (missedMessages.length === 0) {
    logger.info({ chatId, sinceTimestamp }, '无新消息，可能时间戳问题');
    return;
  }

  // 获取历史上下文
  const historyMessages = getChatHistory(chatId, HISTORY_CONTEXT_LIMIT, sinceTimestamp);
  
  const escapeXml = (s: string) => s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

  // 构建带历史上下文的 prompt
  let prompt = '';
  
  if (historyMessages.length > 0) {
    const historyLines = historyMessages.map(m => 
      `<message sender="${escapeXml(m.sender_name)}" time="${m.timestamp}">${escapeXml(m.content)}</message>`
    );
    prompt += `<history_context>\n${historyLines.join('\n')}\n</history_context>\n\n`;
  }

  const newLines = missedMessages.map(m => 
    `<message sender="${escapeXml(m.sender_name)}" time="${m.timestamp}">${escapeXml(m.content)}</message>`
  );
  prompt += `<new_messages>\n${newLines.join('\n')}\n</new_messages>`;

  // 提取图片附件（只处理当前消息的附件）
  const imageAttachments = msg.attachments
    ?.filter(a => a.type === 'image' && a.content)
    .filter(a => {
      const size = estimateBase64Bytes(a.content || '');
      if (size === null) return false;
      if (size > MAX_IMAGE_BYTES) {
        logger.warn({ chatId, size }, '附件过大，已忽略');
        return false;
      }
      return true;
    })
    .map(a => ({
      type: 'image' as const,
      content: a.content!,
      mimeType: a.mimeType
    })) || [];

  logger.info({ 
    group: group.name, 
    newMessages: missedMessages.length, 
    historyContext: historyMessages.length,
    platform: msg.platform,
    imageCount: imageAttachments.length
  }, '⚡ 处理消息');

  // "正在思考..." 提示功能
  let placeholderMessageId: string | undefined;
  let thinkingDone = false;
  
  // 设置定时器，超过阈值时发送"正在思考..."
  const thinkingTimer = THINKING_THRESHOLD_MS > 0 ? setTimeout(async () => {
    if (thinkingDone) return;
    try {
      const result = await channelManager.sendMessage(chatId, `${BOT_NAME}: 正在思考...`, msg.platform);
      if (result.success && result.messageId) {
        placeholderMessageId = result.messageId;
        logger.debug({ chatId, messageId: placeholderMessageId }, '已发送思考提示');
      }
    } catch (err) {
      logger.debug({ chatId, err }, '发送思考提示失败');
    }
  }, THINKING_THRESHOLD_MS) : null;

  try {
    const response = await executeAgent(group, prompt, chatId, {
      attachments: imageAttachments.length > 0 ? imageAttachments : undefined,
      userId: msg.senderId  // 传递用户 ID 用于用户级别记忆
    });
    thinkingDone = true;
    
    if (thinkingTimer) {
      clearTimeout(thinkingTimer);
    }

    if (response) {
      lastAgentTimestamp[chatId] = msg.timestamp;
      saveState();
      
      const finalText = `${BOT_NAME}: ${response}`;
      
      // 如果有占位消息，更新它；否则发送新消息
      if (placeholderMessageId) {
        try {
          await channelManager.updateMessage(placeholderMessageId, finalText, msg.platform);
          logger.info({ chatId, messageId: placeholderMessageId }, '⚡ 消息已更新');
        } catch (updateErr) {
          // 更新失败，尝试删除并发送新消息
          logger.debug({ chatId, messageId: placeholderMessageId, err: updateErr }, '更新占位消息失败，尝试删除并重发');
          try {
            await channelManager.deleteMessage(placeholderMessageId, msg.platform);
          } catch (deleteErr) {
            logger.debug({ chatId, messageId: placeholderMessageId, err: deleteErr }, '删除占位消息失败');
          }
          await sendMessage(chatId, finalText, msg.platform);
        }
      } else {
        await sendMessage(chatId, finalText, msg.platform);
      }
      
      // 检查是否需要提示用户压缩会话（70% 阈值）
      const usagePercent = checkCompactThreshold(chatId);
      if (usagePercent !== null) {
        const stats = getTrackerStats(chatId);
        if (stats) {
          const suggestion = getCompactSuggestion(stats.tokenCount, stats.maxTokens);
          await sendMessage(chatId, suggestion, msg.platform);
          logger.info({ chatId, usagePercent }, '⚠️ 上下文使用率提示已发送');
        }
      }
    } else if (placeholderMessageId) {
      // 没有响应，删除占位消息
      try {
        await channelManager.deleteMessage(placeholderMessageId, msg.platform);
      } catch (deleteErr) {
        logger.debug({ chatId, messageId: placeholderMessageId, err: deleteErr }, '删除占位消息失败（无响应）');
      }
    }
  } catch (err: any) {
    thinkingDone = true;
    if (thinkingTimer) {
      clearTimeout(thinkingTimer);
    }

    logger.error({ chatId, err }, '处理消息失败');
    
    // 构建错误提示信息
    let errorDisplay = '处理消息时发生未知错误';
    let shouldRethrow = true;

    if (err instanceof Error && err.message.startsWith('Agent 错误:')) {
      shouldRethrow = false; // Agent 错误通常无需重试
      const rawError = err.message.replace('Agent 错误:', '').trim();
      
      if (rawError.includes('403') || rawError.includes('Request not allowed')) {
        errorDisplay = 'Agent 调用被拒绝 (403)。请检查配置或权限。';
      } else if (rawError.includes('401')) {
        errorDisplay = 'Agent 认证失败 (401)。请检查 API Key。';
      } else if (rawError.includes('Missing ANTHROPIC_API_KEY')) {
        errorDisplay = '未配置 Agent API Key，请联系管理员。';
      } else {
        // 尝试解析 JSON 错误
        try {
          const jsonMatch = rawError.match(/\{.*\}/);
          if (jsonMatch) {
            const errorObj = JSON.parse(jsonMatch[0]);
            errorDisplay = errorObj.error?.message || rawError;
          } else {
            errorDisplay = rawError;
          }
        } catch {
          errorDisplay = rawError;
        }
      }
    }

    const errorText = `${BOT_NAME}: ❌ ${errorDisplay}`;

    // 更新占位消息或发送新消息
    if (placeholderMessageId) {
      try {
        await channelManager.updateMessage(placeholderMessageId, errorText, msg.platform);
      } catch (updateErr) {
        // 更新失败（例如消息已删），尝试发送新消息
        await sendMessage(chatId, errorText, msg.platform).catch(() => {});
      }
    } else {
      await sendMessage(chatId, errorText, msg.platform).catch(() => {});
    }
    
    if (shouldRethrow) {
      throw err;
    }
  }
}

/**
 * 处理传入消息
 */
async function handleIncomingMessage(msg: Message): Promise<void> {
  const chatId = msg.chatId;

  // 存储聊天元数据
  storeChatMetadata(chatId, msg.timestamp);

  // 获取群组配置
  let group = registeredGroups[chatId];
  
  // 自动注册新会话（参考 openclaw 的动态 session key 设计）
  if (!group) {
    // 查找 main 群组配置作为模板
    const mainGroup = Object.values(registeredGroups).find(g => g.folder === MAIN_GROUP_FOLDER);
    if (mainGroup) {
      // 根据聊天类型生成名称和文件夹
      const chatName = msg.chatType === 'p2p' 
        ? `私聊-${msg.senderName || chatId.slice(-8)}`
        : `群聊-${chatId.slice(-8)}`;
      
      // 为新会话创建独立的文件夹名称（使用 chatId 后8位确保唯一性）
      const folderName = msg.chatType === 'p2p'
        ? `private-${chatId.slice(-8)}`
        : `group-${chatId.slice(-8)}`;
      
      // 创建新的群组配置（使用独立的 folder）
      const newGroup: RegisteredGroup = {
        ...mainGroup,
        name: chatName,
        folder: folderName,
        added_at: new Date().toISOString()
      };
      
      // 动态注册此会话
      registerGroup(chatId, newGroup);
      
      // 使用新创建的群组（而不是 mainGroup）
      group = newGroup;
      
      logger.info({ 
        chatId, 
        chatType: msg.chatType,
        name: chatName,
        folder: folderName
      }, '⚡ 会话已自动注册');
    }
  }
  
  if (!group) {
    logger.debug({ chatId, platform: msg.platform, chatType: msg.chatType }, '未注册的聊天，忽略');
    return;
  }

  // 去重检查
  if (messageExists(msg.id, chatId)) {
    logger.debug({ chatId, messageId: msg.id }, '重复消息，忽略');
    return;
  }

  // 存储消息
  storeMessage({
    id: msg.id,
    chatId: chatId,
    senderId: msg.senderId,
    senderName: msg.senderName,
    content: msg.content,
    timestamp: msg.timestamp,
    isFromMe: false
  });

  // 检查触发条件
  const shouldTrigger = shouldTriggerAgent(msg, group);
  logger.info({ chatId, shouldTrigger, chatType: msg.chatType }, '>>> 触发检查');
  
  if (!shouldTrigger) {
    return;
  }

  // 检查是否是斜杠命令
  if (isCommand(msg.content)) {
    const context: CommandContext = {
      chatId,
      userId: msg.senderId,
      userName: msg.senderName || '用户',
      platform: msg.platform,
      getSessionStats: () => {
        // 获取真实的 token 统计数据
        const trackerStats = getTrackerStats(chatId);
        if (trackerStats) {
          return {
            messageCount: trackerStats.messageCount,
            tokenCount: trackerStats.tokenCount,
            maxTokens: trackerStats.maxTokens,
            model: trackerStats.model,
            startedAt: trackerStats.startedAt
          };
        }
        // 回退到历史记录（服务重启后 tracker 数据会丢失）
        const history = getChatHistory(chatId, 1000);
        const model = process.env.AI_MODEL || 'claude-4-5-sonnet-20250929';
        return {
          messageCount: history.length,
          tokenCount: 0, // 服务重启后需要重新统计
          maxTokens: getContextWindowSize(model),
          model,
          startedAt: history.length > 0 ? history[0].timestamp : undefined
        };
      },
      resetSession: () => {
        // 重置会话（清除内存中的 session ID 和 tracker）
        if (sessions[group.folder]) {
          delete sessions[group.folder];
        }
        resetTrackerSession(chatId);
        logger.info({ chatId, folder: group.folder }, '⚡ 会话已重置');
      },
      getTasks: () => {
        // 获取该会话的任务
        const tasks = getAllTasks();
        return tasks
          .filter(t => t.chat_jid === chatId || group.folder === MAIN_GROUP_FOLDER)
          .map(t => ({
            id: t.id,
            prompt: t.prompt,
            scheduleType: t.schedule_type,
            nextRun: t.next_run || undefined,
            status: t.status
          }));
      },
      compactSession: async () => {
        // 压缩会话：让 AI 总结当前对话，然后重置会话
        try {
          const summary = await executeAgent(
            group,
            '请用 2-3 句话总结我们之前的对话要点，以便我们继续对话时能快速回顾。只输出总结，不要其他内容。',
            chatId,
            { userId: msg.senderId }
          );
          
          // 重置会话和 tracker
          if (sessions[group.folder]) {
            delete sessions[group.folder];
          }
          resetTrackerSession(chatId);
          
          // 发送压缩完成消息
          if (summary) {
            await channelManager.sendMessage(
              chatId,
              `✅ **会话已压缩**\n\n📝 **对话摘要:**\n${summary}\n\n_上下文已清理，新对话已基于此摘要继续。_`,
              msg.platform
            );
          }
          
          return summary;
        } catch (error) {
          logger.error({ error, chatId }, '会话压缩失败');
          return null;
        }
      }
    };

    const result = handleCommand(msg.content, context);
    
    if (result.isCommand && result.shouldRespond && result.response) {
      // 发送命令响应
      await channelManager.sendMessage(chatId, result.response, msg.platform);
      
      // 如果是 /compact 命令，执行实际压缩
      if (msg.content.trim().toLowerCase().startsWith('/compact') || 
          msg.content.trim() === '/压缩') {
        context.compactSession?.();
      }
      
      logger.info({ chatId, command: msg.content }, '⚡ 命令已处理');
      return;
    }
  }

  // 直接抓取网页（避免模型不触发工具）
  if (await tryHandleDirectWebFetch(msg, group)) {
    return;
  }

  // 添加到消息队列
  logger.info({ chatId, msgId: msg.id }, '>>> 加入消息队列');
  await messageQueue.enqueue(chatId, msg.id, msg);
}

// ==================== Agent 执行 ====================
interface ExecuteAgentOptions {
  attachments?: { type: 'image'; content: string; mimeType?: string }[];
  userId?: string;  // 用户 ID，用于用户级别记忆
}

async function executeAgent(group: RegisteredGroup, prompt: string, chatId: string, options?: ExecuteAgentOptions): Promise<string | null> {
  const isMain = group.folder === MAIN_GROUP_FOLDER;
  const sessionId = sessions[group.folder];

  // 更新任务快照
  const tasks = getAllTasks();
  writeTasksSnapshot(group.folder, isMain, tasks.map(t => ({
    id: t.id,
    groupFolder: t.group_folder,
    prompt: t.prompt,
    schedule_type: t.schedule_type,
    schedule_value: t.schedule_value,
    status: t.status,
    next_run: t.next_run
  })));

  // 更新可用群组快照
  const availableGroups = getAvailableGroups();
  writeGroupsSnapshot(group.folder, isMain, availableGroups, new Set(Object.keys(registeredGroups)));

  try {
    const output = await runAgent(group, {
      prompt,
      sessionId,
      groupFolder: group.folder,
      chatJid: chatId,
      isMain,
      userId: options?.userId || chatId,  // 用户级别记忆
      attachments: options?.attachments
    });

    if (output.newSessionId) {
      sessions[group.folder] = output.newSessionId;
      saveJson(path.join(paths.data(), 'sessions.json'), sessions);
    }

    if (output.status === 'error') {
      logger.error({ group: group.name, error: output.error }, 'Agent 错误');
      throw new Error(`Agent 错误: ${output.error}`);
    }

    return output.result;
  } catch (err) {
    logger.error({ group: group.name, err }, 'Agent 执行失败');
    throw err;
  }
}

// ==================== 消息发送 ====================
async function sendMessage(chatId: string, text: string, platform?: string): Promise<void> {
  try {
    await channelManager.sendMessage(chatId, text, platform);
    logger.info({ chatId, length: text.length, platform }, '⚡ 消息已发送');
  } catch (err) {
    logger.error({ chatId, err, platform }, '发送消息失败');
  }
}

// ==================== IPC 处理 ====================
function quarantineIpcFile(ipcBaseDir: string, sourceGroup: string, filePath: string, reason: string, err?: unknown): void {
  const errorDir = path.join(ipcBaseDir, 'errors');
  const fileName = path.basename(filePath);
  try {
    fs.mkdirSync(errorDir, { recursive: true });
    fs.renameSync(filePath, path.join(errorDir, `${sourceGroup}-${fileName}`));
  } catch (moveError) {
    logger.warn({ file: fileName, sourceGroup, moveError }, '隔离 IPC 文件失败');
    return;
  }
  logger.warn({ file: fileName, sourceGroup, reason, err }, 'IPC 文件已隔离');
}

function startIpcWatcher(): void {
  const ipcBaseDir = path.join(paths.data(), 'ipc');
  fs.mkdirSync(ipcBaseDir, { recursive: true });

  const processIpcFiles = async () => {
    let groupFolders: string[];
    try {
      groupFolders = fs.readdirSync(ipcBaseDir).filter(f => {
        const stat = fs.statSync(path.join(ipcBaseDir, f));
        return stat.isDirectory() && f !== 'errors';
      });
    } catch (err) {
      logger.error({ err }, '读取 IPC 目录失败');
      setTimeout(processIpcFiles, IPC_POLL_INTERVAL);
      return;
    }

    for (const sourceGroup of groupFolders) {
      const isMain = sourceGroup === MAIN_GROUP_FOLDER;
      const messagesDir = path.join(ipcBaseDir, sourceGroup, 'messages');
      const tasksDir = path.join(ipcBaseDir, sourceGroup, 'tasks');

      // 处理消息
      try {
        if (fs.existsSync(messagesDir)) {
          const messageFiles = fs.readdirSync(messagesDir).filter(f => f.endsWith('.json'));
          for (const file of messageFiles) {
            const filePath = path.join(messagesDir, file);
            try {
              const stat = fs.statSync(filePath);
              if (stat.size > MAX_IPC_FILE_BYTES) {
                quarantineIpcFile(ipcBaseDir, sourceGroup, filePath, `IPC 消息文件过大 (${stat.size} bytes)`);
                continue;
              }
              const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
              if (data.type === 'message' && data.chatJid && data.text) {
                if (typeof data.chatJid !== 'string' || data.chatJid.length > MAX_IPC_CHAT_ID_CHARS) {
                  logger.warn({ sourceGroup }, 'IPC 消息 chatJid 格式不合法');
                  fs.unlinkSync(filePath);
                  continue;
                }
                if (typeof data.text !== 'string' || data.text.length > MAX_IPC_MESSAGE_CHARS) {
                  logger.warn({ sourceGroup }, 'IPC 消息 text 过长或格式不合法');
                  fs.unlinkSync(filePath);
                  continue;
                }
                const targetGroup = registeredGroups[data.chatJid];
                if (isMain || (targetGroup && targetGroup.folder === sourceGroup)) {
                  await sendMessage(data.chatJid, `${BOT_NAME}: ${data.text}`);
                  logger.info({ chatId: data.chatJid, sourceGroup }, 'IPC 消息已发送');
                } else {
                  logger.warn({ chatId: data.chatJid, sourceGroup }, '未授权的 IPC 消息被阻止');
                }
              }
              fs.unlinkSync(filePath);
            } catch (err) {
              logger.error({ file, sourceGroup, err }, '处理 IPC 消息失败');
              quarantineIpcFile(ipcBaseDir, sourceGroup, filePath, '处理 IPC 消息失败', err);
            }
          }
        }
      } catch (err) {
        logger.error({ err, sourceGroup }, '读取 IPC 消息目录失败');
      }

      // 处理任务
      try {
        if (fs.existsSync(tasksDir)) {
          const taskFiles = fs.readdirSync(tasksDir).filter(f => f.endsWith('.json'));
          for (const file of taskFiles) {
            const filePath = path.join(tasksDir, file);
            try {
              const stat = fs.statSync(filePath);
              if (stat.size > MAX_IPC_FILE_BYTES) {
                quarantineIpcFile(ipcBaseDir, sourceGroup, filePath, `IPC 任务文件过大 (${stat.size} bytes)`);
                continue;
              }
              const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
              await processTaskIpc(data, sourceGroup, isMain);
              fs.unlinkSync(filePath);
            } catch (err) {
              logger.error({ file, sourceGroup, err }, '处理 IPC 任务失败');
              quarantineIpcFile(ipcBaseDir, sourceGroup, filePath, '处理 IPC 任务失败', err);
            }
          }
        }
      } catch (err) {
        logger.error({ err, sourceGroup }, '读取 IPC 任务目录失败');
      }
    }

    setTimeout(processIpcFiles, IPC_POLL_INTERVAL);
  };

  processIpcFiles();
  logger.info('⚡ IPC 监听已启动');
}

// ==================== IPC Schema 验证 ====================

/** 基础 IPC 消息 schema */
const IpcBaseSchema = z.object({
  type: z.string().min(1).max(50),
});

/** schedule_task IPC schema */
const IpcScheduleTaskSchema = IpcBaseSchema.extend({
  type: z.literal('schedule_task'),
  prompt: z.string().min(1).max(10000),
  schedule_type: z.enum(['cron', 'interval', 'once']),
  schedule_value: z.string().min(1).max(200),
  groupFolder: z.string().min(1).max(100),
  context_mode: z.enum(['group', 'isolated']).optional(),
  max_retries: z.number().int().min(0).max(10).optional(),
  timeout_ms: z.number().int().min(1000).max(3600000).optional(),
});

/** pause/resume/cancel task IPC schema */
const IpcTaskActionSchema = IpcBaseSchema.extend({
  type: z.enum(['pause_task', 'resume_task', 'cancel_task']),
  taskId: z.string().min(1).max(100),
});

/** register_group IPC schema */
const IpcRegisterGroupSchema = IpcBaseSchema.extend({
  type: z.literal('register_group'),
  jid: z.string().min(1).max(256),
  name: z.string().min(1).max(200),
  folder: z.string().min(1).max(100).regex(/^[a-zA-Z0-9_-]+$/),
  trigger: z.string().min(1).max(50),
  agentConfig: z.object({
    timeout: z.number().int().min(1000).max(3600000).optional(),
    env: z.record(z.string(), z.string()).optional(),
  }).optional(),
});

/** 联合 IPC schema */
const IpcMessageSchema = z.discriminatedUnion('type', [
  IpcScheduleTaskSchema,
  IpcTaskActionSchema.extend({ type: z.literal('pause_task') }),
  IpcTaskActionSchema.extend({ type: z.literal('resume_task') }),
  IpcTaskActionSchema.extend({ type: z.literal('cancel_task') }),
  IpcRegisterGroupSchema,
]);

type IpcMessage = z.infer<typeof IpcMessageSchema>;

async function processTaskIpc(
  rawData: unknown,
  sourceGroup: string,
  isMain: boolean
): Promise<void> {
  // Zod schema 验证
  const parseResult = IpcMessageSchema.safeParse(rawData);
  if (!parseResult.success) {
    logger.warn({ 
      sourceGroup, 
      errors: parseResult.error.flatten().fieldErrors 
    }, 'IPC 消息验证失败');
    return;
  }
  
  const data = parseResult.data;
  const { createTask, updateTask, deleteTask, getTaskById: getTask } = await import('./db.js');
  const { CronExpressionParser } = await import('cron-parser');

  switch (data.type) {
    case 'schedule_task': {
      // Zod 已验证必填字段，直接使用
      const targetGroup = data.groupFolder;
      if (!isMain && targetGroup !== sourceGroup) {
        logger.warn({ sourceGroup, targetGroup }, '未授权的 schedule_task 被阻止');
        break;
      }

      const targetChatId = Object.entries(registeredGroups).find(
        ([, group]) => group.folder === targetGroup
      )?.[0];

      if (!targetChatId) {
        logger.warn({ targetGroup }, '无法创建任务：目标群组未注册');
        break;
      }

      const scheduleType = data.schedule_type;

      let nextRun: string | null = null;
      if (scheduleType === 'cron') {
        try {
          const interval = CronExpressionParser.parse(data.schedule_value, { tz: TIMEZONE });
          nextRun = interval.next().toISOString();
        } catch {
          logger.warn({ scheduleValue: data.schedule_value }, '无效的 cron 表达式');
          break;
        }
      } else if (scheduleType === 'interval') {
        const ms = parseInt(data.schedule_value, 10);
        if (isNaN(ms) || ms <= 0) {
          logger.warn({ scheduleValue: data.schedule_value }, '无效的间隔值');
          break;
        }
        nextRun = new Date(Date.now() + ms).toISOString();
      } else if (scheduleType === 'once') {
        const scheduled = new Date(data.schedule_value);
        if (isNaN(scheduled.getTime())) {
          logger.warn({ scheduleValue: data.schedule_value }, '无效的时间戳');
          break;
        }
        nextRun = scheduled.toISOString();
      }

      const taskId = `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const contextMode = data.context_mode ?? 'isolated';
      createTask({
        id: taskId,
        group_folder: targetGroup,
        chat_jid: targetChatId,
        prompt: data.prompt,
        schedule_type: scheduleType,
        schedule_value: data.schedule_value,
        context_mode: contextMode,
        next_run: nextRun,
        status: 'active',
        created_at: new Date().toISOString(),
        retry_count: 0,
        max_retries: data.max_retries ?? 3,
        timeout_ms: data.timeout_ms ?? 300000
      });
      // 唤醒调度器，确保新任务立即生效
      wake();
      logger.info({ taskId, sourceGroup, targetGroup, contextMode }, '⚡ 任务已创建');
      break;
    }

    case 'pause_task': {
      const task = getTask(data.taskId);
      if (task && (isMain || task.group_folder === sourceGroup)) {
        updateTask(data.taskId, { status: 'paused' });
        logger.info({ taskId: data.taskId, sourceGroup }, '任务已暂停');
      } else {
        logger.warn({ taskId: data.taskId, sourceGroup }, '未授权的任务暂停操作');
      }
      break;
    }

    case 'resume_task': {
      const task = getTask(data.taskId);
      if (task && (isMain || task.group_folder === sourceGroup)) {
        updateTask(data.taskId, { status: 'active' });
        logger.info({ taskId: data.taskId, sourceGroup }, '任务已恢复');
      } else {
        logger.warn({ taskId: data.taskId, sourceGroup }, '未授权的任务恢复操作');
      }
      break;
    }

    case 'cancel_task': {
      const task = getTask(data.taskId);
      if (task && (isMain || task.group_folder === sourceGroup)) {
        deleteTask(data.taskId);
        logger.info({ taskId: data.taskId, sourceGroup }, '任务已取消');
      } else {
        logger.warn({ taskId: data.taskId, sourceGroup }, '未授权的任务取消操作');
      }
      break;
    }

    case 'register_group': {
      if (!isMain) {
        logger.warn({ sourceGroup }, '未授权的 register_group 被阻止');
        break;
      }
      // Zod 已验证必填字段，直接使用
      registerGroup(data.jid, {
        name: data.name,
        folder: data.folder,
        trigger: data.trigger,
        added_at: new Date().toISOString(),
        agentConfig: data.agentConfig
      });
      break;
    }
  }
}

// ==================== 启动横幅 ====================
function displayBanner(enabledPlatforms: string[], groupCount: number): void {
  const platformsDisplay = enabledPlatforms.map(p => channelManager.getPlatformDisplayName(p)).join(' | ');
  
  const banner = `
\x1b[33m
  ███████╗██╗      █████╗ ███████╗██╗  ██╗ ██████╗██╗      █████╗ ██╗    ██╗
  ██╔════╝██║     ██╔══██╗██╔════╝██║  ██║██╔════╝██║     ██╔══██╗██║    ██║
  █████╗  ██║     ███████║███████╗███████║██║     ██║     ███████║██║ █╗ ██║
  ██╔══╝  ██║     ██╔══██║╚════██║██╔══██║██║     ██║     ██╔══██║██║███╗██║
  ██║     ███████╗██║  ██║███████║██║  ██║╚██████╗███████╗██║  ██║╚███╔███╔╝
  ╚═╝     ╚══════╝╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝ ╚═════╝╚══════╝╚═╝  ╚═╝ ╚══╝╚══╝ 
\x1b[0m
\x1b[36m  ⚡ 闪电龙虾 - 快如闪电的 AI 助手\x1b[0m

  ┌─────────────────────────────────────────────────────────────────────────┐
  │                                                                         │
  │  \x1b[32m✓\x1b[0m 状态: \x1b[32m运行中\x1b[0m                                                        │
  │  \x1b[32m✓\x1b[0m 模式: \x1b[33mDirect (Claude API)\x1b[0m                                           │
  │  \x1b[32m✓\x1b[0m 平台: \x1b[36m${platformsDisplay.padEnd(55)}\x1b[0m│
  │  \x1b[32m✓\x1b[0m 群组: \x1b[33m${String(groupCount).padEnd(55)}\x1b[0m│
  │                                                                         │
  │  \x1b[90m所有平台使用 WebSocket 长连接，无需公网服务器\x1b[0m                        │
  │                                                                         │
  └─────────────────────────────────────────────────────────────────────────┘

  \x1b[90m按 Ctrl+C 停止服务\x1b[0m
`;

  console.log(banner);
}

// ==================== 主函数 ====================
export async function main(): Promise<void> {
  // 确保所有必要目录存在
  ensureDirectories();
  
  // 初始化 API 客户端（全局单例）
  apiClient = getApiClient();
  
  // 初始化记忆管理器（使用全局单例）
  memoryManager = getMemoryManager();
  
  // 初始化数据库（必须在加载插件之前，因为插件可能依赖数据库）
  initDatabase();
  logger.info('⚡ 数据库已初始化');
  
  // 加载插件（在数据库初始化之后）
  // 先加载内置插件
  const builtinPluginsDir = getBuiltinPluginsDir();
  if (fs.existsSync(builtinPluginsDir)) {
    logger.info({ dir: builtinPluginsDir }, '⚡ 加载内置插件');
    await loadFromDir(builtinPluginsDir);
  }
  
  // 再加载用户插件（可覆盖内置插件）
  const userPluginsDir = paths.userPlugins();
  if (fs.existsSync(userPluginsDir)) {
    logger.info({ dir: userPluginsDir }, '⚡ 加载用户插件');
    await loadFromDir(userPluginsDir);
  }
  
  // 启用热重载 - 只监听用户插件目录
  if (fs.existsSync(userPluginsDir)) {
    watchPlugins(userPluginsDir, (event, name) => {
      logger.info({ event, plugin: name }, '⚡ 插件变化');
    });
  }

  // 初始化渠道管理器
  channelManager = new ChannelManager();
  try {
    await channelManager.initialize();
  } catch (err) {
    console.error(`
\x1b[31m
  ███████╗██████╗ ██████╗  ██████╗ ██████╗ 
  ██╔════╝██╔══██╗██╔══██╗██╔═══██╗██╔══██╗
  █████╗  ██████╔╝██████╔╝██║   ██║██████╔╝
  ██╔══╝  ██╔══██╗██╔══██╗██║   ██║██╔══██╗
  ███████╗██║  ██║██║  ██║╚██████╔╝██║  ██║
  ╚══════╝╚═╝  ╚═╝╚═╝  ╚═╝ ╚═════╝ ╚═╝  ╚═╝
\x1b[0m
  \x1b[31m✗ 缺少消息平台配置\x1b[0m

  请在 \x1b[33m.env\x1b[0m 中配置飞书:

  \x1b[36m飞书:\x1b[0m
    FEISHU_APP_ID=cli_xxxxx
    FEISHU_APP_SECRET=xxxxx

  详见 \x1b[33m.env.example\x1b[0m
`);
    process.exit(1);
  }

  const enabledPlatforms = channelManager.getEnabledPlatforms();
  logger.info({ platforms: enabledPlatforms }, '⚡ 渠道管理器已初始化');

  // 加载状态
  loadState();
  
  // 注入全局变量，供 Web UI 等插件使用
  global.__flashclaw_run_agent = runAgent;
  global.__flashclaw_registered_groups = new Map(Object.entries(registeredGroups));

  // 初始化消息队列
  messageQueue = new MessageQueue<Message>(processQueuedMessage, {
    maxQueueSize: MESSAGE_QUEUE_MAX_SIZE,
    maxConcurrent: MESSAGE_QUEUE_MAX_CONCURRENT,
    processingTimeout: MESSAGE_QUEUE_PROCESSING_TIMEOUT_MS,
    maxRetries: MESSAGE_QUEUE_MAX_RETRIES
  });
  messageQueue.start();
  logger.info('⚡ 消息队列已初始化');

  // 启动任务调度器
  startSchedulerLoop({
    sendMessage: (chatId, text) => sendMessage(chatId, text),
    registeredGroups: () => registeredGroups,
    getSessions: () => sessions
  });

  // 启动 IPC 监听
  startIpcWatcher();

  // 启动所有渠道插件
  await channelManager.start(handleIncomingMessage);

  // 显示启动横幅
  const groupCount = Object.keys(registeredGroups).length;
  displayBanner(enabledPlatforms, groupCount);

  logger.info({ 
    mode: 'direct',
    platforms: enabledPlatforms,
    groups: groupCount
  }, '⚡ FlashClaw 已启动');

  // 启动健康检查服务（可通过 HEALTH_PORT 环境变量配置端口，默认 9090）
  const healthPort = parseInt(process.env.HEALTH_PORT || '9090', 10);
  if (healthPort > 0) {
    startHealthServer(healthPort);
  }

  // 注册优雅关闭处理
  setupGracefulShutdown();
}

// ==================== 优雅关闭 ====================

/**
 * 优雅关闭函数
 */
async function gracefulShutdown(signal: string): Promise<void> {
  if (isShuttingDown) return;
  isShuttingDown = true;
  
  logger.info({ signal }, '⚡ 收到关闭信号，正在优雅关闭...');
  
  try {
    // 1. 停止接收新消息
    logger.info('⚡ 停止接收新消息...');
    await pluginManager.stopAll();
    
    // 2. 等待当前任务完成（最多等待 30 秒）
    logger.info('⚡ 等待当前任务完成...');
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // 3. 停止消息队列
    logger.info('⚡ 停止消息队列...');
    messageQueue?.stop();
    
    // 4. 停止任务调度器
    logger.info('⚡ 停止任务调度器...');
    stopScheduler();
    
    // 5. 停止插件目录监听
    logger.info('⚡ 停止插件监听...');
    stopWatching();
    
    // 6. 关闭数据库连接
    logger.info('⚡ 关闭数据库连接...');
    try {
      // 访问全局数据库实例
      if (global.__flashclaw_db) {
        global.__flashclaw_db.close();
        global.__flashclaw_db = undefined;
      }
    } catch (err) {
      logger.warn({ err }, '关闭数据库连接时出错');
    }
    
    // 7. 卸载插件
    logger.info('⚡ 卸载插件...');
    await pluginManager.clear();
    
    // 8. 停止健康检查服务
    logger.info('⚡ 停止健康检查服务...');
    stopHealthServer();
    
    // 9. 保存状态
    logger.info('⚡ 保存状态...');
    saveState();
    
    logger.info('⚡ FlashClaw 已安全关闭');
    process.exit(0);
  } catch (error) {
    logger.error({ error }, '关闭时发生错误');
    process.exit(1);
  }
}

/**
 * 设置优雅关闭处理
 */
function setupGracefulShutdown(): void {
  // 监听关闭信号
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
  
  // 未捕获异常处理
  process.on('uncaughtException', (err) => {
    logger.error({ err }, '未捕获异常');
    gracefulShutdown('uncaughtException').catch(() => {
      process.exit(1);
    });
  });
  
  process.on('unhandledRejection', (reason) => {
    logger.error({ reason }, '未处理的 Promise 拒绝');
  });
}

// 直接运行时启动（测试环境可通过 FLASHCLAW_SKIP_MAIN=1 禁用）
if (process.env.FLASHCLAW_SKIP_MAIN !== '1') {
  main().catch(err => {
    logger.error({ err }, '⚡ FlashClaw 启动失败');
    process.exit(1);
  });
}

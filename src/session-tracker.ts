/**
 * Session Tracker
 * 
 * 追踪每个会话的 token 使用量和状态
 */

import { existsSync, readFileSync, statSync } from 'fs';
import { promises as fs } from 'fs';
import { join } from 'path';
import { getFlashClawHome } from './paths.js';
import { createLogger } from './logger.js';

const logger = createLogger('SessionTracker');

/**
 * 会话统计数据
 */
export interface SessionData {
  /** 会话 ID (chatId) */
  chatId: string;
  /** 消息数量 */
  messageCount: number;
  /** 累计输入 token */
  inputTokens: number;
  /** 累计输出 token */
  outputTokens: number;
  /** 总 token 数 */
  totalTokens: number;
  /** 使用的模型 */
  model: string;
  /** 会话开始时间 */
  startedAt: string;
  /** 最后活动时间 */
  lastActivityAt: string;
  /** 是否已提示过压缩 */
  compactSuggested: boolean;
}

/**
 * Token 使用情况
 */
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

// 内存存储 - 按 chatId 存储会话数据
const sessions = new Map<string, SessionData>();

const SESSION_CACHE_PATH = join(getFlashClawHome(), 'cache', 'session-tracker.json');
const MAX_SESSION_CACHE_BYTES = 10 * 1024 * 1024;
let persistTimer: NodeJS.Timeout | null = null;

function loadSessionsFromDisk(): void {
  try {
    if (!existsSync(SESSION_CACHE_PATH)) return;
    const stat = statSync(SESSION_CACHE_PATH);
    if (stat.size > MAX_SESSION_CACHE_BYTES) {
      logger.warn({ size: stat.size }, '📊 会话追踪缓存文件过大，跳过加载');
      return;
    }
    const content = readFileSync(SESSION_CACHE_PATH, 'utf-8');
    const parsed = JSON.parse(content);
    if (!Array.isArray(parsed)) return;
    for (const item of parsed) {
      if (item && typeof item.chatId === 'string') {
        sessions.set(item.chatId, item as SessionData);
      }
    }
    logger.debug({ count: sessions.size }, '📊 会话追踪缓存已加载');
  } catch (error) {
    logger.warn({ error }, '📊 加载会话追踪缓存失败');
  }
}

async function persistSessions(): Promise<void> {
  try {
    const cacheDir = join(getFlashClawHome(), 'cache');
    await fs.mkdir(cacheDir, { recursive: true });
    const payload = JSON.stringify(Array.from(sessions.values()), null, 2);
    await fs.writeFile(SESSION_CACHE_PATH, payload, 'utf-8');
  } catch (error) {
    logger.warn({ error }, '📊 保存会话追踪缓存失败');
  }
}

function schedulePersist(): void {
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    void persistSessions();
  }, 1000);
  persistTimer.unref?.();
}

// 默认上下文窗口大小（Claude 3.5 Sonnet = 200k）
const DEFAULT_CONTEXT_WINDOW = 200000;

// 压缩提示阈值（70%）
const COMPACT_THRESHOLD = 0.7;

/**
 * 获取或创建会话数据
 */
export function getOrCreateSession(chatId: string, model?: string): SessionData {
  let session = sessions.get(chatId);
  
  if (!session) {
    const now = new Date().toISOString();
    session = {
      chatId,
      messageCount: 0,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      model: model || process.env.AI_MODEL || process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514',
      startedAt: now,
      lastActivityAt: now,
      compactSuggested: false
    };
    sessions.set(chatId, session);
    logger.debug({ chatId }, '📊 新建会话追踪');
  }
  
  return session;
}

/**
 * 获取会话数据（不创建）
 */
export function getSession(chatId: string): SessionData | null {
  return sessions.get(chatId) || null;
}

/**
 * 记录 token 使用
 */
export function recordTokenUsage(chatId: string, usage: TokenUsage, model?: string): SessionData {
  const session = getOrCreateSession(chatId, model);

  const inputTokens = Number.isFinite(usage.inputTokens) && usage.inputTokens >= 0 ? usage.inputTokens : 0;
  const outputTokens = Number.isFinite(usage.outputTokens) && usage.outputTokens >= 0 ? usage.outputTokens : 0;

  if (inputTokens !== usage.inputTokens || outputTokens !== usage.outputTokens) {
    logger.warn({ chatId, usage }, '📊 发现无效 token 数据，已忽略');
  }

  session.messageCount += 1;
  session.inputTokens += inputTokens;
  session.outputTokens += outputTokens;
  session.totalTokens = session.inputTokens + session.outputTokens;
  session.lastActivityAt = new Date().toISOString();
  
  if (model) {
    session.model = model;
  }
  
  logger.debug({
    chatId,
    inputTokens,
    outputTokens,
    totalTokens: session.totalTokens
  }, '📊 Token 使用已记录');

  schedulePersist();
  
  return session;
}

/**
 * 获取模型的上下文窗口大小
 */
export function getContextWindowSize(model?: string): number {
  // Claude 模型的上下文窗口
  const contextWindows: Record<string, number> = {
    'claude-sonnet-4-20250514': 200000,
    'claude-4-5-sonnet-20250929': 200000,
    'claude-3-5-sonnet-20241022': 200000,
    'claude-3-opus-20240229': 200000,
    'claude-3-sonnet-20240229': 200000,
    'claude-3-haiku-20240307': 200000,
  };
  
  // 匹配模型名称（支持部分匹配）
  if (!model) {
    return DEFAULT_CONTEXT_WINDOW;
  }

  for (const [key, value] of Object.entries(contextWindows)) {
    if (model.includes(key) || key.includes(model)) {
      return value;
    }
  }
  
  return DEFAULT_CONTEXT_WINDOW;
}

/**
 * 检查是否需要提示压缩
 * 
 * @returns 如果需要提示返回使用率百分比，否则返回 null
 */
export function checkCompactThreshold(chatId: string): number | null {
  const session = sessions.get(chatId);
  if (!session) return null;
  
  // 已经提示过了
  if (session.compactSuggested) return null;
  
  const maxTokens = getContextWindowSize(session.model);
  if (!Number.isFinite(maxTokens) || maxTokens <= 0) return null;
  const usageRate = session.totalTokens / maxTokens;
  
  if (usageRate >= COMPACT_THRESHOLD) {
    session.compactSuggested = true;
    return Math.round(usageRate * 100);
  }
  
  return null;
}

/**
 * 重置会话
 */
export function resetSession(chatId: string): void {
  sessions.delete(chatId);
  schedulePersist();
  logger.debug({ chatId }, '📊 会话追踪已重置');
}

/**
 * 获取会话统计（用于 /status 命令）
 */
export function getSessionStats(chatId: string): {
  messageCount: number;
  tokenCount: number;
  maxTokens: number;
  model: string;
  startedAt: string;
  usagePercent: number;
} | null {
  const session = sessions.get(chatId);
  if (!session) return null;
  
  const maxTokens = getContextWindowSize(session.model);
  const usagePercent = maxTokens > 0
    ? Math.round((session.totalTokens / maxTokens) * 100)
    : 0;

  return {
    messageCount: session.messageCount,
    tokenCount: session.totalTokens,
    maxTokens,
    model: session.model,
    startedAt: session.startedAt,
    usagePercent
  };
}

/**
 * 获取所有活跃会话数量
 */
export function getActiveSessionCount(): number {
  return sessions.size;
}

/**
 * 清理过期会话（超过 24 小时无活动）
 */
export function cleanupStaleSessions(maxAgeMs: number = 24 * 60 * 60 * 1000): number {
  const now = Date.now();
  let cleaned = 0;
  
  for (const [chatId, session] of sessions) {
    const lastActivity = new Date(session.lastActivityAt).getTime();
    if (isNaN(lastActivity) || now - lastActivity > maxAgeMs) {
      sessions.delete(chatId);
      cleaned++;
    }
  }
  
  if (cleaned > 0) {
    logger.info({ cleaned }, '📊 清理过期会话');
    schedulePersist();
  }
  
  return cleaned;
}

// 初始化：加载缓存并定期清理
loadSessionsFromDisk();
let cleanupTimer: NodeJS.Timeout | null = setInterval(() => {
  cleanupStaleSessions();
}, 60 * 60 * 1000);
cleanupTimer.unref?.();

/**
 * 关闭 session tracker（持久化并清理定时器）
 * 应在优雅关闭时调用
 */
export async function shutdownSessionTracker(): Promise<void> {
  if (cleanupTimer) {
    clearInterval(cleanupTimer);
    cleanupTimer = null;
  }
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  // 最后持久化一次
  await persistSessions();
  logger.debug('📊 Session tracker 已关闭');
}

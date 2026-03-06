/**
 * 聊天服务
 * 通过 core-api 统一接口与 AI 对话
 * 消息持久化优先复用 src/db.ts 中的现有 helper
 */

import { randomUUID } from 'crypto';
import { getChatHistory as getStoredChatHistory, storeChatMetadata, storeMessage } from '../../../../src/db.js';

// ==================== core-api / DB 访问 ====================

function getCoreApi() {
  const api = global.__flashclaw_core_api;
  if (!api) {
    throw new Error('核心 API 未初始化，请确保 FlashClaw 正常启动');
  }
  return api;
}

function getDb() {
  const db = global.__flashclaw_db;
  if (!db) throw new Error('数据库未初始化');
  return db;
}

// ==================== 类型定义 ====================

export interface ChatMessage {
  id?: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp?: string;
}

interface StreamMetrics {
  durationMs: number;
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
}

const WEB_USER_ID = 'web-user';
const WEB_PLATFORM = 'web-ui';

// ==================== 活跃请求跟踪（用于取消） ====================

const activeRequests = new Map<string, AbortController>();

export function cancelRequest(requestId: string): boolean {
  const controller = activeRequests.get(requestId);
  if (controller) {
    controller.abort();
    activeRequests.delete(requestId);
    return true;
  }
  return false;
}

export function getActiveRequestId(group: string): string | null {
  for (const [id] of activeRequests) {
    if (id.startsWith(`${group}:`)) return id;
  }
  return null;
}

// ==================== 会话列表 ====================

export interface SessionInfo {
  id: string;
  name: string;
  lastMessage?: string;
  lastTime?: string;
  messageCount: number;
}

/**
 * 获取所有 web-ui 会话列表
 */
export function getSessions(): SessionInfo[] {
  try {
    const db = getDb();
    const rows = db.prepare(`
      SELECT c.jid, c.name, c.last_message_time,
        (SELECT COUNT(*) FROM messages m WHERE m.chat_jid = c.jid) as msg_count,
        (SELECT m.content FROM messages m WHERE m.chat_jid = c.jid ORDER BY m.timestamp DESC LIMIT 1) as last_msg
      FROM chats c
      WHERE c.jid LIKE '%-chat'
      ORDER BY c.last_message_time DESC
    `).all() as Array<{ jid: string; name: string; last_message_time: string; msg_count: number; last_msg: string | null }>;

    return rows.map(r => ({
      id: r.jid.replace(/-chat$/, ''),
      name: r.name || r.jid.replace(/-chat$/, ''),
      lastMessage: r.last_msg ? (r.last_msg.length > 60 ? r.last_msg.slice(0, 60) + '...' : r.last_msg) : undefined,
      lastTime: r.last_message_time,
      messageCount: r.msg_count,
    }));
  } catch {
    // 至少返回 main 会话
    return [{ id: 'main', name: 'main Chat', messageCount: 0 }];
  }
}

/**
 * 创建新会话
 */
export function createSession(name: string): string {
  const id = name.toLowerCase().replace(/[^a-z0-9_-]/g, '-').replace(/-+/g, '-');
  const chatJid = getChatJid(id);
  const timestamp = new Date().toISOString();
  storeChatMetadata(chatJid, timestamp, `${name} Chat`);
  return id;
}

// ==================== DB 持久化 ====================

function getChatJid(group: string): string {
  return `${group}-chat`;
}

function saveMessageToDb(role: 'user' | 'assistant', content: string, group: string): void {
  try {
    const chatJid = getChatJid(group);
    const timestamp = new Date().toISOString();
    storeChatMetadata(chatJid, timestamp, `${group} Chat`);
    storeMessage({
      id: randomUUID(),
      chatId: chatJid,
      senderId: role,
      senderName: role === 'user' ? '用户' : 'FlashClaw',
      content,
      timestamp,
      isFromMe: role === 'assistant',
    });
  } catch (err) {
    // DB 写入失败不影响聊天功能，但记录日志以便排查数据丢失
    console.warn('[web-ui] saveMessageToDb failed:', err);
  }
}

// ==================== 公开接口 ====================

/**
 * 获取聊天历史（从 DB 读取）
 */
export function getChatHistory(group = 'main', limit = 50): ChatMessage[] {
  try {
    return getStoredChatHistory(getChatJid(group), limit)
      .map(msg => ({
        id: msg.id,
        role: msg.sender === 'user' ? 'user' : 'assistant',
        content: msg.content,
        timestamp: msg.timestamp,
      }));
  } catch {
    return [];
  }
}

/**
 * 发送消息并获取 AI 回复（非流式）
 */
export async function sendMessage(userMessage: string, group = 'main'): Promise<string> {
  saveMessageToDb('user', userMessage, group);

  const api = getCoreApi();
  const result = await api.chat({
    message: userMessage,
    group,
    userId: WEB_USER_ID,
    platform: WEB_PLATFORM,
  });

  saveMessageToDb('assistant', result.response, group);
  return result.response;
}

/**
 * 发送消息并获取 AI 回复（流式，支持 thinking/tool/metrics 回调）
 */
export async function sendMessageStream(
  userMessage: string,
  options: {
    group?: string;
    onToken: (chunk: string) => void;
    onToolUse?: (toolName: string, input: unknown) => void;
    onThinking?: (text: string) => void;
    onMetrics?: (metrics: StreamMetrics) => void;
  },
): Promise<string> {
  const group = options.group || 'main';
  saveMessageToDb('user', userMessage, group);

  const api = getCoreApi();
  const result = await api.chat({
    message: userMessage,
    group,
    userId: WEB_USER_ID,
    platform: WEB_PLATFORM,
    onToken: options.onToken,
    onToolUse: options.onToolUse,
    onThinking: options.onThinking,
  });

  if (result.response) {
    saveMessageToDb('assistant', result.response, group);
  }

  if (options.onMetrics && result.metrics) {
    options.onMetrics({
      durationMs: result.metrics.durationMs,
      model: result.metrics.model,
      inputTokens: result.metrics.usage?.inputTokens ?? null,
      outputTokens: result.metrics.usage?.outputTokens ?? null,
    });
  }

  return result.response;
}

/**
 * 清空聊天历史（保留会话元数据）
 */
export function clearChatHistory(group = 'main'): boolean {
  try {
    const db = getDb();
    const chatJid = getChatJid(group);
    db.prepare('DELETE FROM messages WHERE chat_jid = ?').run(chatJid);

    // 尝试清除 core-api 内存上下文（web-ui 创建的会话可能不在群组注册表中，失败不影响）
    try {
      const api = getCoreApi();
      api.clearSession(group);
    } catch { /* web-ui session 可能未注册为群组 */ }

    return true;
  } catch {
    return false;
  }
}

/**
 * 删除会话（清空消息 + 删除会话元数据）
 */
export function deleteSession(group: string): boolean {
  try {
    const db = getDb();
    const chatJid = getChatJid(group);
    db.prepare('DELETE FROM messages WHERE chat_jid = ?').run(chatJid);
    db.prepare('DELETE FROM chats WHERE jid = ?').run(chatJid);

    try {
      const api = getCoreApi();
      api.clearSession(group);
    } catch { /* ignore */ }

    return true;
  } catch {
    return false;
  }
}

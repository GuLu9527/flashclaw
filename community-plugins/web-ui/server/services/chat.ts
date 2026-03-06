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
  } catch {
    // DB 写入失败不影响聊天功能
  }
}

// ==================== 公开接口 ====================

/**
 * 获取聊天历史（从 DB 读取）
 */
export function getChatHistory(group = 'main', limit = 50): ChatMessage[] {
  try {
    return getStoredChatHistory(getChatJid(group), limit)
      .reverse()
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
 * 清空聊天历史
 */
export function clearChatHistory(group = 'main'): boolean {
  try {
    // 清除 DB 中的消息记录
    const db = getDb();
    const chatJid = getChatJid(group);
    db.prepare('DELETE FROM messages WHERE chat_jid = ?').run(chatJid);

    // 清除 core-api 的内存上下文
    const api = getCoreApi();
    api.clearSession(group);
    return true;
  } catch {
    return false;
  }
}

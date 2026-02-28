/**
 * 聊天服务
 * 提供与 FlashClaw AI 对话的能力
 */

import { randomUUID } from 'crypto';

// Web UI 聊天会话 ID
const WEB_CHAT_JID = 'web-ui-chat';

// 使用全局数据库实例
function getDb() {
  const db = (global as any).__flashclaw_db;
  if (!db) {
    throw new Error('数据库未初始化');
  }
  return db;
}

// 获取全局注入的 runAgent 函数
function getRunAgent() {
  const runAgent = (global as any).__flashclaw_run_agent;
  if (!runAgent) {
    return null;
  }
  return runAgent;
}

// 获取全局注册的群组
function getRegisteredGroups() {
  const groups = (global as any).__flashclaw_registered_groups;
  return groups || new Map();
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}

interface AgentResult {
  status: 'success' | 'error';
  result?: string | null;
  error?: string;
}

/**
 * 获取聊天历史
 */
export function getChatHistory(limit = 50): ChatMessage[] {
  try {
    const db = getDb();
    const messages = db.prepare(`
      SELECT id, sender, content, timestamp
      FROM messages
      WHERE chat_jid = ?
      ORDER BY timestamp DESC
      LIMIT ?
    `).all(WEB_CHAT_JID, limit);

    return messages.reverse().map((msg: any) => ({
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
 * 保存消息到数据库
 */
function saveMessage(role: 'user' | 'assistant', content: string): string {
  const db = getDb();
  const id = randomUUID();
  const timestamp = new Date().toISOString();
  
  // 确保 chat 记录存在
  db.prepare(`
    INSERT OR IGNORE INTO chats (jid, name, last_message_time)
    VALUES (?, ?, ?)
  `).run(WEB_CHAT_JID, 'Web UI Chat', timestamp);
  
  // 更新最后消息时间
  db.prepare(`
    UPDATE chats SET last_message_time = ? WHERE jid = ?
  `).run(timestamp, WEB_CHAT_JID);
  
  // 保存消息
  db.prepare(`
    INSERT INTO messages (id, chat_jid, sender, sender_name, content, timestamp)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, WEB_CHAT_JID, role, role === 'user' ? '用户' : 'FlashClaw', content, timestamp);
  
  return id;
}

/**
 * 获取 main 群组配置
 */
function resolveMainGroup() {
  const groups = getRegisteredGroups();
  let mainGroup = groups.get('main');

  if (!mainGroup) {
    mainGroup = {
      folder: 'main',
      name: 'Web UI',
      agentConfig: { timeout: 120000 }
    };
  }

  return mainGroup;
}

/**
 * 合并流式输出与最终结果
 */
function finalizeStreamedResponse(
  streamed: string,
  finalText: string,
  onToken?: (chunk: string) => void
): string {
  if (!finalText) {
    return streamed;
  }

  if (!streamed) {
    onToken?.(finalText);
    return finalText;
  }

  if (finalText.startsWith(streamed)) {
    const rest = finalText.slice(streamed.length);
    if (rest) {
      onToken?.(rest);
    }
    return finalText;
  }

  // 不可合并时直接追加完整结果
  onToken?.(finalText);
  return finalText;
}

/**
 * 发送消息并获取 AI 回复（可选流式）
 */
async function sendMessageInternal(
  userMessage: string,
  onToken?: (chunk: string) => void,
  onToolUse?: (toolName: string, input: unknown) => void
): Promise<string> {
  // 保存用户消息
  saveMessage('user', userMessage);

  try {
    const runAgent = getRunAgent();
    if (!runAgent) {
      const errorMsg = 'Agent 未初始化，请确保 FlashClaw 正常启动';
      const finalText = `错误: ${errorMsg}`;
      saveMessage('assistant', finalText);
      onToken?.(finalText);
      return finalText;
    }

    const mainGroup = resolveMainGroup();
    let streamed = '';

    const result = await runAgent(mainGroup, {
      prompt: userMessage,
      groupFolder: 'main',
      chatJid: WEB_CHAT_JID,
      isMain: true,
      userId: 'web-user',
      onToken: onToken ? (chunk: string) => {
        streamed += chunk;
        onToken(chunk);
      } : undefined,
      onToolUse: onToolUse
    }) as AgentResult;
    
    if (result.status === 'success' && result.result) {
      const finalText = finalizeStreamedResponse(streamed, String(result.result), onToken);
      saveMessage('assistant', finalText);
      return finalText;
    } else {
      const errorMsg = result.error || '未收到响应';
      const finalText = finalizeStreamedResponse(streamed, `错误: ${errorMsg}`, onToken);
      saveMessage('assistant', finalText);
      return finalText;
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : '发生未知错误';
    const finalText = `错误: ${errorMsg}`;
    onToken?.(finalText);
    saveMessage('assistant', finalText);
    return finalText;
  }
}

/**
 * 发送消息并获取 AI 回复（非流式）
 */
export async function sendMessage(userMessage: string): Promise<string> {
  return sendMessageInternal(userMessage);
}

/**
 * 发送消息并获取 AI 回复（流式）
 */
export async function sendMessageStream(
  userMessage: string,
  onToken: (chunk: string) => void,
  onToolUse?: (toolName: string, input: unknown) => void
): Promise<string> {
  return sendMessageInternal(userMessage, onToken, onToolUse);
}

/**
 * 清空聊天历史
 */
export function clearChatHistory(): boolean {
  try {
    const db = getDb();
    db.prepare('DELETE FROM messages WHERE chat_jid = ?').run(WEB_CHAT_JID);
    return true;
  } catch {
    return false;
  }
}

/**
 * 聊天服务
 * 提供与 FlashClaw AI 对话的能力
 */

import { randomUUID } from 'crypto';

// 根据 group 名称生成聊天会话 ID
function getChatJid(groupName: string): string {
  return `${groupName}-chat`;
}

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

interface AgentUsageMetrics {
  inputTokens: number;
  outputTokens: number;
}

interface AgentRunMetrics {
  durationMs: number;
  model: string;
  usage?: AgentUsageMetrics;
}

interface AgentResult {
  status: 'success' | 'error';
  result?: string | null;
  error?: string;
  metrics?: AgentRunMetrics;
}

/**
 * 获取聊天历史
 */
export function getChatHistory(group = 'main', limit = 50): ChatMessage[] {
  const chatJid = getChatJid(group);
  try {
    const db = getDb();
    const messages = db.prepare(`
      SELECT id, sender, content, timestamp
      FROM messages
      WHERE chat_jid = ?
      ORDER BY timestamp DESC
      LIMIT ?
    `).all(chatJid, limit);

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
function saveMessage(role: 'user' | 'assistant', content: string, group: string): string {
  const chatJid = getChatJid(group);
  const chatName = group === 'web-ui' ? 'Web UI Chat' : group === 'main' ? 'CLI Chat' : `${group} Chat`;
  const db = getDb();
  const id = randomUUID();
  const timestamp = new Date().toISOString();

  // 确保 chat 记录存在
  db.prepare(`
    INSERT OR IGNORE INTO chats (jid, name, last_message_time)
    VALUES (?, ?, ?)
  `).run(chatJid, chatName, timestamp);

  // 更新最后消息时间
  db.prepare(`
    UPDATE chats SET last_message_time = ? WHERE jid = ?
  `).run(timestamp, chatJid);

  // 保存消息
  db.prepare(`
    INSERT INTO messages (id, chat_jid, sender, sender_name, content, timestamp)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, chatJid, role, role === 'user' ? '用户' : 'FlashClaw', content, timestamp);
  
  return id;
}

/**
 * 根据 group 名称获取群组配置
 */
function resolveGroup(groupName: string) {
  const groups = getRegisteredGroups();
  let group = groups.get(groupName);

  if (!group) {
    // 如果是 CLI 传递的 group，使用 'main' 群组的配置
    group = groups.get('main');
  }

  if (!group) {
    // 如果没有注册任何群组，创建默认配置
    const isWebUI = groupName === 'web-ui';
    group = {
      folder: groupName,
      name: isWebUI ? 'Web UI' : 'CLI',
      agentConfig: { timeout: 120000 }
    };
  }

  return group;
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
  groupName: string,
  onToken?: (chunk: string) => void,
  onToolUse?: (toolName: string, input: unknown) => void,
  onMetrics?: (metrics: AgentRunMetrics) => void
): Promise<string> {
  const chatJid = getChatJid(groupName);

  // 保存用户消息
  saveMessage('user', userMessage, groupName);

  try {
    const runAgent = getRunAgent();
    if (!runAgent) {
      const errorMsg = 'Agent 未初始化，请确保 FlashClaw 正常启动';
      const finalText = `错误: ${errorMsg}`;
      saveMessage('assistant', finalText, groupName);
      onToken?.(finalText);
      return finalText;
    }

    const group = resolveGroup(groupName);
    const isMain = groupName === 'main';
    let streamed = '';

    const result = await runAgent(group, {
      prompt: userMessage,
      groupFolder: group.folder,
      chatJid,
      isMain,
      userId: isMain ? 'web-user' : 'cli-user',
      onToken: onToken ? (chunk: string) => {
        streamed += chunk;
        onToken(chunk);
      } : undefined,
      onToolUse: onToolUse
    }) as AgentResult;

    if (result.metrics) {
      onMetrics?.(result.metrics);
    }

    if (result.status === 'success' && result.result) {
      const finalText = finalizeStreamedResponse(streamed, String(result.result), onToken);
      saveMessage('assistant', finalText, groupName);
      return finalText;
    } else {
      const errorMsg = result.error || '未收到响应';
      const finalText = finalizeStreamedResponse(streamed, `错误: ${errorMsg}`, onToken);
      saveMessage('assistant', finalText, groupName);
      return finalText;
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : '发生未知错误';
    const finalText = `错误: ${errorMsg}`;
    onToken?.(finalText);
    saveMessage('assistant', finalText, groupName);
    return finalText;
  }
}

/**
 * 发送消息并获取 AI 回复（非流式）
 */
export async function sendMessage(userMessage: string, group = 'main'): Promise<string> {
  return sendMessageInternal(userMessage, group);
}

/**
 * 发送消息并获取 AI 回复（流式）
 */
export async function sendMessageStream(
  userMessage: string,
  group = 'main',
  onToken: (chunk: string) => void,
  onToolUse?: (toolName: string, input: unknown) => void,
  onMetrics?: (metrics: AgentRunMetrics) => void
): Promise<string> {
  return sendMessageInternal(userMessage, group, onToken, onToolUse, onMetrics);
}

/**
 * 清空聊天历史
 */
export function clearChatHistory(group = 'main'): boolean {
  const chatJid = getChatJid(group);
  try {
    const db = getDb();
    db.prepare('DELETE FROM messages WHERE chat_jid = ?').run(chatJid);
    return true;
  } catch {
    return false;
  }
}

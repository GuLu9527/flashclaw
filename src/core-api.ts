/**
 * FlashClaw 核心 API 层
 * 
 * 所有渠道（CLI、飞书、Telegram、Web UI）的统一入口。
 * 渠道插件只做消息转发，核心逻辑统一在此处理。
 * 
 * 解耦目标：
 * - 渠道之间不互相依赖
 * - 所有命令（/compact、/status 等）统一处理
 * - AI 调用走统一流程（去重→命令→队列→Agent）
 */

import { createLogger } from './logger.js';
import { pluginManager } from './plugins/manager.js';
import { getSessionStats, resetSession as resetTrackerSession, checkCompactThreshold, getContextWindowSize, getActiveSessionCount } from './session-tracker.js';
import { getMemoryManager } from './core/memory.js';
import { getAllTasks, getChatHistory, getMessageStats } from './db.js';
import { getCurrentModelId } from './core/model-capabilities.js';
import { getSchedulerStatus } from './task-scheduler.js';
import type { RegisteredGroup } from './types.js';
import type { AgentRunMetrics } from './agent-runner.js';

const logger = createLogger('CoreAPI');

// ==================== 类型定义 ====================

export interface ChatParams {
  message: string;
  group: string;
  userId?: string;
  platform?: string;
  onToken?: (chunk: string) => void;
  onToolUse?: (name: string, input: unknown) => void;
  onThinking?: (text: string) => void;
}

export interface ChatResult {
  response: string;
  metrics?: AgentRunMetrics;
}

export interface ServiceStatus {
  running: boolean;
  pid: number;
  uptime: string;
  messageCount: number;
  activeSessions: number;
  activeTaskCount: number;
  totalTaskCount: number;
  provider: string | null;
  model: string | null;
}

export interface CommandResult {
  handled: boolean;
  response?: string;
}

// ==================== 内部引用（由 index.ts 注入） ====================

interface CoreDependencies {
  executeAgent: (group: RegisteredGroup, prompt: string, chatId: string, options?: {
    attachments?: { type: 'image'; content: string; mimeType?: string }[];
    userId?: string;
    platform?: string;
    onToken?: (chunk: string) => void;
    onToolUse?: (name: string, input: unknown) => void;
    onThinking?: (text: string) => void;
  }) => Promise<{ result: string | null; metrics?: AgentRunMetrics }>;
  getRegisteredGroups: () => Record<string, RegisteredGroup>;
  getSessions: () => Record<string, string>;
  resetSession: (groupFolder: string) => void;
  getStartTime: () => number;
}

let deps: CoreDependencies | null = null;

/**
 * 初始化核心 API（由 index.ts 在启动时调用）
 */
export function initCoreApi(dependencies: CoreDependencies): void {
  deps = dependencies;
  logger.debug('⚡ 核心 API 层已初始化');
}

function getDeps(): CoreDependencies {
  if (!deps) throw new Error('CoreAPI not initialized. Call initCoreApi() first.');
  return deps;
}

// ==================== 状态查询 ====================

/**
 * 获取服务状态（统一接口，CLI/Web UI/健康检查都用这个）
 */
export function getStatus(): ServiceStatus {
  const d = getDeps();
  const startTime = d.getStartTime();
  const uptimeMs = Date.now() - startTime;
  const hours = Math.floor(uptimeMs / 3600000);
  const minutes = Math.floor((uptimeMs % 3600000) / 60000);
  const uptime = hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;

  const tasks = getAllTasks();
  const activeTasks = tasks.filter(t => t.status === 'active');
  const provider = pluginManager.getProvider();

  // 消息统计
  let messageCount = 0;
  try {
    const groups = d.getRegisteredGroups();
    for (const chatId of Object.keys(groups)) {
      const stats = getMessageStats(chatId);
      messageCount += stats.totalMessages;
    }
  } catch {
    // 数据库可能未初始化
  }

  return {
    running: true,
    pid: process.pid,
    uptime,
    messageCount,
    activeSessions: getActiveSessionCount(),
    activeTaskCount: activeTasks.length,
    totalTaskCount: tasks.length,
    provider: provider?.name || null,
    model: provider ? getCurrentModelId() : null,
  };
}

// ==================== 历史查询 ====================

/**
 * 获取聊天历史
 */
export function getHistory(chatId: string, limit = 50): Array<{ role: string; content: string; time?: string }> {
  try {
    const messages = getChatHistory(chatId, limit);
    return messages.map(m => ({
      role: m.sender === 'user' ? 'user' : 'assistant',
      content: m.content,
      time: m.timestamp,
    }));
  } catch {
    return [];
  }
}

// ==================== 会话管理 ====================

/**
 * 清除会话（/new 命令）
 */
export function clearSession(groupName: string): void {
  const d = getDeps();
  const groups = d.getRegisteredGroups();
  
  // 找到群组对应的 folder
  const entry = Object.entries(groups).find(([, g]) => g.folder === groupName || g.name === groupName);
  if (entry) {
    d.resetSession(entry[1].folder);
    resetTrackerSession(entry[0]);
  }
  
  // 清除记忆上下文
  const mm = getMemoryManager();
  mm.clearContext(groupName);
  
  logger.info({ group: groupName }, '⚡ 会话已清除');
}

/**
 * 压缩会话（/compact 命令）
 */
export async function compactSession(chatId: string, groupName: string, userId?: string, platform?: string): Promise<string | null> {
  const d = getDeps();
  const groups = d.getRegisteredGroups();
  const group = groups[chatId] || Object.values(groups).find(g => g.folder === groupName);
  
  if (!group) {
    return null;
  }

  try {
    const compactResult = await d.executeAgent(
      group,
      '请用 2-3 句话总结我们之前的对话要点，以便我们继续对话时能快速回顾。只输出总结，不要其他内容。',
      chatId,
      { userId, platform }
    );

    // 重置会话
    d.resetSession(group.folder);
    resetTrackerSession(chatId);

    return compactResult.result;
  } catch (error) {
    logger.error({ error, chatId }, '会话压缩失败');
    return null;
  }
}

// ==================== 会话统计 ====================

/**
 * 获取会话统计（/status 命令用）
 */
export function getSessionInfo(chatId: string): {
  messageCount: number;
  tokenCount: number;
  maxTokens: number;
  model: string;
  startedAt?: string;
  usagePercent: number;
} | null {
  const trackerStats = getSessionStats(chatId);
  if (trackerStats) {
    return {
      messageCount: trackerStats.messageCount,
      tokenCount: trackerStats.tokenCount,
      maxTokens: trackerStats.maxTokens,
      model: trackerStats.model,
      startedAt: trackerStats.startedAt,
      usagePercent: trackerStats.usagePercent,
    };
  }
  
  // 回退到历史记录
  const history = getChatHistory(chatId, 1000);
  const model = getCurrentModelId();
  return {
    messageCount: history.length,
    tokenCount: 0,
    maxTokens: getContextWindowSize(model),
    model,
    startedAt: history.length > 0 ? history[0].timestamp : undefined,
    usagePercent: 0,
  };
}

// ==================== 任务查询 ====================

/**
 * 获取任务列表
 */
export function getTasks(chatId?: string, groupFolder?: string): Array<{
  id: string;
  prompt: string;
  scheduleType: string;
  nextRun?: string;
  status: string;
}> {
  const tasks = getAllTasks();
  const filtered = (chatId || groupFolder)
    ? tasks.filter(t => t.chat_jid === chatId || t.group_folder === groupFolder)
    : tasks;
  
  return filtered.map(t => ({
    id: t.id,
    prompt: t.prompt,
    scheduleType: t.schedule_type,
    nextRun: t.next_run || undefined,
    status: t.status,
  }));
}

// ==================== AI 对话 ====================

/**
 * 发送消息给 AI 并获取回复（统一入口）
 * 所有渠道都应该通过此接口与 AI 通信
 */
export async function chat(params: ChatParams): Promise<ChatResult> {
  const d = getDeps();
  const groups = d.getRegisteredGroups();
  
  // 解析群组
  const chatId = `${params.group}-chat`;
  let group = groups[chatId];
  
  if (!group) {
    // 尝试通过 folder 名查找
    const found = Object.values(groups).find(g => g.folder === params.group);
    if (found) group = found;
  }
  
  if (!group) {
    // 创建默认群组配置
    group = {
      folder: params.group,
      name: params.group,
      trigger: '@',
      added_at: new Date().toISOString(),
      agentConfig: { timeout: 120000 },
    } as RegisteredGroup;
  }

  const agentResult = await d.executeAgent(group, params.message, chatId, {
    userId: params.userId || 'cli-user',
    platform: params.platform || 'cli',
    onToken: params.onToken,
    onToolUse: params.onToolUse,
    onThinking: params.onThinking,
  });

  return {
    response: agentResult.result || '',
    metrics: agentResult.metrics,
  };
}

// ==================== 全局单例 ====================

declare global {
  // eslint-disable-next-line no-var
  var __flashclaw_core_api: typeof import('./core-api.js') | undefined;
}

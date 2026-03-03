/**
 * 服务状态服务
 */

import { existsSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

// 动态获取 FlashClaw 路径（兼容用户插件目录）
function getFlashClawHome(): string {
  return process.env.FLASHCLAW_HOME || join(homedir(), '.flashclaw');
}

const paths = {
  pidFile: () => join(getFlashClawHome(), 'data', 'flashclaw.pid'),
  database: () => join(getFlashClawHome(), 'data', 'flashclaw.db'),
};

// 延迟导入数据库函数（使用全局实例）
function getDb() {
  // 使用全局数据库实例
  const db = (global as any).__flashclaw_db;
  if (!db) {
    throw new Error('数据库未初始化');
  }
  return db;
}

function getAllTasks() {
  return getDb().prepare('SELECT * FROM scheduled_tasks ORDER BY created_at DESC').all();
}

function getAllChats() {
  return getDb().prepare('SELECT jid, name, last_message_time FROM chats ORDER BY last_message_time DESC').all();
}

function getChatHistory(chatJid: string, limit = 50) {
  return getDb().prepare(`
    SELECT id, chat_jid, sender, sender_name, content, timestamp
    FROM messages
    WHERE chat_jid = ?
    ORDER BY timestamp DESC
    LIMIT ?
  `).all(chatJid, limit).reverse();
}

export interface ServiceStatus {
  running: boolean;
  pid: number | null;
  uptime: string | null;
  messageCount: number;
  activeSessions: number;
  activeTaskCount: number;
  totalTaskCount: number;
  provider: string | null;
  model: string | null;
}

export interface RecentActivity {
  time: string;
  sender: string;
  content: string;
  chatId: string;
}

// 记录启动时间（用于计算运行时间）
const startTime = Date.now();

/**
 * 获取服务状态
 */
export function getServiceStatus(): ServiceStatus {
  let running = false;
  let pid: number | null = null;
  let uptime: string | null = null;

  // 检查 PID 文件
  const pidFile = paths.pidFile();
  if (existsSync(pidFile)) {
    try {
      pid = parseInt(readFileSync(pidFile, 'utf-8').trim(), 10);
      // 检查进程是否存在
      process.kill(pid, 0);
      running = true;
      
      // 计算运行时间（简化版，基于 PID 文件修改时间）
      const stats = statSync(pidFile);
      const fileStartTime = stats.mtime.getTime();
      const now = Date.now();
      const diffMs = now - fileStartTime;
      uptime = formatUptime(diffMs);
    } catch {
      // 进程不存在
      running = false;
      pid = null;
    }
  }
  
  // 开发模式：如果 PID 文件不存在，但数据库已初始化，说明服务在运行
  if (!running) {
    try {
      const db = (global as any).__flashclaw_db;
      if (db) {
        running = true;
        pid = process.pid;
        uptime = formatUptime(Date.now() - startTime);
      }
    } catch {
      // 忽略
    }
  }

  // 获取任务统计
  const tasks = getAllTasks();
  const activeTaskCount = tasks.filter(t => t.status === 'active').length;
  const totalTaskCount = tasks.length;

  // 获取会话统计
  const chats = getAllChats();
  const activeSessions = chats.filter(c => {
    if (!c.last_message_time || c.jid === '__group_sync__') return false;
    const lastTime = new Date(c.last_message_time).getTime();
    const oneHourAgo = Date.now() - 60 * 60 * 1000;
    return lastTime > oneHourAgo;
  }).length;

  // 消息总数（从所有聊天历史估算）
  let messageCount = 0;
  for (const chat of chats.slice(0, 10)) { // 只检查最近 10 个聊天
    if (chat.jid === '__group_sync__') continue;
    try {
      const history = getChatHistory(chat.jid, 1000);
      messageCount += history.length;
    } catch {
      // 忽略错误
    }
  }

  const apiProvider = (global as any).__flashclaw_api_provider;
  const provider = apiProvider?.name || null;
  const model = typeof apiProvider?.getModel === 'function' ? apiProvider.getModel() : null;

  return {
    running,
    pid,
    uptime,
    messageCount,
    activeSessions,
    activeTaskCount,
    totalTaskCount,
    provider,
    model,
  };
}

/**
 * 获取最近活动
 */
export function getRecentActivity(limit = 10): RecentActivity[] {
  const activities: RecentActivity[] = [];
  const chats = getAllChats();

  // 从最近的聊天中收集消息
  for (const chat of chats.slice(0, 5)) {
    if (chat.jid === '__group_sync__') continue;
    try {
      const history = getChatHistory(chat.jid, 5);
      for (const msg of history) {
        activities.push({
          time: formatTime(msg.timestamp),
          sender: msg.sender_name || '未知',
          content: msg.content.slice(0, 50) + (msg.content.length > 50 ? '...' : ''),
          chatId: chat.jid,
        });
      }
    } catch {
      // 忽略错误
    }
  }

  // 按时间排序，取最近的
  activities.sort((a, b) => b.time.localeCompare(a.time));
  return activities.slice(0, limit);
}

/**
 * 格式化运行时间
 */
function formatUptime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) {
    return `${days}天 ${hours % 24}小时`;
  }
  if (hours > 0) {
    return `${hours}小时 ${minutes % 60}分钟`;
  }
  if (minutes > 0) {
    return `${minutes}分钟`;
  }
  return `${seconds}秒`;
}

/**
 * 格式化时间
 */
function formatTime(timestamp: string): string {
  try {
    const date = new Date(timestamp);
    return date.toLocaleTimeString('zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return timestamp;
  }
}

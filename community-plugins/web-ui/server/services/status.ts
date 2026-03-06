/**
 * 服务状态服务
 * 通过 core-api 统一接口获取状态，不直接访问 global 变量
 */

// ==================== core-api 访问 ====================

function getCoreApi() {
  const api = global.__flashclaw_core_api;
  if (!api) {
    throw new Error('核心 API 未初始化');
  }
  return api;
}

// ==================== 类型定义 ====================

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

// ==================== 公开接口 ====================

/**
 * 获取服务状态
 */
export function getServiceStatus(): ServiceStatus {
  try {
    const api = getCoreApi();
    const status = api.getStatus();
    return {
      running: status.running,
      pid: status.pid,
      uptime: status.uptime,
      messageCount: status.messageCount,
      activeSessions: status.activeSessions,
      activeTaskCount: status.activeTaskCount,
      totalTaskCount: status.totalTaskCount,
      provider: status.provider,
      model: status.model,
    };
  } catch {
    return {
      running: false,
      pid: null,
      uptime: null,
      messageCount: 0,
      activeSessions: 0,
      activeTaskCount: 0,
      totalTaskCount: 0,
      provider: null,
      model: null,
    };
  }
}

/**
 * 获取最近活动
 */
export function getRecentActivity(limit = 10): RecentActivity[] {
  try {
    const api = getCoreApi();
    // 从 main 群组获取最近消息作为活动
    const history = api.getHistory('main-chat', limit * 2);
    return history
      .map((m: { role: string; content: string; time?: string }) => ({
        time: m.time ? formatTime(m.time) : '-',
        sender: m.role === 'user' ? '用户' : 'FlashClaw',
        content: m.content.slice(0, 50) + (m.content.length > 50 ? '...' : ''),
        chatId: 'main-chat',
      }))
      .slice(-limit);
  } catch {
    return [];
  }
}

// ==================== 工具函数 ====================

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

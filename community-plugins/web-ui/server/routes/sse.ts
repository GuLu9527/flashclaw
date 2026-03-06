/**
 * SSE (Server-Sent Events) 路由
 */

import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { watchLogs, logFileExists } from '../services/logs.js';

export const sseRoutes = new Hono();

/**
 * 转义 HTML
 */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// 实时日志流
sseRoutes.get('/logs', async (c) => {
  return streamSSE(c, async (stream) => {
    let cleanup: (() => void) | null = null;

    try {
      // 检查日志文件是否存在
      if (!logFileExists()) {
        // 开发模式下没有日志文件，发送提示后保持连接
        await stream.writeSSE({
          data: `<div class="log-line log-info">开发模式：日志输出到控制台，实时流不可用。</div>`,
          event: 'message',
        });
      }
      
      // 开始监听日志
      cleanup = watchLogs((log) => {
        const levelClass = `log-${log.level}`;
        const html = `<div class="log-line ${levelClass}" data-level="${log.level}"><span style="color: var(--pico-muted-color);">[${escapeHtml(log.time)}]</span> ${escapeHtml(log.message)}</div>`;
        
        stream.writeSSE({
          data: html,
          event: 'message',
        }).catch(() => {
          // 连接已关闭
        });
      });

      // 保持连接
      // 每 30 秒发送一个心跳以保持连接
      while (true) {
        await stream.writeSSE({
          data: '',
          event: 'heartbeat',
        }).catch(() => {
          // 连接已关闭
          throw new Error('Connection closed');
        });
        await stream.sleep(30000);
      }
    } catch {
      // 连接关闭或出错
    } finally {
      if (cleanup) {
        cleanup();
      }
    }
  });
});

// 状态变化流（可选）
sseRoutes.get('/status', async (c) => {
  return streamSSE(c, async (stream) => {
    try {
      // 每 5 秒推送一次状态
      while (true) {
        const { getServiceStatus } = await import('../services/status.js');
        const status = getServiceStatus();
        
        await stream.writeSSE({
          data: JSON.stringify(status),
          event: 'status',
        }).catch(() => {
          throw new Error('Connection closed');
        });
        
        await stream.sleep(5000);
      }
    } catch {
      // 连接关闭
    }
  });
});

// Agent 状态实时推送（含工具名、消息内容等详细信息）
sseRoutes.get('/agent-state', async (c) => {
  return streamSSE(c, async (stream) => {
    let lastState = '';
    try {
      while (true) {
        const { getServiceStatus, getRecentActivity } = await import('../services/status.js');
        const status = getServiceStatus();
        const recentActivity = getRecentActivity(1);

        // 推导 agent 状态（优先使用 agent-runner 的实时状态）
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const liveState = (globalThis as any).__flashclaw_agent_live_state as
          | { state: string; detail: string; group: string; updatedAt: number }
          | undefined;

        let agentState = 'idle';
        let detail = '';

        // 实时状态：5 秒内有更新的 agent-runner 状态优先
        if (liveState && Date.now() - liveState.updatedAt < 5000 && liveState.state !== 'idle') {
          agentState = liveState.state;
          detail = liveState.detail;
        } else if (!status.running) {
          agentState = 'error';
          detail = '服务未运行';
        } else if (status.activeSessions > 0) {
          agentState = 'responding';
          detail = `${status.activeSessions} 个活跃会话`;
        } else if (status.activeTaskCount > 0) {
          agentState = 'tool_use';
          detail = `${status.activeTaskCount} 个活跃任务`;
        }

        // 最近活动信息（用于气泡显示）
        const lastActivity = recentActivity.length > 0 ? recentActivity[0] : null;

        const statePayload = JSON.stringify({
          state: agentState,
          detail,
          status,
          lastActivity: lastActivity ? {
            sender: lastActivity.sender,
            content: lastActivity.content,
            time: lastActivity.time,
          } : null,
        });

        // 只在状态变化或每 3 秒推送一次
        if (statePayload !== lastState) {
          await stream.writeSSE({
            data: statePayload,
            event: 'agent-state',
          }).catch(() => {
            throw new Error('Connection closed');
          });
          lastState = statePayload;
        } else {
          // 心跳
          await stream.writeSSE({
            data: '',
            event: 'heartbeat',
          }).catch(() => {
            throw new Error('Connection closed');
          });
        }

        await stream.sleep(2000);
      }
    } catch {
      // 连接关闭
    }
  });
});

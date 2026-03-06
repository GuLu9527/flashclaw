/**
 * REST API 路由
 */

import { Hono } from 'hono';
import { html } from 'hono/html';
import { getServiceStatus, getRecentActivity } from '../services/status.js';
import { getTasks, pauseTask, resumeTask, deleteTask } from '../services/tasks.js';
import { getPlugins, togglePlugin } from '../services/plugins.js';
import { sendMessage, sendMessageStream, clearChatHistory, getChatHistory } from '../services/chat.js';
import { statusBadge } from '../../views/layout.js';

export const apiRoutes = new Hono();

// ==================== 状态 API ====================

// 获取服务状态 JSON
apiRoutes.get('/status', async (c) => {
  const status = getServiceStatus();
  return c.json(status);
});

// 获取状态卡片 HTML 片段
apiRoutes.get('/status/card', async (c) => {
  const status = getServiceStatus();
  
  return c.html(html`
    <div class="stat-grid">
      <div class="stat-card">
        <div class="stat-label">状态</div>
        <div>${status.running 
          ? html`<span class="badge badge-success">运行中</span>` 
          : html`<span class="badge badge-error">已停止</span>`}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">PID</div>
        <div class="stat-value">${status.pid || '-'}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">运行时间</div>
        <div class="stat-value" style="font-size: 1rem;">${status.uptime || '-'}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">消息数</div>
        <div class="stat-value">${status.messageCount}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">活跃会话</div>
        <div class="stat-value">${status.activeSessions}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">活跃任务</div>
        <div class="stat-value">${status.activeTaskCount}/${status.totalTaskCount}</div>
      </div>
    </div>
  `);
});

// 获取最近活动 HTML 片段
apiRoutes.get('/activity', async (c) => {
  const activities = getRecentActivity(5);
  
  if (activities.length === 0) {
    return c.html(html`<p style="color: var(--pico-muted-color);">暂无活动记录</p>`);
  }
  
  return c.html(html`
    <table>
      <tbody>
        ${activities.map(a => html`
          <tr>
            <td style="width: 80px; color: var(--pico-muted-color);">${a.time}</td>
            <td style="width: 100px;"><strong>${a.sender}</strong></td>
            <td>${a.content}</td>
          </tr>
        `)}
      </tbody>
    </table>
  `);
});

// ==================== 任务 API ====================

// 获取任务列表 JSON
apiRoutes.get('/tasks', async (c) => {
  const tasks = getTasks();
  return c.json(tasks);
});

// 获取任务列表 HTML 片段
apiRoutes.get('/tasks/rows', async (c) => {
  const tasks = getTasks();
  
  if (tasks.length === 0) {
    return c.html(html`<tr><td colspan="6" style="text-align: center; color: var(--pico-muted-color);">暂无任务</td></tr>`);
  }
  
  return c.html(html`
    ${tasks.map(task => html`
      <tr>
        <td><code>${task.id.slice(0, 8)}</code></td>
        <td class="hide-mobile" title="${task.prompt}">${task.prompt.slice(0, 30)}${task.prompt.length > 30 ? '...' : ''}</td>
        <td>${task.scheduleType}</td>
        <td>${task.nextRun ? new Date(task.nextRun).toLocaleString('zh-CN') : '-'}</td>
        <td>${statusBadge(task.status)}</td>
        <td>
          <div class="btn-group">
            ${task.status === 'active' 
              ? html`<button class="outline small" hx-post="/api/tasks/${task.id}/pause" hx-swap="none" hx-on::after-request="htmx.trigger('#tasks-table', 'refresh')">暂停</button>`
              : html`<button class="outline small" hx-post="/api/tasks/${task.id}/resume" hx-swap="none" hx-on::after-request="htmx.trigger('#tasks-table', 'refresh')">恢复</button>`
            }
            <button class="outline secondary small" hx-delete="/api/tasks/${task.id}" hx-confirm="确定要删除这个任务吗？" hx-swap="none" hx-on::after-request="htmx.trigger('#tasks-table', 'refresh')">删除</button>
          </div>
        </td>
      </tr>
    `)}
  `);
});

// 暂停任务
apiRoutes.post('/tasks/:id/pause', async (c) => {
  const id = c.req.param('id');
  const success = pauseTask(id);
  
  if (success) {
    return c.json({ success: true, message: '任务已暂停' });
  }
  return c.json({ success: false, error: '任务不存在' }, 404);
});

// 恢复任务
apiRoutes.post('/tasks/:id/resume', async (c) => {
  const id = c.req.param('id');
  const success = resumeTask(id);
  
  if (success) {
    return c.json({ success: true, message: '任务已恢复' });
  }
  return c.json({ success: false, error: '任务不存在' }, 404);
});

// 删除任务
apiRoutes.delete('/tasks/:id', async (c) => {
  const id = c.req.param('id');
  const success = deleteTask(id);
  
  if (success) {
    return c.json({ success: true, message: '任务已删除' });
  }
  return c.json({ success: false, error: '任务不存在' }, 404);
});

// ==================== 插件 API ====================

// 获取插件列表 JSON
apiRoutes.get('/plugins', async (c) => {
  const plugins = getPlugins();
  return c.json(plugins);
});

// 切换插件状态
apiRoutes.post('/plugins/:name/toggle', async (c) => {
  const name = c.req.param('name');
  const success = togglePlugin(name);
  
  if (success) {
    return c.json({ success: true, message: '插件状态已更新，重启后生效' });
  }
  return c.json({ success: false, error: '插件不存在' }, 404);
});

// ==================== 聊天 API ====================

// 获取聊天历史
apiRoutes.get('/chat/history', async (c) => {
  const group = c.req.query('group') || 'main';
  const history = getChatHistory(group, 50);
  return c.json({ success: true, messages: history });
});

// 发送聊天消息
apiRoutes.post('/chat', async (c) => {
  try {
    const body = await c.req.json();
    const message = body.message;
    const group = body.group || 'main';

    if (!message || typeof message !== 'string') {
      return c.json({ success: false, error: '消息内容不能为空' }, 400);
    }

    const response = await sendMessage(message.trim(), group);
    return c.json({ success: true, response });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : '发送失败';
    return c.json({ success: false, error: errorMsg }, 500);
  }
});

// 流式发送聊天消息（NDJSON 协议：每行一个完整 JSON 对象，避免 chunk 边界问题）
apiRoutes.post('/chat/stream', async (c) => {
  try {
    const body = await c.req.json();
    const message = body.message;
    const group = body.group || 'main';

    if (!message || typeof message !== 'string') {
      return c.json({ success: false, error: '消息内容不能为空' }, 400);
    }

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        // NDJSON 事件发送：每个事件为独立的一行 JSON
        const sendEvent = (event: { type: string; data: unknown }) => {
          controller.enqueue(encoder.encode(JSON.stringify(event) + '\n'));
        };

        const onToken = (chunk: string) => {
          sendEvent({ type: 'token', data: chunk });
        };

        const onToolUse = (toolName: string, input: unknown) => {
          sendEvent({ type: 'tool', data: { name: toolName, input } });
        };

        const onThinking = (text: string) => {
          sendEvent({ type: 'thinking', data: text });
        };

        const onMetrics = (metrics: { durationMs: number; model: string; inputTokens: number | null; outputTokens: number | null }) => {
          sendEvent({ type: 'metrics', data: metrics });
        };

        sendMessageStream(message.trim(), { group, onToken, onToolUse, onThinking, onMetrics })
          .then(() => {
            sendEvent({ type: 'done', data: null });
            controller.close();
          })
          .catch((error) => {
            const errMsg = error instanceof Error ? error.message : '发送失败';
            sendEvent({ type: 'error', data: errMsg });
            controller.close();
          });
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'application/x-ndjson; charset=utf-8',
        'Cache-Control': 'no-cache',
        'X-Accel-Buffering': 'no',
      },
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : '发送失败';
    return c.json({ success: false, error: errorMsg }, 500);
  }
});

// 清空聊天历史
apiRoutes.post('/chat/clear', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const group = body.group || 'main';
  const success = clearChatHistory(group);
  if (success) {
    return c.json({ success: true, message: '聊天记录已清空' });
  }
  return c.json({ success: false, error: '清空失败' }, 500);
});

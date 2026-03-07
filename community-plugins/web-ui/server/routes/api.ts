/**
 * REST API 路由
 */

import { Hono } from 'hono';
import { html } from 'hono/html';
import { getServiceStatus, getRecentActivity } from '../services/status.js';
import { getTasks, getTask, pauseTask, resumeTask, deleteTask, getTaskLogs, createNewTask, updateExistingTask } from '../services/tasks.js';
import { getPlugins, togglePlugin } from '../services/plugins.js';
import { sendMessage, sendMessageStream, clearChatHistory, getChatHistory, getSessions, createSession, cancelRequest, getActiveRequestId, deleteSession } from '../services/chat.js';
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

// 创建任务
apiRoutes.post('/tasks', async (c) => {
  try {
    const body = await c.req.json();
    const { prompt, scheduleType, scheduleValue, groupFolder, contextMode, maxRetries, timeoutMs } = body;

    if (!prompt || typeof prompt !== 'string') {
      return c.json({ success: false, error: '任务描述不能为空' }, 400);
    }
    if (!['cron', 'interval', 'once'].includes(scheduleType)) {
      return c.json({ success: false, error: '调度类型必须为 cron/interval/once' }, 400);
    }
    if (!scheduleValue || typeof scheduleValue !== 'string') {
      return c.json({ success: false, error: '调度值不能为空' }, 400);
    }

    const result = createNewTask({
      prompt: prompt.trim(),
      scheduleType,
      scheduleValue: scheduleValue.trim(),
      groupFolder,
      contextMode,
      maxRetries,
      timeoutMs,
    });

    if ('error' in result) {
      return c.json({ success: false, error: result.error }, 400);
    }
    return c.json({ success: true, task: result });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : '创建失败';
    return c.json({ success: false, error: errorMsg }, 500);
  }
});

// 更新任务
apiRoutes.put('/tasks/:id', async (c) => {
  try {
    const id = c.req.param('id');
    const body = await c.req.json();
    const success = updateExistingTask(id, body);
    if (success) {
      return c.json({ success: true, message: '任务已更新' });
    }
    return c.json({ success: false, error: '任务不存在' }, 404);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : '更新失败';
    return c.json({ success: false, error: errorMsg }, 500);
  }
});

// 获取单个任务详情
apiRoutes.get('/tasks/:id', async (c) => {
  const id = c.req.param('id');
  const task = getTask(id);
  if (task) {
    return c.json({ success: true, task });
  }
  return c.json({ success: false, error: '任务不存在' }, 404);
});

// 获取任务运行日志
apiRoutes.get('/tasks/:id/logs', async (c) => {
  const id = c.req.param('id');
  const limit = Math.min(parseInt(c.req.query('limit') || '20', 10), 100);
  const logs = getTaskLogs(id, limit);
  return c.json({ success: true, logs });
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

// 获取当前会话的上下文和模型信息
apiRoutes.get('/chat/context', async (c) => {
  try {
    const group = c.req.query('group') || 'main';
    const api = (global as Record<string, unknown>).__flashclaw_core_api as {
      getSessionInfo?: (chatId: string) => { messageCount: number; tokenCount: number; maxTokens: number; model: string; usagePercent: number } | null;
      getStatus?: () => { model: string | null; provider: string | null };
    } | undefined;

    if (!api) {
      return c.json({ success: false, error: '核心 API 未初始化' }, 500);
    }

    const chatId = `${group}-chat`;
    const sessionInfo = api.getSessionInfo?.(chatId);
    const status = api.getStatus?.();

    return c.json({
      success: true,
      model: status?.model || null,
      provider: status?.provider || null,
      tokenCount: sessionInfo?.tokenCount ?? 0,
      maxTokens: sessionInfo?.maxTokens ?? 0,
      usagePercent: sessionInfo?.usagePercent ?? 0,
      messageCount: sessionInfo?.messageCount ?? 0,
    });
  } catch {
    return c.json({ success: false, error: '获取上下文信息失败' }, 500);
  }
});

// 取消正在进行的请求
apiRoutes.post('/chat/cancel', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const group = body.group || 'main';
  const requestId = getActiveRequestId(group);
  if (requestId) {
    cancelRequest(requestId);
    return c.json({ success: true, message: '请求已取消' });
  }
  return c.json({ success: false, error: '没有正在进行的请求' });
});

// ==================== 每日小记 & 统计 API ====================

// 获取今日/昨日小记
apiRoutes.get('/daily-note', async (c) => {
  try {
    const fs = await import('fs');
    const path = await import('path');

    // 通过 core-api 获取数据目录（与核心统一）
    const { paths } = await import('../../../../src/paths.js');
    const dailyDir = path.join(paths.data(), 'memory', 'daily');

    if (!fs.existsSync(dailyDir)) {
      return c.json({ success: true, today: null, yesterday: null });
    }

    const now = new Date();
    const today = now.toISOString().split('T')[0];
    const yesterday = new Date(now.getTime() - 86400000).toISOString().split('T')[0];

    let todayContent: string | null = null;
    let yesterdayContent: string | null = null;

    const todayFile = path.join(dailyDir, `${today}.md`);
    const yesterdayFile = path.join(dailyDir, `${yesterday}.md`);

    if (fs.existsSync(todayFile)) {
      todayContent = fs.readFileSync(todayFile, 'utf-8').trim();
    }
    if (fs.existsSync(yesterdayFile)) {
      yesterdayContent = fs.readFileSync(yesterdayFile, 'utf-8').trim();
    }

    return c.json({
      success: true,
      today: todayContent,
      yesterday: yesterdayContent,
      todayDate: today,
      yesterdayDate: yesterday,
    });
  } catch {
    return c.json({ success: true, today: null, yesterday: null });
  }
});

// 获取最近记忆条目
apiRoutes.get('/memories', async (c) => {
  try {
    const fs = await import('fs');
    const path = await import('path');
    const { paths } = await import('../../../../src/paths.js');

    const limit = Math.min(parseInt(c.req.query('limit') || '10', 10), 50);
    const memoryDir = path.join(paths.data(), 'memory');
    const globalFile = path.join(memoryDir, 'global.md');

    const entries: Array<{ key: string; value: string; scope: string }> = [];

    // 读取全局记忆
    if (fs.existsSync(globalFile)) {
      const content = fs.readFileSync(globalFile, 'utf-8');
      for (const line of content.split('\n')) {
        const match = line.match(/^- \*\*(.+?)\*\*:\s*(.+)$/);
        if (match) {
          entries.push({ key: match[1], value: match[2], scope: 'global' });
        }
      }
    }

    // 读取用户记忆（users/ 目录下的所有 .md 文件）
    const usersDir = path.join(memoryDir, 'users');
    if (fs.existsSync(usersDir)) {
      for (const file of fs.readdirSync(usersDir).filter((f: string) => f.endsWith('.md')).slice(0, 5)) {
        const userId = file.replace('.md', '');
        const content = fs.readFileSync(path.join(usersDir, file), 'utf-8');
        for (const line of content.split('\n')) {
          const match = line.match(/^- \*\*(.+?)\*\*:\s*(.+)$/);
          if (match) {
            entries.push({ key: match[1], value: match[2], scope: `user:${userId}` });
          }
        }
      }
    }

    return c.json({ success: true, entries: entries.slice(-limit) });
  } catch {
    return c.json({ success: true, entries: [] });
  }
});

// 获取今日统计
apiRoutes.get('/stats/today', async (c) => {
  try {
    const db = (globalThis as Record<string, unknown>).__flashclaw_db as
      | { prepare: (sql: string) => { get: (...args: unknown[]) => Record<string, number> | undefined } }
      | undefined;

    if (!db) {
      return c.json({ success: true, messages: 0, sessions: 0 });
    }

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayISO = todayStart.toISOString();

    // 今日消息数
    const msgRow = db.prepare(
      'SELECT COUNT(*) as count FROM messages WHERE timestamp >= ?'
    ).get(todayISO);

    // 今日活跃会话数（不同的 chat_jid）
    const sessionRow = db.prepare(
      'SELECT COUNT(DISTINCT chat_jid) as count FROM messages WHERE timestamp >= ?'
    ).get(todayISO);

    return c.json({
      success: true,
      messages: msgRow?.count ?? 0,
      sessions: sessionRow?.count ?? 0,
    });
  } catch {
    return c.json({ success: true, messages: 0, sessions: 0 });
  }
});

// ==================== Agent API ====================

// 获取已注册的 Agent 列表
apiRoutes.get('/agents', async (c) => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const registry = (globalThis as any).__flashclaw_agent_registry as {
      getAllAgents?: () => Array<{ id: string; name: string; soul: string; tools: string[]; default?: boolean }>;
    } | undefined;

    if (registry?.getAllAgents) {
      const agents = registry.getAllAgents().map(a => ({
        id: a.id,
        name: a.name,
        soul: a.soul,
        toolCount: a.tools[0] === '*' ? -1 : a.tools.length,
        isDefault: a.default || false,
      }));
      return c.json({ success: true, agents });
    }

    // 无 agent-manager 插件时，返回默认单 Agent
    const status = (global as Record<string, unknown>).__flashclaw_core_api as {
      getStatus?: () => { model: string | null };
    } | undefined;
    return c.json({
      success: true,
      agents: [{
        id: 'main',
        name: 'FlashClaw',
        soul: 'souls/default.md',
        toolCount: -1,
        isDefault: true,
        model: status?.getStatus?.()?.model || null,
      }],
    });
  } catch {
    return c.json({ success: false, agents: [] });
  }
});

// ==================== 会话 API ====================

// 获取会话列表
apiRoutes.get('/sessions', async (c) => {
  const sessions = getSessions();
  return c.json({ success: true, sessions });
});

// 创建新会话
apiRoutes.post('/sessions', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const name = body.name;
  if (!name || typeof name !== 'string') {
    return c.json({ success: false, error: '会话名称不能为空' }, 400);
  }
  const id = createSession(name.trim());
  return c.json({ success: true, id, name: name.trim() });
});

// 删除会话（清空消息 + 删除会话元数据）
apiRoutes.delete('/sessions/:id', async (c) => {
  const id = c.req.param('id');
  if (id === 'main') {
    return c.json({ success: false, error: '不能删除主会话' }, 400);
  }
  const success = deleteSession(id);
  return c.json({ success });
});

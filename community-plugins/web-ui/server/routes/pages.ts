/**
 * 页面路由
 */

import { Hono } from 'hono';
import { layout, statusBadge } from '../../views/layout.js';
import { getServiceStatus, getRecentActivity } from '../services/status.js';
import { getTasks } from '../services/tasks.js';
import { getPlugins } from '../services/plugins.js';
import { getRecentLogs } from '../services/logs.js';
import { getChatHistory } from '../services/chat.js';
import { html } from 'hono/html';

export const pagesRoutes = new Hono();

// ==================== 仪表盘 ====================
pagesRoutes.get('/', async (c) => {
  const status = getServiceStatus();
  const activities = getRecentActivity(5);

  const content = html`
    <h1 class="page-title">
      <svg class="icon" aria-hidden="true"><use href="#icon-dashboard"></use></svg>
      <span>仪表盘</span>
    </h1>
    
    <!-- 状态卡片 -->
    <article>
      <header class="section-title"><strong>服务状态</strong></header>
      <div id="status-card" hx-get="/api/status/card" hx-trigger="load, every 5s" hx-swap="innerHTML">
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
      </div>
    </article>
    
    <!-- 最近活动 -->
    <article>
      <header class="section-title"><strong>最近活动</strong></header>
      <div id="recent-activity" hx-get="/api/activity" hx-trigger="load, every 10s" hx-swap="innerHTML">
        ${activities.length === 0 
          ? html`<p style="color: var(--pico-muted-color);">暂无活动记录</p>`
          : html`
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
          `}
      </div>
    </article>
    
    <!-- 快捷导航 -->
    <div class="grid">
      <article>
        <header>
          <strong class="title-with-icon">
            <svg class="icon" aria-hidden="true"><use href="#icon-tasks"></use></svg>
            <span>任务</span>
          </strong>
        </header>
        <p>管理定时任务和调度</p>
        <a href="/tasks" role="button" class="outline">查看任务</a>
      </article>
      <article>
        <header>
          <strong class="title-with-icon">
            <svg class="icon" aria-hidden="true"><use href="#icon-plugins"></use></svg>
            <span>插件</span>
          </strong>
        </header>
        <p>管理已安装的插件</p>
        <a href="/plugins" role="button" class="outline">查看插件</a>
      </article>
      <article>
        <header>
          <strong class="title-with-icon">
            <svg class="icon" aria-hidden="true"><use href="#icon-logs"></use></svg>
            <span>日志</span>
          </strong>
        </header>
        <p>查看实时运行日志</p>
        <a href="/logs" role="button" class="outline">查看日志</a>
      </article>
    </div>
  `;

  return c.html(layout({ title: '仪表盘', activeNav: 'dashboard' }, content));
});

// ==================== 聊天页面 ====================
pagesRoutes.get('/chat', async (c) => {
  const history = getChatHistory(50);

  const content = html`
    <h1 class="page-title">
      <svg class="icon" aria-hidden="true"><use href="#icon-chat"></use></svg>
      <span>AI 对话</span>
    </h1>
    
    <div class="chat-container">
      <!-- 消息列表 -->
      <div class="chat-messages" id="chat-messages">
        ${history.length === 0 
          ? html`<p style="color: var(--text-tertiary); text-align: center; margin-top: auto; margin-bottom: auto;">开始与 FlashClaw 对话吧！</p>`
          : history.map(msg => html`
            <div class="chat-message ${msg.role}">
              <div class="content">${msg.content}</div>
              <div class="time">${new Date(msg.timestamp).toLocaleTimeString('zh-CN')}</div>
            </div>
          `)}
      </div>
      
      <!-- 输入区域 -->
      <form id="chat-form" onsubmit="sendChatMessage(event)">
        <div class="chat-input-area">
          <textarea 
            id="chat-input" 
            placeholder="输入消息... (Enter 发送，Shift+Enter 换行)"
            onkeydown="handleKeyDown(event)"
            rows="1"
          ></textarea>
          <button type="submit" id="send-btn" class="icon-btn">
            <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="22" y1="2" x2="11" y2="13"></line>
              <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
            </svg>
          </button>
        </div>
      </form>
    </div>
    
    <div style="margin-top: 1rem; text-align: center;">
      <button class="outline secondary small" onclick="clearChat()">清空对话</button>
    </div>

    <!-- Three.js + 吉祥物脚本（延迟加载） -->
    <script>
      // ========== 聊天逻辑 ==========
      const messagesContainer = document.getElementById('chat-messages');
      const chatInput = document.getElementById('chat-input');
      const sendBtn = document.getElementById('send-btn');
      
      // 滚动到底部
      function scrollToBottom() {
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
      }
      scrollToBottom();
      
      // 自动调整高度
      function adjustTextareaHeight() {
        chatInput.style.height = 'auto';
        chatInput.style.height = Math.min(chatInput.scrollHeight, 200) + 'px';
      }
      chatInput.addEventListener('input', adjustTextareaHeight);

      // 处理键盘事件
      function handleKeyDown(e) {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          sendChatMessage(e);
        }
        // 延迟调整高度，确保换行后能正确计算
        setTimeout(adjustTextareaHeight, 0);
      }
      
      // 添加消息到界面
      function addMessage(role, content) {
        // 移除空提示
        const emptyHint = messagesContainer.querySelector('p');
        if (emptyHint) emptyHint.remove();
        
        const div = document.createElement('div');
        div.className = 'chat-message ' + role;
        
        const contentEl = document.createElement('div');
        contentEl.className = 'content';
        contentEl.textContent = content || '';

        const time = document.createElement('div');
        time.className = 'time';
        time.textContent = new Date().toLocaleTimeString('zh-CN');
        
        div.appendChild(contentEl);
        div.appendChild(time);
        messagesContainer.appendChild(div);
        scrollToBottom();
        return { wrapper: div, contentEl };
      }
      
      // 发送消息
      async function sendChatMessage(e) {
        e.preventDefault();
        
        const message = chatInput.value.trim();
        if (!message) return;
        
        // 禁用输入
        chatInput.disabled = true;
        sendBtn.disabled = true;
        sendBtn.innerHTML = '<span class="htmx-indicator" style="opacity: 1;">...</span>';
        
        // 添加用户消息
        addMessage('user', message);
        chatInput.value = '';
        chatInput.style.height = 'auto';
        
        try {
          const response = await fetch('/api/chat/stream', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message })
          });
          
          if (!response.ok || !response.body) {
            const data = await response.json().catch(() => null);
            addMessage('assistant', '错误: ' + (data?.error || '发送失败'));
          } else {
            const assistantMsg = addMessage('assistant', '');
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            
            while (true) {
              const { value, done } = await reader.read();
              if (done) break;
              const chunk = decoder.decode(value, { stream: true });
              assistantMsg.contentEl.textContent += chunk;
              scrollToBottom();
            }
          }
        } catch (err) {
          addMessage('assistant', '网络错误: ' + err.message);
        }
        
        // 恢复输入
        chatInput.disabled = false;
        sendBtn.disabled = false;
        sendBtn.innerHTML = '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>';
        chatInput.focus();
        adjustTextareaHeight();
      }
      
      // 清空对话
      async function clearChat() {
        if (!confirm('确定要清空所有对话记录吗？')) return;
        
        try {
          await fetch('/api/chat/clear', { method: 'POST' });
          messagesContainer.innerHTML = '<p style="color: var(--pico-muted-color); text-align: center;">开始与 FlashClaw 对话吧！</p>';
        } catch (err) {
          alert('清空失败: ' + err.message);
        }
      }
    </script>
  `;

  return c.html(layout({ title: '对话', activeNav: 'chat' }, content));
});

// ==================== 日志页面 ====================
pagesRoutes.get('/logs', async (c) => {
  const logs = getRecentLogs(50);

  const content = html`
    <h1 class="page-title">
      <svg class="icon" aria-hidden="true"><use href="#icon-logs"></use></svg>
      <span>实时日志</span>
    </h1>
    
    <!-- 筛选器 -->
    <div x-data="{ level: 'all' }" style="margin-bottom: 1rem;">
      <fieldset role="group">
        <button :class="level === 'all' ? '' : 'outline'" @click="level = 'all'; filterLogs('all')">全部</button>
        <button :class="level === 'error' ? '' : 'outline'" @click="level = 'error'; filterLogs('error')">错误</button>
        <button :class="level === 'warn' ? '' : 'outline'" @click="level = 'warn'; filterLogs('warn')">警告</button>
        <button :class="level === 'info' ? '' : 'outline'" @click="level = 'info'; filterLogs('info')">信息</button>
      </fieldset>
    </div>
    
    <!-- 日志容器 -->
    <article>
      <div id="log-container" 
           class="log-container"
           hx-ext="sse" 
           sse-connect="/sse/logs" 
           sse-swap="message"
           hx-swap="beforeend">
        ${logs.map(log => html`
          <div class="log-line log-${log.level}" data-level="${log.level}">
            <span style="color: var(--pico-muted-color);">[${log.time}]</span> ${log.message}
          </div>
        `)}
      </div>
    </article>
    
    <div class="btn-group">
      <button class="outline" onclick="clearLogs()">清空显示</button>
      <button class="outline" onclick="scrollToBottom()">滚动到底部</button>
    </div>
    
    <script>
      function filterLogs(level) {
        const lines = document.querySelectorAll('.log-line');
        lines.forEach(line => {
          if (level === 'all' || line.dataset.level === level) {
            line.style.display = '';
          } else {
            line.style.display = 'none';
          }
        });
      }
      
      function clearLogs() {
        document.getElementById('log-container').innerHTML = '';
      }
      
      function scrollToBottom() {
        const container = document.getElementById('log-container');
        container.scrollTop = container.scrollHeight;
      }
      
      // 自动滚动
      const container = document.getElementById('log-container');
      const observer = new MutationObserver(() => {
        if (container.scrollHeight - container.scrollTop < container.clientHeight + 100) {
          scrollToBottom();
        }
      });
      observer.observe(container, { childList: true });
      
      // 初始滚动
      setTimeout(scrollToBottom, 100);
    </script>
  `;

  return c.html(layout({ title: '日志', activeNav: 'logs' }, content));
});

// ==================== 任务页面 ====================
pagesRoutes.get('/tasks', async (c) => {
  const tasks = getTasks();

  const content = html`
    <h1 class="page-title">
      <svg class="icon" aria-hidden="true"><use href="#icon-tasks"></use></svg>
      <span>定时任务</span>
    </h1>
    
    <article>
      <div class="table-responsive">
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th class="hide-mobile">描述</th>
              <th>类型</th>
              <th>下次执行</th>
              <th>状态</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody id="tasks-table" hx-get="/api/tasks/rows" hx-trigger="load, every 30s" hx-swap="innerHTML">
            ${tasks.length === 0 
              ? html`<tr><td colspan="6" style="text-align: center; color: var(--pico-muted-color);">暂无任务</td></tr>`
              : tasks.map(task => html`
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
          </tbody>
        </table>
      </div>
    </article>
    
    <p style="color: var(--pico-muted-color);">
      <small>提示：任务状态变更需要重启服务后生效</small>
    </p>
  `;

  return c.html(layout({ title: '任务', activeNav: 'tasks' }, content));
});

// ==================== 插件页面 ====================
pagesRoutes.get('/plugins', async (c) => {
  const plugins = getPlugins();

  const content = html`
    <h1 class="page-title">
      <svg class="icon" aria-hidden="true"><use href="#icon-plugins"></use></svg>
      <span>插件管理</span>
    </h1>
    
    <article>
      <div class="table-responsive">
        <table>
          <thead>
            <tr>
              <th>名称</th>
              <th class="hide-mobile">描述</th>
              <th>类型</th>
              <th>版本</th>
              <th>状态</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody id="plugins-table">
            ${plugins.length === 0 
              ? html`<tr><td colspan="6" style="text-align: center; color: var(--pico-muted-color);">暂无插件</td></tr>`
              : plugins.map(plugin => html`
                <tr>
                  <td>
                    <strong>${plugin.name}</strong>
                    ${plugin.isBuiltin ? html`<small style="color: var(--pico-muted-color);"> (内置)</small>` : ''}
                  </td>
                  <td class="hide-mobile">${plugin.description || '-'}</td>
                  <td>${plugin.type}</td>
                  <td>${plugin.version}</td>
                  <td>${statusBadge(plugin.enabled ? 'enabled' : 'disabled')}</td>
                  <td>
                    <button 
                      class="outline small" 
                      hx-post="/api/plugins/${plugin.name}/toggle" 
                      hx-swap="none"
                      hx-on::after-request="location.reload()">
                      ${plugin.enabled ? '禁用' : '启用'}
                    </button>
                  </td>
                </tr>
              `)}
          </tbody>
        </table>
      </div>
    </article>
    
    <p style="color: var(--pico-muted-color);">
      <small>提示：插件状态变更需要重启服务后生效</small>
    </p>
  `;

  return c.html(layout({ title: '插件', activeNav: 'plugins' }, content));
});

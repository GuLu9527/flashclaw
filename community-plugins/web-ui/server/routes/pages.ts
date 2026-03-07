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
    
    <!-- 今日统计 + 每日小记 -->
    <div class="grid" style="grid-template-columns: 1fr 1fr;">
      <article>
        <header class="section-title"><strong>今日统计</strong></header>
        <div id="today-stats">
          <div class="stat-grid" style="grid-template-columns: 1fr 1fr;">
            <div class="stat-card">
              <div class="stat-label">今日消息</div>
              <div class="stat-value" id="today-messages">-</div>
            </div>
            <div class="stat-card">
              <div class="stat-label">今日会话</div>
              <div class="stat-value" id="today-sessions">-</div>
            </div>
          </div>
        </div>
      </article>
      <article>
        <header class="section-title"><strong>每日小记</strong></header>
        <div id="daily-note" style="font-size: 0.8rem; color: var(--text-secondary); max-height: 120px; overflow-y: auto;">
          <p style="color: var(--text-tertiary);">加载中...</p>
        </div>
      </article>
    </div>

    <!-- 记忆条目 -->
    <article>
      <header class="section-title"><strong>最近记忆</strong></header>
      <div id="memories-list" style="font-size: 0.8rem; max-height: 150px; overflow-y: auto;">
        <p style="color: var(--text-tertiary);">加载中...</p>
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

    <script>
      // 今日统计
      fetch('/api/stats/today').then(r => r.json()).then(data => {
        if (data.success) {
          document.getElementById('today-messages').textContent = data.messages;
          document.getElementById('today-sessions').textContent = data.sessions;
        }
      }).catch(() => {});

      // 每日小记
      fetch('/api/daily-note').then(r => r.json()).then(data => {
        const el = document.getElementById('daily-note');
        if (data.today) {
          el.innerHTML = '<div style="white-space:pre-wrap;">' + escapeHtml(data.today) + '</div>';
        } else if (data.yesterday) {
          el.innerHTML = '<div style="color:var(--text-tertiary);margin-bottom:4px;font-size:0.7rem;">昨日小记：</div><div style="white-space:pre-wrap;">' + escapeHtml(data.yesterday) + '</div>';
        } else {
          el.innerHTML = '<p style="color:var(--text-tertiary);">暂无小记</p>';
        }
      }).catch(() => { document.getElementById('daily-note').innerHTML = '<p style="color:var(--text-tertiary);">加载失败</p>'; });

      // 记忆条目
      fetch('/api/memories?limit=8').then(r => r.json()).then(data => {
        const el = document.getElementById('memories-list');
        const entries = data.entries || [];
        if (entries.length === 0) {
          el.innerHTML = '<p style="color:var(--text-tertiary);">暂无记忆条目</p>';
        } else {
          el.innerHTML = entries.map(e =>
            '<div style="padding:4px 0;border-bottom:1px solid var(--border-color);">'
            + '<strong style="color:var(--gold);font-size:0.75rem;">' + escapeHtml(e.key) + '</strong>'
            + '<span style="color:var(--text-tertiary);font-size:0.65rem;margin-left:6px;">[' + e.scope + ']</span>'
            + '<div style="color:var(--text-secondary);font-size:0.75rem;">' + escapeHtml(e.value) + '</div>'
            + '</div>'
          ).join('');
        }
      }).catch(() => { document.getElementById('memories-list').innerHTML = '<p style="color:var(--text-tertiary);">加载失败</p>'; });

      function escapeHtml(text) { const d = document.createElement('div'); d.textContent = text || ''; return d.innerHTML; }
    </script>
  `;

  return c.html(layout({ title: '仪表盘', activeNav: 'dashboard' }, content));
});

// ==================== 聊天页面 ====================
pagesRoutes.get('/chat', async (c) => {
  const content = html`
    <div class="chat-page">
    <div class="page-title-row">
      <h1 class="page-title" style="margin-bottom: 0;">
        <svg class="icon" aria-hidden="true"><use href="#icon-chat"></use></svg>
        <span>AI 对话</span>
      </h1>
      <div class="chat-header-right">
        <div class="chat-context-bar" id="chat-context-bar"></div>
        <button class="outline secondary small" onclick="clearChat()" title="清空当前会话记录">清空</button>
      </div>
    </div>
    
    <div class="chat-layout">
      <!-- 会话侧栏 -->
      <aside class="session-sidebar" id="session-sidebar">
        <div class="sidebar-header">
          <strong>会话</strong>
          <button class="icon-btn" onclick="createNewSession()" title="新建会话">
            <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          </button>
        </div>
        <div class="session-list" id="session-list"></div>
      </aside>

      <!-- 聊天主区域 -->
      <div class="chat-container">
        <div class="chat-messages" id="chat-messages">
          <p style="color: var(--text-tertiary); text-align: center; margin-top: auto; margin-bottom: auto;">加载中...</p>
        </div>
        
        <form id="chat-form" onsubmit="sendChatMessage(event)">
          <div class="chat-input-area">
            <textarea 
              id="chat-input" 
              placeholder="输入消息... (Enter 发送，Shift+Enter 换行)"
              onkeydown="handleKeyDown(event)"
              rows="1"
            ></textarea>
            <button type="submit" id="send-btn" class="icon-btn" title="发送">
              <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="22" y1="2" x2="11" y2="13"></line>
                <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
              </svg>
            </button>
            <button type="button" id="cancel-btn" class="icon-btn" onclick="cancelChat()" title="停止生成" style="display:none;">
              <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="6" y="6" width="12" height="12" rx="2"></rect>
              </svg>
            </button>
          </div>
        </form>
      </div>
    </div>
    </div>

    <script>
      // ========== 状态 ==========
      let currentGroup = 'main';
      let isSending = false;
      let currentAbortController = null;

      const messagesContainer = document.getElementById('chat-messages');
      const chatInput = document.getElementById('chat-input');
      const sendBtn = document.getElementById('send-btn');
      const cancelBtn = document.getElementById('cancel-btn');
      const sessionList = document.getElementById('session-list');
      const contextBar = document.getElementById('chat-context-bar');

      // ========== Markdown ==========
      marked.setOptions({ breaks: true, gfm: true });
      function renderMarkdown(text) {
        if (!text) return '';
        return marked.parse(text);
      }

      // ========== 会话管理 ==========
      async function loadSessions() {
        try {
          const res = await fetch('/api/sessions');
          const data = await res.json();
          const sessions = data.sessions || [];
          renderSessionList(sessions);
        } catch { renderSessionList([{ id: 'main', name: 'main Chat', messageCount: 0 }]); }
      }

      function renderSessionList(sessions) {
        if (sessions.length === 0) sessions = [{ id: 'main', name: 'main Chat', messageCount: 0 }];
        sessionList.innerHTML = '';
        sessions.forEach(function(s) {
          var item = document.createElement('div');
          item.className = 'session-item' + (s.id === currentGroup ? ' session-active' : '');
          item.onclick = function() { switchSession(s.id); };
          var info = document.createElement('div');
          info.className = 'session-info';
          var nameEl = document.createElement('div');
          nameEl.className = 'session-name';
          nameEl.textContent = s.name || s.id;
          info.appendChild(nameEl);
          if (s.lastMessage) {
            var preview = document.createElement('div');
            preview.className = 'session-preview';
            preview.textContent = s.lastMessage;
            info.appendChild(preview);
          }
          item.appendChild(info);
          if (s.id !== 'main') {
            var delBtn = document.createElement('button');
            delBtn.className = 'session-delete';
            delBtn.textContent = '\u00d7';
            delBtn.title = '删除';
            delBtn.onclick = function(e) { e.stopPropagation(); deleteSessionItem(s.id); };
            item.appendChild(delBtn);
          }
          sessionList.appendChild(item);
        });
      }

      async function switchSession(group) {
        if (group === currentGroup) return;
        currentGroup = group;
        await loadChatHistory();
        loadSessions();
        loadContextInfo();
      }

      async function createNewSession() {
        const name = prompt('输入新会话名称：');
        if (!name || !name.trim()) return;
        try {
          const res = await fetch('/api/sessions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: name.trim() }) });
          const data = await res.json();
          if (data.success) {
            currentGroup = data.id;
            await loadSessions();
            await loadChatHistory();
            loadContextInfo();
          } else { alert(data.error || '创建失败'); }
        } catch (err) { alert('创建失败: ' + err.message); }
      }

      async function deleteSessionItem(id) {
        if (!confirm('确定要删除会话 "' + id + '" 吗？所有消息将被清除。')) return;
        try {
          await fetch('/api/sessions/' + id, { method: 'DELETE' });
          if (currentGroup === id) { currentGroup = 'main'; }
          await loadSessions();
          await loadChatHistory();
          loadContextInfo();
        } catch (err) { alert('删除失败: ' + err.message); }
      }

      // ========== 聊天历史 ==========
      async function loadChatHistory() {
        try {
          const res = await fetch('/api/chat/history?group=' + encodeURIComponent(currentGroup));
          const data = await res.json();
          const messages = data.messages || [];
          messagesContainer.innerHTML = '';
          if (messages.length === 0) {
            messagesContainer.innerHTML = '<div class="chat-empty-hint" style="color: var(--text-tertiary); text-align: center; margin-top: auto; margin-bottom: auto;">开始与 FlashClaw 对话吧！</div>';
          } else {
            messages.forEach(msg => addMessage(msg.role, msg.content, msg.timestamp));
          }
          scrollToBottom(true);
        } catch { messagesContainer.innerHTML = '<div class="chat-empty-hint" style="color: var(--error);">加载历史失败</div>'; }
      }

      // ========== 上下文信息 ==========
      async function loadContextInfo() {
        try {
          const res = await fetch('/api/chat/context?group=' + encodeURIComponent(currentGroup));
          const data = await res.json();
          if (data.success) {
            const model = data.model || '-';
            const usage = data.usagePercent || 0;
            const tokens = data.tokenCount || 0;
            const maxTokens = data.maxTokens || 0;
            contextBar.innerHTML = '<span class="ctx-model" title="当前模型">' + escapeHtml(model) + '</span>'
              + (maxTokens > 0 ? '<span class="ctx-tokens" title="Token 使用量">' + tokens + '/' + maxTokens + ' (' + usage + '%)</span>' : '');
          } else { contextBar.innerHTML = ''; }
        } catch { contextBar.innerHTML = ''; }
      }

      // ========== UI 工具 ==========
      var userScrolledUp = false;
      function scrollToBottom(force) {
        if (!force && userScrolledUp) return;
        messagesContainer.scrollTo({ top: messagesContainer.scrollHeight, behavior: 'smooth' });
      }
      messagesContainer.addEventListener('scroll', function() {
        var gap = messagesContainer.scrollHeight - messagesContainer.scrollTop - messagesContainer.clientHeight;
        userScrolledUp = gap > 80;
      });

      function adjustTextareaHeight() {
        chatInput.style.height = 'auto';
        chatInput.style.height = Math.min(chatInput.scrollHeight, 200) + 'px';
      }
      chatInput.addEventListener('input', adjustTextareaHeight);

      function handleKeyDown(e) {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChatMessage(e); }
        setTimeout(adjustTextareaHeight, 0);
      }

      function escapeHtml(text) {
        const d = document.createElement('div');
        d.textContent = text;
        return d.innerHTML;
      }

      function setSendingState(sending) {
        isSending = sending;
        chatInput.disabled = sending;
        sendBtn.style.display = sending ? 'none' : '';
        cancelBtn.style.display = sending ? '' : 'none';
      }

      function addMessage(role, content, timestamp) {
        const emptyHint = messagesContainer.querySelector('.chat-empty-hint');
        if (emptyHint) emptyHint.remove();
        const div = document.createElement('div');
        div.className = 'chat-message ' + role;
        const contentEl = document.createElement('div');
        contentEl.className = 'content' + (role === 'assistant' ? ' markdown-body' : '');
        if (role === 'assistant') { contentEl.innerHTML = renderMarkdown(content); }
        else { contentEl.textContent = content || ''; }
        const time = document.createElement('div');
        time.className = 'time';
        time.textContent = timestamp ? new Date(timestamp).toLocaleTimeString('zh-CN') : new Date().toLocaleTimeString('zh-CN');
        div.appendChild(contentEl);
        div.appendChild(time);
        messagesContainer.appendChild(div);
        scrollToBottom(role === 'user');
        return { wrapper: div, contentEl, rawText: content || '' };
      }

      // ========== 发送 / 取消 ==========
      async function sendChatMessage(e) {
        e.preventDefault();
        const message = chatInput.value.trim();
        if (!message || isSending) return;
        setSendingState(true);
        addMessage('user', message);
        chatInput.value = '';
        chatInput.style.height = 'auto';

        currentAbortController = new AbortController();
        try {
          const response = await fetch('/api/chat/stream', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message, group: currentGroup }),
            signal: currentAbortController.signal,
          });
          if (!response.ok || !response.body) {
            const data = await response.json().catch(() => null);
            addMessage('assistant', '错误: ' + (data?.error || '发送失败'));
          } else {
            const assistantMsg = addMessage('assistant', '');
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let lineBuf = '';
            let renderScheduled = false;
            const flush = () => { renderScheduled = false; assistantMsg.contentEl.innerHTML = renderMarkdown(assistantMsg.rawText); scrollToBottom(); };
            const scheduleRender = () => { if (!renderScheduled) { renderScheduled = true; requestAnimationFrame(flush); } };
            try {
              while (true) {
                const { value, done } = await reader.read();
                if (done) break;
                lineBuf += decoder.decode(value, { stream: true });
                const lines = lineBuf.split('\\n');
                lineBuf = lines.pop() || '';
                for (const line of lines) {
                  if (!line.trim()) continue;
                  try {
                    const evt = JSON.parse(line);
                    if (evt.type === 'token') { assistantMsg.rawText += evt.data; scheduleRender(); }
                    else if (evt.type === 'tool') {
                      const toolDiv = document.createElement('div');
                      toolDiv.className = 'chat-message tool';
                      toolDiv.innerHTML = '<div class="content" style="font-size:0.8rem;color:var(--pico-muted-color);padding:0.25rem 0.5rem;">🔧 ' + escapeHtml(evt.data?.name || '') + '</div>';
                      messagesContainer.insertBefore(toolDiv, messagesContainer.lastElementChild);
                      scrollToBottom();
                    } else if (evt.type === 'error') { assistantMsg.rawText += '\\n\\n❌ 错误: ' + evt.data; scheduleRender(); }
                  } catch { /* ignore non-JSON */ }
                }
              }
            } catch (readErr) {
              if (readErr.name !== 'AbortError') { assistantMsg.rawText += '\\n\\n❌ 读取中断'; scheduleRender(); }
            }
            if (renderScheduled) flush();
          }
        } catch (err) {
          if (err.name !== 'AbortError') addMessage('assistant', '网络错误: ' + err.message);
        }
        currentAbortController = null;
        setSendingState(false);
        chatInput.focus();
        adjustTextareaHeight();
        loadContextInfo();
        loadSessions();
      }

      async function cancelChat() {
        if (currentAbortController) currentAbortController.abort();
        try { await fetch('/api/chat/cancel', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ group: currentGroup }) }); } catch {}
        setSendingState(false);
      }

      async function clearChat() {
        if (!confirm('确定要清空当前会话的所有对话记录吗？')) return;
        try {
          await fetch('/api/chat/clear', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ group: currentGroup }) });
          messagesContainer.innerHTML = '<div class="chat-empty-hint" style="color: var(--text-tertiary); text-align: center; margin-top: auto; margin-bottom: auto;">开始与 FlashClaw 对话吧！</div>';
          loadContextInfo();
          loadSessions();
        } catch (err) { alert('清空失败: ' + err.message); }
      }

      // ========== 初始化 ==========
      loadSessions();
      loadChatHistory();
      loadContextInfo();
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
    
    <!-- 筛选器 + 搜索 -->
    <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 1rem; flex-wrap: wrap;">
      <div x-data="{ level: 'all' }">
        <fieldset role="group">
          <button :class="level === 'all' ? '' : 'outline'" @click="level = 'all'; filterLogs('all')">全部</button>
          <button :class="level === 'error' ? '' : 'outline'" @click="level = 'error'; filterLogs('error')">错误</button>
          <button :class="level === 'warn' ? '' : 'outline'" @click="level = 'warn'; filterLogs('warn')">警告</button>
          <button :class="level === 'info' ? '' : 'outline'" @click="level = 'info'; filterLogs('info')">信息</button>
        </fieldset>
      </div>
      <input id="log-search" type="text" placeholder="搜索关键词..." oninput="searchLogs(this.value)" style="width: 200px; margin: 0;">
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
      <button class="outline" onclick="exportLogs()">导出日志</button>
    </div>
    
    <script>
      let currentLogLevel = 'all';
      let currentSearchKeyword = '';

      function applyLogFilters() {
        const lines = document.querySelectorAll('.log-line');
        const keyword = currentSearchKeyword.toLowerCase();
        lines.forEach(line => {
          const matchLevel = currentLogLevel === 'all' || line.dataset.level === currentLogLevel;
          const matchSearch = !keyword || (line.textContent || '').toLowerCase().includes(keyword);
          line.style.display = (matchLevel && matchSearch) ? '' : 'none';
        });
      }

      function filterLogs(level) {
        currentLogLevel = level;
        applyLogFilters();
      }

      function searchLogs(keyword) {
        currentSearchKeyword = keyword;
        applyLogFilters();
      }
      
      function clearLogs() {
        document.getElementById('log-container').innerHTML = '';
      }
      
      function scrollToBottom() {
        const container = document.getElementById('log-container');
        container.scrollTop = container.scrollHeight;
      }

      function exportLogs() {
        const lines = document.querySelectorAll('.log-line');
        let text = '';
        lines.forEach(line => {
          if (line.style.display !== 'none') {
            text += line.textContent + '\\n';
          }
        });
        if (!text) { alert('没有可导出的日志'); return; }
        const blob = new Blob([text], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'flashclaw-logs-' + new Date().toISOString().slice(0, 10) + '.txt';
        a.click();
        URL.revokeObjectURL(url);
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
    <div class="page-title-row">
      <h1 class="page-title" style="margin-bottom: 0;">
        <svg class="icon" aria-hidden="true"><use href="#icon-tasks"></use></svg>
        <span>定时任务</span>
      </h1>
      <button class="outline small" onclick="toggleCreateForm()">+ 新建任务</button>
    </div>

    <!-- 创建任务表单（默认隐藏） -->
    <article id="create-task-form" style="display:none;">
      <header class="section-title"><strong>新建定时任务</strong></header>
      <form onsubmit="createTask(event)">
        <div style="margin-bottom: 12px;">
          <label class="field-label">任务描述（AI 将执行的指令）</label>
          <textarea id="task-prompt" rows="2" placeholder="例：检查今日新闻并生成摘要" required></textarea>
        </div>
        <div class="grid" style="grid-template-columns: 1fr 1fr 1fr; gap: 12px; margin-bottom: 12px;">
          <div>
            <label class="field-label">调度类型</label>
            <select id="task-schedule-type" onchange="updateScheduleHint()">
              <option value="cron">Cron 表达式</option>
              <option value="interval">固定间隔（毫秒）</option>
              <option value="once">一次性</option>
            </select>
          </div>
          <div>
            <label class="field-label">调度值</label>
            <input id="task-schedule-value" placeholder="0 9 * * *" required>
            <small id="schedule-hint" style="color: var(--text-tertiary); font-size: 0.7rem;">cron: 分 时 日 月 周</small>
          </div>
          <div>
            <label class="field-label">上下文模式</label>
            <select id="task-context-mode">
              <option value="isolated">独立（推荐）</option>
              <option value="group">共享群组上下文</option>
            </select>
          </div>
        </div>
        <div class="btn-group">
          <button type="submit">创建任务</button>
          <button type="button" class="outline secondary" onclick="toggleCreateForm()">取消</button>
        </div>
      </form>
    </article>
    
    <!-- 任务列表 -->
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
                  <td><code style="cursor:pointer;" onclick="showTaskDetail('${task.id}')">${task.id.slice(0, 8)}</code></td>
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
                      <button class="outline small" onclick="showTaskDetail('${task.id}')">详情</button>
                      <button class="outline secondary small" hx-delete="/api/tasks/${task.id}" hx-confirm="确定要删除这个任务吗？" hx-swap="none" hx-on::after-request="htmx.trigger('#tasks-table', 'refresh')">删除</button>
                    </div>
                  </td>
                </tr>
              `)}
          </tbody>
        </table>
      </div>
    </article>

    <!-- 任务详情（默认隐藏） -->
    <article id="task-detail" style="display:none;">
      <header class="section-title"><strong>任务详情</strong> <button class="outline secondary small" onclick="document.getElementById('task-detail').style.display='none'">关闭</button></header>
      <div id="task-detail-content"></div>
    </article>

    <script>
      function toggleCreateForm() {
        const form = document.getElementById('create-task-form');
        form.style.display = form.style.display === 'none' ? '' : 'none';
      }

      function updateScheduleHint() {
        const type = document.getElementById('task-schedule-type').value;
        const hint = document.getElementById('schedule-hint');
        const input = document.getElementById('task-schedule-value');
        if (type === 'cron') { hint.textContent = 'cron: 分 时 日 月 周'; input.placeholder = '0 9 * * *'; }
        else if (type === 'interval') { hint.textContent = '间隔毫秒数，如 3600000 = 1小时'; input.placeholder = '3600000'; }
        else { hint.textContent = 'ISO 时间或相对时间'; input.placeholder = '2025-01-01T09:00:00'; }
      }

      async function createTask(e) {
        e.preventDefault();
        const prompt = document.getElementById('task-prompt').value.trim();
        const scheduleType = document.getElementById('task-schedule-type').value;
        const scheduleValue = document.getElementById('task-schedule-value').value.trim();
        const contextMode = document.getElementById('task-context-mode').value;
        if (!prompt || !scheduleValue) return;
        try {
          const res = await fetch('/api/tasks', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt, scheduleType, scheduleValue, contextMode }),
          });
          const data = await res.json();
          if (data.success) {
            toggleCreateForm();
            document.getElementById('task-prompt').value = '';
            document.getElementById('task-schedule-value').value = '';
            htmx.trigger('#tasks-table', 'refresh');
          } else { alert(data.error || '创建失败'); }
        } catch (err) { alert('创建失败: ' + err.message); }
      }

      async function showTaskDetail(id) {
        const detailEl = document.getElementById('task-detail');
        const contentEl = document.getElementById('task-detail-content');
        detailEl.style.display = '';
        contentEl.innerHTML = '<p>加载中...</p>';
        try {
          const [taskRes, logsRes] = await Promise.all([
            fetch('/api/tasks/' + id),
            fetch('/api/tasks/' + id + '/logs'),
          ]);
          const taskData = await taskRes.json();
          const logsData = await logsRes.json();
          if (!taskData.success) { contentEl.innerHTML = '<p style="color:var(--error);">任务不存在</p>'; return; }
          const t = taskData.task;
          const logs = logsData.logs || [];
          let html = '<div class="stat-grid" style="margin-bottom: 16px;">'
            + '<div class="stat-card"><div class="stat-label">ID</div><div style="font-family:var(--font-mono);font-size:0.75rem;">' + t.id + '</div></div>'
            + '<div class="stat-card"><div class="stat-label">类型</div><div class="stat-value" style="font-size:1rem;">' + t.scheduleType + '</div></div>'
            + '<div class="stat-card"><div class="stat-label">调度值</div><div style="font-family:var(--font-mono);font-size:0.75rem;">' + t.scheduleValue + '</div></div>'
            + '<div class="stat-card"><div class="stat-label">状态</div><div class="stat-value" style="font-size:1rem;">' + t.status + '</div></div>'
            + '<div class="stat-card"><div class="stat-label">上次执行</div><div style="font-size:0.75rem;">' + (t.lastRun ? new Date(t.lastRun).toLocaleString('zh-CN') : '-') + '</div></div>'
            + '<div class="stat-card"><div class="stat-label">下次执行</div><div style="font-size:0.75rem;">' + (t.nextRun ? new Date(t.nextRun).toLocaleString('zh-CN') : '-') + '</div></div>'
            + '</div>';
          html += '<div style="margin-bottom: 16px;"><strong style="font-size:0.8rem;color:var(--text-tertiary);">任务描述</strong><pre style="margin-top:6px;padding:12px;background:var(--code-bg);border-radius:var(--radius-md);font-size:0.8rem;white-space:pre-wrap;">' + escapeHtml(t.prompt) + '</pre></div>';
          if (t.lastResult) {
            html += '<div style="margin-bottom: 16px;"><strong style="font-size:0.8rem;color:var(--text-tertiary);">上次结果</strong><pre style="margin-top:6px;padding:12px;background:var(--code-bg);border-radius:var(--radius-md);font-size:0.8rem;white-space:pre-wrap;">' + escapeHtml(t.lastResult) + '</pre></div>';
          }
          if (logs.length > 0) {
            html += '<strong style="font-size:0.8rem;color:var(--text-tertiary);">运行历史</strong><table style="margin-top:8px;"><thead><tr><th>时间</th><th>状态</th><th>耗时</th><th class="hide-mobile">结果</th></tr></thead><tbody>';
            for (const log of logs) {
              const statusClass = log.status === 'success' ? 'badge-success' : 'badge-error';
              html += '<tr><td style="font-size:0.75rem;">' + new Date(log.run_at).toLocaleString('zh-CN') + '</td>'
                + '<td><span class="badge ' + statusClass + '">' + log.status + '</span></td>'
                + '<td style="font-family:var(--font-mono);font-size:0.75rem;">' + (log.duration_ms / 1000).toFixed(1) + 's</td>'
                + '<td class="hide-mobile" style="font-size:0.75rem;max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="' + escapeAttr(log.result || log.error || '') + '">' + escapeHtml((log.result || log.error || '-').slice(0, 80)) + '</td></tr>';
            }
            html += '</tbody></table>';
          } else {
            html += '<p style="color:var(--text-tertiary);font-size:0.8rem;">暂无运行记录</p>';
          }
          contentEl.innerHTML = html;
        } catch (err) { contentEl.innerHTML = '<p style="color:var(--error);">加载失败: ' + err.message + '</p>'; }
      }

      function escapeHtml(text) { const d = document.createElement('div'); d.textContent = text || ''; return d.innerHTML; }
      function escapeAttr(text) { return (text || '').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;'); }
    </script>
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



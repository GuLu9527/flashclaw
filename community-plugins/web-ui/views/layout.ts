/**
 * HTML 布局模板
 */

import { html } from 'hono/html';
import type { HtmlEscapedString } from 'hono/utils/html';

export interface LayoutOptions {
  title: string;
  activeNav?: 'dashboard' | 'chat' | 'logs' | 'tasks' | 'plugins';
}

/**
 * 基础布局模板
 */
export function layout(options: LayoutOptions, content: HtmlEscapedString): HtmlEscapedString {
  const { title, activeNav } = options;

  return html`
<!DOCTYPE html>
<html lang="zh-CN" data-theme="light">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} - FlashClaw</title>
  <link rel="stylesheet" href="/public/style.css">
  <script src="/public/htmx.min.js"></script>
  <script src="/public/htmx-sse.js"></script>
  <script src="/public/alpine.min.js" defer></script>
  <script src="/public/marked.min.js"></script>
</head>
<body>
  <svg class="icon-defs" aria-hidden="true" focusable="false">
    <symbol id="icon-dashboard" viewBox="0 0 24 24">
      <rect x="3" y="3" width="8" height="8" rx="2" fill="none" stroke="currentColor" stroke-width="1.5"></rect>
      <rect x="13" y="3" width="8" height="8" rx="2" fill="none" stroke="currentColor" stroke-width="1.5"></rect>
      <rect x="3" y="13" width="8" height="8" rx="2" fill="none" stroke="currentColor" stroke-width="1.5"></rect>
      <rect x="13" y="13" width="8" height="8" rx="2" fill="none" stroke="currentColor" stroke-width="1.5"></rect>
    </symbol>
    <symbol id="icon-chat" viewBox="0 0 24 24">
      <path d="M4 6.5A3.5 3.5 0 0 1 7.5 3h9A3.5 3.5 0 0 1 20 6.5v6A3.5 3.5 0 0 1 16.5 16H10l-4.5 4v-4H7.5A3.5 3.5 0 0 1 4 12.5z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"></path>
    </symbol>
    <symbol id="icon-logs" viewBox="0 0 24 24">
      <path d="M7 3h7l5 5v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"></path>
      <path d="M14 3v6h6" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"></path>
      <path d="M9 13h6M9 17h6" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"></path>
    </symbol>
    <symbol id="icon-tasks" viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="1.5"></circle>
      <path d="M12 7v5l3 2" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"></path>
    </symbol>
    <symbol id="icon-plugins" viewBox="0 0 24 24">
      <path d="M10 3h4a2 2 0 0 1 2 2v2h2a2 2 0 0 1 2 2v4h-2a2 2 0 0 0-2 2v2h-4v-2a2 2 0 0 0-2-2H8V9a2 2 0 0 1 2-2h2V5a2 2 0 0 0-2-2z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"></path>
      <path d="M6 11H4a2 2 0 0 0-2 2v4h2a2 2 0 0 1 2 2v2h4v-2a2 2 0 0 1 2-2h2v-4a2 2 0 0 0-2-2H6z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"></path>
    </symbol>
    <symbol id="icon-theme" viewBox="0 0 24 24">
      <path d="M21 14.5A8.5 8.5 0 1 1 9.5 3a7 7 0 1 0 11.5 11.5z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"></path>
    </symbol>
  </svg>
  <nav class="top-nav">
    <div class="nav-inner">
      <a href="/" class="brand">
        <img src="/public/flashclaw-icon.svg" alt="FlashClaw" class="brand-icon">
        <span class="brand-text">FlashClaw</span>
      </a>
      <div class="nav-links">
        <a href="/" class="nav-link ${activeNav === 'dashboard' ? 'nav-active' : ''}">
          <svg class="icon" aria-hidden="true"><use href="#icon-dashboard"></use></svg>
          <span>仪表盘</span>
        </a>
        <a href="/chat" class="nav-link ${activeNav === 'chat' ? 'nav-active' : ''}">
          <svg class="icon" aria-hidden="true"><use href="#icon-chat"></use></svg>
          <span>对话</span>
        </a>
        <a href="/logs" class="nav-link ${activeNav === 'logs' ? 'nav-active' : ''}">
          <svg class="icon" aria-hidden="true"><use href="#icon-logs"></use></svg>
          <span>日志</span>
        </a>
        <a href="/tasks" class="nav-link ${activeNav === 'tasks' ? 'nav-active' : ''}">
          <svg class="icon" aria-hidden="true"><use href="#icon-tasks"></use></svg>
          <span>任务</span>
        </a>
        <a href="/plugins" class="nav-link ${activeNav === 'plugins' ? 'nav-active' : ''}">
          <svg class="icon" aria-hidden="true"><use href="#icon-plugins"></use></svg>
          <span>插件</span>
        </a>
        <button class="theme-toggle" type="button" onclick="toggleTheme()" title="切换主题">
          <svg class="icon" aria-hidden="true"><use href="#icon-theme"></use></svg>
        </button>
      </div>
    </div>
  </nav>
  
  <main class="page">
    ${content}
  </main>
  
  <footer class="page-footer">
    <small>FlashClaw Web UI v1.0.0 | <a href="https://github.com/GuLu9527/flashclaw" target="_blank">GitHub</a></small>
  </footer>
  
  <script>
    // 主题切换
    function toggleTheme() {
      const html = document.documentElement;
      const current = html.getAttribute('data-theme');
      const next = current === 'dark' ? 'light' : 'dark';
      html.setAttribute('data-theme', next);
      localStorage.setItem('theme', next);
    }
    
    // 恢复主题
    (function() {
      const saved = localStorage.getItem('theme');
      if (saved) {
        document.documentElement.setAttribute('data-theme', saved);
      } else if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
        document.documentElement.setAttribute('data-theme', 'dark');
      }
    })();
  </script>
</body>
</html>
`;
}

/**
 * 状态徽章组件
 */
export function statusBadge(status: string): HtmlEscapedString {
  const statusMap: Record<string, { class: string; text: string }> = {
    active: { class: 'badge-success', text: '运行中' },
    running: { class: 'badge-success', text: '运行中' },
    paused: { class: 'badge-warning', text: '已暂停' },
    completed: { class: 'badge-muted', text: '已完成' },
    error: { class: 'badge-error', text: '错误' },
    failed: { class: 'badge-error', text: '失败' },
    enabled: { class: 'badge-success', text: '已启用' },
    disabled: { class: 'badge-muted', text: '已禁用' },
  };

  const info = statusMap[status.toLowerCase()] || { class: 'badge-info', text: status };
  return html`<span class="badge ${info.class}">${info.text}</span>`;
}

/**
 * 加载指示器
 */
export function loadingIndicator(): HtmlEscapedString {
  return html`<span class="htmx-indicator" aria-busy="true">加载中...</span>`;
}

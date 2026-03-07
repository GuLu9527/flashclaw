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
export function layout(options: LayoutOptions, content: HtmlEscapedString | Promise<HtmlEscapedString>): HtmlEscapedString | Promise<HtmlEscapedString> {
  const { title, activeNav } = options;

  return html`
<!DOCTYPE html>
<html lang="zh-CN" data-theme="dark">
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
    <symbol id="icon-dashboard" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
      <rect x="3" y="3" width="7" height="7" rx="2.5"/>
      <rect x="14" y="3" width="7" height="7" rx="2.5"/>
      <rect x="3" y="14" width="7" height="7" rx="2.5"/>
      <rect x="14" y="14" width="7" height="7" rx="2.5"/>
    </symbol>
    <symbol id="icon-chat" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
      <path d="M7.5 3h9A3.5 3.5 0 0 1 20 6.5v5a3.5 3.5 0 0 1-3.5 3.5H11l-4 3.5V15H5.5A2.5 2.5 0 0 1 3 12.5v-6A3.5 3.5 0 0 1 6.5 3z"/>
      <path d="M8 8.5h8M8 11.5h5" opacity="0.5"/>
    </symbol>
    <symbol id="icon-logs" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
      <polyline points="14 2 14 8 20 8"/>
      <line x1="8" y1="13" x2="16" y2="13"/>
      <line x1="8" y1="17" x2="13" y2="17"/>
    </symbol>
    <symbol id="icon-tasks" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="12" cy="12" r="9"/>
      <polyline points="12 6 12 12 16 14"/>
    </symbol>
    <symbol id="icon-plugins" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
      <rect x="4" y="4" width="16" height="16" rx="3"/>
      <path d="M9 4v4a1 1 0 0 0 1 1h4a1 1 0 0 0 1-1V4"/>
      <line x1="12" y1="13" x2="12" y2="17"/>
      <line x1="10" y1="15" x2="14" y2="15"/>
    </symbol>
    <symbol id="icon-theme" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
      <path d="M21 12.79A9 9 0 1 1 11.21 3a7 7 0 0 0 9.79 9.79z"/>
    </symbol>
  </svg>
  <nav class="top-nav">
    <div class="nav-inner">
      <a href="/" class="brand">
        <img src="/public/flashclaw-icon.svg" alt="FlashClaw" class="brand-icon">
        <span class="brand-text hide-mobile">FlashClaw</span>
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
    ⚡ FlashClaw v1.0.0 · <a href="https://github.com/GuLu9527/flashclaw" target="_blank">GitHub</a>
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
export function statusBadge(status: string): HtmlEscapedString | Promise<HtmlEscapedString> {
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
export function loadingIndicator(): HtmlEscapedString | Promise<HtmlEscapedString> {
  return html`<span class="htmx-indicator" aria-busy="true">加载中...</span>`;
}

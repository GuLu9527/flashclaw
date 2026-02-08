/**
 * Web UI Hono 应用
 */

import { Hono } from 'hono';
import { serveStatic } from '@hono/node-server/serve-static';
import { timingSafeEqual, createHash } from 'crypto';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { pagesRoutes } from './routes/pages.js';
import { apiRoutes } from './routes/api.js';
import { sseRoutes } from './routes/sse.js';

// 基于模块自身位置计算绝对路径，不依赖 process.cwd()
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
/** 插件根目录（web-ui/） */
const pluginRoot = resolve(__dirname, '..');

function safeCompare(a: string, b: string): boolean {
  const hashA = createHash('sha256').update(a).digest();
  const hashB = createHash('sha256').update(b).digest();
  return timingSafeEqual(hashA, hashB);
}

interface AppOptions {
  token?: string;
}

export function createApp(options: AppOptions = {}) {
  const app = new Hono();

  // 可选的 Token 认证中间件
  if (options.token) {
    app.use('*', async (c, next) => {
      // 跳过静态资源
      if (c.req.path.startsWith('/public/')) {
        return next();
      }

      const authHeader = c.req.header('Authorization');
      const cookieToken = c.req.header('Cookie')?.match(/token=([^;]+)/)?.[1];
      const queryToken = c.req.query('token');

      if (
        safeCompare(authHeader || '', `Bearer ${options.token}`) ||
        safeCompare(cookieToken || '', options.token) ||
        safeCompare(queryToken || '', options.token)
      ) {
        return next();
      }

      // 登录页面
      if (c.req.path === '/login' && c.req.method === 'GET') {
        return c.html(`
          <!DOCTYPE html>
          <html>
          <head>
            <title>登录 - FlashClaw</title>
            <link rel="stylesheet" href="/public/style.css">
          </head>
          <body class="auth-body">
            <main class="auth-container">
              <div class="auth-card">
                <div class="auth-brand">
                  <img src="/public/flashclaw-icon.svg" alt="FlashClaw" class="brand-icon">
                  <div class="auth-title">FlashClaw Web UI</div>
                </div>
                <form method="POST" action="/login" class="auth-form">
                  <label class="field-label" for="token">访问密钥</label>
                  <input id="token" type="password" name="token" placeholder="请输入访问密钥" required>
                  <button type="submit" class="primary">登录</button>
                </form>
              </div>
            </main>
          </body>
          </html>
        `);
      }

      // 登录提交
      if (c.req.path === '/login' && c.req.method === 'POST') {
        const body = await c.req.parseBody();
        if (body.token === options.token) {
          c.header('Set-Cookie', `token=${encodeURIComponent(options.token)}; Path=/; HttpOnly; SameSite=Strict; Secure`);
          return c.redirect('/');
        }
        return c.redirect('/login?error=1');
      }

      return c.redirect('/login');
    });
  }

  // 静态文件 — 使用绝对路径，确保无论 CWD 在哪都能正确加载
  app.use('/public/*', serveStatic({ root: pluginRoot }));

  // API 路由
  app.route('/api', apiRoutes);

  // SSE 路由
  app.route('/sse', sseRoutes);

  // 页面路由
  app.route('/', pagesRoutes);

  return app;
}

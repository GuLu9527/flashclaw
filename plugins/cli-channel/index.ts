/**
 * CLI 渠道插件 - 终端交互渠道
 *
 * 提供独立的 HTTP API 供 flashclaw cli 客户端连接。
 * 通过核心 API 层（core-api）处理消息和命令，不依赖 web-ui。
 *
 * 使用方式：
 * 1. 启动服务: flashclaw start
 * 2. 连接 CLI: flashclaw cli
 */

import type { ChannelPlugin, MessageHandler, PluginConfig, SendMessageResult } from '../../src/plugins/types.js';
import { createLogger } from '../../src/logger.js';
import http from 'http';

const logger = createLogger('CLI-Channel');

const DEFAULT_PORT = 3001;
let server: http.Server | null = null;
let cliPort = DEFAULT_PORT;

/**
 * 获取核心 API（通过全局变量注入）
 */
function getCoreApi() {
  return (global as Record<string, unknown>).__flashclaw_core_api as typeof import('../../src/core-api.js') | undefined;
}

/**
 * 解析 JSON 请求体
 */
function parseBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

/**
 * 发送 JSON 响应
 */
function sendJson(res: http.ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(JSON.stringify(data));
}

/**
 * 处理 HTTP 请求
 */
async function handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const url = req.url || '/';
  const method = req.method || 'GET';

  // CORS preflight
  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    res.end();
    return;
  }

  const api = getCoreApi();
  if (!api) {
    sendJson(res, 503, { error: 'Core API not ready' });
    return;
  }

  try {
    // GET /api/status
    if (url === '/api/status' && method === 'GET') {
      sendJson(res, 200, api.getStatus());
      return;
    }

    // GET /api/chat/history?group=xxx
    if (url.startsWith('/api/chat/history') && method === 'GET') {
      const params = new URL(url, 'http://localhost').searchParams;
      const group = params.get('group') || 'main';
      const chatId = `${group}-chat`;
      const messages = api.getHistory(chatId);
      sendJson(res, 200, { success: true, messages });
      return;
    }

    // POST /api/chat/clear
    if (url === '/api/chat/clear' && method === 'POST') {
      const body = await parseBody(req);
      const group = (body.group as string) || 'main';
      api.clearSession(group);
      sendJson(res, 200, { success: true });
      return;
    }

    // POST /api/chat/stream — 流式对话
    if (url === '/api/chat/stream' && method === 'POST') {
      const body = await parseBody(req);
      const message = body.message as string;
      const group = (body.group as string) || 'main';

      if (!message) {
        sendJson(res, 400, { error: 'message is required' });
        return;
      }

      // 流式响应
      res.writeHead(200, {
        'Content-Type': 'text/plain; charset=utf-8',
        'Transfer-Encoding': 'chunked',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-cache',
      });

      try {
        const result = await api.chat({
          message,
          group,
          userId: 'cli-user',
          platform: 'cli-channel',
          onToken: (chunk: string) => {
            res.write(chunk);
          },
          onToolUse: (name: string, input: unknown) => {
            res.write(`[TOOL:${JSON.stringify({ name, input })}]`);
          },
        });

        // 发送 metrics
        if (result.metrics) {
          res.write(`[METRICS:${JSON.stringify({
            durationMs: result.metrics.durationMs,
            model: result.metrics.model,
            inputTokens: result.metrics.usage?.inputTokens ?? null,
            outputTokens: result.metrics.usage?.outputTokens ?? null,
          })}]`);
        }
      } catch (err) {
        res.write(`\n\n❌ 错误: ${err instanceof Error ? err.message : String(err)}`);
      }

      res.end();
      return;
    }

    // POST /api/chat — 非流式对话
    if (url === '/api/chat' && method === 'POST') {
      const body = await parseBody(req);
      const message = body.message as string;
      const group = (body.group as string) || 'main';

      if (!message) {
        sendJson(res, 400, { error: 'message is required' });
        return;
      }

      const result = await api.chat({ message, group, userId: 'cli-user', platform: 'cli-channel' });
      sendJson(res, 200, { response: result.response, metrics: result.metrics });
      return;
    }

    // POST /api/compact
    if (url === '/api/compact' && method === 'POST') {
      const body = await parseBody(req);
      const group = (body.group as string) || 'main';
      const chatId = `${group}-chat`;
      const summary = await api.compactSession(chatId, group, 'cli-user', 'cli-channel');
      sendJson(res, 200, { success: true, summary });
      return;
    }

    // 404
    sendJson(res, 404, { error: 'Not Found' });
  } catch (err) {
    logger.error({ err, url }, 'CLI-Channel API 错误');
    sendJson(res, 500, { error: err instanceof Error ? err.message : 'Internal Server Error' });
  }
}

const plugin: ChannelPlugin = {
  name: 'cli-channel',
  version: '2.0.0',

  async init(config: PluginConfig): Promise<void> {
    cliPort = Number(config.port || process.env.CLI_PORT || DEFAULT_PORT);
  },

  onMessage(_handler: MessageHandler): void {
    // CLI 渠道通过 HTTP API 接收消息，不需要 onMessage handler
  },

  async start(): Promise<void> {
    server = http.createServer((req, res) => {
      handleRequest(req, res).catch(err => {
        logger.error({ err }, 'CLI-Channel 请求处理失败');
        if (!res.headersSent) {
          sendJson(res, 500, { error: 'Internal Server Error' });
        }
      });
    });

    server.listen(cliPort, () => {
      logger.info({ port: cliPort }, '⚡ CLI 渠道 API 已启动');
    });
  },

  async stop(): Promise<void> {
    if (server) {
      await new Promise<void>((resolve) => {
        server!.close(() => resolve());
      });
      server = null;
      logger.info('⚡ CLI 渠道 API 已停止');
    }
  },

  async sendMessage(_chatId: string, _content: string): Promise<SendMessageResult> {
    // CLI 渠道的消息通过 HTTP 流式响应直接返回，不需要主动推送
    return { success: true };
  }
};

export default plugin;

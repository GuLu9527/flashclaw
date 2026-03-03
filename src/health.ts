/**
 * FlashClaw 健康检查服务
 * 提供 HTTP 健康检查端点
 */

import http from 'http';
import { createLogger } from './logger.js';

const logger = createLogger('HealthCheck');

interface HealthStatus {
  status: 'ok' | 'degraded' | 'unhealthy';
  uptime: number;
  timestamp: string;
  memory: {
    used: number;
    total: number;
    percentage: number;
  };
  plugins?: {
    loaded: number;
    enabled: number;
  };
}

let server: http.Server | null = null;
let startTime = Date.now();

export function getHealthStatus(pluginCount?: { loaded: number; enabled: number }): HealthStatus {
  const memUsage = process.memoryUsage();
  const totalMem = memUsage.heapTotal;
  const usedMem = memUsage.heapUsed;
  
  return {
    status: 'ok',
    uptime: Math.floor((Date.now() - startTime) / 1000),
    timestamp: new Date().toISOString(),
    memory: {
      used: Math.round(usedMem / 1024 / 1024),
      total: Math.round(totalMem / 1024 / 1024),
      percentage: Math.round((usedMem / totalMem) * 100),
    },
    plugins: pluginCount,
  };
}

export function startHealthServer(port: number = 9090): http.Server {
  server = http.createServer((req, res) => {
    if (req.url === '/health' && req.method === 'GET') {
      const health = getHealthStatus();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(health, null, 2));
    } else if (req.url === '/ready' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ready: true }));
    } else {
      res.writeHead(404);
      res.end('Not Found');
    }
  });
  
  server.listen(port, () => {
    logger.debug({ port }, '⚡ 健康检查服务已启动');
  });
  
  startTime = Date.now();
  return server;
}

export function stopHealthServer(): void {
  if (server) {
    server.close();
    server = null;
    logger.info('⚡ 健康检查服务已停止');
  }
}

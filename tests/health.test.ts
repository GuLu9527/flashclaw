import { describe, it, expect, afterEach } from 'vitest';
import { getHealthStatus, startHealthServer, stopHealthServer } from '../src/health.js';

describe('health', () => {
  afterEach(() => {
    stopHealthServer();
  });

  describe('getHealthStatus', () => {
    it('should return health status', () => {
      const status = getHealthStatus();

      expect(status.status).toBe('ok');
      expect(typeof status.uptime).toBe('number');
      expect(status.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(status.memory).toBeDefined();
      expect(typeof status.memory.used).toBe('number');
      expect(typeof status.memory.total).toBe('number');
      expect(typeof status.memory.percentage).toBe('number');
    });

    it('should include plugin count when provided', () => {
      const pluginCount = { loaded: 5, enabled: 4 };
      const status = getHealthStatus(pluginCount);

      expect(status.plugins).toEqual(pluginCount);
    });

    it('should not include plugins when not provided', () => {
      const status = getHealthStatus();

      expect(status.plugins).toBeUndefined();
    });

    it('should have valid memory percentage', () => {
      const status = getHealthStatus();

      expect(status.memory.percentage).toBeGreaterThanOrEqual(0);
      expect(status.memory.percentage).toBeLessThanOrEqual(100);
    });

    it('should have non-negative uptime', () => {
      const status = getHealthStatus();

      expect(status.uptime).toBeGreaterThanOrEqual(0);
    });
  });

  describe('startHealthServer', () => {
    it('should start server on specified port', async () => {
      const port = 19090; // 使用非标准端口避免冲突
      const server = startHealthServer(port);

      expect(server).toBeDefined();
      expect(server.listening).toBe(true);

      // 等待服务器启动
      await new Promise(resolve => setTimeout(resolve, 100));

      stopHealthServer();
    });

    it('should respond to /health endpoint', async () => {
      const port = 19091;
      startHealthServer(port);

      // 等待服务器启动
      await new Promise(resolve => setTimeout(resolve, 100));

      // 发送请求
      const response = await fetch(`http://localhost:${port}/health`);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.status).toBe('ok');
      expect(data.memory).toBeDefined();

      stopHealthServer();
    });

    it('should respond to /ready endpoint', async () => {
      const port = 19092;
      startHealthServer(port);

      await new Promise(resolve => setTimeout(resolve, 100));

      const response = await fetch(`http://localhost:${port}/ready`);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.ready).toBe(true);

      stopHealthServer();
    });

    it('should return 404 for unknown endpoints', async () => {
      const port = 19093;
      startHealthServer(port);

      await new Promise(resolve => setTimeout(resolve, 100));

      const response = await fetch(`http://localhost:${port}/unknown`);

      expect(response.status).toBe(404);

      stopHealthServer();
    });
  });

  describe('stopHealthServer', () => {
    it('should stop running server', async () => {
      const port = 19094;
      const server = startHealthServer(port);

      await new Promise(resolve => setTimeout(resolve, 100));
      expect(server.listening).toBe(true);

      stopHealthServer();

      // 服务器应该已停止
      await new Promise(resolve => setTimeout(resolve, 100));
      expect(server.listening).toBe(false);
    });

    it('should handle multiple stop calls gracefully', () => {
      const port = 19095;
      startHealthServer(port);

      // 多次调用 stop 不应报错
      stopHealthServer();
      stopHealthServer();
      stopHealthServer();
    });
  });
});

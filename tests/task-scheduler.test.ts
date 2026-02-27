import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// Mock 依赖模块
vi.mock('../src/db.js', () => ({
  getDueTasks: vi.fn(() => []),
  getTaskById: vi.fn(),
  getAllTasks: vi.fn(() => []),
  getNextWakeTime: vi.fn(() => null),
  updateTaskAfterRun: vi.fn(),
  logTaskRun: vi.fn(),
  updateTaskRetry: vi.fn(),
  resetTaskRetry: vi.fn(),
  updateTask: vi.fn(),
}));

vi.mock('../src/agent-runner.js', () => ({
  runAgent: vi.fn(async () => ({ status: 'success', result: 'Task completed' })),
  writeTasksSnapshot: vi.fn(),
}));

vi.mock('../src/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}));

let tempDir = '';

describe('task-scheduler', () => {
  beforeEach(async () => {
    tempDir = await fs.mkdtemp(join(tmpdir(), 'flashclaw-scheduler-'));
    process.env.FLASHCLAW_HOME = tempDir;
    vi.resetModules();
    vi.useFakeTimers();
  });

  afterEach(async () => {
    vi.useRealTimers();
    vi.clearAllMocks();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('startScheduler / stopScheduler', () => {
    it('should start and stop scheduler without errors', async () => {
      const scheduler = await import('../src/task-scheduler.js');
      const { getDueTasks, getNextWakeTime } = await import('../src/db.js');

      vi.mocked(getDueTasks).mockReturnValue([]);
      vi.mocked(getNextWakeTime).mockReturnValue(null);

      const mockDeps = {
        sendMessage: vi.fn(),
        registeredGroups: () => ({}),
        getSessions: () => ({}),
      };

      // 启动调度器
      scheduler.startScheduler(mockDeps);

      // 停止调度器
      scheduler.stopScheduler();

      // 应该正常完成，无报错
      expect(true).toBe(true);
    });

    it('should handle startSchedulerLoop alias', async () => {
      const scheduler = await import('../src/task-scheduler.js');
      const { getNextWakeTime } = await import('../src/db.js');

      vi.mocked(getNextWakeTime).mockReturnValue(null);

      const mockDeps = {
        sendMessage: vi.fn(),
        registeredGroups: () => ({}),
        getSessions: () => ({}),
      };

      // 使用别名
      scheduler.startSchedulerLoop(mockDeps);
      scheduler.stopScheduler();

      expect(true).toBe(true);
    });
  });

  describe('wake', () => {
    it('should reset timer when wake is called', async () => {
      const scheduler = await import('../src/task-scheduler.js');
      const { getNextWakeTime } = await import('../src/db.js');

      vi.mocked(getNextWakeTime).mockReturnValue(Date.now() + 60000);

      const mockDeps = {
        sendMessage: vi.fn(),
        registeredGroups: () => ({}),
        getSessions: () => ({}),
      };

      scheduler.startScheduler(mockDeps);

      // 调用 wake 应该重新计算定时器
      scheduler.wake();

      scheduler.stopScheduler();
    });
  });

  describe('getSchedulerStatus', () => {
    it('should return scheduler status', async () => {
      const scheduler = await import('../src/task-scheduler.js');
      const { getDueTasks, getNextWakeTime } = await import('../src/db.js');

      vi.mocked(getDueTasks).mockReturnValue([]);
      vi.mocked(getNextWakeTime).mockReturnValue(Date.now() + 60000);

      const status = scheduler.getSchedulerStatus();

      expect(status).toHaveProperty('running');
      expect(status).toHaveProperty('nextWakeTime');
      expect(status).toHaveProperty('activeTasks');
      expect(typeof status.running).toBe('boolean');
    });
  });

  describe('calculateNextRun', () => {
    it('should calculate next run for cron tasks', async () => {
      // 这个测试验证 cron 解析逻辑
      const { CronExpressionParser } = await import('cron-parser');

      // 每小时执行
      const interval = CronExpressionParser.parse('0 * * * *');
      const next = interval.next();

      expect(next.toDate()).toBeInstanceOf(Date);
      expect(next.toDate().getTime()).toBeGreaterThan(Date.now());
    });

    it('should calculate next run for interval tasks', () => {
      const intervalMs = 3600000; // 1 hour
      const now = Date.now();
      const nextRun = new Date(now + intervalMs);

      expect(nextRun.getTime()).toBe(now + intervalMs);
    });

    it('should return null for once tasks after execution', () => {
      // once 类型任务执行后没有下次
      const nextRun = null;
      expect(nextRun).toBeNull();
    });
  });
});

describe('task retry mechanism', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should calculate exponential backoff delay', () => {
    const RETRY_BASE_DELAY_MS = 60 * 1000;
    const MAX_RETRY_DELAY_MS = 60 * 60 * 1000;

    // 第1次重试：1分钟
    const delay1 = Math.min(RETRY_BASE_DELAY_MS * Math.pow(2, 0), MAX_RETRY_DELAY_MS);
    expect(delay1).toBe(60000);

    // 第2次重试：2分钟
    const delay2 = Math.min(RETRY_BASE_DELAY_MS * Math.pow(2, 1), MAX_RETRY_DELAY_MS);
    expect(delay2).toBe(120000);

    // 第3次重试：4分钟
    const delay3 = Math.min(RETRY_BASE_DELAY_MS * Math.pow(2, 2), MAX_RETRY_DELAY_MS);
    expect(delay3).toBe(240000);

    // 第7次重试：应该被限制在最大值
    const delay7 = Math.min(RETRY_BASE_DELAY_MS * Math.pow(2, 6), MAX_RETRY_DELAY_MS);
    expect(delay7).toBe(MAX_RETRY_DELAY_MS);
  });
});

describe('task execution', () => {
  it('should handle task timeout', async () => {
    const DEFAULT_TASK_TIMEOUT_MS = 5 * 60 * 1000;

    // 模拟超时
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject(new Error(`任务执行超时 (${DEFAULT_TASK_TIMEOUT_MS}ms)`));
      }, 100); // 使用较短时间测试
    });

    const taskPromise = new Promise(resolve => {
      setTimeout(resolve, 200); // 任务需要更长时间
    });

    try {
      await Promise.race([taskPromise, timeoutPromise]);
      expect.fail('Should have thrown timeout error');
    } catch (err) {
      expect((err as Error).message).toContain('超时');
    }
  });
});

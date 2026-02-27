import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MessageQueue, QueuedMessage } from '../src/message-queue.js';

describe('MessageQueue', () => {
  let processedMessages: QueuedMessage<string>[];
  let processor: (msg: QueuedMessage<string>) => Promise<void>;

  beforeEach(() => {
    processedMessages = [];
    processor = vi.fn(async (msg: QueuedMessage<string>) => {
      processedMessages.push(msg);
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('enqueue', () => {
    it('should enqueue a message successfully', async () => {
      const queue = new MessageQueue(processor);
      queue.start();

      const result = await queue.enqueue('chat-1', 'msg-1', 'test data');
      expect(result).toBe(true);

      // 等待处理
      await new Promise(resolve => setTimeout(resolve, 50));
      expect(processedMessages.length).toBe(1);
      expect(processedMessages[0].data).toBe('test data');

      queue.stop();
    });

    it('should reject duplicate messages', async () => {
      const queue = new MessageQueue(processor);
      queue.start();

      const result1 = await queue.enqueue('chat-1', 'msg-1', 'data1');
      const result2 = await queue.enqueue('chat-1', 'msg-1', 'data2');

      expect(result1).toBe(true);
      expect(result2).toBe(false);

      await new Promise(resolve => setTimeout(resolve, 50));
      expect(processedMessages.length).toBe(1);

      queue.stop();
    });

    it('should drop oldest message when queue is full', async () => {
      // 使用慢处理器保持队列
      const slowProcessor = vi.fn(async () => {
        await new Promise(resolve => setTimeout(resolve, 500));
      });
      const queue = new MessageQueue(slowProcessor, { maxQueueSize: 2 });
      queue.start();

      // 快速添加多条消息
      await queue.enqueue('chat-1', 'msg-1', 'data1');
      await queue.enqueue('chat-1', 'msg-2', 'data2');
      await queue.enqueue('chat-1', 'msg-3', 'data3');

      const stats = queue.getStats();
      // 队列中应该只有2条（1个正在处理，队列中最多2个）
      expect(stats.totalQueued).toBeLessThanOrEqual(2);

      queue.stop();
    });
  });

  describe('concurrency control', () => {
    it('should respect maxConcurrent setting', async () => {
      let concurrentCount = 0;
      let maxConcurrent = 0;

      const concurrentProcessor = vi.fn(async () => {
        concurrentCount++;
        maxConcurrent = Math.max(maxConcurrent, concurrentCount);
        await new Promise(resolve => setTimeout(resolve, 100));
        concurrentCount--;
      });

      const queue = new MessageQueue(concurrentProcessor, { maxConcurrent: 2 });
      queue.start();

      // 添加多条来自不同聊天的消息
      await queue.enqueue('chat-1', 'msg-1', 'data1');
      await queue.enqueue('chat-2', 'msg-2', 'data2');
      await queue.enqueue('chat-3', 'msg-3', 'data3');
      await queue.enqueue('chat-4', 'msg-4', 'data4');

      await new Promise(resolve => setTimeout(resolve, 500));

      expect(maxConcurrent).toBeLessThanOrEqual(2);

      queue.stop();
    });
  });

  describe('retry mechanism', () => {
    it('should retry failed messages', async () => {
      let attempts = 0;
      const failingProcessor = vi.fn(async () => {
        attempts++;
        if (attempts < 3) {
          throw new Error('Processing failed');
        }
      });

      const queue = new MessageQueue(failingProcessor, { maxRetries: 3 });
      queue.start();

      await queue.enqueue('chat-1', 'msg-1', 'data');

      // 等待重试
      await new Promise(resolve => setTimeout(resolve, 300));

      expect(attempts).toBe(3);

      queue.stop();
    });

    it('should drop message after max retries', async () => {
      const alwaysFailProcessor = vi.fn(async () => {
        throw new Error('Always fail');
      });

      const queue = new MessageQueue(alwaysFailProcessor, { maxRetries: 2 });
      queue.start();

      await queue.enqueue('chat-1', 'msg-1', 'data');

      // 等待所有重试完成
      await new Promise(resolve => setTimeout(resolve, 500));

      // 应该调用 3 次（初始 + 2次重试）
      expect(alwaysFailProcessor).toHaveBeenCalledTimes(3);

      const stats = queue.getStats();
      expect(stats.totalQueued).toBe(0);

      queue.stop();
    });
  });

  describe('getStats', () => {
    it('should return correct statistics', async () => {
      const slowProcessor = vi.fn(async () => {
        await new Promise(resolve => setTimeout(resolve, 200));
      });

      const queue = new MessageQueue(slowProcessor);
      queue.start();

      await queue.enqueue('chat-1', 'msg-1', 'data1');
      await queue.enqueue('chat-1', 'msg-2', 'data2');
      await queue.enqueue('chat-2', 'msg-3', 'data3');

      // 立即获取统计
      const stats = queue.getStats();

      expect(stats.seenCount).toBe(3);
      expect(stats.processingCount).toBeGreaterThanOrEqual(0);

      queue.stop();
    });
  });

  describe('start/stop', () => {
    it('should not process messages when stopped', async () => {
      const queue = new MessageQueue(processor);
      // 不调用 start()

      await queue.enqueue('chat-1', 'msg-1', 'data');

      await new Promise(resolve => setTimeout(resolve, 100));

      // 消息被加入队列但不处理
      expect(processedMessages.length).toBe(0);
    });

    it('should handle multiple start calls gracefully', () => {
      const queue = new MessageQueue(processor);

      // 多次调用 start 不应报错
      queue.start();
      queue.start();
      queue.start();

      queue.stop();
    });
  });
});

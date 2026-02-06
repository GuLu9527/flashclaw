/**
 * Message Queue for FlashClaw
 * 高并发消息排队处理，防止消息丢失
 */

import { createLogger } from './logger.js';

const logger = createLogger('MessageQueue');

export interface QueuedMessage<T> {
  id: string;
  chatId: string;
  data: T;
  timestamp: number;
  retries: number;
}

interface QueueConfig {
  maxQueueSize: number;        // 每个聊天的最大队列长度
  maxConcurrent: number;       // 最大并发处理数
  processingTimeout: number;   // 处理超时时间(ms)
  maxRetries: number;          // 最大重试次数
}

const DEFAULT_CONFIG: QueueConfig = {
  maxQueueSize: 100,
  maxConcurrent: 5,
  processingTimeout: 300000,   // 5 minutes
  maxRetries: 2
};

type MessageProcessor<T> = (message: QueuedMessage<T>) => Promise<void>;

export class MessageQueue<T> {
  private queues: Map<string, QueuedMessage<T>[]> = new Map();
  private processing: Set<string> = new Set();
  private seenMessages: Map<string, number> = new Map();
  private config: QueueConfig;
  private processor: MessageProcessor<T>;
  private isRunning: boolean = false;
  private processInterval: NodeJS.Timeout | null = null;

  // 去重 TTL (10 分钟)
  private readonly SEEN_TTL_MS = 10 * 60 * 1000;
  // 去重缓存硬上限（防止高负载下无限增长）
  private readonly MAX_SEEN_ENTRIES = 10000;

  constructor(processor: MessageProcessor<T>, config: Partial<QueueConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.processor = processor;
  }

  /**
   * 启动队列处理
   */
  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    
    // 定期清理过期的去重记录
    this.processInterval = setInterval(() => {
      this.cleanupSeenMessages();
    }, 60000); // 每分钟清理一次
    this.processInterval.unref();
    
    logger.info('Message queue started');
  }

  /**
   * 停止队列处理
   */
  stop(): void {
    this.isRunning = false;
    if (this.processInterval) {
      clearInterval(this.processInterval);
      this.processInterval = null;
    }
    logger.info('Message queue stopped');
  }

  /**
   * 添加消息到队列
   * @returns true 如果消息被添加, false 如果是重复消息或队列已满
   */
  async enqueue(chatId: string, messageId: string, data: T): Promise<boolean> {
    // 去重检查
    if (this.isDuplicate(messageId)) {
      logger.debug({ messageId, chatId }, 'Duplicate message ignored');
      return false;
    }

    // 标记已见
    this.markSeen(messageId);

    // 获取或创建队列
    let queue = this.queues.get(chatId);
    if (!queue) {
      queue = [];
      this.queues.set(chatId, queue);
    }

    // 检查队列大小
    if (queue.length >= this.config.maxQueueSize) {
      logger.warn({ chatId, queueSize: queue.length }, 'Queue full, dropping oldest message');
      queue.shift(); // 移除最旧的消息
    }

    // 添加到队列
    const queuedMessage: QueuedMessage<T> = {
      id: messageId,
      chatId,
      data,
      timestamp: Date.now(),
      retries: 0
    };
    queue.push(queuedMessage);

    logger.debug({ chatId, messageId, queueSize: queue.length }, 'Message enqueued');

    // 触发处理
    this.processNext(chatId);

    return true;
  }

  /**
   * 处理下一条消息
   * 使用同步的 Set 检查确保同一 chatId 不会被并发处理
   */
  private async processNext(chatId: string): Promise<void> {
    if (!this.isRunning) return;
    
    // 原子检查：如果已在处理该聊天，直接返回
    // Node.js 单线程模型下，同步代码块内的检查和添加是原子的
    if (this.processing.has(chatId)) {
      return;
    }

    // 检查并发数
    if (this.processing.size >= this.config.maxConcurrent) {
      return;
    }

    const queue = this.queues.get(chatId);
    if (!queue || queue.length === 0) {
      return;
    }

    // 立即标记为处理中（在任何 await 之前），确保不会重复进入
    this.processing.add(chatId);
    
    // 取出消息
    const message = queue.shift()!;

    let timeoutId: NodeJS.Timeout | undefined;
    try {
      // 设置超时
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error('Processing timeout')), this.config.processingTimeout);
      });

      await Promise.race([
        this.processor(message),
        timeoutPromise
      ]);

      logger.debug({ chatId, messageId: message.id }, 'Message processed');

    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      logger.error({ chatId, messageId: message.id, error: errorMsg }, 'Message processing error');

      // 重试逻辑
      if (message.retries < this.config.maxRetries) {
        message.retries++;
        queue.unshift(message); // 放回队列头部
        logger.info({ chatId, messageId: message.id, retries: message.retries }, 'Message will be retried');
      } else {
        logger.error({ chatId, messageId: message.id }, 'Message dropped after max retries');
      }

    } finally {
      if (timeoutId !== undefined) clearTimeout(timeoutId);
      this.processing.delete(chatId);

      // 继续处理下一条
      if (queue.length > 0) {
        setImmediate(() => this.processNext(chatId));
      }
    }
  }

  /**
   * 检查是否是重复消息
   */
  private isDuplicate(messageId: string): boolean {
    const seenAt = this.seenMessages.get(messageId);
    if (!seenAt) return false;
    
    // 检查是否过期
    if (Date.now() - seenAt > this.SEEN_TTL_MS) {
      this.seenMessages.delete(messageId);
      return false;
    }
    
    return true;
  }

  /**
   * 标记消息已见（超过上限时移除最旧的条目）
   */
  private markSeen(messageId: string): void {
    this.seenMessages.set(messageId, Date.now());
    
    // 硬上限保护：超过上限时批量清理最旧的条目
    if (this.seenMessages.size > this.MAX_SEEN_ENTRIES) {
      const toRemove = this.seenMessages.size - this.MAX_SEEN_ENTRIES + Math.floor(this.MAX_SEEN_ENTRIES * 0.1); // 多清理 10%
      const keys = this.seenMessages.keys();
      for (let i = 0; i < toRemove; i++) {
        const key = keys.next().value;
        if (key !== undefined) this.seenMessages.delete(key);
      }
      logger.debug({ removed: toRemove, remaining: this.seenMessages.size }, 'Evicted old seen messages (hard limit)');
    }
  }

  /**
   * 清理过期的去重记录
   */
  private cleanupSeenMessages(): void {
    const now = Date.now();
    let cleaned = 0;
    
    for (const [id, timestamp] of this.seenMessages.entries()) {
      if (now - timestamp > this.SEEN_TTL_MS) {
        this.seenMessages.delete(id);
        cleaned++;
      }
    }
    
    if (cleaned > 0) {
      logger.debug({ cleaned }, 'Cleaned up expired seen messages');
    }
  }

  /**
   * 获取队列统计信息
   */
  getStats(): {
    totalQueued: number;
    processingCount: number;
    queuedByChat: Record<string, number>;
    seenCount: number;
  } {
    const queuedByChat: Record<string, number> = {};
    let totalQueued = 0;

    for (const [chatId, queue] of this.queues.entries()) {
      queuedByChat[chatId] = queue.length;
      totalQueued += queue.length;
    }

    return {
      totalQueued,
      processingCount: this.processing.size,
      queuedByChat,
      seenCount: this.seenMessages.size
    };
  }
}

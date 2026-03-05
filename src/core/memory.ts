/**
 * FlashClaw 记忆系统
 * 
 * 三层记忆架构：
 * 1. 短期记忆 - 最近 N 条消息，保存在内存中
 * 2. 长期记忆 - 重要信息，保存在 data/memory/{group}.md 文件
 * 3. 上下文压缩 - 超长对话时自动摘要，减少 token 消耗
 * 
 * 参考 OpenClaw 的 session-memory 设计
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ApiClient, ChatMessage, MessageContent, TextBlock } from './api-client.js';
import type { AIProviderPlugin, ChatOptions } from '../plugins/types.js';

/**
 * 兼容 ApiClient 和 AIProviderPlugin 的类型
 * 两者都有 chat 方法，但 extractText 只在 ApiClient 上有
 */
type AIClient = ApiClient | AIProviderPlugin;

/**
 * 从响应中提取文本（兼容两种客户端）
 */
function extractResponseText(response: unknown, client: AIClient): string {
  // 如果有 extractText 方法（旧的 ApiClient），使用它
  if ('extractText' in client && typeof client.extractText === 'function') {
    return client.extractText(response as Parameters<typeof client.extractText>[0]);
  }
  // 否则，从响应中手动提取（AIProviderPlugin）
  const msg = response as { content?: Array<{ type: string; text?: string }> };
  if (msg.content) {
    return msg.content
      .filter((block): block is { type: 'text'; text: string } => block.type === 'text')
      .map(block => block.text || '')
      .join('');
  }
  return '';
}
import { createLogger } from '../logger.js';

const logger = createLogger('MemoryManager');
const CJK_CHAR_REGEX = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;

function countCjkChars(text: string): number {
  let count = 0;
  for (const char of text) {
    if (CJK_CHAR_REGEX.test(char)) {
      count += 1;
    }
  }
  return count;
}

function extractTextContent(content: MessageContent): string {
  if (typeof content === 'string') return content;
  return content
    .filter((block): block is TextBlock => block.type === 'text')
    .map(block => block.text)
    .join('');
}

// ==================== 类型定义 ====================

/**
 * 记忆配置
 */
export interface MemoryConfig {
  /** 上下文 token 限制（发送给 AI 的最大 token 数，默认 100000） */
  contextTokenLimit: number;
  /** 触发自动压缩的 token 阈值（默认 150000，略高于 70% 提示） */
  compactThreshold: number;
  /** 长期记忆存储目录（默认 data/memory） */
  memoryDir: string;
  /** 压缩后保留的 token 数（默认 30000） */
  compactKeepTokens: number;
}

/**
 * 记忆条目（长期记忆）
 */
export interface MemoryEntry {
  /** 记忆键 */
  key: string;
  /** 记忆值 */
  value: string;
  /** 创建时间 */
  createdAt: string;
  /** 更新时间 */
  updatedAt: string;
}

/**
 * 上下文压缩结果
 */
export interface CompactResult {
  /** 原始消息数 */
  originalCount: number;
  /** 压缩后消息数 */
  compactedCount: number;
  /** 摘要内容 */
  summary: string;
  /** 估算节省的 token 数 */
  savedTokens: number;
}

export interface DailyLogAppendResult {
  date: string;
  time: string;
  filePath: string;
}

// ==================== 记忆管理器实现 ====================

/**
 * 记忆管理器
 * 
 * @example
 * ```typescript
 * const memory = new MemoryManager({
 *   shortTermLimit: 50,
 *   compactThreshold: 80000,
 *   memoryDir: 'data/memory',
 *   compactKeepRecent: 10,
 * });
 * 
 * // 添加消息
 * memory.addMessage('group1', { role: 'user', content: '你好' });
 * 
 * // 获取上下文
 * const context = memory.getContext('group1');
 * 
 * // 记住重要信息（全局共享）
 * memory.remember('user_name', '张三');
 *
 * // 回忆信息
 * const name = memory.recall('user_name');
 * ```
 */
export class MemoryManager {
  private config: MemoryConfig;
  
  /** 短期记忆存储：groupId -> 消息列表 */
  private shortTermMemory: Map<string, ChatMessage[]> = new Map();
  
  /** 全局长期记忆缓存（跨渠道共享） */
  private globalMemoryCache: Map<string, MemoryEntry> | null = null;
  
  /** 用户级别记忆缓存：userId -> 记忆条目映射 */
  private userMemoryCache: Map<string, Map<string, MemoryEntry>> = new Map();
  
  /** 压缩摘要缓存：groupId -> 摘要 */
  private summaryCache: Map<string, string> = new Map();

  /** 每日日志缓存 */
  private dailyLogsCache: {
    content: string;
    fileStats: Record<string, number>;
  } | null = null;

  /** 正在压缩的 groupId 集合（防止并发压缩） */
  private compactingGroups: Set<string> = new Set();
  
  /** 缓存上限 */
  private static readonly MAX_CACHE_ENTRIES = 200;
  
  constructor(config: Partial<MemoryConfig> = {}) {
    this.config = {
      contextTokenLimit: config.contextTokenLimit ?? 100000,  // 发送给 AI 的上下文限制 100k tokens
      compactThreshold: config.compactThreshold ?? 150000,    // 自动压缩阈值 150k tokens
      memoryDir: config.memoryDir ?? 'data/memory',
      compactKeepTokens: config.compactKeepTokens ?? 30000,   // 压缩后保留 30k tokens
    };
    
    // 确保记忆目录存在
    this.ensureMemoryDir();
  }
  
  // ==================== 短期记忆 ====================
  
  /**
   * 获取群组的对话上下文
   * 基于 token 限制返回消息（从最新到最旧）
   * 
   * @param groupId - 群组 ID
   * @param maxTokens - 最大 token 数（可选，默认使用配置值）
   * @returns 消息列表
   */
  getContext(groupId: string, maxTokens?: number): ChatMessage[] {
    const messages = this.shortTermMemory.get(groupId) || [];
    const tokenLimit = maxTokens ?? this.config.contextTokenLimit;
    
    if (messages.length === 0) {
      return [];
    }
    
    // 从最新的消息开始，累计 token 直到达到限制
    const result: ChatMessage[] = [];
    let totalTokens = 0;
    
    // 从后往前遍历（最新的消息优先）
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      const msgTokens = this.estimateMessageTokens(msg);
      
      if (totalTokens + msgTokens > tokenLimit) {
        // 如果一条消息就超过限制，至少保留最新一条
        if (result.length === 0) {
          result.unshift(msg);
        }
        break;
      }
      
      result.unshift(msg); // 添加到开头，保持顺序
      totalTokens += msgTokens;
    }
    
    return result;
  }
  
  /**
   * 估算单条消息的 token 数
   * 中文约 1 字符/token，英文约 4 字符/token
   */
  private estimateMessageTokens(message: ChatMessage): number {
    const content = typeof message.content === 'string' 
      ? message.content 
      : JSON.stringify(message.content);
    const cjkCount = countCjkChars(content);
    const nonCjkLength = Math.max(0, content.length - cjkCount);
    const nonCjkTokens = Math.ceil(nonCjkLength / 4);
    // 保守估计：中文 1 字符/token，英文 4 字符/token，加上角色和格式开销
    return Math.max(1, cjkCount + nonCjkTokens + 10);
  }
  
  /**
   * 添加消息到短期记忆
   * 
   * @param groupId - 群组 ID
   * @param message - 消息
   */
  addMessage(groupId: string, message: ChatMessage): void {
    if (!this.shortTermMemory.has(groupId)) {
      this.shortTermMemory.set(groupId, []);
    }
    
    const messages = this.shortTermMemory.get(groupId)!;
    const newMsg = { ...message };
    messages.push(newMsg);
    
    // 检查总 token 数，如果超过阈值的 2 倍，移除最旧的消息
    // 使用增量计算避免 O(n^2)：先算总量，逐条减去被移除的消息
    const maxStorageTokens = this.config.compactThreshold * 2;
    let totalTokens = this.estimateTokens(messages);
    while (totalTokens > maxStorageTokens && messages.length > 10) {
      const removed = messages.shift()!;
      totalTokens -= this.estimateMessageTokens(removed);
    }
    
    // 清理过大的缓存，防止无限增长
    this.evictCachesIfNeeded();
  }
  
  /**
   * 批量添加消息
   * 
   * @param groupId - 群组 ID
   * @param messages - 消息列表
   */
  addMessages(groupId: string, messages: ChatMessage[]): void {
    for (const message of messages) {
      this.addMessage(groupId, message);
    }
  }
  
  /**
   * 清除群组的短期记忆
   * 
   * @param groupId - 群组 ID
   */
  clearContext(groupId: string): void {
    this.shortTermMemory.delete(groupId);
    this.summaryCache.delete(groupId);
  }
  
  /**
   * 获取消息数量
   * 
   * @param groupId - 群组 ID
   * @returns 消息数量
   */
  getMessageCount(groupId: string): number {
    return this.shortTermMemory.get(groupId)?.length ?? 0;
  }
  
  /**
   * 清理过大的缓存，防止 Map 无限增长
   */
  private evictCachesIfNeeded(): void {
    const maxEntries = MemoryManager.MAX_CACHE_ENTRIES;
    
    // 清理短期记忆中不活跃的群组
    if (this.shortTermMemory.size > maxEntries) {
      const toRemove = this.shortTermMemory.size - maxEntries;
      const keys = this.shortTermMemory.keys();
      for (let i = 0; i < toRemove; i++) {
        const key = keys.next().value;
        if (key !== undefined) {
          this.shortTermMemory.delete(key);
          this.summaryCache.delete(key);
        }
      }
      logger.debug({ evicted: toRemove }, '清理不活跃的短期记忆');
    }
    
    // 清理用户记忆缓存
    if (this.userMemoryCache.size > maxEntries) {
      const toRemove = this.userMemoryCache.size - maxEntries;
      const keys = this.userMemoryCache.keys();
      for (let i = 0; i < toRemove; i++) {
        const key = keys.next().value;
        if (key !== undefined) this.userMemoryCache.delete(key);
      }
    }
  }
  
  // ==================== 长期记忆 ====================
  
  /**
   * 记住重要信息（全局长期记忆，跨渠道共享）
   *
   * @param key - 记忆键
   * @param value - 记忆值
   */
  remember(key: string, value: string): void {
    this.loadGlobalMemory();

    const cache = this.globalMemoryCache!;
    const now = new Date().toISOString();

    const existing = cache.get(key);
    const entry: MemoryEntry = {
      key,
      value,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };

    cache.set(key, entry);
    this.saveGlobalMemory();
  }

  /**
   * 回忆全局长期记忆
   *
   * @param key - 记忆键（可选，不提供则返回所有记忆）
   */
  recall(key?: string): string {
    this.loadGlobalMemory();

    const cache = this.globalMemoryCache!;

    if (key) {
      return cache.get(key)?.value ?? '';
    }

    if (cache.size === 0) {
      return '';
    }

    const lines: string[] = [];
    for (const [k, entry] of cache) {
      lines.push(`- ${k}: ${entry.value}`);
    }
    return lines.join('\n');
  }

  /**
   * 删除全局记忆
   */
  forget(key: string): void {
    this.loadGlobalMemory();

    const cache = this.globalMemoryCache!;
    if (cache.delete(key)) {
      this.saveGlobalMemory();
    }
  }

  /**
   * 获取全局记忆键列表
   */
  getMemoryKeys(): string[] {
    this.loadGlobalMemory();
    return Array.from(this.globalMemoryCache!.keys());
  }
  
  // ==================== 用户级别记忆 ====================
  
  /**
   * 记住用户级别信息（跨会话共享）
   * 
   * @param userId - 用户 ID
   * @param key - 记忆键
   * @param value - 记忆值
   */
  rememberUser(userId: string, key: string, value: string): void {
    if (!this.userMemoryCache.has(userId)) {
      this.loadUserMemory(userId);
    }
    
    const cache = this.userMemoryCache.get(userId)!;
    const now = new Date().toISOString();
    
    const existing = cache.get(key);
    const entry: MemoryEntry = {
      key,
      value,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    
    cache.set(key, entry);
    this.saveUserMemory(userId);
  }
  
  /**
   * 回忆用户级别信息
   * 
   * @param userId - 用户 ID
   * @param key - 记忆键（可选，不提供则返回所有记忆）
   * @returns 记忆值或格式化的所有记忆
   */
  recallUser(userId: string, key?: string): string {
    if (!this.userMemoryCache.has(userId)) {
      this.loadUserMemory(userId);
    }
    
    const cache = this.userMemoryCache.get(userId)!;
    
    if (key) {
      return cache.get(key)?.value ?? '';
    }
    
    if (cache.size === 0) {
      return '';
    }
    
    const lines: string[] = [];
    for (const [k, entry] of cache) {
      lines.push(`- ${k}: ${entry.value}`);
    }
    return lines.join('\n');
  }
  
  /**
   * 删除用户级别记忆
   */
  forgetUser(userId: string, key: string): void {
    if (!this.userMemoryCache.has(userId)) {
      this.loadUserMemory(userId);
    }
    
    const cache = this.userMemoryCache.get(userId)!;
    if (cache.delete(key)) {
      this.saveUserMemory(userId);
    }
  }
  
  /**
   * 获取用户文件路径
   */
  private getUserMemoryFilePath(userId: string): string {
    const safeId = userId.replace(/[^a-zA-Z0-9_-]/g, '_');
    return path.join(this.config.memoryDir, 'users', `${safeId}.md`);
  }
  
  /**
   * 加载用户级别记忆
   */
  private loadUserMemory(userId: string): void {
    const cache = new Map<string, MemoryEntry>();
    this.userMemoryCache.set(userId, cache);
    
    const filePath = this.getUserMemoryFilePath(userId);
    if (!fs.existsSync(filePath)) {
      return;
    }
    
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const entries = this.parseMemoryFile(content);
      for (const entry of entries) {
        cache.set(entry.key, entry);
      }
    } catch (error) {
      logger.error({ path: filePath, error }, '加载用户记忆文件失败');
    }
  }
  
  /**
   * 保存用户级别记忆（原子写入）
   */
  private saveUserMemory(userId: string): void {
    const cache = this.userMemoryCache.get(userId);
    if (!cache) return;

    const filePath = this.getUserMemoryFilePath(userId);
    const content = this.formatMemoryFile(`用户 ${userId}`, cache);

    try {
      this.atomicWriteFile(filePath, content);
    } catch (error) {
      logger.error({ path: filePath, error }, '保存用户记忆文件失败');
    }
  }
  
  /**
   * 构建包含用户记忆的系统提示词
   */
  buildUserSystemPrompt(userId: string, basePrompt?: string): string {
    const parts: string[] = [];
    
    if (basePrompt) {
      parts.push(basePrompt);
    }
    
    // 添加用户级别记忆
    const userMemories = this.recallUser(userId);
    if (userMemories) {
      parts.push(`\n## 关于这个用户的记忆（跨会话共享）\n${userMemories}`);
    }
    
    return parts.join('\n\n');
  }
  
  // ==================== 上下文压缩 ====================
  
  /**
   * 估算消息的 token 数量（简单估算）
   * 中文约 2 字符/token，英文约 4 字符/token
   * 
   * @param messages - 消息列表
   * @returns 估算的 token 数
   */
  estimateTokens(messages: ChatMessage[]): number {
    let totalTokens = 0;
    for (const msg of messages) {
      totalTokens += this.estimateMessageTokens(msg);
    }
    return totalTokens;
  }
  
  /**
   * 检查是否需要压缩
   * 
   * @param groupId - 群组 ID
   * @returns 是否需要压缩
   */
  needsCompaction(groupId: string): boolean {
    const messages = this.shortTermMemory.get(groupId) || [];
    const estimatedTokens = this.estimateTokens(messages);
    return estimatedTokens > this.config.compactThreshold;
  }
  
  /**
   * 压缩对话上下文
   * 将旧消息总结为摘要，只保留最近的消息（基于 token 限制）
   * 
   * @param groupId - 群组 ID
   * @param apiClient - API 客户端（用于生成摘要）
   * @returns 压缩结果
   */
  async compact(groupId: string, client: AIClient): Promise<CompactResult> {
    // 防止并发压缩同一群组
    if (this.compactingGroups.has(groupId)) {
      logger.debug({ groupId }, '📦 压缩进行中，跳过重复请求');
      const messages = this.shortTermMemory.get(groupId) || [];
      return {
        originalCount: messages.length,
        compactedCount: messages.length,
        summary: '',
        savedTokens: 0,
      };
    }
    
    this.compactingGroups.add(groupId);
    
    try {
      return await this.compactInternal(groupId, client);
    } finally {
      this.compactingGroups.delete(groupId);
    }
  }
  
  /**
   * 内部压缩实现（由 compact 方法调用，受并发锁保护）
   */
  private async compactInternal(groupId: string, client: AIClient): Promise<CompactResult> {
    const messages = this.shortTermMemory.get(groupId) || [];
    const originalCount = messages.length;
    const originalTokens = this.estimateTokens(messages);
    
    if (originalTokens <= this.config.compactKeepTokens) {
      // token 数太少，无需压缩
      return {
        originalCount,
        compactedCount: originalCount,
        summary: '',
        savedTokens: 0,
      };
    }
    
    // 基于 token 数量决定保留多少消息
    // 从最新的消息开始，累计 token 直到达到 compactKeepTokens
    const toKeep: ChatMessage[] = [];
    let keepTokens = 0;
    
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      const msgTokens = this.estimateMessageTokens(msg);
      
      if (keepTokens + msgTokens > this.config.compactKeepTokens) {
        break;
      }
      
      toKeep.unshift(msg);
      keepTokens += msgTokens;
    }
    
    // 要压缩的消息（旧消息）
    const toCompress = messages.slice(0, messages.length - toKeep.length);
    
    if (toCompress.length === 0) {
      return {
        originalCount,
        compactedCount: originalCount,
        summary: '',
        savedTokens: 0,
      };
    }
    
    // ==================== 压缩前记忆 Flush ====================
    // 参考 OpenClaw memoryFlush：在压缩前让 AI 提取重要信息写入长期记忆
    // 避免压缩时丢失用户偏好、重要决定等关键事实
    try {
      await this.flushMemoryBeforeCompact(groupId, toCompress, client);
    } catch (error) {
      // Flush 失败不阻塞压缩流程
      logger.warn({ error, groupId }, '📦 压缩前记忆 Flush 失败，继续压缩');
    }
    
    // 生成摘要
    let summary = '';
    try {
      summary = await this.generateSummary(toCompress, client);
    } catch (error) {
      logger.error({ error, groupId }, '生成摘要失败，跳过压缩');
      return {
        originalCount,
        compactedCount: originalCount,
        summary: '',
        savedTokens: 0,
      };
    }
    
    // 估算节省的 token
    const compressedTokens = this.estimateTokens(toCompress);
    const summaryTokens = Math.ceil(summary.length / 2);
    const savedTokens = Math.max(0, compressedTokens - summaryTokens);
    
    // 更新短期记忆
    this.shortTermMemory.set(groupId, toKeep);
    
    // 缓存摘要
    this.summaryCache.set(groupId, summary);
    
    logger.info({
      groupId,
      originalTokens,
      compressedTokens,
      keepTokens,
      savedTokens,
      originalCount,
      compactedCount: toKeep.length
    }, '📦 上下文已压缩');
    
    return {
      originalCount,
      compactedCount: toKeep.length,
      summary,
      savedTokens,
    };
  }
  
  /**
   * 压缩前记忆 Flush
   * 参考 OpenClaw memoryFlush：让 AI 从即将被压缩的消息中提取重要信息写入长期记忆
   * 
   * @param groupId - 群组 ID
   * @param toCompress - 即将被压缩的消息
   * @param client - AI 客户端
   */
  private async flushMemoryBeforeCompact(
    groupId: string,
    toCompress: ChatMessage[],
    client: AIClient
  ): Promise<void> {
    // 格式化即将被压缩的消息
    const conversationText = toCompress
      .map(msg => `${msg.role === 'user' ? '用户' : '助手'}: ${extractTextContent(msg.content)}`)
      .join('\n\n');

    // 获取当前已有的长期记忆（避免重复提取）
    const existingMemories = this.recall();

    const response = await client.chat(
      [
        {
          role: 'user',
          content: `以下对话即将被压缩。请从中提取需要长期记住的关键事实，每行一条，格式为 "key: value"。

只提取以下类型信息：
- 用户偏好（喜好、习惯）
- 重要决定或约定
- 关键事实（姓名、身份、联系方式等）
- 用户明确要求记住的内容

${existingMemories ? `已有记忆（不要重复）：\n${existingMemories}\n\n` : ''}对话内容：
${conversationText}

如果没有值得记住的新信息，只回复 "NONE"。
否则每行输出一条：key: value`,
        },
      ],
      {
        system: '你是记忆提取助手。从对话中识别重要的持久化信息，输出简洁的 key-value 对。',
        maxTokens: 512,
        temperature: 0.2,
      }
    );

    const result = extractResponseText(response, client).trim();

    // 如果 AI 返回 NONE 或空内容，跳过
    if (!result || result.toUpperCase() === 'NONE') {
      logger.debug({ groupId }, '📦 Flush: 无需保存的新记忆');
      return;
    }

    // 解析 key: value 格式并写入长期记忆
    let savedCount = 0;
    for (const line of result.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.toUpperCase() === 'NONE') continue;

      // 匹配 "key: value" 或 "key：value"（中英文冒号）
      const match = trimmed.match(/^([^:：]+)[：:]\s*(.+)$/);
      if (match) {
        const key = match[1].trim().replace(/^[-*•]\s*/, ''); // 去除列表符号
        const value = match[2].trim();
        if (key && value) {
          this.remember(key, value);
          savedCount++;
        }
      }
    }

    if (savedCount > 0) {
      logger.info({ groupId, savedCount }, '📦 Flush: 压缩前已保存记忆');
    }
  }

  /**
   * 生成对话摘要
   *
   * @param messages - 要压缩的消息
   * @param client - API 客户端（兼容 ApiClient 和 AIProviderPlugin）
   * @returns 摘要文本
   */
  private async generateSummary(
    messages: ChatMessage[],
    client: AIClient
  ): Promise<string> {
    // 格式化消息为文本
    const conversationText = messages
      .map(msg => `${msg.role === 'user' ? '用户' : '助手'}: ${extractTextContent(msg.content)}`)
      .join('\n\n');

    // 使用 AI 生成摘要
    const response = await client.chat(
      [
        {
          role: 'user',
          content: `请将以下对话内容压缩成一个简洁的摘要，保留关键信息、用户偏好、重要决定和上下文。摘要应该帮助后续对话理解之前的背景。

对话内容：
${conversationText}

请用中文输出摘要，格式为：
## 对话摘要
[简洁的摘要内容]`,
        },
      ],
      {
        system: '你是一个专业的对话摘要助手。你的任务是将长对话压缩成简洁但信息丰富的摘要。',
        maxTokens: 1024,
        temperature: 0.3,
      }
    );

    return extractResponseText(response, client);
  }
  
  /**
   * 获取压缩摘要
   * 
   * @param groupId - 群组 ID
   * @returns 摘要文本，如果没有则返回空字符串
   */
  getSummary(groupId: string): string {
    return this.summaryCache.get(groupId) ?? '';
  }
  
  // ==================== 系统提示词构建 ====================
  
  /**
   * 构建包含长期记忆的系统提示词
   *
   * @param groupId - 群组 ID（用于读取该会话摘要）
   * @param userId - 用户 ID（用于注入用户级别记忆）
   * @param basePrompt - 基础系统提示词
   * @returns 完整的系统提示词
   */
  buildSystemPrompt(groupId: string, userId: string, basePrompt?: string): string {
    const parts: string[] = [];

    if (basePrompt) {
      parts.push(basePrompt);
    }

    const summary = this.getSummary(groupId);
    if (summary) {
      parts.push(`\n## 之前对话的摘要\n${summary}`);
    }

    const globalMemories = this.recall();
    if (globalMemories) {
      parts.push(`\n## 全局长期记忆（跨渠道共享）\n${globalMemories}`);
    }

    const userMemories = this.recallUser(userId);
    if (userMemories) {
      parts.push(`\n## 当前用户记忆\n${userMemories}`);
    }

    const dailyLogs = this.loadRecentDailyLogs();
    if (dailyLogs) {
      parts.push(`\n## 近期日志\n${dailyLogs}`);
    }

    return parts.join('\n\n');
  }
  
  /**
   * 追加每日日志
   */
  appendDailyLog(content: string): DailyLogAppendResult {
    const logsDir = path.join(this.config.memoryDir, 'daily');
    const now = new Date();
    const today = now.toISOString().split('T')[0];
    const time = now.toLocaleTimeString('zh-CN', { hour12: false });
    const logFile = path.join(logsDir, `${today}.md`);
    const entry = `- [${time}] ${content}\n`;

    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir, { recursive: true });
    }

    if (!fs.existsSync(logFile)) {
      this.atomicWriteFile(logFile, `# ${today} 日志\n\n${entry}`);
    } else {
      fs.appendFileSync(logFile, entry, 'utf-8');
    }

    // 日志有更新，清空缓存
    this.dailyLogsCache = null;

    return {
      date: today,
      time,
      filePath: logFile,
    };
  }

  /**
   * 加载近期每日日志（今天 + 昨天）
   * 参考 OpenClaw 的 memory/YYYY-MM-DD.md 设计
   *
   * @returns 日志内容，如果没有则返回空字符串
   */
  private loadRecentDailyLogs(): string {
    const dailyDir = path.join(this.config.memoryDir, 'daily');
    if (!fs.existsSync(dailyDir)) {
      this.dailyLogsCache = { content: '', fileStats: {} };
      return '';
    }

    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    const dates = [
      today.toISOString().split('T')[0],
      yesterday.toISOString().split('T')[0],
    ];

    const stats: Record<string, number> = {};
    const logs: string[] = [];

    for (const date of dates) {
      const logFile = path.join(dailyDir, `${date}.md`);
      if (!fs.existsSync(logFile)) continue;

      try {
        const st = fs.statSync(logFile);
        stats[logFile] = st.mtimeMs;
      } catch {
        stats[logFile] = -1;
      }
    }

    const cache = this.dailyLogsCache;
    if (cache) {
      const cachedKeys = Object.keys(cache.fileStats).sort();
      const currentKeys = Object.keys(stats).sort();
      const sameKeys = cachedKeys.length === currentKeys.length && cachedKeys.every((k, i) => k === currentKeys[i]);
      const sameMtime = sameKeys && currentKeys.every(k => cache.fileStats[k] === stats[k]);
      if (sameMtime) {
        return cache.content;
      }
    }

    for (const date of dates) {
      const logFile = path.join(dailyDir, `${date}.md`);
      if (!fs.existsSync(logFile)) continue;
      try {
        const content = fs.readFileSync(logFile, 'utf-8').trim();
        if (content) {
          logs.push(content);
        }
      } catch {
        // 读取失败，跳过
      }
    }

    const merged = logs.join('\n\n');
    this.dailyLogsCache = { content: merged, fileStats: stats };
    return merged;
  }

  // ==================== 持久化 ====================
  
  /**
   * 确保记忆目录存在
   */
  private ensureMemoryDir(): void {
    if (!fs.existsSync(this.config.memoryDir)) {
      fs.mkdirSync(this.config.memoryDir, { recursive: true });
    }
  }

  /**
   * 原子写文件：先写 tmp 再 rename
   */
  private atomicWriteFile(filePath: string, content: string): void {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const tmpPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
    fs.writeFileSync(tmpPath, content, 'utf-8');
    fs.renameSync(tmpPath, filePath);
  }
  
  /**
   * 获取全局记忆文件路径
   */
  private getGlobalMemoryFilePath(): string {
    return path.join(this.config.memoryDir, 'global.md');
  }

  /**
   * 加载全局长期记忆
   */
  private loadGlobalMemory(): void {
    if (this.globalMemoryCache) {
      return;
    }

    const cache = new Map<string, MemoryEntry>();
    this.globalMemoryCache = cache;

    const filePath = this.getGlobalMemoryFilePath();
    if (!fs.existsSync(filePath)) {
      return;
    }

    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const entries = this.parseMemoryFile(content);
      for (const entry of entries) {
        cache.set(entry.key, entry);
      }
    } catch (error) {
      logger.error({ path: filePath, error }, '加载全局记忆文件失败');
    }
  }

  /**
   * 保存全局长期记忆（原子写入）
   */
  private saveGlobalMemory(): void {
    if (!this.globalMemoryCache) return;

    const filePath = this.getGlobalMemoryFilePath();
    const content = this.formatMemoryFile('global', this.globalMemoryCache);

    try {
      this.atomicWriteFile(filePath, content);
    } catch (error) {
      logger.error({ path: filePath, error }, '保存全局记忆文件失败');
    }
  }
  
  /**
   * 解析记忆文件
   */
  private parseMemoryFile(content: string): MemoryEntry[] {
    const entries: MemoryEntry[] = [];

    // 解析 Markdown 格式的记忆条目
    // 格式：### key
    //       value
    //       <!-- created: ISO, updated: ISO -->

    const lines = content.split('\n');
    let currentKey: string | null = null;
    let currentValue: string[] = [];
    let currentCreated = '';
    let currentUpdated = '';

    for (const line of lines) {
      const keyMatch = line.match(/^### (.+)$/);
      if (keyMatch) {
        if (currentKey) {
          entries.push({
            key: currentKey,
            value: currentValue.join('\n').trim(),
            createdAt: currentCreated || new Date().toISOString(),
            updatedAt: currentUpdated || new Date().toISOString(),
          });
        }

        currentKey = keyMatch[1].trim();
        currentValue = [];
        currentCreated = '';
        currentUpdated = '';
        continue;
      }

      const metaMatch = line.match(/<!-- created: (.+), updated: (.+) -->/);
      if (metaMatch) {
        currentCreated = metaMatch[1];
        currentUpdated = metaMatch[2];
        continue;
      }

      if (currentKey) {
        currentValue.push(line);
      }
    }

    if (currentKey) {
      entries.push({
        key: currentKey,
        value: currentValue.join('\n').trim(),
        createdAt: currentCreated || new Date().toISOString(),
        updatedAt: currentUpdated || new Date().toISOString(),
      });
    }

    return entries;
  }
  
  /**
   * 格式化记忆文件
   */
  private formatMemoryFile(groupId: string, cache: Map<string, MemoryEntry>): string {
    const lines: string[] = [
      `# ${groupId} 的长期记忆`,
      '',
      `> 最后更新: ${new Date().toISOString()}`,
      '',
    ];
    
    for (const [key, entry] of cache) {
      lines.push(`### ${key}`);
      lines.push('');
      lines.push(entry.value);
      lines.push('');
      lines.push(`<!-- created: ${entry.createdAt}, updated: ${entry.updatedAt} -->`);
      lines.push('');
    }
    
    return lines.join('\n');
  }
  
  // ==================== 会话导出 ====================
  
  /**
   * 导出会话历史到 Markdown 文件
   * 类似 OpenClaw 的 session-memory hook
   * 
   * @param groupId - 群组 ID
   * @param filename - 文件名（可选，自动生成）
   * @returns 保存的文件路径
   */
  exportSession(groupId: string, filename?: string): string {
    const messages = this.shortTermMemory.get(groupId) || [];
    
    if (messages.length === 0) {
      throw new Error('没有可导出的会话消息');
    }
    
    // 生成文件名
    const date = new Date().toISOString().split('T')[0];
    const safeName = filename 
      ? filename.replace(/[^a-zA-Z0-9_-]/g, '_')
      : `session_${Date.now()}`;
    const exportFilename = `${date}-${safeName}.md`;
    const exportPath = path.join(this.config.memoryDir, 'sessions', exportFilename);
    
    // 确保目录存在
    const sessionsDir = path.dirname(exportPath);
    if (!fs.existsSync(sessionsDir)) {
      fs.mkdirSync(sessionsDir, { recursive: true });
    }
    
    // 格式化内容
    const lines: string[] = [
      `# 会话记录: ${groupId}`,
      '',
      `> 导出时间: ${new Date().toISOString()}`,
      `> 消息数量: ${messages.length}`,
      '',
      '---',
      '',
    ];
    
    for (const msg of messages) {
      const role = msg.role === 'user' ? '👤 用户' : '🤖 助手';
      lines.push(`## ${role}`);
      lines.push('');
      // content 可能是字符串或数组
      if (typeof msg.content === 'string') {
        lines.push(msg.content);
      } else if (Array.isArray(msg.content)) {
        // 提取文本内容
        const textContent = msg.content
          .filter((block): block is { type: 'text'; text: string } => block.type === 'text')
          .map(block => block.text)
          .join('\n');
        lines.push(textContent || '[包含图片/媒体内容]');
      }
      lines.push('');
    }
    
    fs.writeFileSync(exportPath, lines.join('\n'), 'utf-8');
    
    return exportPath;
  }
}

// ==================== 工厂函数 ====================

// 使用全局变量存储单例，确保 jiti 动态加载的模块也能访问同一个实例
declare global {
  // eslint-disable-next-line no-var
  var __flashclaw_memory_manager: MemoryManager | undefined;
}

/**
 * 获取全局记忆管理器实例
 * 确保所有模块（包括 jiti 加载的插件）使用同一个实例
 */
export function getMemoryManager(): MemoryManager {
  if (!global.__flashclaw_memory_manager) {
    global.__flashclaw_memory_manager = new MemoryManager({
      memoryDir: 'data/memory',
    });
  }
  return global.__flashclaw_memory_manager;
}

/**
 * 创建默认记忆管理器
 * 
 * @param baseDir - 基础目录（可选）
 * @returns 记忆管理器实例
 * @deprecated 使用 getMemoryManager() 获取全局单例
 */
export function createMemoryManager(baseDir?: string): MemoryManager {
  // 如果已有全局实例，返回它
  if (global.__flashclaw_memory_manager) {
    return global.__flashclaw_memory_manager;
  }
  // 否则创建新实例
  return new MemoryManager({
    memoryDir: baseDir ? path.join(baseDir, 'memory') : 'data/memory',
  });
}

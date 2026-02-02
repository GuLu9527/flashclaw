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
import type { ApiClient, ChatMessage } from './api-client.js';
import { createLogger } from '../logger.js';

const logger = createLogger('MemoryManager');

// ==================== 类型定义 ====================

/**
 * 记忆配置
 */
export interface MemoryConfig {
  /** 短期记忆条数限制（默认 50） */
  shortTermLimit: number;
  /** 触发压缩的 token 阈值（默认 80000） */
  compactThreshold: number;
  /** 长期记忆存储目录（默认 data/memory） */
  memoryDir: string;
  /** 压缩后保留的最近消息数（默认 10） */
  compactKeepRecent: number;
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
 * // 记住重要信息
 * memory.remember('group1', 'user_name', '张三');
 * 
 * // 回忆信息
 * const name = memory.recall('group1', 'user_name');
 * ```
 */
export class MemoryManager {
  private config: MemoryConfig;
  
  /** 短期记忆存储：groupId -> 消息列表 */
  private shortTermMemory: Map<string, ChatMessage[]> = new Map();
  
  /** 长期记忆缓存：groupId -> 记忆条目映射 */
  private longTermCache: Map<string, Map<string, MemoryEntry>> = new Map();
  
  /** 压缩摘要缓存：groupId -> 摘要 */
  private summaryCache: Map<string, string> = new Map();
  
  constructor(config: Partial<MemoryConfig> = {}) {
    this.config = {
      shortTermLimit: config.shortTermLimit ?? 50,
      compactThreshold: config.compactThreshold ?? 80000,
      memoryDir: config.memoryDir ?? 'data/memory',
      compactKeepRecent: config.compactKeepRecent ?? 10,
    };
    
    // 确保记忆目录存在
    this.ensureMemoryDir();
  }
  
  // ==================== 短期记忆 ====================
  
  /**
   * 获取群组的对话上下文
   * 
   * @param groupId - 群组 ID
   * @param limit - 限制返回的消息数量（可选）
   * @returns 消息列表
   */
  getContext(groupId: string, limit?: number): ChatMessage[] {
    const messages = this.shortTermMemory.get(groupId) || [];
    const effectiveLimit = limit ?? this.config.shortTermLimit;
    
    // 如果有压缩摘要，将其作为第一条系统消息的一部分
    // 但这里只返回原始消息，摘要在 buildSystemPrompt 中处理
    
    if (messages.length <= effectiveLimit) {
      return [...messages];
    }
    
    // 返回最近的 N 条消息
    return messages.slice(-effectiveLimit);
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
    messages.push({ ...message });
    
    // 超出限制时，移除最旧的消息（但保留摘要）
    while (messages.length > this.config.shortTermLimit * 2) {
      messages.shift();
    }
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
  
  // ==================== 长期记忆 ====================
  
  /**
   * 记住重要信息（持久化到文件）
   * 
   * @param groupId - 群组 ID
   * @param key - 记忆键
   * @param value - 记忆值
   */
  remember(groupId: string, key: string, value: string): void {
    // 确保缓存存在
    if (!this.longTermCache.has(groupId)) {
      this.loadLongTermMemory(groupId);
    }
    
    const cache = this.longTermCache.get(groupId)!;
    const now = new Date().toISOString();
    
    const existing = cache.get(key);
    const entry: MemoryEntry = {
      key,
      value,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    
    cache.set(key, entry);
    
    // 保存到文件
    this.saveLongTermMemory(groupId);
  }
  
  /**
   * 回忆信息
   * 
   * @param groupId - 群组 ID
   * @param key - 记忆键（可选，不提供则返回所有记忆）
   * @returns 记忆值或格式化的所有记忆
   */
  recall(groupId: string, key?: string): string {
    // 确保缓存存在
    if (!this.longTermCache.has(groupId)) {
      this.loadLongTermMemory(groupId);
    }
    
    const cache = this.longTermCache.get(groupId)!;
    
    if (key) {
      return cache.get(key)?.value ?? '';
    }
    
    // 返回所有记忆的格式化文本
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
   * 删除记忆
   * 
   * @param groupId - 群组 ID
   * @param key - 记忆键
   */
  forget(groupId: string, key: string): void {
    if (!this.longTermCache.has(groupId)) {
      this.loadLongTermMemory(groupId);
    }
    
    const cache = this.longTermCache.get(groupId)!;
    if (cache.delete(key)) {
      this.saveLongTermMemory(groupId);
    }
  }
  
  /**
   * 获取所有记忆键
   * 
   * @param groupId - 群组 ID
   * @returns 记忆键列表
   */
  getMemoryKeys(groupId: string): string[] {
    if (!this.longTermCache.has(groupId)) {
      this.loadLongTermMemory(groupId);
    }
    
    return Array.from(this.longTermCache.get(groupId)!.keys());
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
    let totalChars = 0;
    for (const msg of messages) {
      totalChars += msg.content.length;
    }
    // 使用保守估计：平均 2 字符/token
    return Math.ceil(totalChars / 2);
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
   * 将旧消息总结为摘要，只保留最近的消息
   * 
   * @param groupId - 群组 ID
   * @param apiClient - API 客户端（用于生成摘要）
   * @returns 压缩结果
   */
  async compact(groupId: string, apiClient: ApiClient): Promise<CompactResult> {
    const messages = this.shortTermMemory.get(groupId) || [];
    const originalCount = messages.length;
    
    if (originalCount <= this.config.compactKeepRecent) {
      // 消息太少，无需压缩
      return {
        originalCount,
        compactedCount: originalCount,
        summary: '',
        savedTokens: 0,
      };
    }
    
    // 分离要压缩的消息和要保留的最近消息
    const toCompress = messages.slice(0, -this.config.compactKeepRecent);
    const toKeep = messages.slice(-this.config.compactKeepRecent);
    
    // 生成摘要
    const summary = await this.generateSummary(toCompress, apiClient);
    
    // 估算节省的 token
    const originalTokens = this.estimateTokens(toCompress);
    const summaryTokens = Math.ceil(summary.length / 2);
    const savedTokens = Math.max(0, originalTokens - summaryTokens);
    
    // 更新短期记忆
    this.shortTermMemory.set(groupId, toKeep);
    
    // 缓存摘要
    this.summaryCache.set(groupId, summary);
    
    return {
      originalCount,
      compactedCount: toKeep.length,
      summary,
      savedTokens,
    };
  }
  
  /**
   * 生成对话摘要
   * 
   * @param messages - 要压缩的消息
   * @param apiClient - API 客户端
   * @returns 摘要文本
   */
  private async generateSummary(
    messages: ChatMessage[],
    apiClient: ApiClient
  ): Promise<string> {
    // 格式化消息为文本
    const conversationText = messages
      .map(msg => `${msg.role === 'user' ? '用户' : '助手'}: ${msg.content}`)
      .join('\n\n');
    
    // 使用 AI 生成摘要
    const response = await apiClient.chat(
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
    
    return apiClient.extractText(response);
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
   * @param groupId - 群组 ID
   * @param basePrompt - 基础系统提示词
   * @returns 完整的系统提示词
   */
  buildSystemPrompt(groupId: string, basePrompt?: string): string {
    const parts: string[] = [];
    
    // 基础提示词
    if (basePrompt) {
      parts.push(basePrompt);
    }
    
    // 添加压缩摘要（如果有）
    const summary = this.getSummary(groupId);
    if (summary) {
      parts.push(`\n## 之前对话的摘要\n${summary}`);
    }
    
    // 添加长期记忆
    const memories = this.recall(groupId);
    if (memories) {
      parts.push(`\n## 关于这个群组/用户的记忆\n${memories}`);
    }
    
    return parts.join('\n\n');
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
   * 获取群组的记忆文件路径
   */
  private getMemoryFilePath(groupId: string): string {
    // 清理 groupId 中的特殊字符
    const safeId = groupId.replace(/[^a-zA-Z0-9_-]/g, '_');
    return path.join(this.config.memoryDir, `${safeId}.md`);
  }
  
  /**
   * 加载长期记忆
   */
  private loadLongTermMemory(groupId: string): void {
    const cache = new Map<string, MemoryEntry>();
    this.longTermCache.set(groupId, cache);
    
    const filePath = this.getMemoryFilePath(groupId);
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
      // 解析失败，使用空缓存
      logger.error({ path: filePath, error }, '加载记忆文件失败');
    }
  }
  
  /**
   * 保存长期记忆
   */
  private saveLongTermMemory(groupId: string): void {
    const cache = this.longTermCache.get(groupId);
    if (!cache) return;
    
    const filePath = this.getMemoryFilePath(groupId);
    const content = this.formatMemoryFile(groupId, cache);
    
    try {
      fs.writeFileSync(filePath, content, 'utf-8');
    } catch (error) {
      logger.error({ path: filePath, error }, '保存记忆文件失败');
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
      // 检查是否是新的条目标题
      const keyMatch = line.match(/^### (.+)$/);
      if (keyMatch) {
        // 保存之前的条目
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
      
      // 检查是否是元数据注释
      const metaMatch = line.match(/<!-- created: (.+), updated: (.+) -->/);
      if (metaMatch) {
        currentCreated = metaMatch[1];
        currentUpdated = metaMatch[2];
        continue;
      }
      
      // 跳过文件头
      if (line.startsWith('# ') || line.startsWith('> ')) {
        continue;
      }
      
      // 添加到当前值
      if (currentKey) {
        currentValue.push(line);
      }
    }
    
    // 保存最后一个条目
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

/**
 * 创建默认记忆管理器
 * 
 * @param baseDir - 基础目录（可选）
 * @returns 记忆管理器实例
 */
export function createMemoryManager(baseDir?: string): MemoryManager {
  return new MemoryManager({
    memoryDir: baseDir ? path.join(baseDir, 'memory') : 'data/memory',
  });
}

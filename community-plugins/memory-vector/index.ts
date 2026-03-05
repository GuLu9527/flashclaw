/**
 * FlashClaw 插件 - 语义记忆搜索
 * 基于 Ollama embedding 的模糊召回，支持语义相似度匹配
 * 
 * 工作原理：
 * 1. 读取所有长期记忆文件（KV 记忆 + 每日日志）
 * 2. 调用 Ollama embedding API 生成向量
 * 3. 计算余弦相似度，返回最相关的记忆片段
 */

import type { ToolPlugin, ToolContext, ToolResult } from '../../src/plugins/types';
import * as fs from 'node:fs';
import * as path from 'node:path';

// ==================== 配置 ====================

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || process.env.OPENAI_BASE_URL?.replace('/v1', '') || 'http://localhost:11434';
const EMBED_MODEL = process.env.MEMORY_EMBED_MODEL || 'nomic-embed-text';
const MAX_RESULTS = 5;
const MIN_SCORE = 0.3;

// ==================== Embedding 缓存 ====================

interface EmbeddingEntry {
  text: string;
  source: string; // 来源文件
  vector: number[];
}

// 内存缓存（避免重复调用 embedding API）
const embeddingCache = new Map<string, number[]>();

// ==================== 工具函数 ====================

/**
 * 调用 Ollama embedding API
 */
async function getEmbedding(text: string): Promise<number[]> {
  // 检查缓存
  const cached = embeddingCache.get(text);
  if (cached) return cached;

  const response = await fetch(`${OLLAMA_BASE_URL}/api/embed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: EMBED_MODEL, input: text }),
  });

  if (!response.ok) {
    throw new Error(`Ollama embedding failed: ${response.status} ${response.statusText}`);
  }

  const data = await response.json() as { embeddings?: number[][] };
  const vector = data.embeddings?.[0];
  if (!vector || vector.length === 0) {
    throw new Error('Empty embedding response from Ollama');
  }

  // 缓存
  embeddingCache.set(text, vector);

  // 限制缓存大小
  if (embeddingCache.size > 500) {
    const firstKey = embeddingCache.keys().next().value;
    if (firstKey !== undefined) embeddingCache.delete(firstKey);
  }

  return vector;
}

/**
 * 余弦相似度
 */
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dotProduct / denom;
}

/**
 * 从记忆目录加载所有片段
 */
function loadMemorySnippets(memoryDir: string): Array<{ text: string; source: string }> {
  const snippets: Array<{ text: string; source: string }> = [];

  if (!fs.existsSync(memoryDir)) return snippets;

  // 加载 KV 记忆文件（*.md，排除 daily 子目录）
  const files = fs.readdirSync(memoryDir).filter(f => f.endsWith('.md'));
  for (const file of files) {
    const filePath = path.join(memoryDir, file);
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      // 按 ### 标题分块
      const blocks = content.split(/^### /m).filter(b => b.trim());
      for (const block of blocks) {
        const lines = block.split('\n');
        const key = lines[0]?.trim();
        const value = lines.slice(1).filter(l => !l.startsWith('<!--')).join('\n').trim();
        if (key && value) {
          snippets.push({ text: `${key}: ${value}`, source: file });
        }
      }
    } catch {
      // 跳过无法读取的文件
    }
  }

  // 加载用户记忆
  const usersDir = path.join(memoryDir, 'users');
  if (fs.existsSync(usersDir)) {
    const userFiles = fs.readdirSync(usersDir).filter(f => f.endsWith('.md'));
    for (const file of userFiles) {
      const filePath = path.join(usersDir, file);
      try {
        const content = fs.readFileSync(filePath, 'utf-8');
        const blocks = content.split(/^### /m).filter(b => b.trim());
        for (const block of blocks) {
          const lines = block.split('\n');
          const key = lines[0]?.trim();
          const value = lines.slice(1).filter(l => !l.startsWith('<!--')).join('\n').trim();
          if (key && value) {
            snippets.push({ text: `${key}: ${value}`, source: `users/${file}` });
          }
        }
      } catch {
        // 跳过
      }
    }
  }

  // 加载每日日志
  const dailyDir = path.join(memoryDir, 'daily');
  if (fs.existsSync(dailyDir)) {
    const logFiles = fs.readdirSync(dailyDir)
      .filter(f => f.endsWith('.md'))
      .sort()
      .slice(-7); // 只加载最近 7 天
    for (const file of logFiles) {
      const filePath = path.join(dailyDir, file);
      try {
        const content = fs.readFileSync(filePath, 'utf-8');
        // 按行分块（每条日志条目独立）
        const lines = content.split('\n').filter(l => l.startsWith('- ['));
        for (const line of lines) {
          snippets.push({ text: line.replace(/^- \[\d{2}:\d{2}:\d{2}\]\s*/, ''), source: `daily/${file}` });
        }
      } catch {
        // 跳过
      }
    }
  }

  return snippets;
}

// ==================== 插件定义 ====================

interface MemorySearchParams {
  query: string;
  maxResults?: number;
}

const plugin: ToolPlugin = {
  name: 'memory_search',
  version: '1.0.0',
  description: '语义记忆搜索 - 用自然语言搜索记忆和日志',

  schema: {
    name: 'memory_search',
    description: `语义搜索记忆。用自然语言查询，即使措辞不同也能找到相关记忆。
搜索范围包括：长期记忆（KV）、用户记忆、近 7 天每日日志。
当 recall(key) 精确匹配找不到时，使用此工具做模糊搜索。

需要本地 Ollama 运行并安装 embedding 模型（默认 nomic-embed-text）。`,
    input_schema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: '搜索查询（自然语言，如"用户喜欢什么水果"）'
        },
        maxResults: {
          type: 'number',
          description: '最大返回结果数（默认 5）'
        }
      },
      required: ['query']
    }
  },

  async execute(params: unknown, context: ToolContext): Promise<ToolResult> {
    const { query, maxResults = MAX_RESULTS } = params as MemorySearchParams;

    if (!query || typeof query !== 'string') {
      return { success: false, error: '需要提供搜索查询 query' };
    }

    try {
      // 获取记忆目录（默认 data/memory，可通过 MEMORY_DIR 覆盖）
      const memoryDir = process.env.MEMORY_DIR || 'data/memory';

      // 加载所有记忆片段
      const snippets = loadMemorySnippets(memoryDir);
      if (snippets.length === 0) {
        return {
          success: true,
          data: { results: [], message: '没有找到任何记忆数据' }
        };
      }

      // 获取查询向量
      let queryVector: number[];
      try {
        queryVector = await getEmbedding(query);
      } catch (error) {
        return {
          success: false,
          error: `Embedding 服务不可用（需要 Ollama 运行 ${EMBED_MODEL}）: ${error instanceof Error ? error.message : String(error)}`
        };
      }

      // 批量获取片段向量并计算相似度
      const scored: Array<{ text: string; source: string; score: number }> = [];

      for (const snippet of snippets) {
        try {
          const vector = await getEmbedding(snippet.text);
          const score = cosineSimilarity(queryVector, vector);
          if (score >= MIN_SCORE) {
            scored.push({ text: snippet.text, source: snippet.source, score });
          }
        } catch {
          // 单个片段 embedding 失败，跳过
        }
      }

      // 按相似度排序，取 top N
      scored.sort((a, b) => b.score - a.score);
      const results = scored.slice(0, maxResults);

      if (results.length === 0) {
        return {
          success: true,
          data: {
            query,
            results: [],
            message: `没有找到与 "${query}" 相关的记忆`
          }
        };
      }

      return {
        success: true,
        data: {
          query,
          results: results.map(r => ({
            content: r.text,
            source: r.source,
            relevance: Math.round(r.score * 100) + '%'
          })),
          message: `找到 ${results.length} 条相关记忆`
        }
      };
    } catch (error) {
      return {
        success: false,
        error: `语义搜索失败: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }
};

export default plugin;

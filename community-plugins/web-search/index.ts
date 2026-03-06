/**
 * FlashClaw 插件 - Web 搜索
 * 搜索互联网获取信息，支持 DuckDuckGo 和自定义搜索引擎
 * 自动检测 HTTP_PROXY/HTTPS_PROXY 环境变量，通过 curl 代理访问
 */

import { ToolPlugin, ToolContext, ToolResult, PluginConfig } from '../../src/plugins/types.js';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

interface SearchParams {
  /** 搜索关键词 */
  query: string;
  /** 返回结果数量（默认 5，最大 10） */
  maxResults?: number;
}

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

let searchEngineUrl = 'https://html.duckduckgo.com/html/';
let defaultMaxResults = 5;

/**
 * 获取代理 URL
 */
function getProxyUrl(): string | null {
  return process.env.HTTPS_PROXY ||
         process.env.HTTP_PROXY ||
         process.env.https_proxy ||
         process.env.http_proxy ||
         null;
}

/**
 * 带代理支持的 HTTP 请求
 * 有代理时直接用 curl；无代理时先尝试 fetch，失败后回退到 curl
 */
async function fetchWithProxy(url: string, options?: { method?: string; body?: string; headers?: Record<string, string> }): Promise<string> {
  const proxyUrl = getProxyUrl();

  // 有代理时直接用 curl（Node fetch 不原生支持代理）
  if (proxyUrl) {
    return curlFetch(url, options, proxyUrl);
  }

  // 无代理：先尝试 fetch，失败后回退到 curl
  try {
    const response = await fetch(url, {
      method: options?.method || 'GET',
      headers: options?.headers,
      body: options?.body,
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return response.text();
  } catch {
    // fetch 失败（网络问题），回退到 curl
    return curlFetch(url, options);
  }
}

/**
 * 通过 curl 命令执行 HTTP 请求
 */
async function curlFetch(url: string, options?: { method?: string; body?: string; headers?: Record<string, string> }, proxyUrl?: string): Promise<string> {
  const args = ['-fsSL', '--max-time', '15'];

  if (proxyUrl) {
    args.push('-x', proxyUrl);
  }

  if (options?.headers) {
    for (const [key, value] of Object.entries(options.headers)) {
      args.push('-H', `${key}: ${value}`);
    }
  }

  if (options?.method === 'POST' && options?.body) {
    args.push('-X', 'POST', '-d', options.body);
  }

  args.push(url);

  const { stdout } = await execFileAsync('curl', args, { timeout: 20000, maxBuffer: 1024 * 1024 });
  return stdout;
}

/**
 * 从 DuckDuckGo HTML 页面解析搜索结果
 */
function parseDuckDuckGoHTML(html: string, maxResults: number): SearchResult[] {
  const results: SearchResult[] = [];

  // DuckDuckGo HTML 格式: <a class="result__a" href="...">title</a>
  // <a class="result__snippet" href="...">snippet</a>
  const resultBlocks = html.split(/class="result\s/);

  for (let i = 1; i < resultBlocks.length && results.length < maxResults; i++) {
    const block = resultBlocks[i];

    // 提取标题和 URL
    const titleMatch = block.match(/class="result__a"[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/s);
    if (!titleMatch) continue;

    let url = titleMatch[1];
    const title = titleMatch[2].replace(/<[^>]*>/g, '').trim();

    // DuckDuckGo 使用重定向 URL，提取真实 URL
    const uddgMatch = url.match(/uddg=([^&]*)/);
    if (uddgMatch) {
      url = decodeURIComponent(uddgMatch[1]);
    }

    // 提取摘要
    const snippetMatch = block.match(/class="result__snippet"[^>]*>(.*?)<\/a>/s);
    const snippet = snippetMatch
      ? snippetMatch[1].replace(/<[^>]*>/g, '').trim()
      : '';

    if (title && url) {
      results.push({ title, url, snippet });
    }
  }

  return results;
}

const plugin: ToolPlugin = {
  name: 'web_search',
  version: '1.0.0',
  description: '搜索互联网获取信息',

  async init(config: PluginConfig): Promise<void> {
    if (config.searchEngineUrl) {
      searchEngineUrl = config.searchEngineUrl as string;
    }
    if (config.maxResults) {
      defaultMaxResults = Math.min(Number(config.maxResults), 10);
    }
  },

  schema: {
    name: 'web_search',
    description: `搜索互联网获取信息。适用场景：
- 查询最新新闻、天气、股价等实时信息
- 搜索技术文档、教程、API 文档
- 查找产品、服务、公司信息
- 验证事实、查找数据

示例：web_search({ query: "北京天气" })`,
    input_schema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: '搜索关键词，如 "北京天气" 或 "Node.js stream API"'
        },
        maxResults: {
          type: 'number',
          description: '返回结果数量（默认 5，最大 10）'
        }
      },
      required: ['query']
    }
  },

  async execute(params: unknown, context: ToolContext): Promise<ToolResult> {
    const { query, maxResults = defaultMaxResults } = params as SearchParams;

    if (!query || typeof query !== 'string' || query.trim().length === 0) {
      return { success: false, error: '搜索关键词不能为空' };
    }

    if (query.length > 500) {
      return { success: false, error: '搜索关键词过长，最大 500 字符' };
    }

    const limit = Math.min(Math.max(1, maxResults), 10);

    try {
      const url = `${searchEngineUrl}?q=${encodeURIComponent(query.trim())}`;

      const html = await fetchWithProxy(url, {
        method: 'POST',
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; FlashClaw/1.0)',
          'Accept': 'text/html',
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        },
        body: `q=${encodeURIComponent(query.trim())}`,
      });

      const results = parseDuckDuckGoHTML(html, limit);

      if (results.length === 0) {
        return {
          success: true,
          data: {
            query,
            results: [],
            message: '未找到相关结果'
          }
        };
      }

      // 格式化为易读文本
      const formatted = results.map((r, i) =>
        `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet}`
      ).join('\n\n');

      return {
        success: true,
        data: {
          query,
          resultCount: results.length,
          results,
          formatted
        }
      };
    } catch (error) {
      return {
        success: false,
        error: `搜索失败: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }
};

export default plugin;

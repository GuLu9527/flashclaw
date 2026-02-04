/**
 * FlashClaw 插件 - 网页内容获取
 * 安全获取网页并提取文本/HTML/Markdown
 */

import type { ToolPlugin, ToolContext, ToolResult } from '../../src/plugins/types.js';
import { fetch as undiciFetch, ProxyAgent, Agent } from 'undici';
import { lookup as dnsLookup } from 'dns/promises';
import { isIP } from 'net';
import * as cheerio from 'cheerio';
import { htmlToText } from 'html-to-text';
import TurndownService from 'turndown';

interface WebFetchParams {
  url: string;
  method?: string;
  headers?: Record<string, unknown>;
  query?: Record<string, unknown>;
  body?: string | Record<string, unknown>;
  timeoutMs?: number;
  maxBytes?: number;
  extract?: 'auto' | 'text' | 'html' | 'markdown';
  selector?: string;
  followRedirects?: boolean;
  maxRedirects?: number;
  userAgent?: string;
  allowPrivate?: boolean;
}

interface FetchResult {
  response: Response;
  finalUrl: string;
  release: () => Promise<void>;
}

const DEFAULT_TIMEOUT_MS = 10000;
const MAX_TIMEOUT_MS = 60000;
const DEFAULT_MAX_BYTES = 2_000_000;
const MAX_MAX_BYTES = 10_000_000;
const DEFAULT_MAX_REDIRECTS = 3;
const DEFAULT_UA = 'FlashClaw WebFetch/1.0';

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'metadata.google.internal'
]);

function getProxyUrl(): string | null {
  return process.env.HTTPS_PROXY ||
    process.env.HTTP_PROXY ||
    process.env.https_proxy ||
    process.env.http_proxy ||
    null;
}

function normalizeHostname(hostname: string): string {
  return hostname.trim().toLowerCase();
}

function isBlockedHostname(hostname: string): boolean {
  const normalized = normalizeHostname(hostname);
  if (BLOCKED_HOSTNAMES.has(normalized)) return true;
  return (
    normalized.endsWith('.localhost') ||
    normalized.endsWith('.local') ||
    normalized.endsWith('.internal')
  );
}

function isPrivateIpv4(ip: string): boolean {
  const parts = ip.split('.').map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => Number.isNaN(part))) return false;

  const [a, b] = parts;
  if (a === 0) return true; // 0.0.0.0/8
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 127) return true; // 127.0.0.0/8
  if (a === 169 && b === 254) return true; // 169.254.0.0/16
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10
  return false;
}

function isPrivateIpv6(ip: string): boolean {
  const normalized = ip.toLowerCase();
  if (normalized === '::' || normalized === '::1') return true;
  if (normalized.startsWith('fe80:')) return true; // link-local
  if (normalized.startsWith('fec0:')) return true; // site-local (deprecated)
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true; // unique local

  if (normalized.includes('::ffff:')) {
    const ipv4Part = normalized.split('::ffff:')[1];
    if (ipv4Part && isPrivateIpv4(ipv4Part)) return true;
  }

  return false;
}

function isPrivateIp(ip: string): boolean {
  const family = isIP(ip);
  if (family === 4) return isPrivateIpv4(ip);
  if (family === 6) return isPrivateIpv6(ip);
  return false;
}

async function resolvePublicAddresses(hostname: string, allowPrivate: boolean): Promise<string[]> {
  if (isBlockedHostname(hostname) && !allowPrivate) {
    throw new Error('目标地址禁止访问');
  }

  if (isIP(hostname) && isPrivateIp(hostname) && !allowPrivate) {
    throw new Error('目标地址禁止访问内网');
  }

  const results = await dnsLookup(hostname, { all: true });
  const addresses = Array.from(new Set(results.map((entry) => entry.address)));

  if (!allowPrivate) {
    for (const address of addresses) {
      if (isPrivateIp(address)) {
        throw new Error('目标地址解析到内网地址');
      }
    }
  }

  return addresses;
}

function createPinnedLookup(addresses: string[]) {
  let index = 0;
  return (hostname: string, options: unknown, callback: (err: NodeJS.ErrnoException | null, address: string, family: number) => void) => {
    const address = addresses[index++ % addresses.length];
    const family = isIP(address);
    if (typeof options === 'function') {
      return process.nextTick(() => (options as typeof callback)(null, address, family));
    }
    return process.nextTick(() => callback(null, address, family));
  };
}

async function createDispatcher(hostname: string, allowPrivate: boolean): Promise<{ dispatcher: Agent | ProxyAgent; close: () => Promise<void> }> {
  const proxyUrl = getProxyUrl();
  const addresses = await resolvePublicAddresses(hostname, allowPrivate);
  if (proxyUrl) {
    const proxyAgent = new ProxyAgent(proxyUrl);
    return {
      dispatcher: proxyAgent,
      close: async () => {
        await proxyAgent.close();
      }
    };
  }

  const agent = new Agent({
    connect: {
      lookup: createPinnedLookup(addresses)
    }
  });

  return {
    dispatcher: agent,
    close: async () => {
      await agent.close();
    }
  };
}

function buildAbortSignal(timeoutMs: number): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  return {
    signal: controller.signal,
    cleanup: () => clearTimeout(timeoutId)
  };
}

function isRedirect(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

async function fetchWithGuard(
  url: string,
  init: RequestInit,
  allowPrivate: boolean,
  followRedirects: boolean,
  maxRedirects: number,
  timeoutMs: number
): Promise<FetchResult> {
  const visited = new Set<string>();
  let currentUrl = url;
  let redirectCount = 0;
  let currentMethod = init.method ?? 'GET';
  let currentBody = init.body;

  while (true) {
    const urlObj = new URL(currentUrl);
    if (!['http:', 'https:'].includes(urlObj.protocol)) {
      throw new Error('只支持 HTTP/HTTPS 协议');
    }

    const { dispatcher, close } = await createDispatcher(urlObj.hostname, allowPrivate);
    const { signal, cleanup } = buildAbortSignal(timeoutMs);

    let response: Response;
    try {
      response = await undiciFetch(currentUrl, {
        ...init,
        method: currentMethod,
        body: currentBody,
        redirect: 'manual',
        dispatcher,
        signal
      });
    } finally {
      cleanup();
    }

    if (isRedirect(response.status) && followRedirects) {
      const location = response.headers.get('location');
      if (!location) {
        await close();
        throw new Error(`重定向缺少 Location 头 (${response.status})`);
      }

      redirectCount += 1;
      if (redirectCount > maxRedirects) {
        await close();
        throw new Error(`重定向次数超过限制 (${maxRedirects})`);
      }

      const nextUrl = new URL(location, urlObj).toString();
      if (visited.has(nextUrl)) {
        await close();
        throw new Error('检测到重定向循环');
      }

      visited.add(nextUrl);
      try {
        await response.body?.cancel();
      } catch {
        // ignore
      }

      // 303 或者 301/302 且非 GET/HEAD 时切换为 GET
      if (response.status === 303 || ((response.status === 301 || response.status === 302) && !['GET', 'HEAD'].includes(currentMethod))) {
        currentMethod = 'GET';
        currentBody = undefined;
      }

      await close();
      currentUrl = nextUrl;
      continue;
    }

    return {
      response,
      finalUrl: currentUrl,
      release: close
    };
  }
}

async function readResponseWithLimit(response: Response, maxBytes: number): Promise<Buffer> {
  const contentLength = response.headers.get('content-length');
  if (contentLength) {
    const length = Number(contentLength);
    if (Number.isFinite(length) && length > maxBytes) {
      throw new Error(`响应体超过限制 (${maxBytes} bytes)`);
    }
  }

  if (!response.body || typeof response.body.getReader !== 'function') {
    const fallback = Buffer.from(await response.arrayBuffer());
    if (fallback.length > maxBytes) {
      throw new Error(`响应体超过限制 (${maxBytes} bytes)`);
    }
    return fallback;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value?.length) {
        total += value.length;
        if (total > maxBytes) {
          try {
            await reader.cancel();
          } catch {
            // ignore
          }
          throw new Error(`响应体超过限制 (${maxBytes} bytes)`);
        }
        chunks.push(value);
      }
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // ignore
    }
  }

  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), total);
}

function detectCharset(contentType: string | null): string | null {
  if (!contentType) return null;
  const match = contentType.match(/charset=([^;]+)/i);
  return match ? match[1].trim().toLowerCase() : null;
}

function decodeBuffer(buffer: Buffer, contentType: string | null): string {
  const charset = detectCharset(contentType);
  try {
    const decoder = new TextDecoder(charset ?? 'utf-8');
    return decoder.decode(buffer);
  } catch {
    const decoder = new TextDecoder('utf-8');
    return decoder.decode(buffer);
  }
}

function isHtmlContent(contentType: string | null, text: string): boolean {
  if (contentType) {
    const lower = contentType.toLowerCase();
    if (lower.includes('text/html') || lower.includes('application/xhtml+xml')) {
      return true;
    }
  }
  return /<!doctype html|<html[\s>]/i.test(text);
}

function isTextLikeContent(contentType: string | null): boolean {
  if (!contentType) return true;
  const lower = contentType.toLowerCase();
  return (
    lower.startsWith('text/') ||
    lower.includes('json') ||
    lower.includes('xml') ||
    lower.includes('javascript') ||
    lower.includes('xhtml')
  );
}

function extractFromHtml(html: string, selector?: string, mode: 'text' | 'html' | 'markdown'): { content: string; title?: string } {
  const $ = cheerio.load(html);
  const title = $('title').first().text().trim() || undefined;
  const fragment = selector ? $(selector).map((_, el) => $.html(el)).get().join('\n') : html;

  if (mode === 'html') {
    return { content: fragment, title };
  }

  if (mode === 'markdown') {
    const turndown = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' });
    return { content: turndown.turndown(fragment), title };
  }

  return { content: htmlToText(fragment, { wordwrap: false }), title };
}

function normalizeHeaders(headers?: Record<string, unknown>): Record<string, string> | null {
  if (!headers) return {};
  const output: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      output[key] = String(value);
      continue;
    }
    return null;
  }
  return output;
}

function applyQuery(url: URL, query?: Record<string, unknown>): string {
  if (!query) return url.toString();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue;
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      url.searchParams.set(key, String(value));
    } else {
      throw new Error(`查询参数不合法: ${key}`);
    }
  }
  return url.toString();
}

const plugin: ToolPlugin = {
  name: 'web_fetch',
  version: '1.0.0',
  description: '获取网页内容并提取为文本/HTML/Markdown',
  schema: {
    name: 'web_fetch',
    description: '从指定 URL 获取网页内容，支持提取正文、限制大小、处理重定向，并具备基本 SSRF 防护。',
    input_schema: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: '要获取的网页 URL（仅支持 http/https）'
        },
        method: {
          type: 'string',
          description: 'HTTP 方法（默认 GET）',
          enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD']
        },
        headers: {
          type: 'object',
          description: '请求头（键值对）'
        },
        query: {
          type: 'object',
          description: '查询参数（键值对）'
        },
        body: {
          type: 'string',
          description: '请求体（非 GET/HEAD）'
        },
        timeoutMs: {
          type: 'number',
          description: '请求超时（毫秒，默认 10000，最大 60000）'
        },
        maxBytes: {
          type: 'number',
          description: '最大响应大小（默认 2MB，最大 10MB）'
        },
        extract: {
          type: 'string',
          description: '提取方式（auto/text/html/markdown）',
          enum: ['auto', 'text', 'html', 'markdown']
        },
        selector: {
          type: 'string',
          description: 'CSS 选择器，仅提取指定内容'
        },
        followRedirects: {
          type: 'boolean',
          description: '是否跟随重定向（默认 true）'
        },
        maxRedirects: {
          type: 'number',
          description: '最大重定向次数（默认 3）'
        },
        userAgent: {
          type: 'string',
          description: '自定义 User-Agent'
        },
        allowPrivate: {
          type: 'boolean',
          description: '允许访问内网地址（默认 false）'
        }
      },
      required: ['url']
    }
  },

  async execute(params: unknown, _context: ToolContext): Promise<ToolResult> {
    const input = params as WebFetchParams;

    if (!input || typeof input !== 'object') {
      return { success: false, error: '参数格式错误' };
    }

    if (!input.url || typeof input.url !== 'string') {
      return { success: false, error: 'url 不能为空' };
    }

    let urlObj: URL;
    try {
      urlObj = new URL(input.url);
    } catch {
      return { success: false, error: 'URL 格式不合法' };
    }

    if (!['http:', 'https:'].includes(urlObj.protocol)) {
      return { success: false, error: '只支持 HTTP/HTTPS 协议' };
    }

    const headers = normalizeHeaders(input.headers);
    if (!headers) {
      return { success: false, error: 'headers 格式不合法' };
    }

    const method = (input.method ?? 'GET').toUpperCase();
    const allowedMethods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'];
    if (!allowedMethods.includes(method)) {
      return { success: false, error: 'method 不合法' };
    }

    const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    if (!Number.isFinite(timeoutMs) || timeoutMs < 1000 || timeoutMs > MAX_TIMEOUT_MS) {
      return { success: false, error: `timeoutMs 需在 1000-${MAX_TIMEOUT_MS} 之间` };
    }

    const maxBytes = input.maxBytes ?? DEFAULT_MAX_BYTES;
    if (!Number.isFinite(maxBytes) || maxBytes <= 0 || maxBytes > MAX_MAX_BYTES) {
      return { success: false, error: `maxBytes 需在 1-${MAX_MAX_BYTES} 之间` };
    }

    const extract = input.extract ?? 'auto';
    if (!['auto', 'text', 'html', 'markdown'].includes(extract)) {
      return { success: false, error: 'extract 不合法' };
    }

    if (input.selector !== undefined && typeof input.selector !== 'string') {
      return { success: false, error: 'selector 需为字符串' };
    }

    const followRedirects = input.followRedirects ?? true;
    const maxRedirects = input.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
    if (!Number.isFinite(maxRedirects) || maxRedirects < 0 || maxRedirects > 10) {
      return { success: false, error: 'maxRedirects 不合法' };
    }

    const allowPrivate = input.allowPrivate ?? process.env.WEB_FETCH_ALLOW_PRIVATE === '1';

    try {
      const finalUrl = applyQuery(urlObj, input.query);

      let body: string | undefined;
      if (input.body !== undefined) {
        if (method === 'GET' || method === 'HEAD') {
          return { success: false, error: 'GET/HEAD 不支持 body' };
        }

        if (typeof input.body === 'string') {
          body = input.body;
        } else {
          body = JSON.stringify(input.body);
          if (!headers['content-type']) {
            headers['content-type'] = 'application/json';
          }
        }
      }

      headers['user-agent'] = input.userAgent || headers['user-agent'] || DEFAULT_UA;

      const fetchResult = await fetchWithGuard(
        finalUrl,
        { method, headers, body },
        allowPrivate,
        followRedirects,
        maxRedirects,
        timeoutMs
      );

      const { response, finalUrl: resolvedUrl, release } = fetchResult;

      let buffer: Buffer;
      try {
        buffer = await readResponseWithLimit(response, maxBytes);
      } finally {
        await release();
      }

      const contentType = response.headers.get('content-type');
      if (!isTextLikeContent(contentType) && !isHtmlContent(contentType, '')) {
        return { success: false, error: '响应类型非文本，无法解析' };
      }

      const text = decodeBuffer(buffer, contentType);
      const isHtml = isHtmlContent(contentType, text);

      let content = text;
      let title: string | undefined;

      if (isHtml) {
        const mode = extract === 'auto' ? 'text' : extract;
        const extracted = extractFromHtml(text, input.selector, mode === 'auto' ? 'text' : mode);
        content = extracted.content;
        title = extracted.title;
      } else if (extract === 'html') {
        content = text;
      }

      if (response.status >= 400) {
        return {
          success: false,
          error: `HTTP ${response.status}: ${response.statusText}`,
          data: {
            url: finalUrl,
            finalUrl: resolvedUrl,
            status: response.status,
            content
          }
        };
      }

      return {
        success: true,
        data: {
          url: finalUrl,
          finalUrl: resolvedUrl,
          status: response.status,
          contentType: contentType ?? 'unknown',
          bytes: buffer.length,
          extract,
          selector: input.selector,
          title,
          content
        }
      };
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        return { success: false, error: `请求超时（${timeoutMs}ms）` };
      }
      return { success: false, error: `获取失败: ${error instanceof Error ? error.message : String(error)}` };
    }
  }
};

export default plugin;

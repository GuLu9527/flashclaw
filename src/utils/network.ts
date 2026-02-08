/**
 * FlashClaw 网络工具函数
 * IP 检测、URL 提取、文本截断等
 */

import { isIP } from 'net';

// ==================== URL 提取 ====================

const WEB_FETCH_URL_RE = /https?:\/\/[^\s<>()]+/i;
const WEB_FETCH_DOMAIN_RE = /(?:^|[^A-Za-z0-9.-])((?:[A-Za-z0-9-]+\.)+[A-Za-z]{2,})(:\d{2,5})?(\/[^\s<>()]*)?/i;
const TRAILING_PUNCT_RE = /[)\],.。，;；!！?？]+$/;

/**
 * 从文本中提取第一个 URL
 * 支持完整 URL 和裸域名（自动添加 https://）
 */
export function extractFirstUrl(text: string): string | null {
  const match = text.match(WEB_FETCH_URL_RE);
  if (match) {
    return match[0].replace(TRAILING_PUNCT_RE, '');
  }

  const domainMatch = text.match(WEB_FETCH_DOMAIN_RE);
  if (!domainMatch) return null;
  const host = domainMatch[1];
  const port = domainMatch[2] ?? '';
  const urlPath = domainMatch[3] ?? '';
  const candidate = `https://${host}${port}${urlPath}`;
  return candidate.replace(TRAILING_PUNCT_RE, '');
}

// ==================== IP 安全检测 ====================

/**
 * 检测 IPv4 是否为私有地址
 */
export function isPrivateIpv4(ip: string): boolean {
  const parts = ip.split('.').map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => Number.isNaN(part))) return false;

  const [a, b] = parts;
  if (a === 0) return true;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  return false;
}

/**
 * 检测 IPv6 是否为私有地址
 */
export function isPrivateIpv6(ip: string): boolean {
  const normalized = ip.toLowerCase();
  if (normalized === '::' || normalized === '::1') return true;
  if (normalized.startsWith('fe80:')) return true;
  if (normalized.startsWith('fec0:')) return true;
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true;

  if (normalized.includes('::ffff:')) {
    const ipv4Part = normalized.split('::ffff:')[1];
    if (ipv4Part && isPrivateIpv4(ipv4Part)) return true;
  }

  return false;
}

/**
 * 检测 IP 是否为私有地址（自动判断 IPv4/IPv6）
 */
export function isPrivateIp(ip: string): boolean {
  const family = isIP(ip);
  if (family === 4) return isPrivateIpv4(ip);
  if (family === 6) return isPrivateIpv6(ip);
  return false;
}

/**
 * 检测主机名是否为被阻止的内部地址
 */
export function isBlockedHostname(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase();
  if (normalized === 'localhost') return true;
  return (
    normalized.endsWith('.localhost') ||
    normalized.endsWith('.local') ||
    normalized.endsWith('.internal')
  );
}

// ==================== 文本工具 ====================

/**
 * 估算 base64 编码内容的原始字节数
 */
export function estimateBase64Bytes(content: string): number | null {
  if (!content) return null;
  const raw = content.startsWith('data:') ? content.split(',')[1] ?? '' : content;
  const normalized = raw.replace(/\s+/g, '');
  if (!normalized) return 0;
  const padding = normalized.endsWith('==') ? 2 : normalized.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((normalized.length * 3) / 4) - padding);
}

/**
 * 截断文本到指定长度
 */
export function truncateText(text: string, maxLength: number): { text: string; truncated: boolean } {
  if (text.length <= maxLength) {
    return { text, truncated: false };
  }
  return { text: `${text.slice(0, maxLength)}\n\n...（内容已截断）`, truncated: true };
}

/**
 * XML 转义（用于消息构建）
 */
export function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Browser Control Plugin - Utility Functions
 *
 * 通用工具函数模块，提供超时规范化、错误处理、异步等待等基础功能。
 */

// ============================================================================
// Timeout
// ============================================================================

/**
 * 规范化超时时间
 *
 * @param timeout - 输入的超时时间（毫秒）
 * @param defaultMs - 默认超时时间，默认 8000ms
 * @returns 规范化后的超时时间（500-60000ms 范围内）
 */
export function normalizeTimeout(timeout?: number, defaultMs = 8000): number {
  if (typeof timeout !== "number" || !Number.isFinite(timeout)) {
    return defaultMs;
  }
  return Math.max(500, Math.min(60_000, Math.floor(timeout)));
}

// ============================================================================
// Error Handling
// ============================================================================

/**
 * 转换为用户友好的错误消息
 *
 * @param err - 原始错误对象
 * @param context - 可选的上下文信息（如元素引用）
 * @returns 包含友好消息的 Error 对象
 */
export function toFriendlyError(err: unknown, context?: string): Error {
  const message = err instanceof Error ? err.message : String(err);
  const ctx = context ? ` (${context})` : "";
  return new Error(`Operation failed${ctx}: ${message}`);
}

// ============================================================================
// Async Utilities
// ============================================================================

/**
 * 异步等待指定时间
 *
 * @param ms - 等待时间（毫秒）
 * @returns Promise，在指定时间后 resolve
 */
export function sleep(ms: number): Promise<void> {
  const duration = Math.max(0, Math.floor(ms ?? 0));
  return new Promise((resolve) => setTimeout(resolve, duration));
}

// ============================================================================
// Validation
// ============================================================================

/**
 * 验证 URL 格式是否有效
 *
 * @param url - 要验证的 URL 字符串
 * @returns 如果 URL 格式有效返回 true，否则返回 false
 */
export function isValidUrl(url: string): boolean {
  if (!url || typeof url !== "string") {
    return false;
  }

  try {
    const parsed = new URL(url);
    // 只允许 http/https 协议
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

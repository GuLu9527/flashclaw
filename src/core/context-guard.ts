/**
 * 上下文窗口保护
 * 
 * 在调用 API 之前检查 token 使用量，防止超出模型上下文窗口限制。
 * 支持环境变量覆盖默认阈值：
 *   - CONTEXT_MIN_TOKENS  剩余 token 低于此值时拒绝运行（默认 16000）
 *   - CONTEXT_WARN_TOKENS 剩余 token 低于此值时建议压缩（默认 32000）
 */

import { createLogger } from '../logger.js';

const logger = createLogger('ContextGuard');

// ==================== 配置常量 ====================

/** 最小剩余 token 阈值 — 低于此值直接拒绝请求 */
const CONTEXT_MIN_TOKENS = parseEnvInt('CONTEXT_MIN_TOKENS', 16000);
/** 警告剩余 token 阈值 — 低于此值建议压缩 */
const CONTEXT_WARN_TOKENS = parseEnvInt('CONTEXT_WARN_TOKENS', 32000);

// ==================== 类型定义 ====================

/**
 * 上下文安全检查参数
 */
export interface ContextSafetyParams {
  /** 已使用的 token 数（估算） */
  usedTokens: number;
  /** 模型上下文窗口最大 token 数 */
  maxTokens: number;
  /** 模型 ID（用于日志） */
  model: string;
}

/**
 * 上下文安全检查结果
 */
export interface ContextSafetyResult {
  /** 是否安全（剩余空间足够继续运行） */
  safe: boolean;
  /** 是否建议压缩上下文 */
  shouldCompact: boolean;
  /** 警告信息（空间紧张时） */
  warning?: string;
  /** 错误信息（空间不足时） */
  error?: string;
}

// ==================== 工具函数 ====================

/**
 * 从环境变量解析正整数，无效时返回默认值
 */
function parseEnvInt(envKey: string, defaultValue: number): number {
  const raw = process.env[envKey];
  if (!raw) return defaultValue;
  const parsed = parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    logger.warn({ envKey, raw }, '环境变量值无效，使用默认值');
    return defaultValue;
  }
  return parsed;
}

// ==================== 核心函数 ====================

/**
 * 检查上下文是否安全
 * 
 * 根据已使用 token 和模型上下文窗口大小，判断是否可以安全发起 API 调用。
 * 
 * 返回值含义：
 * - safe=false, error: 剩余空间低于 CONTEXT_MIN_TOKENS，拒绝运行
 * - safe=true, shouldCompact=true, warning: 剩余空间低于 CONTEXT_WARN_TOKENS，建议压缩
 * - safe=true, shouldCompact=false: 正常，空间充足
 * 
 * @example
 * ```typescript
 * const result = checkContextSafety({
 *   usedTokens: 180000,
 *   maxTokens: 200000,
 *   model: 'claude-4-sonnet',
 * });
 * if (!result.safe) {
 *   // 拒绝运行，提示用户执行 /compact
 * }
 * if (result.shouldCompact) {
 *   // 自动触发压缩后重试
 * }
 * ```
 */
export function checkContextSafety(params: ContextSafetyParams): ContextSafetyResult {
  const { usedTokens, maxTokens, model } = params;
  const remainingTokens = Math.max(0, maxTokens - usedTokens);

  logger.debug({
    model,
    usedTokens,
    maxTokens,
    remainingTokens,
    minThreshold: CONTEXT_MIN_TOKENS,
    warnThreshold: CONTEXT_WARN_TOKENS,
  }, '🛡️ 上下文窗口检查');

  // 剩余空间不足，拒绝运行
  if (remainingTokens < CONTEXT_MIN_TOKENS) {
    const error = `上下文窗口空间不足：模型 ${model} 剩余 ${remainingTokens} tokens（最低要求 ${CONTEXT_MIN_TOKENS}），已使用 ${usedTokens}/${maxTokens}。请执行 /compact 压缩上下文后重试。`;
    logger.error({ model, usedTokens, maxTokens, remainingTokens }, '🛡️ 上下文窗口空间不足，拒绝请求');
    return {
      safe: false,
      shouldCompact: true,
      error,
    };
  }

  // 剩余空间紧张，建议压缩
  if (remainingTokens < CONTEXT_WARN_TOKENS) {
    const warning = `上下文窗口即将耗尽：模型 ${model} 剩余 ${remainingTokens} tokens（警告阈值 ${CONTEXT_WARN_TOKENS}），已使用 ${usedTokens}/${maxTokens}，将自动压缩上下文。`;
    logger.warn({ model, usedTokens, maxTokens, remainingTokens }, '🛡️ 上下文窗口空间紧张');
    return {
      safe: true,
      shouldCompact: true,
      warning,
    };
  }

  // 空间充足
  return {
    safe: true,
    shouldCompact: false,
  };
}

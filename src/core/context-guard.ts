/**
 * 上下文窗口保护
 * 
 * 在调用 API 之前检查 token 使用量，防止超出模型上下文窗口限制。
 * 阈值按上下文窗口大小动态计算（比例制），也支持环境变量覆盖：
 *   - CONTEXT_MIN_TOKENS  剩余 token 低于此值时拒绝运行（默认：窗口的 12%）
 *   - CONTEXT_WARN_TOKENS 剩余 token 低于此值时建议压缩（默认：窗口的 25%）
 */

import { createLogger } from '../logger.js';

const logger = createLogger('ContextGuard');

// ==================== 配置常量 ====================

/** 拒绝阈值占上下文窗口的比例（剩余低于此比例时拒绝请求） */
const DEFAULT_MIN_RATIO = 0.12;
/** 警告阈值占上下文窗口的比例（剩余低于此比例时建议压缩） */
const DEFAULT_WARN_RATIO = 0.25;

/** 环境变量覆盖值（null 表示未设置，使用动态比例） */
const ENV_MIN_TOKENS = parseEnvIntOrNull('CONTEXT_MIN_TOKENS');
const ENV_WARN_TOKENS = parseEnvIntOrNull('CONTEXT_WARN_TOKENS');

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
 * 从环境变量解析正整数，未设置或无效时返回 null
 */
function parseEnvIntOrNull(envKey: string): number | null {
  const raw = process.env[envKey];
  if (!raw) return null;
  const parsed = parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    logger.warn({ envKey, raw }, '环境变量值无效，将使用动态比例');
    return null;
  }
  return parsed;
}

/**
 * 根据上下文窗口大小计算阈值（环境变量优先，否则按比例）
 */
function getMinThreshold(maxTokens: number): number {
  return ENV_MIN_TOKENS ?? Math.floor(maxTokens * DEFAULT_MIN_RATIO);
}

function getWarnThreshold(maxTokens: number): number {
  return ENV_WARN_TOKENS ?? Math.floor(maxTokens * DEFAULT_WARN_RATIO);
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
  const minThreshold = getMinThreshold(maxTokens);
  const warnThreshold = getWarnThreshold(maxTokens);

  logger.debug({
    model,
    usedTokens,
    maxTokens,
    remainingTokens,
    minThreshold,
    warnThreshold,
  }, '🛡️ 上下文窗口检查');

  // 剩余空间不足，拒绝运行
  if (remainingTokens < minThreshold) {
    const error = `上下文窗口空间不足：模型 ${model} 剩余 ${remainingTokens} tokens（最低要求 ${minThreshold}），已使用 ${usedTokens}/${maxTokens}。请执行 /compact 压缩上下文后重试。`;
    logger.error({ model, usedTokens, maxTokens, remainingTokens }, '🛡️ 上下文窗口空间不足，拒绝请求');
    return {
      safe: false,
      shouldCompact: true,
      error,
    };
  }

  // 剩余空间紧张，建议压缩
  if (remainingTokens < warnThreshold) {
    const warning = `上下文窗口即将耗尽：模型 ${model} 剩余 ${remainingTokens} tokens（警告阈值 ${warnThreshold}），已使用 ${usedTokens}/${maxTokens}，将自动压缩上下文。`;
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

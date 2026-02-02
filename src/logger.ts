/**
 * FlashClaw 统一日志模块
 * 使用 pino 提供结构化日志
 */

import pino from 'pino';

// 创建全局 logger 实例
export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: {
    target: 'pino-pretty',
    options: { colorize: true }
  }
});

// 导出子 logger 工厂函数
export function createLogger(name: string): pino.Logger {
  return logger.child({ module: name });
}

export default logger;

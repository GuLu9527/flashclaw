/**
 * FlashClaw Configuration
 * 
 * 注意：路径相关的配置已统一到 paths.ts 中管理
 * 请使用 paths.data(), paths.groups() 等函数获取路径
 */

import path from 'path';
import dotenv from 'dotenv';
import { paths } from './paths.js';

// Load environment variables from .env file
dotenv.config();

// ==================== Bot Configuration ====================
// Bot name for display in messages (customizable via .env)
export const BOT_NAME = process.env.BOT_NAME || 'FlashClaw';

// ==================== AI Provider ====================
/** 默认 AI Provider（可通过 AI_PROVIDER 环境变量配置） */
export const DEFAULT_AI_PROVIDER = process.env.AI_PROVIDER || 'anthropic-provider';

/** 默认 AI 模型（所有文件统一使用此常量，避免不一致） */
export const DEFAULT_AI_MODEL = process.env.AI_MODEL || process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514';

// ==================== Polling Intervals ====================
export const SCHEDULER_POLL_INTERVAL = 60000;
export const IPC_POLL_INTERVAL = 1000;

// ==================== Paths (统一使用 paths.ts) ====================
// Mount security: allowlist stored in config directory
export const MOUNT_ALLOWLIST_PATH = path.join(paths.config(), 'mount-allowlist.json');

// 主群组文件夹名称
export const MAIN_GROUP_FOLDER = 'main';

// 向后兼容：导出路径变量（建议直接使用 paths 模块）
/** @deprecated 请使用 paths.groups() */
export const GROUPS_DIR = paths.groups();
/** @deprecated 请使用 paths.data() */
export const DATA_DIR = paths.data();

// ==================== Agent Configuration ====================
export const AGENT_TIMEOUT = parseInt(process.env.AGENT_TIMEOUT || '300000', 10); // 5 minutes default
/** AI 单次响应最大输出 token 数 */
export const AI_MAX_OUTPUT_TOKENS = parseInt(process.env.AI_MAX_OUTPUT_TOKENS || '4096', 10);

// ==================== Scheduler Configuration ====================
export const MAX_CONCURRENT_TASKS = parseInt(process.env.MAX_CONCURRENT_TASKS || '3', 10);
export const DEFAULT_TASK_TIMEOUT_MS = parseInt(process.env.DEFAULT_TASK_TIMEOUT_MS || '300000', 10);
export const RETRY_BASE_DELAY_MS = parseInt(process.env.RETRY_BASE_DELAY_MS || '60000', 10);
export const MAX_RETRY_DELAY_MS = parseInt(process.env.MAX_RETRY_DELAY_MS || '3600000', 10);

// ==================== Message Queue Configuration ====================
export const MESSAGE_QUEUE_MAX_SIZE = parseInt(process.env.MESSAGE_QUEUE_MAX_SIZE || '100', 10);
export const MESSAGE_QUEUE_MAX_CONCURRENT = parseInt(process.env.MESSAGE_QUEUE_MAX_CONCURRENT || '3', 10);
export const MESSAGE_QUEUE_PROCESSING_TIMEOUT_MS = parseInt(process.env.MESSAGE_QUEUE_PROCESSING_TIMEOUT_MS || '300000', 10);
export const MESSAGE_QUEUE_MAX_RETRIES = parseInt(process.env.MESSAGE_QUEUE_MAX_RETRIES || '2', 10);

// ==================== Runtime Limits ====================
export const HISTORY_CONTEXT_LIMIT = parseInt(process.env.HISTORY_CONTEXT_LIMIT || '500', 10);
export const THINKING_THRESHOLD_MS = Number(process.env.THINKING_THRESHOLD_MS ?? 0);
export const MAX_DIRECT_FETCH_CHARS = parseInt(process.env.MAX_DIRECT_FETCH_CHARS || '4000', 10);
export const MAX_IPC_FILE_BYTES = parseInt(process.env.MAX_IPC_FILE_BYTES || String(1024 * 1024), 10);
export const MAX_IPC_MESSAGE_CHARS = parseInt(process.env.MAX_IPC_MESSAGE_CHARS || '10000', 10);
export const MAX_IPC_CHAT_ID_CHARS = parseInt(process.env.MAX_IPC_CHAT_ID_CHARS || '256', 10);
export const MAX_IMAGE_BYTES = parseInt(process.env.MAX_IMAGE_BYTES || String(10 * 1024 * 1024), 10);

// ==================== Timezone ====================
// Timezone for scheduled tasks (cron expressions, etc.)
// Uses system timezone by default
export const TIMEZONE = process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone;

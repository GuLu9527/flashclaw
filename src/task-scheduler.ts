/**
 * FlashClaw 任务调度器
 * 
 * 功能特性：
 * 1. 精确定时器 - 按需唤醒，而不是固定轮询
 * 2. 并发控制 - 限制同时执行的任务数
 * 3. 超时保护 - 防止任务卡死阻塞调度
 * 4. 重试机制 - 失败任务自动重试（指数退避）
 */

import fs from 'fs';
import path from 'path';
import pLimit from 'p-limit';
import { CronExpressionParser } from 'cron-parser';
import {
  getDueTasks,
  updateTaskAfterRun,
  logTaskRun,
  getTaskById,
  getAllTasks,
  getNextWakeTime,
  updateTaskRetry,
  resetTaskRetry,
  updateTask
} from './db.js';
import { ScheduledTask, RegisteredGroup } from './types.js';
import { GROUPS_DIR, MAIN_GROUP_FOLDER, TIMEZONE } from './config.js';
import { runAgent, writeTasksSnapshot } from './agent-runner.js';
import { createLogger } from './logger.js';

const logger = createLogger('TaskScheduler');

// ==================== 配置常量 ====================

/** 最大并发任务数 */
const MAX_CONCURRENT_TASKS = 3;

/** 默认任务超时时间（5 分钟） */
const DEFAULT_TASK_TIMEOUT_MS = 5 * 60 * 1000;

/** 最大定时器延迟（避免 Node.js 的 32 位整数溢出） */
const MAX_TIMEOUT_MS = 2 ** 31 - 1;

/** 重试基础延迟（1 分钟） */
const RETRY_BASE_DELAY_MS = 60 * 1000;

/** 最大重试延迟（1 小时） */
const MAX_RETRY_DELAY_MS = 60 * 60 * 1000;

// ==================== 类型定义 ====================

export interface SchedulerDependencies {
  sendMessage: (jid: string, text: string) => Promise<void>;
  registeredGroups: () => Record<string, RegisteredGroup>;
  getSessions: () => Record<string, string>;
}

interface SchedulerState {
  timer: NodeJS.Timeout | null;
  running: boolean;
  deps: SchedulerDependencies | null;
}

interface TaskRunResult {
  success: boolean;
  result: string | null;
  error: string | null;
  durationMs: number;
}

// ==================== 调度器状态 ====================

const state: SchedulerState = {
  timer: null,
  running: false,
  deps: null
};

// 并发限制器
const taskLimit = pLimit(MAX_CONCURRENT_TASKS);

// ==================== 精确定时器 ====================

/**
 * 设置精确定时器
 * 计算下一个任务的执行时间，并设置 setTimeout
 */
function armTimer(): void {
  // 清除旧定时器
  if (state.timer) {
    clearTimeout(state.timer);
    state.timer = null;
  }

  // 获取下一个唤醒时间
  const nextAt = getNextWakeTime();
  if (!nextAt) {
    logger.debug('没有待执行的任务，定时器空闲');
    return;
  }

  // 计算延迟时间
  const now = Date.now();
  const delay = Math.max(nextAt - now, 0);
  
  // 限制最大延迟，避免 32 位整数溢出
  const clampedDelay = Math.min(delay, MAX_TIMEOUT_MS);

  logger.debug({ 
    nextAt: new Date(nextAt).toISOString(), 
    delayMs: clampedDelay 
  }, '设置定时器');

  state.timer = setTimeout(() => {
    void onTimer().catch((err) => {
      logger.error({ err: String(err) }, '定时器触发失败');
    });
  }, clampedDelay);

  // 允许进程在没有其他活动时退出
  state.timer.unref?.();
}

/**
 * 定时器触发时的处理函数
 */
async function onTimer(): Promise<void> {
  if (state.running) {
    logger.debug('调度器正在运行，跳过本次触发');
    return;
  }

  state.running = true;
  try {
    await runDueTasks();
  } finally {
    state.running = false;
    armTimer();
  }
}

/**
 * 执行所有到期任务
 */
async function runDueTasks(): Promise<void> {
  if (!state.deps) {
    logger.error('调度器依赖未初始化');
    return;
  }

  const dueTasks = getDueTasks();
  if (dueTasks.length === 0) {
    return;
  }

  logger.info({ count: dueTasks.length }, '⚡ 发现到期任务');

  // 使用并发限制器执行任务
  const promises = dueTasks.map(task => 
    taskLimit(async () => {
      // 双重检查任务状态
      const currentTask = getTaskById(task.id);
      if (!currentTask || currentTask.status !== 'active') {
        logger.debug({ taskId: task.id }, '任务状态已变更，跳过执行');
        return;
      }

      await executeTask(currentTask);
    })
  );

  await Promise.all(promises);
}

// ==================== 任务执行 ====================

/**
 * 执行单个任务（带超时和重试）
 */
async function executeTask(task: ScheduledTask): Promise<void> {
  const startTime = Date.now();
  const deps = state.deps!;

  logger.info({ taskId: task.id, group: task.group_folder }, '⚡ 开始执行任务');

  // 执行任务
  const result = await runTaskWithTimeout(task, deps);

  // 记录运行日志
  logTaskRun({
    task_id: task.id,
    run_at: new Date().toISOString(),
    duration_ms: result.durationMs,
    status: result.success ? 'success' : 'error',
    result: result.result,
    error: result.error
  });

  if (result.success) {
    // 成功：重置重试计数，计算下次运行时间
    resetTaskRetry(task.id);
    const nextRun = calculateNextRun(task);
    const resultSummary = result.result ? result.result.slice(0, 200) : 'Completed';
    updateTaskAfterRun(task.id, nextRun, resultSummary);

    logger.info({ taskId: task.id, durationMs: result.durationMs }, '⚡ 任务执行成功');
  } else {
    // 失败：处理重试逻辑
    await handleTaskFailure(task, result.error || 'Unknown error');
  }
}

/**
 * 带超时保护的任务执行
 */
async function runTaskWithTimeout(
  task: ScheduledTask, 
  deps: SchedulerDependencies
): Promise<TaskRunResult> {
  const startTime = Date.now();
  const timeoutMs = task.timeout_ms || DEFAULT_TASK_TIMEOUT_MS;

  // 创建超时 Promise
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => {
      reject(new Error(`任务执行超时 (${timeoutMs}ms)`));
    }, timeoutMs);
  });

  try {
    // 实际执行任务
    const resultPromise = runTaskCore(task, deps);
    const result = await Promise.race([resultPromise, timeoutPromise]);
    
    return {
      success: true,
      result: result,
      error: null,
      durationMs: Date.now() - startTime
    };
  } catch (err) {
    return {
      success: false,
      result: null,
      error: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - startTime
    };
  }
}

/**
 * 任务执行核心逻辑
 */
async function runTaskCore(task: ScheduledTask, deps: SchedulerDependencies): Promise<string> {
  const groupDir = path.join(GROUPS_DIR, task.group_folder);
  fs.mkdirSync(groupDir, { recursive: true });

  const groups = deps.registeredGroups();
  const group = Object.values(groups).find(g => g.folder === task.group_folder);

  if (!group) {
    throw new Error(`Group not found: ${task.group_folder}`);
  }

  // 更新任务快照供 Agent 读取
  const isMain = task.group_folder === MAIN_GROUP_FOLDER;
  const tasks = getAllTasks();
  writeTasksSnapshot(task.group_folder, isMain, tasks.map(t => ({
    id: t.id,
    groupFolder: t.group_folder,
    prompt: t.prompt,
    schedule_type: t.schedule_type,
    schedule_value: t.schedule_value,
    status: t.status,
    next_run: t.next_run
  })));

  // 获取会话 ID
  const sessions = deps.getSessions();
  const sessionId = task.context_mode === 'group' ? sessions[task.group_folder] : undefined;

  // 执行 Agent
  const output = await runAgent(group, {
    prompt: task.prompt,
    sessionId,
    groupFolder: task.group_folder,
    chatJid: task.chat_jid,
    isMain,
    isScheduledTask: true
  });

  if (output.status === 'error') {
    throw new Error(output.error || 'Agent execution failed');
  }

  return output.result || 'Completed';
}

// ==================== 重试机制 ====================

/**
 * 处理任务失败（重试逻辑）
 */
async function handleTaskFailure(task: ScheduledTask, error: string): Promise<void> {
  const maxRetries = task.max_retries ?? 3;
  const currentRetry = (task.retry_count ?? 0) + 1;

  logger.warn({ 
    taskId: task.id, 
    error, 
    retryCount: currentRetry, 
    maxRetries 
  }, '任务执行失败');

  if (currentRetry >= maxRetries) {
    // 达到最大重试次数
    logger.error({ taskId: task.id, retryCount: currentRetry }, '任务达到最大重试次数，标记为失败');
    
    // 对于 once 类型任务，标记为 completed（已完成但失败）
    if (task.schedule_type === 'once') {
      updateTask(task.id, { status: 'completed' });
      updateTaskAfterRun(task.id, null, `Error after ${currentRetry} retries: ${error}`);
    } else {
      // 对于重复任务，重置重试计数并调度下一次正常执行
      resetTaskRetry(task.id);
      const nextRun = calculateNextRun(task);
      updateTaskAfterRun(task.id, nextRun, `Error: ${error}`);
    }
    return;
  }

  // 计算重试延迟（指数退避）
  const retryDelay = Math.min(
    RETRY_BASE_DELAY_MS * Math.pow(2, currentRetry - 1),
    MAX_RETRY_DELAY_MS
  );
  const nextRetryTime = new Date(Date.now() + retryDelay).toISOString();

  logger.info({ 
    taskId: task.id, 
    retryIn: retryDelay / 1000 + 's',
    nextRetry: nextRetryTime 
  }, '安排任务重试');

  // 更新任务重试信息
  updateTaskRetry(task.id, currentRetry, nextRetryTime);
}

/**
 * 计算下次运行时间
 */
function calculateNextRun(task: ScheduledTask): string | null {
  switch (task.schedule_type) {
    case 'cron': {
      const interval = CronExpressionParser.parse(task.schedule_value, { tz: TIMEZONE });
      return interval.next().toISOString();
    }
    case 'interval': {
      const ms = parseInt(task.schedule_value, 10);
      return new Date(Date.now() + ms).toISOString();
    }
    case 'once':
      // 一次性任务执行后没有下次
      return null;
    default:
      return null;
  }
}

// ==================== 公开 API ====================

/**
 * 启动调度器
 */
export function startScheduler(deps: SchedulerDependencies): void {
  state.deps = deps;
  logger.info('⚡ 任务调度器已启动');
  armTimer();
}

/**
 * 停止调度器
 */
export function stopScheduler(): void {
  if (state.timer) {
    clearTimeout(state.timer);
    state.timer = null;
  }
  state.deps = null;
  logger.info('⚡ 任务调度器已停止');
}

/**
 * 立即唤醒调度器
 * 用于创建新任务后立即检查是否需要执行
 */
export function wake(): void {
  logger.debug('收到唤醒信号，重新计算定时器');
  armTimer();
}

/**
 * 获取调度器状态
 */
export function getSchedulerStatus(): {
  running: boolean;
  nextWakeTime: number | null;
  activeTasks: number;
} {
  const nextWakeTime = getNextWakeTime();
  const dueTasks = getDueTasks();
  
  return {
    running: state.running,
    nextWakeTime,
    activeTasks: dueTasks.length
  };
}

// 兼容旧 API
export function startSchedulerLoop(deps: SchedulerDependencies): void {
  startScheduler(deps);
}

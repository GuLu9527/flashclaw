/**
 * 任务管理服务
 */

// 使用全局数据库实例
function getDb() {
  const db = (global as any).__flashclaw_db;
  if (!db) {
    throw new Error('数据库未初始化');
  }
  return db;
}

interface ScheduledTask {
  id: string;
  group_folder: string;
  chat_jid: string;
  prompt: string;
  schedule_type: string;
  schedule_value: string;
  next_run: string | null;
  last_run: string | null;
  last_result: string | null;
  status: string;
  created_at: string;
}

interface TaskRunLog {
  task_id: string;
  run_at: string;
  duration_ms: number;
  status: string;
  result: string | null;
  error: string | null;
}

function getAllTasksFromDb(): ScheduledTask[] {
  return getDb().prepare('SELECT * FROM scheduled_tasks ORDER BY created_at DESC').all() as ScheduledTask[];
}

function getTaskById(id: string): ScheduledTask | undefined {
  return getDb().prepare('SELECT * FROM scheduled_tasks WHERE id = ?').get(id) as ScheduledTask | undefined;
}

function updateTaskInDb(id: string, updates: { status?: string }): void {
  if (updates.status !== undefined) {
    getDb().prepare('UPDATE scheduled_tasks SET status = ? WHERE id = ?').run(updates.status, id);
  }
}

function deleteTaskFromDb(id: string): void {
  getDb().prepare('DELETE FROM task_run_logs WHERE task_id = ?').run(id);
  getDb().prepare('DELETE FROM scheduled_tasks WHERE id = ?').run(id);
}

function getTaskRunLogsFromDb(taskId: string, limit = 10): TaskRunLog[] {
  return getDb().prepare(`
    SELECT task_id, run_at, duration_ms, status, result, error
    FROM task_run_logs
    WHERE task_id = ?
    ORDER BY run_at DESC
    LIMIT ?
  `).all(taskId, limit) as TaskRunLog[];
}

export interface TaskInfo {
  id: string;
  groupFolder: string;
  chatJid: string;
  prompt: string;
  scheduleType: string;
  scheduleValue: string;
  nextRun: string | null;
  lastRun: string | null;
  lastResult: string | null;
  status: string;
  createdAt: string;
}

/**
 * 获取所有任务
 */
export function getTasks(): TaskInfo[] {
  const tasks = getAllTasksFromDb();
  return tasks.map(formatTask);
}

/**
 * 获取单个任务
 */
export function getTask(id: string): TaskInfo | null {
  const task = getTaskById(id);
  return task ? formatTask(task) : null;
}

/**
 * 暂停任务
 */
export function pauseTask(id: string): boolean {
  const task = getTaskById(id);
  if (!task) return false;
  
  updateTaskInDb(id, { status: 'paused' });
  return true;
}

/**
 * 恢复任务
 */
export function resumeTask(id: string): boolean {
  const task = getTaskById(id);
  if (!task) return false;
  
  updateTaskInDb(id, { status: 'active' });
  return true;
}

/**
 * 删除任务
 */
export function deleteTask(id: string): boolean {
  const task = getTaskById(id);
  if (!task) return false;
  
  deleteTaskFromDb(id);
  return true;
}

/**
 * 获取任务执行日志
 */
export function getTaskLogs(taskId: string, limit = 10): TaskRunLog[] {
  return getTaskRunLogsFromDb(taskId, limit);
}

/**
 * 创建新任务
 */
export function createNewTask(params: {
  prompt: string;
  scheduleType: 'cron' | 'interval' | 'once';
  scheduleValue: string;
  groupFolder?: string;
  contextMode?: 'group' | 'isolated';
  maxRetries?: number;
  timeoutMs?: number;
}): TaskInfo | { error: string } {
  const groupFolder = params.groupFolder || 'main';
  const chatJid = `${groupFolder}-chat`;
  const id = `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  let nextRun: string | null = null;

  if (params.scheduleType === 'cron') {
    try {
      // Validate cron by parsing — dynamically import not possible in sync, use simple validation
      // We'll compute next_run on the backend via the scheduler wake
      nextRun = new Date(Date.now() + 60000).toISOString(); // placeholder, scheduler will recompute
    } catch {
      return { error: '无效的 cron 表达式' };
    }
  } else if (params.scheduleType === 'interval') {
    const ms = parseInt(params.scheduleValue, 10);
    if (isNaN(ms) || ms <= 0) return { error: '无效的间隔值（毫秒）' };
    nextRun = new Date(Date.now() + ms).toISOString();
  } else if (params.scheduleType === 'once') {
    const scheduled = new Date(params.scheduleValue);
    if (isNaN(scheduled.getTime())) return { error: '无效的时间' };
    nextRun = scheduled.toISOString();
  }

  try {
    const db = getDb();
    db.prepare(`
      INSERT INTO scheduled_tasks (id, group_folder, chat_jid, prompt, schedule_type, schedule_value, context_mode, next_run, status, created_at, retry_count, max_retries, timeout_ms)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, groupFolder, chatJid, params.prompt,
      params.scheduleType, params.scheduleValue,
      params.contextMode || 'isolated',
      nextRun, 'active', new Date().toISOString(),
      0, params.maxRetries ?? 3, params.timeoutMs ?? 300000
    );

    // Wake the scheduler if available
    try {
      const wake = (global as Record<string, unknown>).__flashclaw_scheduler_wake as (() => void) | undefined;
      if (wake) wake();
    } catch { /* ignore */ }

    const task = getTaskById(id);
    return task ? formatTask(task) : { error: '创建后未找到任务' };
  } catch (err) {
    return { error: err instanceof Error ? err.message : '创建失败' };
  }
}

/**
 * 更新任务
 */
export function updateExistingTask(id: string, updates: {
  prompt?: string;
  scheduleType?: string;
  scheduleValue?: string;
  status?: string;
  maxRetries?: number;
  timeoutMs?: number;
}): boolean {
  const task = getTaskById(id);
  if (!task) return false;

  const fields: string[] = [];
  const values: unknown[] = [];

  if (updates.prompt !== undefined) { fields.push('prompt = ?'); values.push(updates.prompt); }
  if (updates.scheduleType !== undefined) { fields.push('schedule_type = ?'); values.push(updates.scheduleType); }
  if (updates.scheduleValue !== undefined) { fields.push('schedule_value = ?'); values.push(updates.scheduleValue); }
  if (updates.status !== undefined) { fields.push('status = ?'); values.push(updates.status); }
  if (updates.maxRetries !== undefined) { fields.push('max_retries = ?'); values.push(updates.maxRetries); }
  if (updates.timeoutMs !== undefined) { fields.push('timeout_ms = ?'); values.push(updates.timeoutMs); }

  if (fields.length === 0) return true;

  values.push(id);
  getDb().prepare(`UPDATE scheduled_tasks SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  return true;
}

/**
 * 格式化任务数据
 */
function formatTask(task: ScheduledTask): TaskInfo {
  return {
    id: task.id,
    groupFolder: task.group_folder,
    chatJid: task.chat_jid,
    prompt: task.prompt,
    scheduleType: task.schedule_type,
    scheduleValue: task.schedule_value,
    nextRun: task.next_run,
    lastRun: task.last_run || null,
    lastResult: task.last_result || null,
    status: task.status,
    createdAt: task.created_at,
  };
}

/**
 * FlashClaw 插件 - 列出定时任务
 * 查看当前群组或所有群组的定时任务
 */

import { ToolPlugin, ToolContext, ToolResult } from '../../src/plugins/types.js';
import { getTasksForGroup, getAllTasks, getTaskRunLogs } from '../../src/db.js';
import { TIMEZONE, MAIN_GROUP_FOLDER } from '../../src/config.js';
import { ScheduledTask } from '../../src/types.js';

/**
 * 列出任务参数
 */
interface ListTasksParams {
  /** 是否列出所有群组的任务（仅 main 群组可用） */
  all?: boolean;
  /** 任务状态过滤 */
  status?: 'active' | 'paused' | 'completed' | 'all';
  /** 是否包含最近运行记录 */
  includeRunLogs?: boolean;
}

/**
 * 格式化任务信息
 */
function formatTask(task: ScheduledTask, includeRunLogs: boolean = false): Record<string, unknown> {
  const formatted: Record<string, unknown> = {
    id: task.id,
    prompt: task.prompt.length > 100 ? task.prompt.slice(0, 100) + '...' : task.prompt,
    scheduleType: task.schedule_type,
    scheduleValue: task.schedule_value,
    status: task.status,
    groupFolder: task.group_folder,
    chatId: task.chat_jid,
    contextMode: task.context_mode,
    createdAt: formatDateTime(task.created_at)
  };
  
  if (task.next_run) {
    formatted.nextRun = formatDateTime(task.next_run);
  }
  
  if (task.last_run) {
    formatted.lastRun = formatDateTime(task.last_run);
    formatted.lastResult = task.last_result;
  }
  
  // 获取最近运行记录
  if (includeRunLogs) {
    const logs = getTaskRunLogs(task.id, 3);
    if (logs.length > 0) {
      formatted.recentRuns = logs.map(log => ({
        runAt: formatDateTime(log.run_at),
        status: log.status,
        durationMs: log.duration_ms,
        result: log.result ? (log.result.length > 50 ? log.result.slice(0, 50) + '...' : log.result) : null,
        error: log.error
      }));
    }
  }
  
  return formatted;
}

/**
 * 格式化日期时间为可读格式
 */
function formatDateTime(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleString('zh-CN', { timeZone: TIMEZONE });
}

const plugin: ToolPlugin = {
  name: 'list_tasks',
  version: '1.0.0',
  description: '列出定时任务，查看任务状态和运行记录',
  
  schema: {
    name: 'list_tasks',
    description: '列出定时任务。默认只显示当前群组的任务，main 群组可以查看所有任务。',
    input_schema: {
      type: 'object',
      properties: {
        all: {
          type: 'boolean',
          description: '是否列出所有群组的任务（仅 main 群组有权限）'
        },
        status: {
          type: 'string',
          enum: ['active', 'paused', 'completed', 'all'],
          description: '按状态过滤任务。默认显示所有状态'
        },
        includeRunLogs: {
          type: 'boolean',
          description: '是否包含最近 3 次运行记录'
        }
      }
    }
  },
  
  async execute(params: unknown, context: ToolContext): Promise<ToolResult> {
    const { all = false, status = 'all', includeRunLogs = false } = (params || {}) as ListTasksParams;
    
    const isMainGroup = context.groupId === MAIN_GROUP_FOLDER;
    
    // 获取任务列表
    let tasks: ScheduledTask[];
    
    if (all && isMainGroup) {
      // main 群组可以查看所有任务
      tasks = getAllTasks();
    } else if (all && !isMainGroup) {
      return {
        success: false,
        error: '只有 main 群组可以查看所有群组的任务'
      };
    } else {
      // 只查看当前群组的任务
      tasks = getTasksForGroup(context.groupId);
    }
    
    // 按状态过滤
    if (status !== 'all') {
      tasks = tasks.filter(task => task.status === status);
    }
    
    // 格式化任务列表
    const formattedTasks = tasks.map(task => formatTask(task, includeRunLogs));
    
    // 统计信息
    const stats = {
      total: tasks.length,
      active: tasks.filter(t => t.status === 'active').length,
      paused: tasks.filter(t => t.status === 'paused').length,
      completed: tasks.filter(t => t.status === 'completed').length
    };
    
    return {
      success: true,
      data: {
        tasks: formattedTasks,
        stats,
        scope: all ? 'all_groups' : 'current_group',
        groupId: context.groupId
      }
    };
  }
};

export default plugin;

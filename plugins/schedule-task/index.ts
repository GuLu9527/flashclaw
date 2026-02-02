/**
 * FlashClaw 插件 - 创建定时任务
 * 允许 AI Agent 创建定时执行的任务
 */

import { ToolPlugin, ToolContext, ToolResult } from '../../src/plugins/types.js';
import { createTask } from '../../src/db.js';
import { CronExpressionParser } from 'cron-parser';
import { TIMEZONE } from '../../src/config.js';

/**
 * 创建任务参数
 */
interface ScheduleTaskParams {
  /** 任务执行时的提示词 */
  prompt: string;
  /** 调度类型：cron（定时表达式）、interval（间隔执行）、once（一次性） */
  scheduleType: 'cron' | 'interval' | 'once';
  /** 调度值：cron 表达式、毫秒数、或 ISO 时间字符串 */
  scheduleValue: string;
  /** 上下文模式：group（共享群组会话）或 isolated（独立会话） */
  contextMode?: 'group' | 'isolated';
}

/**
 * 生成唯一任务 ID
 */
function generateTaskId(): string {
  return `task_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * 计算下一次运行时间
 */
function calculateNextRun(scheduleType: string, scheduleValue: string): string | null {
  const now = new Date();
  
  switch (scheduleType) {
    case 'cron': {
      // 解析 cron 表达式，计算下一次运行时间
      const interval = CronExpressionParser.parse(scheduleValue, { tz: TIMEZONE });
      return interval.next().toISOString();
    }
    case 'interval': {
      // 间隔执行，从现在开始计算
      const ms = parseInt(scheduleValue, 10);
      if (isNaN(ms) || ms < 1000) {
        throw new Error('间隔时间必须是大于 1000 的毫秒数');
      }
      return new Date(now.getTime() + ms).toISOString();
    }
    case 'once': {
      // 一次性任务，直接使用指定的时间
      const runTime = new Date(scheduleValue);
      if (isNaN(runTime.getTime())) {
        throw new Error('无效的时间格式，请使用 ISO 8601 格式');
      }
      if (runTime <= now) {
        throw new Error('任务时间必须是将来的时间');
      }
      return runTime.toISOString();
    }
    default:
      throw new Error(`不支持的调度类型: ${scheduleType}`);
  }
}

/**
 * 验证 cron 表达式
 */
function validateCronExpression(expression: string): boolean {
  try {
    CronExpressionParser.parse(expression);
    return true;
  } catch {
    return false;
  }
}

const plugin: ToolPlugin = {
  name: 'schedule_task',
  version: '1.0.0',
  description: '创建定时任务，支持 cron 表达式、固定间隔或一次性执行',
  
  schema: {
    name: 'schedule_task',
    description: `创建定时任务。支持三种调度方式：
1. cron - 使用 cron 表达式（如 "0 9 * * *" 每天 9 点）
2. interval - 固定间隔（毫秒数，如 "3600000" 每小时）
3. once - 一次性任务（ISO 时间，如 "2024-12-31T23:59:59Z"）

常用 cron 示例：
- "0 9 * * *" - 每天早上 9 点
- "0 9 * * 1" - 每周一早上 9 点
- "0 0 1 * *" - 每月 1 日零点
- "*/30 * * * *" - 每 30 分钟`,
    input_schema: {
      type: 'object',
      properties: {
        prompt: {
          type: 'string',
          description: '任务执行时的提示词，描述需要 AI 做什么'
        },
        scheduleType: {
          type: 'string',
          enum: ['cron', 'interval', 'once'],
          description: '调度类型：cron（定时表达式）、interval（固定间隔）、once（一次性）'
        },
        scheduleValue: {
          type: 'string',
          description: '调度值。cron 类型填 cron 表达式；interval 类型填毫秒数；once 类型填 ISO 8601 时间'
        },
        contextMode: {
          type: 'string',
          enum: ['group', 'isolated'],
          description: '上下文模式。group 表示共享群组会话历史，isolated 表示独立会话（默认）'
        }
      },
      required: ['prompt', 'scheduleType', 'scheduleValue']
    }
  },
  
  async execute(params: unknown, context: ToolContext): Promise<ToolResult> {
    const { prompt, scheduleType, scheduleValue, contextMode = 'isolated' } = params as ScheduleTaskParams;
    
    // 参数验证
    if (!prompt || typeof prompt !== 'string') {
      return {
        success: false,
        error: '任务提示词不能为空'
      };
    }
    
    if (!['cron', 'interval', 'once'].includes(scheduleType)) {
      return {
        success: false,
        error: '调度类型必须是 cron、interval 或 once'
      };
    }
    
    if (!scheduleValue || typeof scheduleValue !== 'string') {
      return {
        success: false,
        error: '调度值不能为空'
      };
    }
    
    // 验证 cron 表达式
    if (scheduleType === 'cron' && !validateCronExpression(scheduleValue)) {
      return {
        success: false,
        error: `无效的 cron 表达式: ${scheduleValue}`
      };
    }
    
    try {
      // 计算下一次运行时间
      const nextRun = calculateNextRun(scheduleType, scheduleValue);
      
      // 生成任务 ID
      const taskId = generateTaskId();
      
      // 创建任务
      createTask({
        id: taskId,
        group_folder: context.groupId,
        chat_jid: context.chatId,
        prompt,
        schedule_type: scheduleType,
        schedule_value: scheduleValue,
        context_mode: contextMode,
        next_run: nextRun,
        status: 'active',
        created_at: new Date().toISOString()
      });
      
      // 格式化下一次运行时间的友好显示
      const nextRunDate = nextRun ? new Date(nextRun) : null;
      const nextRunDisplay = nextRunDate 
        ? nextRunDate.toLocaleString('zh-CN', { timeZone: TIMEZONE })
        : '未知';
      
      return {
        success: true,
        data: {
          taskId,
          prompt,
          scheduleType,
          scheduleValue,
          contextMode,
          nextRun: nextRunDisplay,
          status: 'active'
        }
      };
    } catch (error) {
      return {
        success: false,
        error: `创建任务失败: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }
};

export default plugin;

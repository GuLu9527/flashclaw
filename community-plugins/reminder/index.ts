/**
 * FlashClaw 插件 - 简单提醒
 * 简化版的定时任务，只需要「提醒内容」和「时间」两个参数
 * 小模型更容易正确使用（参数更少、语义更明确）
 */

import { ToolPlugin, ToolContext, ToolResult } from '../../src/plugins/types.js';
import { createTask } from '../../src/db.js';
import { wake } from '../../src/task-scheduler.js';
import { TIMEZONE } from '../../src/config.js';

interface ReminderParams {
  /** 提醒内容 */
  message: string;
  /** 提醒时间，ISO 8601 格式（如 "2026-03-07T09:00:00+08:00"） */
  time: string;
}

function generateTaskId(): string {
  return `reminder_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

const plugin: ToolPlugin = {
  name: 'reminder',
  version: '1.0.0',
  description: '设置简单提醒',

  schema: {
    name: 'reminder',
    description: `设置一个简单的定时提醒。到时间后会自动发送提醒消息给用户。

适用场景：
- "10分钟后提醒我开会"
- "明天早上9点提醒我交报告"
- "下午3点提醒我喝水"

只需要两个参数：提醒内容和提醒时间。
时间使用 ISO 8601 格式。

示例：reminder({ message: "开会啦！", time: "2026-03-07T14:00:00+08:00" })`,
    input_schema: {
      type: 'object',
      properties: {
        message: {
          type: 'string',
          description: '提醒内容，如 "该开会了" 或 "记得喝水"'
        },
        time: {
          type: 'string',
          description: '提醒时间，ISO 8601 格式'
        }
      },
      required: ['message', 'time']
    }
  },

  async execute(params: unknown, context: ToolContext): Promise<ToolResult> {
    const { message, time } = params as ReminderParams;

    if (!message || typeof message !== 'string' || message.trim().length === 0) {
      return { success: false, error: '提醒内容不能为空' };
    }

    if (message.length > 1000) {
      return { success: false, error: '提醒内容过长，最大 1000 字符' };
    }

    if (!time || typeof time !== 'string') {
      return { success: false, error: '提醒时间不能为空' };
    }

    const runTime = new Date(time);
    if (isNaN(runTime.getTime())) {
      return { success: false, error: '无效的时间格式，请使用 ISO 8601 格式（如 2026-03-07T14:00:00+08:00）' };
    }

    if (runTime <= new Date()) {
      return { success: false, error: '提醒时间必须是将来的时间' };
    }

    try {
      const taskId = generateTaskId();

      // 提醒任务的 prompt 包含 send_message 指令
      const prompt = `请使用 send_message 工具发送以下提醒消息给用户：\n\n⏰ 提醒：${message.trim()}`;

      createTask({
        id: taskId,
        group_folder: context.groupId,
        chat_jid: context.chatId,
        prompt,
        schedule_type: 'once',
        schedule_value: runTime.toISOString(),
        context_mode: 'isolated',
        next_run: runTime.toISOString(),
        status: 'active',
        created_at: new Date().toISOString(),
        retry_count: 0,
        max_retries: 2,
        timeout_ms: 60000,
      });

      wake();

      const displayTime = runTime.toLocaleString('zh-CN', { timeZone: TIMEZONE });

      return {
        success: true,
        data: {
          taskId,
          message: message.trim(),
          time: displayTime,
          status: 'scheduled'
        }
      };
    } catch (error) {
      return {
        success: false,
        error: `创建提醒失败: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }
};

export default plugin;

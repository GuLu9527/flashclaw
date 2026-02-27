/**
 * FlashClaw 插件 - 恢复定时任务
 */

import { ToolPlugin, ToolContext, ToolResult } from '../../src/plugins/types.js';
import { getTaskById, updateTask } from '../../src/db.js';
import { MAIN_GROUP_FOLDER } from '../../src/config.js';
import { wake } from '../../src/task-scheduler.js';

interface ResumeTaskParams {
  task_id: string;
}

const plugin: ToolPlugin = {
  name: 'resume_task',
  version: '1.0.0',
  description: '恢复已暂停的定时任务',
  
  schema: {
    name: 'resume_task',
    description: '恢复一个已暂停的定时任务。任务将在下一个调度时间执行。',
    input_schema: {
      type: 'object',
      properties: {
        task_id: {
          type: 'string',
          description: '要恢复的任务 ID，可以通过 list_tasks 获取'
        }
      },
      required: ['task_id']
    }
  },
  
  async execute(params: unknown, context: ToolContext): Promise<ToolResult> {
    const { task_id } = params as ResumeTaskParams;
    
    if (!task_id || typeof task_id !== 'string') {
      return {
        success: false,
        error: '任务 ID 不能为空'
      };
    }
    
    const task = getTaskById(task_id);
    
    if (!task) {
      return {
        success: false,
        error: `任务不存在: ${task_id}`
      };
    }
    
    // 权限检查
    const isMainGroup = context.groupId === MAIN_GROUP_FOLDER;
    const isOwnTask = task.group_folder === context.groupId;
    
    if (!isMainGroup && !isOwnTask) {
      return {
        success: false,
        error: '无权操作其他群组的任务'
      };
    }
    
    if (task.status !== 'paused') {
      return {
        success: false,
        error: '只能恢复已暂停的任务'
      };
    }
    
    try {
      updateTask(task_id, { status: 'active' });
      // 唤醒调度器重新计算定时器
      wake();
      return {
        success: true,
        data: {
          task_id,
          next_run: task.next_run,
          message: '任务已恢复，将在下一个调度时间执行'
        }
      };
    } catch (error) {
      return {
        success: false,
        error: `恢复任务失败: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }
};

export default plugin;

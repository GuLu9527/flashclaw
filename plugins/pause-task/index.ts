/**
 * FlashClaw 插件 - 暂停定时任务
 */

import { ToolPlugin, ToolContext, ToolResult } from '../../src/plugins/types.js';
import { getTaskById, updateTask } from '../../src/db.js';
import { MAIN_GROUP_FOLDER } from '../../src/config.js';

interface PauseTaskParams {
  task_id: string;
}

const plugin: ToolPlugin = {
  name: 'pause_task',
  version: '1.0.0',
  description: '暂停定时任务',
  
  schema: {
    name: 'pause_task',
    description: '暂停一个定时任务。暂停后任务不会执行，直到使用 resume_task 恢复。',
    input_schema: {
      type: 'object',
      properties: {
        task_id: {
          type: 'string',
          description: '要暂停的任务 ID，可以通过 list_tasks 获取'
        }
      },
      required: ['task_id']
    }
  },
  
  async execute(params: unknown, context: ToolContext): Promise<ToolResult> {
    const { task_id } = params as PauseTaskParams;
    
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
    
    if (task.status === 'paused') {
      return {
        success: false,
        error: '任务已经是暂停状态'
      };
    }
    
    if (task.status === 'completed') {
      return {
        success: false,
        error: '已完成的任务无法暂停'
      };
    }
    
    try {
      updateTask(task_id, { status: 'paused' });
      return {
        success: true,
        data: {
          task_id,
          message: '任务已暂停，使用 resume_task 可以恢复执行'
        }
      };
    } catch (error) {
      return {
        success: false,
        error: `暂停任务失败: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }
};

export default plugin;

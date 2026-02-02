/**
 * FlashClaw 插件 - 取消定时任务
 * 取消或暂停定时任务
 */

import { ToolPlugin, ToolContext, ToolResult } from '../../src/plugins/types.js';
import { getTaskById, updateTask, deleteTask, getTasksForGroup } from '../../src/db.js';
import { MAIN_GROUP_FOLDER } from '../../src/config.js';

/**
 * 取消任务参数
 */
interface CancelTaskParams {
  /** 要取消的任务 ID */
  taskId: string;
  /** 操作类型：cancel（取消并删除）、pause（暂停）、resume（恢复） */
  action?: 'cancel' | 'pause' | 'resume';
}

const plugin: ToolPlugin = {
  name: 'cancel_task',
  version: '1.0.0',
  description: '取消、暂停或恢复定时任务',
  
  schema: {
    name: 'cancel_task',
    description: '管理定时任务的状态。可以取消（永久删除）、暂停或恢复任务。',
    input_schema: {
      type: 'object',
      properties: {
        taskId: {
          type: 'string',
          description: '任务 ID，可以通过 list_tasks 工具获取'
        },
        action: {
          type: 'string',
          enum: ['cancel', 'pause', 'resume'],
          description: '操作类型。cancel 永久删除任务，pause 暂停任务，resume 恢复已暂停的任务。默认为 cancel'
        }
      },
      required: ['taskId']
    }
  },
  
  async execute(params: unknown, context: ToolContext): Promise<ToolResult> {
    const { taskId, action = 'cancel' } = params as CancelTaskParams;
    
    // 参数验证
    if (!taskId || typeof taskId !== 'string') {
      return {
        success: false,
        error: '任务 ID 不能为空'
      };
    }
    
    if (!['cancel', 'pause', 'resume'].includes(action)) {
      return {
        success: false,
        error: '操作类型必须是 cancel、pause 或 resume'
      };
    }
    
    // 查找任务
    const task = getTaskById(taskId);
    
    if (!task) {
      return {
        success: false,
        error: `任务不存在: ${taskId}`
      };
    }
    
    // 权限检查：只能操作自己群组的任务，或者 main 群组可以操作所有任务
    const isMainGroup = context.groupId === MAIN_GROUP_FOLDER;
    const isOwnTask = task.group_folder === context.groupId;
    
    if (!isMainGroup && !isOwnTask) {
      return {
        success: false,
        error: '无权操作其他群组的任务'
      };
    }
    
    try {
      switch (action) {
        case 'cancel': {
          // 永久删除任务
          deleteTask(taskId);
          return {
            success: true,
            data: {
              taskId,
              action: 'cancelled',
              message: '任务已永久删除'
            }
          };
        }
        
        case 'pause': {
          // 暂停任务
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
          
          updateTask(taskId, { status: 'paused' });
          return {
            success: true,
            data: {
              taskId,
              action: 'paused',
              message: '任务已暂停，可以使用 resume 操作恢复'
            }
          };
        }
        
        case 'resume': {
          // 恢复任务
          if (task.status !== 'paused') {
            return {
              success: false,
              error: '只能恢复已暂停的任务'
            };
          }
          
          updateTask(taskId, { status: 'active' });
          return {
            success: true,
            data: {
              taskId,
              action: 'resumed',
              message: '任务已恢复，将在下一个调度时间执行',
              nextRun: task.next_run
            }
          };
        }
        
        default:
          return {
            success: false,
            error: `未知操作: ${action}`
          };
      }
    } catch (error) {
      return {
        success: false,
        error: `操作失败: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }
};

export default plugin;

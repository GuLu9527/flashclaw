/**
 * FlashClaw 插件 - 长期记忆管理
 * 提供 remember 和 recall 功能
 */

import { ToolPlugin, ToolContext, ToolResult } from '../../src/plugins/types.js';
import { getMemoryManager } from '../../src/core/memory.js';

/**
 * 记忆操作参数
 */
interface MemoryParams {
  /** 操作类型：remember（记住）或 recall（回忆） */
  action: 'remember' | 'recall';
  /** 记忆键（remember 必需，recall 可选） */
  key?: string;
  /** 记忆值（remember 必需） */
  value?: string;
  /** 作用域：user（用户级别，跨会话共享）或 group（会话级别，默认） */
  scope?: 'user' | 'group';
}

const plugin: ToolPlugin = {
  name: 'memory',
  version: '1.0.0',
  description: '长期记忆管理，可以记住和回忆重要信息',
  
  schema: {
    name: 'memory',
    description: `管理长期记忆。支持两种操作：
- remember: 保存重要信息到长期记忆（用户偏好、重要事实等）
- recall: 回忆之前保存的信息

支持两种作用域：
- user: 用户级别记忆，跨所有会话共享（推荐用于个人偏好）
- group: 会话级别记忆，仅在当前会话有效（默认）

记忆会持久化到文件，跨会话保持。`,
    input_schema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['remember', 'recall'],
          description: 'remember 保存信息，recall 回忆信息'
        },
        key: {
          type: 'string',
          description: '记忆的键名（如 "favorite_food"、"name"）。recall 时留空则返回所有记忆'
        },
        value: {
          type: 'string',
          description: 'remember 时要保存的值'
        },
        scope: {
          type: 'string',
          enum: ['user', 'group'],
          description: '作用域。user=用户级别（跨会话共享，适合个人偏好），group=会话级别（默认）'
        }
      },
      required: ['action']
    }
  },
  
  async execute(params: unknown, context: ToolContext): Promise<ToolResult> {
    const { action, key, value, scope = 'user' } = params as MemoryParams;
    const mm = getMemoryManager();
    
    // 默认使用用户级别记忆（跨会话共享）
    const isUserScope = scope === 'user';
    const scopeLabel = isUserScope ? '用户' : '会话';
    
    if (action === 'remember') {
      // 记住信息
      if (!key || typeof key !== 'string') {
        return {
          success: false,
          error: 'remember 操作需要提供 key'
        };
      }
      
      if (!value || typeof value !== 'string') {
        return {
          success: false,
          error: 'remember 操作需要提供 value'
        };
      }
      
      try {
        if (isUserScope) {
          mm.rememberUser(context.userId, key, value);
        } else {
          mm.remember(context.groupId, key, value);
        }
        return {
          success: true,
          data: {
            action: 'remembered',
            scope: scopeLabel,
            key,
            value,
            message: `已记住（${scopeLabel}级别）: ${key} = ${value}`
          }
        };
      } catch (error) {
        return {
          success: false,
          error: `保存记忆失败: ${error instanceof Error ? error.message : String(error)}`
        };
      }
    }
    
    if (action === 'recall') {
      // 回忆信息
      try {
        // 默认同时查询用户级别和会话级别记忆
        const userResult = mm.recallUser(context.userId, key);
        const groupResult = mm.recall(context.groupId, key);
        
        if (key) {
          // 回忆特定键 - 优先返回用户级别，其次会话级别
          const result = userResult || groupResult;
          const foundScope = userResult ? '用户' : (groupResult ? '会话' : null);
          
          if (result) {
            return {
              success: true,
              data: {
                action: 'recalled',
                scope: foundScope,
                key,
                value: result
              }
            };
          } else {
            return {
              success: true,
              data: {
                action: 'recalled',
                key,
                value: null,
                message: `没有找到键为 "${key}" 的记忆`
              }
            };
          }
        } else {
          // 回忆所有 - 合并用户级别和会话级别
          const memories: string[] = [];
          if (userResult) {
            memories.push(`【用户记忆】\n${userResult}`);
          }
          if (groupResult) {
            memories.push(`【会话记忆】\n${groupResult}`);
          }
          
          if (memories.length > 0) {
            return {
              success: true,
              data: {
                action: 'recalled',
                memories: memories.join('\n\n')
              }
            };
          } else {
            return {
              success: true,
              data: {
                action: 'recalled',
                memories: null,
                message: '没有保存的记忆'
              }
            };
          }
        }
      } catch (error) {
        return {
          success: false,
          error: `回忆失败: ${error instanceof Error ? error.message : String(error)}`
        };
      }
    }
    
    return {
      success: false,
      error: 'action 必须是 remember 或 recall'
    };
  }
};

export default plugin;

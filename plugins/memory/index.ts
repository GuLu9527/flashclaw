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
  /** 操作类型：remember（记住）、recall（回忆）或 log（追加每日日志） */
  action: 'remember' | 'recall' | 'log';
  /** 记忆键（remember 必需，recall 可选） */
  key?: string;
  /** 记忆值（remember 必需）/ 日志内容（log 必需） */
  value?: string;
  /** 作用域：user（用户级别）或 global（全局共享，默认） */
  scope?: 'user' | 'global';
}

const plugin: ToolPlugin = {
  name: 'memory',
  version: '1.1.0',
  description: '长期记忆管理，可以记住、回忆重要信息，以及写入每日日志',
  
  schema: {
    name: 'memory',
    description: `管理长期记忆和每日日志。

**何时用 remember**: 保存持久事实（姓名、偏好、配置等），需要 key 和 value
**何时用 recall**: 查询之前保存的事实
**何时用 log**: 记录事件、笔记、动态（"今天做了XX"、"开了会"、"学了XX"），自动按日期归档，无需 key

示例：
- "记住我叫张三" → remember(key="name", value="张三")
- "帮我记录今天开了会" → log(value="今天开了会")
- "我叫什么" → recall(key="name")`,
    input_schema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['remember', 'recall', 'log'],
          description: 'remember 保存信息，recall 回忆信息，log 追加每日日志'
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
          enum: ['user', 'global'],
          description: '作用域。user=用户级别（适合个人偏好），global=全局级别（跨渠道共享，默认）'
        }
      },
      required: ['action']
    }
  },
  
  async execute(params: unknown, context: ToolContext): Promise<ToolResult> {
    const { action, key, value, scope = 'global' } = params as MemoryParams;
    const mm = getMemoryManager();

    const isUserScope = scope === 'user';
    const scopeLabel = isUserScope ? '用户' : '全局';
    
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
          mm.remember(key, value);
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
        // 默认同时查询用户级别和全局级别记忆
        const userResult = mm.recallUser(context.userId, key);
        const globalResult = mm.recall(key);

        if (key) {
          // 回忆特定键 - 优先返回用户级别，其次全局级别
          const result = userResult || globalResult;
          const foundScope = userResult ? '用户' : (globalResult ? '全局' : null);

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
          // 回忆所有 - 合并用户级别和全局级别
          const memories: string[] = [];
          if (userResult) {
            memories.push(`【用户记忆】\n${userResult}`);
          }
          if (globalResult) {
            memories.push(`【全局记忆】\n${globalResult}`);
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
    
    if (action === 'log') {
      // 追加每日日志
      if (!value || typeof value !== 'string') {
        return {
          success: false,
          error: 'log 操作需要提供 value（日志内容）'
        };
      }

      try {
        const log = mm.appendDailyLog(value);
        return {
          success: true,
          data: {
            action: 'logged',
            date: log.date,
            time: log.time,
            content: value,
            message: `已记录到 ${log.date} 日志`
          }
        };
      } catch (error) {
        return {
          success: false,
          error: `写入日志失败: ${error instanceof Error ? error.message : String(error)}`
        };
      }
    }
    
    return {
      success: false,
      error: 'action 必须是 remember、recall 或 log'
    };
  }
};

export default plugin;

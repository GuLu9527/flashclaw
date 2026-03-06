/**
 * FlashClaw 插件 - 注册群组
 * 允许 AI Agent 注册新的聊天群组
 */

import { ToolPlugin, ToolContext, ToolResult } from '../../src/plugins/types.js';
import { MAIN_GROUP_FOLDER } from '../../src/config.js';
import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * 注册群组参数
 */
interface RegisterGroupParams {
  /** 聊天 ID（如 "oc_xxxxxxxx"） */
  jid: string;
  /** 群组显示名称 */
  name: string;
  /** 群组文件夹名称（小写，用连字符分隔） */
  folder: string;
  /** 触发词（如 "@Andy"） */
  trigger: string;
}

const plugin: ToolPlugin = {
  name: 'register_group',
  version: '1.0.0',
  description: '注册新的聊天群组',
  
  schema: {
    name: 'register_group',
    description: `注册新的聊天群组，使机器人可以响应该群组的消息。
仅限 main 群组使用。文件夹名称应使用小写字母和连字符（如 "family-chat"）。`,
    input_schema: {
      type: 'object',
      properties: {
        jid: {
          type: 'string',
          description: '聊天 ID（如 "oc_xxxxxxxx"）'
        },
        name: {
          type: 'string',
          description: '群组显示名称'
        },
        folder: {
          type: 'string',
          description: '群组文件夹名称（小写，用连字符分隔）'
        },
        trigger: {
          type: 'string',
          description: '触发词（如 "@Andy"）'
        }
      },
      required: ['jid', 'name', 'folder', 'trigger']
    }
  },
  
  async execute(params: unknown, context: ToolContext): Promise<ToolResult> {
    const { jid, name, folder, trigger } = params as RegisterGroupParams;
    
    // 权限检查：只有 main 群组可以注册新群组
    if (context.groupId !== MAIN_GROUP_FOLDER) {
      return {
        success: false,
        error: '只有 main 群组可以注册新群组'
      };
    }
    
    // 参数验证
    if (!jid || typeof jid !== 'string') {
      return {
        success: false,
        error: 'jid（聊天 ID）不能为空'
      };
    }
    
    if (!name || typeof name !== 'string') {
      return {
        success: false,
        error: 'name（群组名称）不能为空'
      };
    }
    
    if (!folder || typeof folder !== 'string') {
      return {
        success: false,
        error: 'folder（文件夹名称）不能为空'
      };
    }
    
    if (!trigger || typeof trigger !== 'string') {
      return {
        success: false,
        error: 'trigger（触发词）不能为空'
      };
    }
    
    // 验证 folder 格式
    if (!/^[a-z0-9-]+$/.test(folder)) {
      return {
        success: false,
        error: 'folder 只能包含小写字母、数字和连字符'
      };
    }
    
    // 通过 IPC 写入注册请求
    const ipcDir = path.join(process.cwd(), 'data', 'ipc', context.groupId, 'tasks');
    fs.mkdirSync(ipcDir, { recursive: true });
    
    const data = {
      type: 'register_group',
      jid,
      name,
      folder,
      trigger,
      timestamp: new Date().toISOString()
    };
    
    const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`;
    const filepath = path.join(ipcDir, filename);
    
    try {
      // 原子写入
      const tempPath = `${filepath}.tmp`;
      fs.writeFileSync(tempPath, JSON.stringify(data, null, 2));
      fs.renameSync(tempPath, filepath);
      
      return {
        success: true,
        data: {
          jid,
          name,
          folder,
          trigger,
          message: `群组 "${name}" 已注册，机器人将开始响应该群组的消息`
        }
      };
    } catch (error) {
      return {
        success: false,
        error: `注册失败: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }
};

export default plugin;

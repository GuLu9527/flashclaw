/**
 * FlashClaw 插件 - 发送消息
 * 允许 AI Agent 主动发送消息到聊天
 */

import { ToolPlugin, ToolContext, ToolResult } from '../../src/plugins/types.js';

/**
 * 发送消息参数
 */
interface SendMessageParams {
  /** 要发送的消息内容 */
  content: string;
  /** 目标聊天 ID（可选，默认当前聊天） */
  chatId?: string;
}

const plugin: ToolPlugin = {
  name: 'send_message',
  version: '1.0.0',
  description: '发送消息到当前聊天或指定聊天',
  
  schema: {
    name: 'send_message',
    description: '发送消息到聊天。用于主动通知用户、回复消息或发送执行结果。',
    input_schema: {
      type: 'object',
      properties: {
        content: {
          type: 'string',
          description: '要发送的消息内容，支持文本格式'
        },
        chatId: {
          type: 'string',
          description: '目标聊天 ID。如果不指定，则发送到当前对话的聊天'
        }
      },
      required: ['content']
    }
  },
  
  async execute(params: unknown, context: ToolContext): Promise<ToolResult> {
    const { content, chatId } = params as SendMessageParams;
    
    // 验证参数
    if (!content || typeof content !== 'string') {
      return {
        success: false,
        error: '消息内容不能为空'
      };
    }
    
    if (content.length > 10000) {
      return {
        success: false,
        error: '消息内容过长，最大支持 10000 字符'
      };
    }
    
    const targetChatId = chatId || context.chatId;
    
    try {
      // 使用上下文提供的 sendMessage 方法发送消息
      await context.sendMessage(content);
      
      return {
        success: true,
        data: {
          chatId: targetChatId,
          contentLength: content.length,
          sent: true
        }
      };
    } catch (error) {
      return {
        success: false,
        error: `发送消息失败: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }
};

export default plugin;

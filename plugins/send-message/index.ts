/**
 * FlashClaw 插件 - 发送消息
 * 允许 AI Agent 主动发送消息和图片到聊天
 */

import { ToolPlugin, ToolContext, ToolResult } from '../../src/plugins/types.js';
import { tmpdir } from 'os';
import { join } from 'path';
import { readFileSync, existsSync } from 'fs';

// 最近截图的临时文件路径（与 browser-control 插件共享）
const LATEST_SCREENSHOT_PATH = join(tmpdir(), 'flashclaw-latest-screenshot.txt');

/** 从临时文件读取最近截图 */
function getLatestScreenshot(): string | null {
  if (!existsSync(LATEST_SCREENSHOT_PATH)) return null;
  try {
    return readFileSync(LATEST_SCREENSHOT_PATH, 'utf-8');
  } catch {
    return null;
  }
}

/**
 * 发送消息参数
 */
interface SendMessageParams {
  /** 要发送的消息内容 */
  content?: string;
  /** 要发送的图片（base64 或 data URL 格式） */
  image?: string;
  /** 图片说明文字 */
  caption?: string;
}

const plugin: ToolPlugin = {
  name: 'send_message',
  version: '1.1.0',
  description: '发送消息或图片到当前聊天',
  
  schema: {
    name: 'send_message',
    description: '发送消息或图片到当前聊天。用于主动通知用户、回复消息、发送执行结果或分享截图等图片。',
    input_schema: {
      type: 'object',
      properties: {
        content: {
          type: 'string',
          description: '要发送的文本消息内容'
        },
        image: {
          type: 'string',
          description: '要发送的图片。支持：1) "latest_screenshot" - 发送最近的浏览器截图；2) base64 编码字符串；3) data URL 格式。推荐使用 "latest_screenshot" 发送 browser_action screenshot 的截图。'
        },
        caption: {
          type: 'string',
          description: '图片说明文字（仅在发送图片时有效）'
        }
      },
      required: []  // content 和 image 至少需要一个
    }
  },
  
  async execute(params: unknown, context: ToolContext): Promise<ToolResult> {
    const { content, image, caption } = params as SendMessageParams;
    
    // 验证至少有一个内容
    const hasContent = content && typeof content === 'string' && content.trim().length > 0;
    const hasImage = image && typeof image === 'string' && image.length > 0;
    
    if (!hasContent && !hasImage) {
      return {
        success: false,
        error: '消息内容和图片至少需要提供一个'
      };
    }
    
    // 验证文本长度
    if (hasContent && content.length > 10000) {
      return {
        success: false,
        error: '消息内容过长，最大支持 10000 字符'
      };
    }
    
    try {
      const results: { text?: boolean; image?: boolean } = {};
      
      // 发送图片（如果有）
      if (hasImage) {
        let imageData = image;
        
        // 处理特殊引用：latest_screenshot 或文件名含 _screenshot 的值
        // AI 有时会传文件名如 "baidu_screenshot.png" 而非 "latest_screenshot"
        if (image === 'latest_screenshot' || /^[\w-]*_?screenshot[\w.]*$/i.test(image)) {
          const screenshot = getLatestScreenshot();
          if (screenshot) {
            imageData = `data:image/png;base64,${screenshot}`;
          } else {
            return {
              success: false,
              error: '没有可用的截图。请先使用 browser_action screenshot 截图。'
            };
          }
        } else if (!image.startsWith('data:')) {
          // 尝试作为文件路径读取
          try {
            if (existsSync(image)) {
              const fileBuffer = readFileSync(image);
              imageData = `data:image/png;base64,${fileBuffer.toString('base64')}`;
            } else {
              // 假设是纯 base64，转换为 data URL
              imageData = `data:image/png;base64,${image}`;
            }
          } catch {
            imageData = `data:image/png;base64,${image}`;
          }
        }
        
        await context.sendImage(imageData, caption);
        results.image = true;
      }
      
      // 发送文本消息（如果有，且不是作为图片说明）
      if (hasContent && !hasImage) {
        await context.sendMessage(content);
        results.text = true;
      } else if (hasContent && hasImage && !caption) {
        // 如果同时有文本和图片但没指定 caption，文本单独发送
        await context.sendMessage(content);
        results.text = true;
      }
      
      return {
        success: true,
        data: {
          chatId: context.chatId,
          contentLength: hasContent ? content.length : 0,
          hasImage: hasImage,
          sent: results
        }
      };
    } catch (error) {
      return {
        success: false,
        error: `发送失败: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }
};

export default plugin;

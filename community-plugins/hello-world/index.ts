/**
 * Hello World 测试插件
 * 用于验证 FlashClaw 插件安装功能
 */

import type { ToolPlugin, ToolContext, ToolResult } from '../../src/plugins/types.js';

const greetings: Record<string, (name: string) => string> = {
  zh: (name) => `你好，${name}！欢迎使用 FlashClaw ⚡`,
  en: (name) => `Hello, ${name}! Welcome to FlashClaw ⚡`,
  ja: (name) => `こんにちは、${name}さん！FlashClaw へようこそ ⚡`,
};

const plugin: ToolPlugin = {
  name: 'hello-world',
  version: '1.0.0',
  description: '测试插件 - 向用户打招呼',

  tools: [
    {
      name: 'say_hello',
      description: '向指定的人打招呼',
      input_schema: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: '要打招呼的人的名字',
          },
          language: {
            type: 'string',
            enum: ['zh', 'en', 'ja'],
            description: '语言：zh=中文, en=英文, ja=日文',
          },
        },
        required: ['name'],
      },
    },
  ],

  async init() {
    // 插件加载日志（仅 debug 模式可见）
  },

  async execute(toolName: string, params: unknown, context: ToolContext): Promise<ToolResult> {
    if (toolName !== 'say_hello') {
      return { success: false, error: `未知工具: ${toolName}` };
    }

    const { name, language = 'zh' } = params as { name: string; language?: string };
    const greetFn = greetings[language] || greetings['zh'];
    const message = greetFn(name);

    return {
      success: true,
      data: { message, name, language },
    };
  },

  async cleanup() {
    console.log('[hello-world] 插件已卸载');
  },
};

export default plugin;

/**
 * CLI 渠道插件 - 终端交互渠道
 *
 * 作为 FlashClaw 的内置终端渠道，
 * 提供 CLI 命令客户端连接到服务
 *
 * 使用方式：
 * 1. 启动服务: flashclaw start
 * 2. 连接 CLI: flashclaw cli
 */

import type { ChannelPlugin, MessageHandler, PluginConfig, SendMessageResult } from '../../src/plugins/types.js';
import { createLogger } from '../../src/logger.js';

const logger = createLogger('CLI-Channel');

const plugin: ChannelPlugin & {
  group: string;
} = {
  name: 'cli-channel',
  version: '1.0.0',
  group: 'cli-default',

  async init(_config: PluginConfig): Promise<void> {
    // CLI 渠道不需要特殊配置
  },

  onMessage(_handler: MessageHandler): void {
    // CLI 是客户端模式，由 flashclaw cli 命令连接
    // 消息通过 HTTP API 传输
  },

  async start(): Promise<void> {
    // CLI 渠道是客户端模式，不绑定终端
    // 用户通过 flashclaw cli 命令连接
    // 消息通过 web-ui 的 /api/chat 接口传输
    logger.info('CLI 渠道已就绪，使用 flashclaw cli 连接服务');
  },

  async stop(): Promise<void> {
    // 清理资源
  },

  async sendMessage(_chatId: string, content: string): Promise<SendMessageResult> {
    // CLI 渠道的消息由 flashclaw cli 命令处理
    // 这里不需要实现（消息通过 API 传输）
    return { success: true };
  }
};

export default plugin;

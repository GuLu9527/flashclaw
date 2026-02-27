/**
 * FlashClaw 渠道管理器
 * 管理所有已启用的通讯渠道插件
 */

import { pluginManager } from './plugins/manager.js';
import { ChannelPlugin, Message, MessageHandler, SendMessageResult } from './plugins/types.js';
import { createLogger } from './logger.js';

const logger = createLogger('ChannelManager');

export class ChannelManager {
  private channels: ChannelPlugin[] = [];
  private enabledPlatforms: string[] = [];
  
  async initialize(): Promise<void> {
    this.channels = pluginManager.getActiveChannels();
    this.enabledPlatforms = this.channels.map(c => c.name);
    
    if (this.channels.length === 0) {
      throw new Error('没有启用任何通讯渠道');
    }
  }
  
  async start(onMessage: MessageHandler): Promise<void> {
    for (const channel of this.channels) {
      channel.onMessage(onMessage);
      await channel.start();
      logger.info({ channel: channel.name }, '⚡ 渠道已启动');
    }
  }
  
  async sendMessage(chatId: string, content: string, platform?: string): Promise<SendMessageResult> {
    // 如果指定了平台，使用指定的渠道
    if (platform) {
      const channel = this.channels.find(c => c.name === platform);
      if (channel) {
        return await channel.sendMessage(chatId, content);
      }
    }
    // 否则尝试所有渠道
    for (const channel of this.channels) {
      try {
        return await channel.sendMessage(chatId, content);
      } catch (err) {
        logger.debug({ channel: channel.name, chatId, err }, '渠道发送消息失败，尝试下一个');
        continue;
      }
    }
    return { success: false, error: `无法发送消息到 ${chatId}` };
  }
  
  async updateMessage(messageId: string, content: string, platform?: string): Promise<void> {
    // 如果指定了平台，使用指定的渠道
    if (platform) {
      const channel = this.channels.find(c => c.name === platform);
      if (channel?.updateMessage) {
        await channel.updateMessage(messageId, content);
        return;
      }
    }
    // 尝试所有支持更新的渠道
    for (const channel of this.channels) {
      if (channel.updateMessage) {
        try {
          await channel.updateMessage(messageId, content);
          return;
        } catch (err) {
          logger.debug({ channel: channel.name, messageId, err }, '渠道更新消息失败，尝试下一个');
          continue;
        }
      }
    }
  }
  
  async deleteMessage(messageId: string, platform?: string): Promise<void> {
    if (platform) {
      const channel = this.channels.find(c => c.name === platform);
      if (channel?.deleteMessage) {
        await channel.deleteMessage(messageId);
        return;
      }
    }
    for (const channel of this.channels) {
      if (channel.deleteMessage) {
        try {
          await channel.deleteMessage(messageId);
          return;
        } catch (err) {
          logger.debug({ channel: channel.name, messageId, err }, '渠道删除消息失败，尝试下一个');
          continue;
        }
      }
    }
  }
  
  async sendImage(chatId: string, imageData: string, caption?: string, platform?: string): Promise<SendMessageResult> {
    // 如果指定了平台，使用指定的渠道
    if (platform) {
      const channel = this.channels.find(c => c.name === platform);
      if (channel?.sendImage) {
        return await channel.sendImage(chatId, imageData, caption);
      }
      // 渠道不支持发送图片，降级为发送文本提示
      logger.warn({ platform, chatId }, '渠道不支持发送图片，已降级');
      return await this.sendMessage(chatId, caption || '[图片无法显示]', platform);
    }
    // 尝试所有支持图片的渠道
    for (const channel of this.channels) {
      if (channel.sendImage) {
        try {
          return await channel.sendImage(chatId, imageData, caption);
        } catch (err) {
          logger.debug({ channel: channel.name, chatId, err }, '渠道发送图片失败，尝试下一个');
          continue;
        }
      }
    }
    // 所有渠道都不支持，降级为文本
    logger.warn({ chatId }, '没有渠道支持发送图片，已降级');
    return await this.sendMessage(chatId, caption || '[图片无法显示]', platform);
  }
  
  getEnabledPlatforms(): string[] {
    return this.enabledPlatforms;
  }
  
  getPlatformDisplayName(platform: string): string {
    const names: Record<string, string> = {
      'feishu': '飞书',
    };
    return names[platform] || platform;
  }
  
  shouldRespondInGroup(msg: Message): boolean {
    // 检查是否被 @ 或提到机器人名称
    const botName = process.env.BOT_NAME || 'FlashClaw';
    return msg.content.includes(`@${botName}`) || 
           msg.content.toLowerCase().includes(botName.toLowerCase());
  }
}

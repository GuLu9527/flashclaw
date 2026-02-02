/**
 * FlashClaw 插件管理器
 * 负责插件的注册、卸载和查询
 */

import {
  Plugin,
  ToolPlugin,
  ChannelPlugin,
  ToolSchema,
  isToolPlugin,
  isChannelPlugin,
} from './types.js';
import { createLogger } from '../logger.js';

const logger = createLogger('PluginManager');

// 插件注册表项
interface PluginEntry {
  plugin: Plugin;
  type: 'tool' | 'channel';
  loadedAt: Date;
}

/**
 * 插件管理器
 * 管理所有已加载的插件
 */
export class PluginManager {
  // 插件注册表：name -> PluginEntry
  private plugins = new Map<string, PluginEntry>();

  /**
   * 注册插件
   * @param plugin 插件实例
   * @returns 是否注册成功
   */
  register(plugin: Plugin): boolean {
    const name = plugin.name;

    // 检查是否已存在
    if (this.plugins.has(name)) {
      logger.warn({ plugin: name }, '插件已存在，跳过注册');
      return false;
    }

    // 确定插件类型
    const type = isToolPlugin(plugin) ? 'tool' : 'channel';

    // 注册
    this.plugins.set(name, {
      plugin,
      type,
      loadedAt: new Date(),
    });

    logger.info({ plugin: name, type, version: plugin.version }, '⚡ 已注册插件');
    return true;
  }

  /**
   * 卸载插件
   * @param name 插件名称
   * @returns 是否卸载成功
   */
  unregister(name: string): boolean {
    const entry = this.plugins.get(name);
    if (!entry) {
      logger.warn({ plugin: name }, '插件不存在');
      return false;
    }

    // 如果是渠道插件，先停止
    if (isChannelPlugin(entry.plugin)) {
      entry.plugin.stop().catch((err) => {
        logger.error({ plugin: name, err }, '停止渠道插件失败');
      });
    }

    this.plugins.delete(name);
    logger.info({ plugin: name }, '⚡ 已卸载插件');
    return true;
  }

  /**
   * 获取所有工具的 Schema
   * 用于传递给 AI Agent
   */
  getActiveTools(): ToolSchema[] {
    const schemas: ToolSchema[] = [];

    for (const entry of this.plugins.values()) {
      if (entry.type === 'tool' && isToolPlugin(entry.plugin)) {
        schemas.push(entry.plugin.schema);
      }
    }

    return schemas;
  }

  /**
   * 获取所有渠道插件
   */
  getActiveChannels(): ChannelPlugin[] {
    const channels: ChannelPlugin[] = [];

    for (const entry of this.plugins.values()) {
      if (entry.type === 'channel' && isChannelPlugin(entry.plugin)) {
        channels.push(entry.plugin);
      }
    }

    return channels;
  }

  /**
   * 获取指定工具插件
   * @param name 工具名称
   */
  getTool(name: string): ToolPlugin | null {
    const entry = this.plugins.get(name);
    if (entry && entry.type === 'tool' && isToolPlugin(entry.plugin)) {
      return entry.plugin;
    }
    return null;
  }

  /**
   * 获取指定渠道插件
   * @param name 渠道名称
   */
  getChannel(name: string): ChannelPlugin | null {
    const entry = this.plugins.get(name);
    if (entry && entry.type === 'channel' && isChannelPlugin(entry.plugin)) {
      return entry.plugin;
    }
    return null;
  }

  /**
   * 获取所有已注册的插件名称
   */
  getPluginNames(): string[] {
    return Array.from(this.plugins.keys());
  }

  /**
   * 获取插件数量统计
   */
  getStats(): { total: number; tools: number; channels: number } {
    let tools = 0;
    let channels = 0;

    for (const entry of this.plugins.values()) {
      if (entry.type === 'tool') tools++;
      else channels++;
    }

    return { total: this.plugins.size, tools, channels };
  }

  /**
   * 清空所有插件
   */
  async clear(): Promise<void> {
    // 先停止所有渠道
    for (const entry of this.plugins.values()) {
      if (isChannelPlugin(entry.plugin)) {
        await entry.plugin.stop().catch(() => {});
      }
    }

    this.plugins.clear();
    logger.info('⚡ 已清空所有插件');
  }
}

// 导出单例
export const pluginManager = new PluginManager();

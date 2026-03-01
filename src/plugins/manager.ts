/**
 * FlashClaw 插件管理器
 * 负责插件的注册、卸载和查询
 */

import {
  Plugin,
  ToolPlugin,
  ChannelPlugin,
  AIProviderPlugin,
  ToolSchema,
  isToolPlugin,
  isChannelPlugin,
  isAIProviderPlugin,
} from './types.js';
import { createLogger } from '../logger.js';

const logger = createLogger('PluginManager');

// 插件注册表项
interface PluginEntry {
  plugin: Plugin;
  type: 'tool' | 'channel' | 'provider';
  loadedAt: Date;
}

/**
 * 插件管理器
 * 管理所有已加载的插件
 */
export class PluginManager {
  // 插件注册表：name -> PluginEntry
  private plugins = new Map<string, PluginEntry>();

  // 当前 AI Provider
  private currentProvider: AIProviderPlugin | null = null;

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
    let type: 'tool' | 'channel' | 'provider';
    if (isAIProviderPlugin(plugin)) {
      type = 'provider';
      // 如果没有设置过 provider，自动设置为这个
      if (!this.currentProvider) {
        this.currentProvider = plugin;
        logger.info({ plugin: name, version: plugin.version }, '⚡ 已设置为当前 AI Provider');
      }
    } else if (isToolPlugin(plugin)) {
      type = 'tool';
    } else {
      type = 'channel';
    }

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
  async unregister(name: string): Promise<boolean> {
    const entry = this.plugins.get(name);
    if (!entry) {
      logger.warn({ plugin: name }, '插件不存在');
      return false;
    }

    // 如果是渠道插件，先停止
    if (isChannelPlugin(entry.plugin)) {
      try {
        await entry.plugin.stop();
      } catch (err) {
        logger.error({ plugin: name, err }, '停止渠道插件失败');
      }
    }
    
    // 如果是工具插件且有 cleanup 钩子，调用它
    if (isToolPlugin(entry.plugin) && entry.plugin.cleanup) {
      try {
        await entry.plugin.cleanup();
      } catch (err) {
        logger.error({ plugin: name, err }, '清理工具插件失败');
      }
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
        // 支持多工具插件（tools 数组）
        if (entry.plugin.tools && Array.isArray(entry.plugin.tools)) {
          schemas.push(...entry.plugin.tools);
        } else if (entry.plugin.schema) {
          // 单工具插件
          schemas.push(entry.plugin.schema);
        }
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
   * @param toolName 工具名称
   * @returns 插件和是否为多工具模式
   */
  getTool(toolName: string): { plugin: ToolPlugin; isMultiTool: boolean } | null {
    // 1. 先按插件名称查找（单工具模式：插件名 = 工具名）
    const entry = this.plugins.get(toolName);
    if (entry && entry.type === 'tool' && isToolPlugin(entry.plugin)) {
      return { plugin: entry.plugin, isMultiTool: false };
    }
    
    // 2. 再在所有工具插件的 tools 数组中查找（多工具模式）
    for (const pluginEntry of this.plugins.values()) {
      if (pluginEntry.type === 'tool' && isToolPlugin(pluginEntry.plugin)) {
        const plugin = pluginEntry.plugin;
        if (plugin.tools && Array.isArray(plugin.tools)) {
          const found = plugin.tools.some(t => t.name === toolName);
          if (found) {
            return { plugin, isMultiTool: true };
          }
        }
      }
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
  getStats(): { total: number; tools: number; channels: number; providers: number } {
    let tools = 0;
    let channels = 0;
    let providers = 0;

    for (const entry of this.plugins.values()) {
      if (entry.type === 'tool') tools++;
      else if (entry.type === 'channel') channels++;
      else if (entry.type === 'provider') providers++;
    }

    return { total: this.plugins.size, tools, channels, providers };
  }

  /**
   * 清空所有插件
   */
  async clear(): Promise<void> {
    // 先停止所有渠道插件，清理所有工具插件，清理所有 provider 插件
    for (const entry of this.plugins.values()) {
      if (isChannelPlugin(entry.plugin)) {
        await entry.plugin.stop().catch((err) => {
          logger.warn({ plugin: entry.plugin.name, err }, '停止渠道插件失败（清空时）');
        });
      }
      if (isToolPlugin(entry.plugin) && entry.plugin.cleanup) {
        await entry.plugin.cleanup().catch((err) => {
          logger.warn({ plugin: entry.plugin.name, err }, '清理工具插件失败（清空时）');
        });
      }
      if (isAIProviderPlugin(entry.plugin) && entry.plugin.cleanup) {
        await entry.plugin.cleanup().catch((err) => {
          logger.warn({ plugin: entry.plugin.name, err }, '清理 Provider 插件失败（清空时）');
        });
      }
    }

    this.plugins.clear();
    this.currentProvider = null;
    logger.info('⚡ 已清空所有插件');
  }

  /**
   * 停止所有渠道插件（不清空注册）
   */
  async stopAll(): Promise<void> {
    const promises: Promise<void>[] = [];

    for (const entry of this.plugins.values()) {
      if (isChannelPlugin(entry.plugin)) {
        promises.push(
          entry.plugin.stop().catch((err) => {
            logger.warn({ plugin: entry.plugin.name, err }, '停止插件失败');
          })
        );
      }
    }

    await Promise.all(promises);
    logger.info('⚡ 所有渠道插件已停止');
  }

  /**
   * 设置当前 AI Provider
   * @param provider AI Provider 插件实例
   */
  setProvider(provider: AIProviderPlugin): void {
    this.currentProvider = provider;
    logger.info({ plugin: provider.name }, '⚡ 已设置当前 AI Provider');
  }

  /**
   * 获取当前 AI Provider
   * @returns 当前 Provider 实例，如果没有则返回 null
   */
  getProvider(): AIProviderPlugin | null {
    return this.currentProvider;
  }

  /**
   * 根据名称获取 AI Provider
   * @param name Provider 插件名称
   * @returns Provider 实例，如果没有找到则返回 null
   */
  getProviderByName(name: string): AIProviderPlugin | null {
    const entry = this.plugins.get(name);
    if (entry && entry.type === 'provider') {
      return entry.plugin as AIProviderPlugin;
    }
    return null;
  }

  /**
   * 获取所有已注册的 AI Provider
   * @returns 所有 Provider 实例数组
   */
  getAllProviders(): AIProviderPlugin[] {
    const providers: AIProviderPlugin[] = [];
    for (const entry of this.plugins.values()) {
      if (entry.type === 'provider') {
        providers.push(entry.plugin as AIProviderPlugin);
      }
    }
    return providers;
  }
}

// 使用全局变量存储单例，确保 jiti 动态加载的模块也能访问同一个实例
declare global {
  // eslint-disable-next-line no-var
  var __flashclaw_plugin_manager: PluginManager | undefined;
}

function getPluginManager(): PluginManager {
  if (!global.__flashclaw_plugin_manager) {
    global.__flashclaw_plugin_manager = new PluginManager();
  }
  return global.__flashclaw_plugin_manager;
}

// 导出单例（通过全局变量）
export const pluginManager = getPluginManager();

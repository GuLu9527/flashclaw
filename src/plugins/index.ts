/**
 * FlashClaw 插件系统
 * 统一导出入口
 */

// 类型定义
export {
  PluginConfig,
  ToolContext,
  ToolResult,
  Message,
  MessageHandler,
  ToolSchema,
  PluginManifest,
  ToolPlugin,
  ChannelPlugin,
  Plugin,
  isToolPlugin,
  isChannelPlugin,
} from './types.js';

// 插件管理器
export { PluginManager, pluginManager } from './manager.js';

// 热加载器
export {
  loadFromDir,
  loadPlugin,
  reloadPlugin,
  watchPlugins,
  stopWatching,
  getLoadedPaths,
} from './loader.js';

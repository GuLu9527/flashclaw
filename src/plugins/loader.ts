/**
 * FlashClaw 插件热加载器
 * 支持动态加载、重载和监听插件目录变化
 */

import { promises as fs, watch, FSWatcher } from 'fs';
import { join, resolve } from 'path';
import { createHash } from 'crypto';
import { createJiti } from 'jiti';
import {
  Plugin,
  PluginManifest,
  PluginConfig,
  isToolPlugin,
  isChannelPlugin,
} from './types.js';
import { pluginManager } from './manager.js';
import { createLogger } from '../logger.js';

const logger = createLogger('PluginLoader');

// 创建 jiti 实例用于加载 TS 文件
const jiti = createJiti(import.meta.url, {
  interopDefault: true,
});

// 已加载插件的路径映射
const loadedPaths = new Map<string, string>();

// 插件文件内容的 hash 缓存（用于检测真正的变化）
const contentHashes = new Map<string, string>();

// 目录监听器
let watcher: FSWatcher | null = null;

/**
 * 计算文件内容的 hash
 */
async function getFileHash(filePath: string): Promise<string | null> {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    return createHash('md5').update(content).digest('hex');
  } catch {
    return null;
  }
}

/**
 * 计算插件目录的 hash（主要文件）
 */
async function getPluginHash(pluginPath: string): Promise<string> {
  const hashes: string[] = [];
  
  // 检查主要文件
  const files = ['plugin.json', 'index.ts', 'index.js'];
  for (const file of files) {
    const hash = await getFileHash(join(pluginPath, file));
    if (hash) hashes.push(hash);
  }
  
  return createHash('md5').update(hashes.join('')).digest('hex');
}

/**
 * 从目录加载所有插件（按依赖顺序）
 * @param pluginsDir 插件目录路径
 * @returns 加载成功的插件名称列表
 */
export async function loadFromDir(pluginsDir: string): Promise<string[]> {
  const loaded: string[] = [];
  const dir = resolve(pluginsDir);

  // 检查目录是否存在
  try {
    await fs.access(dir);
  } catch {
    logger.warn({ dir }, '插件目录不存在');
    return loaded;
  }

  // 读取目录内容
  const entries = await fs.readdir(dir, { withFileTypes: true });

  // 第一遍：收集所有插件的清单信息
  const manifests = new Map<string, { path: string; manifest: PluginManifest }>();
  
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const pluginPath = join(dir, entry.name);
    const manifestPath = join(pluginPath, 'plugin.json');
    
    try {
      const content = await fs.readFile(manifestPath, 'utf-8');
      const manifest = JSON.parse(content) as PluginManifest;
      if (manifest.name) {
        manifests.set(manifest.name, { path: pluginPath, manifest });
      }
    } catch {
      // 忽略无效插件
      logger.debug({ plugin: entry.name }, '跳过无效插件目录');
    }
  }

  // 拓扑排序：按依赖顺序排列插件
  const sortedNames = topologicalSort(manifests);
  
  logger.debug({ order: sortedNames }, '插件加载顺序');

  // 按顺序加载插件
  for (const name of sortedNames) {
    const info = manifests.get(name);
    if (!info) continue;

    try {
      const loadedName = await loadPlugin(info.path);
      if (loadedName) loaded.push(loadedName);
    } catch (err) {
      logger.error({ plugin: name, err }, '加载插件失败');
    }
  }

  logger.info({ dir, count: loaded.length }, '⚡ 插件加载完成');
  return loaded;
}

/**
 * 拓扑排序：按依赖顺序排列插件
 * 依赖的插件先加载
 */
function topologicalSort(
  manifests: Map<string, { path: string; manifest: PluginManifest }>
): string[] {
  const result: string[] = [];
  const visited = new Set<string>();
  const visiting = new Set<string>(); // 检测循环依赖

  function visit(name: string) {
    if (visited.has(name)) return;
    if (visiting.has(name)) {
      logger.warn({ plugin: name }, '检测到循环依赖，跳过');
      return;
    }

    visiting.add(name);

    const info = manifests.get(name);
    if (info?.manifest.dependencies) {
      for (const dep of info.manifest.dependencies) {
        if (manifests.has(dep)) {
          visit(dep);
        } else {
          logger.warn({ plugin: name, dependency: dep }, '依赖插件不存在');
        }
      }
    }

    visiting.delete(name);
    visited.add(name);
    result.push(name);
  }

  for (const name of manifests.keys()) {
    visit(name);
  }

  return result;
}

/**
 * 加载单个插件
 * @param pluginPath 插件目录路径
 * @returns 插件名称，失败返回 null
 */
export async function loadPlugin(pluginPath: string): Promise<string | null> {
  const absPath = resolve(pluginPath);
  const manifestPath = join(absPath, 'plugin.json');

  // 读取清单文件
  let manifest: PluginManifest;
  try {
    const content = await fs.readFile(manifestPath, 'utf-8');
    manifest = JSON.parse(content);
  } catch {
    logger.warn({ path: manifestPath }, '无法读取 plugin.json');
    return null;
  }

  // 验证清单
  if (!manifest.name || !manifest.main || !manifest.type) {
    logger.warn({ plugin: manifest.name || absPath }, '插件清单不完整');
    return null;
  }

  // 构建配置
  const config = buildConfig(manifest);

  // 动态导入插件模块
  const mainPath = join(absPath, manifest.main);
  
  let pluginModule: { default?: Plugin; create?: () => Plugin };
  try {
    // 优先尝试加载 TS 文件
    const tsPath = mainPath.replace(/\.js$/, '.ts');
    try {
      pluginModule = await jiti.import(tsPath) as typeof pluginModule;
    } catch {
      // 如果 TS 不存在，尝试 JS
      pluginModule = await jiti.import(mainPath) as typeof pluginModule;
    }
  } catch (err) {
    logger.error({ path: mainPath, err }, '导入插件模块失败');
    return null;
  }

  // 获取插件实例
  const plugin = pluginModule.default || pluginModule.create?.();
  if (!plugin) {
    logger.warn({ plugin: manifest.name }, '插件模块没有导出 default 或 create');
    return null;
  }

  // 初始化插件
  try {
    if (isToolPlugin(plugin) && plugin.init) {
      await plugin.init(config);
    } else if (isChannelPlugin(plugin)) {
      await plugin.init(config);
    }
  } catch (err) {
    logger.error({ plugin: manifest.name, err }, '插件初始化失败');
    return null;
  }

  // 注册到管理器
  if (!pluginManager.register(plugin)) {
    return null;
  }

  // 记录路径和 hash
  loadedPaths.set(plugin.name, absPath);
  const hash = await getPluginHash(absPath);
  contentHashes.set(plugin.name, hash);

  return plugin.name;
}

/**
 * 重新加载插件
 * @param name 插件名称
 * @returns 是否重载成功
 */
export async function reloadPlugin(name: string): Promise<boolean> {
  const pluginPath = loadedPaths.get(name);
  if (!pluginPath) {
    logger.warn({ plugin: name }, '找不到插件路径');
    return false;
  }

  // 获取旧插件
  const oldTool = pluginManager.getTool(name);
  const oldChannel = pluginManager.getChannel(name);
  const oldPlugin = oldTool || oldChannel;

  // 调用 reload 钩子（如果有）
  if (oldPlugin?.reload) {
    try {
      await oldPlugin.reload();
    } catch (err) {
      logger.warn({ plugin: name, err }, '调用 reload 钩子失败');
    }
  }

  // 卸载旧插件
  pluginManager.unregister(name);
  loadedPaths.delete(name);

  // 重新加载
  const newName = await loadPlugin(pluginPath);
  if (newName) {
    logger.info({ plugin: name }, '⚡ 插件已重载');
    return true;
  }

  logger.error({ plugin: name }, '插件重载失败');
  return false;
}

/**
 * 监听插件目录变化
 * @param dir 插件目录
 * @param onChange 变化回调
 */
export function watchPlugins(
  dir: string,
  onChange?: (event: 'add' | 'change' | 'remove', name: string) => void
): void {
  const absDir = resolve(dir);

  // 停止之前的监听
  stopWatching();

  logger.info({ dir: absDir }, '⚡ 开始监听插件目录');

  // 防抖定时器
  const debounceTimers = new Map<string, NodeJS.Timeout>();

  watcher = watch(absDir, { recursive: true }, (eventType, filename) => {
    if (!filename) return;

    // 只关注 plugin.json 和 .js/.ts 文件的变化
    if (!filename.endsWith('plugin.json') && 
        !filename.endsWith('.js') && 
        !filename.endsWith('.ts')) {
      return;
    }

    // 提取插件名称（第一级目录）
    const pluginName = filename.split(/[/\\]/)[0];
    if (!pluginName) return;

    // 防抖处理（500ms）
    const existingTimer = debounceTimers.get(pluginName);
    if (existingTimer) clearTimeout(existingTimer);

    debounceTimers.set(pluginName, setTimeout(async () => {
      debounceTimers.delete(pluginName);

      const pluginPath = join(absDir, pluginName);
      const isLoaded = loadedPaths.has(pluginName);

      // 检查插件目录是否还存在
      let exists = false;
      try {
        await fs.access(pluginPath);
        exists = true;
      } catch {}

      if (exists && isLoaded) {
        // 检查内容是否真的变化了
        const newHash = await getPluginHash(pluginPath);
        const oldHash = contentHashes.get(pluginName);
        
        if (newHash !== oldHash) {
          // 内容真的变了，重载
          await reloadPlugin(pluginName);
          onChange?.('change', pluginName);
        } else {
          // 内容没变（可能是 jiti 缓存或访问时间变化），忽略
          logger.debug({ plugin: pluginName }, '插件文件访问但内容未变，忽略');
        }
      } else if (exists && !isLoaded) {
        // 新插件，加载
        const name = await loadPlugin(pluginPath);
        if (name) onChange?.('add', name);
      } else if (!exists && isLoaded) {
        // 插件被删除，卸载
        pluginManager.unregister(pluginName);
        loadedPaths.delete(pluginName);
        onChange?.('remove', pluginName);
      }
    }, 500));
  });

  watcher.on('error', (err) => {
    logger.error({ err }, '插件目录监听错误');
  });
}

/**
 * 停止监听
 */
export function stopWatching(): void {
  if (watcher) {
    watcher.close();
    watcher = null;
    logger.info('⚡ 已停止监听插件目录');
  }
}

/**
 * 从清单构建配置
 */
function buildConfig(manifest: PluginManifest): PluginConfig {
  const config: PluginConfig = {};

  if (!manifest.config) return config;

  for (const [key, schema] of Object.entries(manifest.config)) {
    // 优先从环境变量读取
    if (schema.env && process.env[schema.env]) {
      config[key] = process.env[schema.env];
    } else if (schema.default !== undefined) {
      config[key] = schema.default;
    } else if (schema.required) {
      logger.warn({ plugin: manifest.name, config: key }, '缺少必需配置');
    }
  }

  return config;
}

/**
 * 获取已加载插件的路径
 */
export function getLoadedPaths(): Map<string, string> {
  return new Map(loadedPaths);
}

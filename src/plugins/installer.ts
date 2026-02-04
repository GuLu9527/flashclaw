/**
 * FlashClaw 插件安装器
 * 支持从 GitHub 下载、安装、卸载和更新插件
 */

import { promises as fs } from 'fs';
import { existsSync } from 'fs';
import { join, basename, dirname, resolve, sep, isAbsolute, normalize, relative } from 'path';
import { homedir, platform } from 'os';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { fileURLToPath } from 'url';

const execFileAsync = promisify(execFile);

// ============================================================================
// 代理支持
// ============================================================================

/**
 * 获取代理 URL
 * 支持环境变量: HTTPS_PROXY, HTTP_PROXY, https_proxy, http_proxy
 */
function getProxyUrl(): string | null {
  return process.env.HTTPS_PROXY || 
         process.env.HTTP_PROXY || 
         process.env.https_proxy || 
         process.env.http_proxy || 
         null;
}

/**
 * 使用系统命令下载文件（自动处理代理和重定向）
 * Windows 使用 PowerShell，Unix 使用 curl
 */
async function downloadFile(url: string, destPath: string): Promise<void> {
  const isWindows = platform() === 'win32';
  const proxyUrl = getProxyUrl();
  
  if (proxyUrl) {
    log.debug(`使用代理: ${proxyUrl}`);
  } else {
    log.debug('直接连接（无代理）');
  }
  
  try {
    if (isWindows) {
      const script = '& { param([string]$Url,[string]$OutFile,[string]$Proxy) ' +
        'if ($Proxy) { $proxyObj = New-Object System.Net.WebProxy($Proxy); [System.Net.WebRequest]::DefaultWebProxy = $proxyObj } ' +
        'Invoke-WebRequest -Uri $Url -OutFile $OutFile -UseBasicParsing }';
      await execFileAsync(
        'powershell',
        ['-NoProfile', '-NonInteractive', '-Command', script, url, destPath, proxyUrl ?? ''],
        { timeout: 120000, windowsHide: true }
      );
    } else {
      const args = ['-fL', '-o', destPath];
      if (proxyUrl) {
        args.push('-x', proxyUrl);
      }
      args.push(url);
      await execFileAsync('curl', args, { timeout: 120000 });
    }
  } catch (err) {
    throw new Error(`下载失败: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * 带代理支持的 fetch（用于小文件如 JSON）
 * 自动检测环境变量中的代理设置
 */
async function fetchWithProxy(url: string): Promise<{ ok: boolean; status: number; statusText: string; json: () => Promise<any>; text: () => Promise<string> }> {
  const proxyUrl = getProxyUrl();
  const isWindows = platform() === 'win32';
  
  if (!proxyUrl) {
    log.debug('直接连接（无代理）');
    const response = await fetch(url);
    return response;
  }
  
  log.debug(`使用代理: ${proxyUrl}`);
  
  // 使用系统命令获取内容
  try {
    let content: string;
    
    if (isWindows) {
      const script = '& { param([string]$Url,[string]$Proxy) ' +
        '$proxyObj = New-Object System.Net.WebProxy($Proxy); ' +
        '[System.Net.WebRequest]::DefaultWebProxy = $proxyObj; ' +
        '(Invoke-WebRequest -Uri $Url -UseBasicParsing).Content }';
      const { stdout } = await execFileAsync(
        'powershell',
        ['-NoProfile', '-NonInteractive', '-Command', script, url, proxyUrl],
        { timeout: 30000, windowsHide: true }
      );
      content = stdout ?? '';
    } else {
      const args = ['-fsSL', '-x', proxyUrl, url];
      const { stdout } = await execFileAsync('curl', args, { timeout: 30000 });
      content = stdout ?? '';
    }
    
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => JSON.parse(content),
      text: async () => content,
    };
  } catch (err) {
    // 代理失败时回退到直接连接
    log.warn(`代理请求失败，尝试直接连接...`);
    const response = await fetch(url);
    return response;
  }
}

// ============================================================================
// 输入校验
// ============================================================================

const PLUGIN_NAME_PATTERN = /^[a-z0-9][a-z0-9-_]{0,63}$/;

function isValidPluginName(name: string): boolean {
  return PLUGIN_NAME_PATTERN.test(name);
}

function resolvePluginDir(baseDir: string, name: string): string | null {
  if (!isValidPluginName(name)) return null;
  const base = resolve(baseDir);
  const target = resolve(baseDir, name);
  const relativePath = relative(base, target);
  if (relativePath.startsWith('..') || isAbsolute(relativePath)) return null;
  return target;
}

function isSafeRelativePath(value: string): boolean {
  if (!value || typeof value !== 'string') return false;
  if (isAbsolute(value)) return false;
  const segments = value.split(/[\\/]+/);
  if (segments.some((segment) => segment === '..')) {
    return false;
  }
  const normalized = normalize(value);
  if (normalized === '..' || normalized.startsWith(`..${sep}`) || normalized.includes(`${sep}..${sep}`)) {
    return false;
  }
  return true;
}

// ES 模块中获取 __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ============================================================================
// 颜色输出工具
// ============================================================================

const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
};

const log = {
  info: (msg: string) => console.log(`${colors.cyan}[INFO]${colors.reset} ${msg}`),
  success: (msg: string) => console.log(`${colors.green}[SUCCESS]${colors.reset} ${msg}`),
  warn: (msg: string) => console.log(`${colors.yellow}[WARN]${colors.reset} ${msg}`),
  error: (msg: string) => console.log(`${colors.red}[ERROR]${colors.reset} ${msg}`),
  debug: (msg: string) => console.log(`${colors.dim}[DEBUG]${colors.reset} ${msg}`),
  step: (msg: string) => console.log(`${colors.magenta}[STEP]${colors.reset} ${msg}`),
};

// ============================================================================
// 类型定义
// ============================================================================

/**
 * 插件信息（来自注册表）
 */
export interface PluginInfo {
  name: string;
  description: string;
  type: 'tool' | 'channel' | 'system';
  version: string;
  author: string;
  tags: string[];
}

/**
 * 插件注册表
 */
export interface Registry {
  $schema?: string;
  version: string;
  updated: string;
  officialRepo?: string;       // 官方仓库 (如 GuLu9527/flashclaw)
  officialPluginsPath?: string; // 官方插件在仓库中的路径 (如 community-plugins)
  plugins: Record<string, PluginInfo>;
}

function validateRegistry(data: unknown): Registry {
  if (!data || typeof data !== 'object') {
    throw new Error('注册表格式错误');
  }

  const registry = data as Registry;
  if (!registry.plugins || typeof registry.plugins !== 'object') {
    throw new Error('注册表缺少 plugins 字段');
  }

  for (const [key, plugin] of Object.entries(registry.plugins)) {
    if (!plugin || typeof plugin !== 'object') {
      throw new Error(`插件定义无效: ${key}`);
    }
    const p = plugin as PluginInfo;
    if (!p.name || !p.description || !p.type || !p.version || !p.author) {
      throw new Error(`插件字段不完整: ${key}`);
    }
    if (!Array.isArray(p.tags)) {
      throw new Error(`插件 tags 必须为数组: ${key}`);
    }
  }

  return registry;
}

/**
 * 已安装插件的元数据
 */
export interface InstalledPluginMeta {
  name: string;
  version: string;
  installedAt: string;
  source: 'registry' | 'local' | 'github';
  repo?: string;
}

// ============================================================================
// 路径工具
// ============================================================================

/**
 * 获取 FlashClaw 主目录
 */
function getFlashClawHome(): string {
  return process.env.FLASHCLAW_HOME || join(homedir(), '.flashclaw');
}

/**
 * 获取用户插件安装目录
 */
export function getUserPluginsDir(): string {
  return join(getFlashClawHome(), 'plugins');
}

/**
 * 获取本地注册表路径（项目内置）
 */
function getLocalRegistryPath(): string {
  // 相对于此文件的路径
  return join(__dirname, '..', '..', 'plugins', 'registry.json');
}

/**
 * 获取缓存的远程注册表路径
 */
function getCachedRegistryPath(): string {
  return join(getFlashClawHome(), 'cache', 'registry.json');
}

/**
 * 获取已安装插件元数据文件路径
 */
function getInstalledMetaPath(): string {
  return join(getFlashClawHome(), 'plugins', '.installed.json');
}

/**
 * 确保目录存在
 */
async function ensureDir(dir: string): Promise<void> {
  if (!existsSync(dir)) {
    await fs.mkdir(dir, { recursive: true });
  }
}

// ============================================================================
// 注册表管理
// ============================================================================

// GitHub API 地址
const GITHUB_API_BASE = 'https://api.github.com/repos';
const OFFICIAL_REPO = 'GuLu9527/flashclaw';
const COMMUNITY_PLUGINS_PATH = 'community-plugins';

/**
 * GitHub 目录项
 */
interface GitHubContentItem {
  name: string;
  path: string;
  type: 'file' | 'dir';
  download_url?: string;
}

/**
 * 从 GitHub API 获取可用插件列表
 * 直接读取 community-plugins 目录结构
 */
async function fetchAvailablePluginsFromGitHub(): Promise<PluginInfo[]> {
  const apiUrl = `${GITHUB_API_BASE}/${OFFICIAL_REPO}/contents/${COMMUNITY_PLUGINS_PATH}`;
  log.debug(`获取插件列表: ${apiUrl}`);
  
  const response = await fetchWithProxy(apiUrl);
  if (!response.ok) {
    throw new Error(`GitHub API 请求失败: HTTP ${response.status}`);
  }
  
  const items: GitHubContentItem[] = await response.json();
  const plugins: PluginInfo[] = [];
  
  // 过滤出目录（每个目录就是一个插件）
  const pluginDirs = items.filter(item => item.type === 'dir');
  
  // 并行获取每个插件的 plugin.json
  const pluginPromises = pluginDirs.map(async (dir) => {
    try {
      const pluginJsonUrl = `https://raw.githubusercontent.com/${OFFICIAL_REPO}/main/${COMMUNITY_PLUGINS_PATH}/${dir.name}/plugin.json`;
      const pluginResponse = await fetchWithProxy(pluginJsonUrl);
      
      if (pluginResponse.ok) {
        const manifest = await pluginResponse.json();
        return {
          name: manifest.name || dir.name,
          description: manifest.description || '无描述',
          type: manifest.type || 'tool',
          version: manifest.version || '1.0.0',
          author: manifest.author || 'unknown',
          tags: manifest.tags || [],
        } as PluginInfo;
      }
    } catch (err) {
      log.debug(`获取插件 ${dir.name} 信息失败: ${err instanceof Error ? err.message : String(err)}`);
    }
    return null;
  });
  
  const results = await Promise.all(pluginPromises);
  for (const plugin of results) {
    if (plugin) {
      plugins.push(plugin);
    }
  }
  
  return plugins;
}

/**
 * 获取可用插件缓存路径
 */
function getPluginsCachePath(): string {
  return join(getFlashClawHome(), 'cache', 'available-plugins.json');
}

/**
 * 缓存可用插件列表
 */
async function cacheAvailablePlugins(plugins: PluginInfo[]): Promise<void> {
  const cacheDir = join(getFlashClawHome(), 'cache');
  await ensureDir(cacheDir);
  const cachePath = getPluginsCachePath();
  const cacheData = {
    updated: new Date().toISOString(),
    plugins,
  };
  await fs.writeFile(cachePath, JSON.stringify(cacheData, null, 2), 'utf-8');
  log.debug(`插件列表已缓存到 ${cachePath}`);
}

/**
 * 读取缓存的插件列表
 */
async function readCachedPlugins(): Promise<PluginInfo[] | null> {
  const cachePath = getPluginsCachePath();
  try {
    if (existsSync(cachePath)) {
      const content = await fs.readFile(cachePath, 'utf-8');
      const data = JSON.parse(content);
      // 检查缓存是否过期（1小时）
      const updated = new Date(data.updated);
      const now = new Date();
      const hoursDiff = (now.getTime() - updated.getTime()) / (1000 * 60 * 60);
      if (hoursDiff < 1 && Array.isArray(data.plugins)) {
        log.debug('使用缓存的插件列表');
        return data.plugins;
      }
    }
  } catch {
    // 忽略缓存读取错误
  }
  return null;
}

/**
 * 获取插件注册表（兼容旧接口）
 * 现在从 GitHub API 动态获取
 */
export async function getRegistry(forceRemote = false): Promise<Registry> {
  // 获取可用插件列表
  let plugins: PluginInfo[];
  
  if (!forceRemote) {
    const cached = await readCachedPlugins();
    if (cached) {
      plugins = cached;
    } else {
      plugins = await fetchAvailablePluginsFromGitHub();
      await cacheAvailablePlugins(plugins);
    }
  } else {
    log.info('正在从 GitHub 获取最新插件列表...');
    plugins = await fetchAvailablePluginsFromGitHub();
    await cacheAvailablePlugins(plugins);
    log.success('插件列表获取成功');
  }
  
  // 转换为 Registry 格式
  const pluginsMap: Record<string, PluginInfo> = {};
  for (const plugin of plugins) {
    pluginsMap[plugin.name] = plugin;
  }
  
  return {
    version: new Date().toISOString().split('T')[0],
    updated: new Date().toISOString(),
    officialRepo: OFFICIAL_REPO,
    officialPluginsPath: COMMUNITY_PLUGINS_PATH,
    plugins: pluginsMap,
  };
}

/**
 * 更新注册表（从远程）
 */
export async function updateRegistry(): Promise<Registry> {
  return getRegistry(true);
}

// ============================================================================
// 插件下载
// ============================================================================

/**
 * 从 GitHub 下载插件
 * 下载仓库的 ZIP 文件并解压
 * 
 * @param repo GitHub 仓库路径 (如 "owner/repo")
 * @param targetDir 目标目录
 * @param branch 分支名 (默认 "main")
 */
export async function downloadPlugin(
  repo: string,
  targetDir: string,
  branch = 'main'
): Promise<void> {
  const repoPattern = /^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/;
  if (!repoPattern.test(repo)) {
    throw new Error(`仓库格式不合法: ${repo}`);
  }
  const branchPattern = /^[a-zA-Z0-9._/-]+$/;
  if (!branchPattern.test(branch) || branch.includes('..')) {
    throw new Error(`分支名不合法: ${branch}`);
  }
  const zipUrl = `https://github.com/${repo}/archive/refs/heads/${branch}.zip`;
  const tempDir = join(getFlashClawHome(), 'temp');
  const tempZip = join(tempDir, `${repo.replace('/', '-')}-${branch}.zip`);
  const extractDir = join(tempDir, 'extract');

  log.step(`下载插件: ${repo}`);
  log.debug(`ZIP URL: ${zipUrl}`);

  // 确保临时目录存在
  await ensureDir(tempDir);

  try {
    // 下载 ZIP 文件（使用系统命令，自动处理代理和重定向）
    log.info('正在下载 ZIP 文件...');
    await downloadFile(zipUrl, tempZip);
    log.debug(`ZIP 文件已保存: ${tempZip}`);

    // 确保目标目录存在
    await ensureDir(targetDir);

    // 清理并创建解压目录
    if (existsSync(extractDir)) {
      await fs.rm(extractDir, { recursive: true, force: true });
    }
    await ensureDir(extractDir);

    // 解压 ZIP 文件 - 使用系统命令
    log.info('正在解压...');
    await extractZip(tempZip, extractDir);

    // 找到解压后的目录（GitHub ZIP 包含一个以 repo-branch 命名的根目录）
    const entries = await fs.readdir(extractDir, { withFileTypes: true });
    const directories = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
    if (directories.length === 0) {
      throw new Error('解压后找不到插件目录');
    }

    const repoName = basename(repo);
    const extractedFolder = directories.find((dir) =>
      dir.toLowerCase().startsWith(repoName.toLowerCase()) ||
      dir.includes(repoName)
    ) || directories[0];

    const sourcePath = join(extractDir, extractedFolder);

    // 复制文件到目标目录
    log.info('正在安装文件...');
    await copyDir(sourcePath, targetDir);

    log.success(`插件已下载到: ${targetDir}`);
  } finally {
    // 清理临时文件
    try {
      if (existsSync(tempZip)) {
        await fs.unlink(tempZip);
      }
      if (existsSync(extractDir)) {
        await fs.rm(extractDir, { recursive: true, force: true });
      }
    } catch {
      // 忽略清理错误
    }
  }
}

/**
 * 解压 ZIP 文件
 * Windows 使用 PowerShell，Unix 使用 unzip
 */
async function extractZip(zipPath: string, destDir: string): Promise<void> {
  const isWindows = platform() === 'win32';

  try {
    if (isWindows) {
      const script = '& { param([string]$Zip,[string]$Dest) Expand-Archive -Path $Zip -DestinationPath $Dest -Force }';
      await execFileAsync(
        'powershell',
        ['-NoProfile', '-NonInteractive', '-Command', script, zipPath, destDir],
        { timeout: 120000, windowsHide: true }
      );
    } else {
      await execFileAsync('unzip', ['-o', zipPath, '-d', destDir], { timeout: 120000 });
    }
  } catch (err) {
    // 如果系统命令失败，尝试使用 tar 命令（Windows 10+ 支持）
    try {
      await execFileAsync('tar', ['-xf', zipPath, '-C', destDir], { timeout: 120000 });
    } catch {
      throw new Error(`解压失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

/**
 * 递归复制目录
 */
async function copyDir(src: string, dest: string): Promise<void> {
  await ensureDir(dest);
  const entries = await fs.readdir(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = join(src, entry.name);
    const destPath = join(dest, entry.name);

    if (entry.isDirectory()) {
      await copyDir(srcPath, destPath);
    } else {
      await fs.copyFile(srcPath, destPath);
    }
  }
}

// ============================================================================
// 插件验证
// ============================================================================

/**
 * 验证插件结构
 * 检查必要文件是否存在：plugin.json 或 package.json, index.ts 或 index.js
 * 
 * @param pluginDir 插件目录
 * @returns 验证结果
 */
export async function validatePlugin(pluginDir: string): Promise<{
  valid: boolean;
  errors: string[];
  manifest?: {
    name: string;
    version: string;
    description?: string;
    type?: string;
  };
}> {
  const errors: string[] = [];
  let manifest: any = null;

  // 检查 plugin.json 或 package.json
  const pluginJsonPath = join(pluginDir, 'plugin.json');
  const packageJsonPath = join(pluginDir, 'package.json');

  if (existsSync(pluginJsonPath)) {
    try {
      const content = await fs.readFile(pluginJsonPath, 'utf-8');
      manifest = JSON.parse(content);
      log.debug('找到 plugin.json');

      // 验证必要字段
      if (!manifest.name) errors.push('plugin.json 缺少 name 字段');
      if (!manifest.version) errors.push('plugin.json 缺少 version 字段');
      if (!manifest.main) errors.push('plugin.json 缺少 main 字段');
      if (!manifest.type) errors.push('plugin.json 缺少 type 字段');
    } catch (err) {
      errors.push(`plugin.json 解析失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  } else if (existsSync(packageJsonPath)) {
    try {
      const content = await fs.readFile(packageJsonPath, 'utf-8');
      manifest = JSON.parse(content);
      log.debug('找到 package.json');

      // 验证必要字段
      if (!manifest.name) errors.push('package.json 缺少 name 字段');
      if (!manifest.version) errors.push('package.json 缺少 version 字段');
    } catch (err) {
      errors.push(`package.json 解析失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  } else {
    errors.push('缺少 plugin.json 或 package.json');
  }

  // 检查入口文件
  const indexTs = join(pluginDir, 'index.ts');
  const indexJs = join(pluginDir, 'index.js');
  const srcIndexTs = join(pluginDir, 'src', 'index.ts');
  const srcIndexJs = join(pluginDir, 'src', 'index.js');

  const hasEntryFile = 
    existsSync(indexTs) || 
    existsSync(indexJs) || 
    existsSync(srcIndexTs) || 
    existsSync(srcIndexJs);

  if (!hasEntryFile && manifest?.main) {
    if (!isSafeRelativePath(manifest.main)) {
      errors.push(`入口文件路径不安全: ${manifest.main}`);
    } else {
      // 检查 manifest 中指定的 main 文件
      const mainPath = join(pluginDir, manifest.main);
      const mainTsPath = mainPath.replace(/\.js$/, '.ts');
      if (!existsSync(mainPath) && !existsSync(mainTsPath)) {
        errors.push(`入口文件不存在: ${manifest.main}`);
      }
    }
  } else if (!hasEntryFile && !manifest?.main) {
    errors.push('缺少入口文件 (index.ts/index.js)');
  }

  return {
    valid: errors.length === 0,
    errors,
    manifest: manifest ? {
      name: manifest.name,
      version: manifest.version,
      description: manifest.description,
      type: manifest.type,
    } : undefined,
  };
}

// ============================================================================
// 已安装插件管理
// ============================================================================

/**
 * 读取已安装插件元数据
 */
async function readInstalledMeta(): Promise<Record<string, InstalledPluginMeta>> {
  const metaPath = getInstalledMetaPath();
  try {
    if (existsSync(metaPath)) {
      const content = await fs.readFile(metaPath, 'utf-8');
      return JSON.parse(content);
    }
  } catch {
    // 忽略读取错误
  }
  return {};
}

/**
 * 保存已安装插件元数据
 */
async function saveInstalledMeta(meta: Record<string, InstalledPluginMeta>): Promise<void> {
  const metaPath = getInstalledMetaPath();
  const dir = join(getFlashClawHome(), 'plugins');
  await ensureDir(dir);
  await fs.writeFile(metaPath, JSON.stringify(meta, null, 2), 'utf-8');
}

// ============================================================================
// 主要功能
// ============================================================================

/**
 * 从官方仓库安装插件（只提取特定目录）
 */
async function downloadOfficialPlugin(
  registry: Registry,
  pluginName: string,
  targetDir: string
): Promise<void> {
  const repo = registry.officialRepo || 'GuLu9527/flashclaw';
  const pluginsPath = registry.officialPluginsPath || 'community-plugins';
  if (!isSafeRelativePath(pluginsPath)) {
    throw new Error(`官方插件目录路径不安全: ${pluginsPath}`);
  }
  
  log.step(`从官方仓库安装: ${repo}/${pluginsPath}/${pluginName}`);
  
  const tempDir = join(getFlashClawHome(), 'temp');
  const tempZip = join(tempDir, `official-repo.zip`);
  const extractDir = join(tempDir, 'extract-official');
  
  await ensureDir(tempDir);
  
  try {
    // 下载主仓库 ZIP
    const zipUrl = `https://github.com/${repo}/archive/refs/heads/main.zip`;
    log.debug(`ZIP URL: ${zipUrl}`);
    log.info('正在下载官方仓库...');
    await downloadFile(zipUrl, tempZip);
    
    // 解压
    if (existsSync(extractDir)) {
      await fs.rm(extractDir, { recursive: true, force: true });
    }
    await ensureDir(extractDir);
    log.info('正在解压...');
    await extractZip(tempZip, extractDir);
    
    // 找到解压后的根目录
    const entries = await fs.readdir(extractDir, { withFileTypes: true });
    const rootEntry = entries.find((entry) => entry.isDirectory());
    if (!rootEntry) {
      throw new Error('解压后找不到仓库根目录');
    }
    const repoRoot = rootEntry.name; // 通常是 flashclaw-main

    // 定位插件目录
    const pluginsRoot = resolve(extractDir, repoRoot, pluginsPath);
    const pluginSourceDir = resolve(pluginsRoot, pluginName);
    if (!pluginSourceDir.startsWith(pluginsRoot + sep)) {
      throw new Error(`插件路径不安全: ${pluginsPath}/${pluginName}`);
    }
    
    if (!existsSync(pluginSourceDir)) {
      throw new Error(`插件 "${pluginName}" 在官方仓库中不存在 (路径: ${pluginsPath}/${pluginName})`);
    }
    
    // 复制插件到目标目录
    log.info('正在安装插件...');
    await ensureDir(targetDir);
    await copyDir(pluginSourceDir, targetDir);
    
    log.success(`插件已安装到: ${targetDir}`);
  } finally {
    // 清理
    try {
      if (existsSync(tempZip)) await fs.unlink(tempZip);
      if (existsSync(extractDir)) await fs.rm(extractDir, { recursive: true, force: true });
    } catch { /* ignore */ }
  }
}

/**
 * 安装插件
 * 直接从 community-plugins 目录下载，无需预先检查注册表
 * 
 * @param name 插件名称
 * @returns 是否安装成功
 */
export async function installPlugin(name: string): Promise<boolean> {
  log.info(`准备安装插件: ${name}`);

  const pluginsDir = getUserPluginsDir();
  await ensureDir(pluginsDir);

  if (!isValidPluginName(name)) {
    log.error(`插件名称不合法: ${name}`);
    log.info('插件名称只能包含小写字母、数字、- 或 _');
    return false;
  }

  const targetDir = resolvePluginDir(pluginsDir, name);
  if (!targetDir) {
    log.error(`插件名称不合法: ${name}`);
    return false;
  }

  // 检查是否已安装
  if (existsSync(targetDir)) {
    log.warn(`插件 "${name}" 已安装，将覆盖安装`);
    await fs.rm(targetDir, { recursive: true, force: true });
  }

  // 构建默认 Registry 结构用于下载
  const registry: Registry = {
    version: '1.0.0',
    updated: new Date().toISOString(),
    officialRepo: OFFICIAL_REPO,
    officialPluginsPath: COMMUNITY_PLUGINS_PATH,
    plugins: {},
  };

  try {
    // 从官方仓库安装（直接尝试下载，如果不存在会报错）
    await downloadOfficialPlugin(registry, name, targetDir);

    // 验证插件
    log.step('验证插件结构...');
    const validation = await validatePlugin(targetDir);
    if (!validation.valid) {
      log.error('插件验证失败:');
      validation.errors.forEach(e => log.error(`  - ${e}`));
      // 回滚：删除已下载的文件
      await fs.rm(targetDir, { recursive: true, force: true });
      return false;
    }

    // 保存安装元数据
    const meta = await readInstalledMeta();
    meta[name] = {
      name: name,
      version: validation.manifest?.version || '1.0.0',
      installedAt: new Date().toISOString(),
      source: 'registry',
      repo: `${OFFICIAL_REPO}/${COMMUNITY_PLUGINS_PATH}/${name}`,
    };
    await saveInstalledMeta(meta);

    log.success(`插件 "${name}" 安装成功!`);
    log.info(`安装位置: ${targetDir}`);
    log.info('提示: 重启 FlashClaw 以加载新插件');

    return true;
  } catch (err) {
    log.error(`安装失败: ${err instanceof Error ? err.message : String(err)}`);
    // 回滚：删除已下载的文件
    try {
      if (existsSync(targetDir)) {
        await fs.rm(targetDir, { recursive: true, force: true });
      }
    } catch {
      // 忽略清理错误
    }
    return false;
  }
}

/**
 * 卸载插件
 * 
 * @param name 插件名称
 * @returns 是否卸载成功
 */
export async function uninstallPlugin(name: string): Promise<boolean> {
  log.info(`准备卸载插件: ${name}`);

  const pluginsDir = getUserPluginsDir();
  const targetDir = resolvePluginDir(pluginsDir, name);
  if (!targetDir) {
    log.error(`插件名称不合法: ${name}`);
    return false;
  }

  if (!existsSync(targetDir)) {
    log.error(`插件 "${name}" 未安装`);
    return false;
  }

  try {
    // 删除插件目录
    await fs.rm(targetDir, { recursive: true, force: true });

    // 更新安装元数据
    const meta = await readInstalledMeta();
    delete meta[name];
    await saveInstalledMeta(meta);

    log.success(`插件 "${name}" 已卸载`);
    log.info('提示: 重启 FlashClaw 以应用更改');

    return true;
  } catch (err) {
    log.error(`卸载失败: ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}

/**
 * 列出已安装插件
 * 
 * @returns 已安装插件列表
 */
export async function listInstalledPlugins(): Promise<InstalledPluginMeta[]> {
  const pluginsDir = getUserPluginsDir();

  if (!existsSync(pluginsDir)) {
    return [];
  }

  const installed: InstalledPluginMeta[] = [];
  const meta = await readInstalledMeta();

  // 扫描插件目录
  const entries = await fs.readdir(pluginsDir, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith('.')) continue;

    const pluginDir = join(pluginsDir, entry.name);
    const validation = await validatePlugin(pluginDir);

    if (validation.valid && validation.manifest) {
      const savedMeta = meta[entry.name];
      installed.push({
        name: validation.manifest.name,
        version: validation.manifest.version,
        installedAt: savedMeta?.installedAt || 'unknown',
        source: savedMeta?.source || 'local',
        repo: savedMeta?.repo,
      });
    }
  }

  return installed;
}

/**
 * 列出可用插件（注册表中的插件）
 * 
 * @returns 可用插件列表
 */
export async function listAvailablePlugins(): Promise<PluginInfo[]> {
  try {
    const registry = await getRegistry();
    return Object.values(registry.plugins);
  } catch (err) {
    log.error(`获取注册表失败: ${err instanceof Error ? err.message : String(err)}`);
    return [];
  }
}

/**
 * 更新插件
 * 
 * @param name 插件名称
 * @returns 是否更新成功
 */
export async function updatePlugin(name: string): Promise<boolean> {
  log.info(`准备更新插件: ${name}`);

  const pluginsDir = getUserPluginsDir();
  const targetDir = resolvePluginDir(pluginsDir, name);
  if (!targetDir) {
    log.error(`插件名称不合法: ${name}`);
    return false;
  }

  if (!existsSync(targetDir)) {
    log.error(`插件 "${name}" 未安装`);
    return false;
  }

  const meta = await readInstalledMeta();

  // 构建默认 Registry 结构用于下载
  const registry: Registry = {
    version: '1.0.0',
    updated: new Date().toISOString(),
    officialRepo: OFFICIAL_REPO,
    officialPluginsPath: COMMUNITY_PLUGINS_PATH,
    plugins: {},
  };

  const tempInstallDir = join(getFlashClawHome(), 'temp', `update-${name}-${Date.now()}`);
  const backupDir = join(getFlashClawHome(), 'backup', `${name}-${Date.now()}`);

  try {
    // 下载新版本到临时目录
    await downloadOfficialPlugin(registry, name, tempInstallDir);

    // 验证新版本
    const validation = await validatePlugin(tempInstallDir);
    if (!validation.valid) {
      log.error('新版本验证失败:');
      validation.errors.forEach((e) => log.error(`  - ${e}`));
      await fs.rm(tempInstallDir, { recursive: true, force: true });
      return false;
    }

    // 备份当前版本
    log.step('备份当前版本...');
    await ensureDir(backupDir);
    await copyDir(targetDir, backupDir);

    // 替换旧版本
    await fs.rm(targetDir, { recursive: true, force: true });
    try {
      await fs.rename(tempInstallDir, targetDir);
    } catch {
      await copyDir(tempInstallDir, targetDir);
      await fs.rm(tempInstallDir, { recursive: true, force: true });
    }

    // 更新元数据
    meta[name] = {
      name,
      version: validation.manifest?.version || '1.0.0',
      installedAt: new Date().toISOString(),
      source: 'registry',
      repo: `${OFFICIAL_REPO}/${COMMUNITY_PLUGINS_PATH}/${name}`,
    };
    await saveInstalledMeta(meta);

    // 清理备份
    await fs.rm(backupDir, { recursive: true, force: true });

    log.success(`插件 "${name}" 更新成功!`);
    log.info(`新版本: ${validation.manifest?.version || 'unknown'}`);
    log.info('提示: 重启 FlashClaw 以应用更新');

    return true;
  } catch (err) {
    log.error(`更新失败: ${err instanceof Error ? err.message : String(err)}`);

    // 尝试回滚
    try {
      if (existsSync(backupDir)) {
        if (existsSync(targetDir)) {
          await fs.rm(targetDir, { recursive: true, force: true });
        }
        await copyDir(backupDir, targetDir);
        await fs.rm(backupDir, { recursive: true, force: true });
        log.info('已回滚到之前版本');
      }
    } catch {
      log.error('回滚失败，请手动恢复');
    }

    // 清理临时目录
    try {
      if (existsSync(tempInstallDir)) {
        await fs.rm(tempInstallDir, { recursive: true, force: true });
      }
    } catch {
      // ignore
    }

    return false;
  }
}

/**
 * 显示插件详情
 * 
 * @param name 插件名称
 */
export async function showPluginInfo(name: string): Promise<void> {
  // 检查注册表
  try {
    const registry = await getRegistry();
    const pluginInfo = registry.plugins[name];

    if (pluginInfo) {
      console.log('');
      console.log(`${colors.bright}${colors.cyan}插件信息${colors.reset}`);
      console.log(`${colors.bright}名称:${colors.reset}     ${pluginInfo.name}`);
      console.log(`${colors.bright}版本:${colors.reset}     ${pluginInfo.version}`);
      console.log(`${colors.bright}作者:${colors.reset}     ${pluginInfo.author}`);
      console.log(`${colors.bright}类型:${colors.reset}     ${pluginInfo.type}`);
      console.log(`${colors.bright}描述:${colors.reset}     ${pluginInfo.description}`);
      console.log(`${colors.bright}标签:${colors.reset}     ${pluginInfo.tags.join(', ')}`);
      console.log('');
      return;
    }
  } catch {
    // 忽略注册表错误
  }

  // 检查本地安装
  const pluginsDir = getUserPluginsDir();
  const targetDir = join(pluginsDir, name);

  if (existsSync(targetDir)) {
    const validation = await validatePlugin(targetDir);
    if (validation.valid && validation.manifest) {
      const meta = await readInstalledMeta();
      const savedMeta = meta[name];

      console.log('');
      console.log(`${colors.bright}${colors.cyan}已安装插件信息${colors.reset}`);
      console.log(`${colors.bright}名称:${colors.reset}     ${validation.manifest.name}`);
      console.log(`${colors.bright}版本:${colors.reset}     ${validation.manifest.version}`);
      console.log(`${colors.bright}类型:${colors.reset}     ${validation.manifest.type || 'unknown'}`);
      console.log(`${colors.bright}描述:${colors.reset}     ${validation.manifest.description || 'N/A'}`);
      console.log(`${colors.bright}安装时间:${colors.reset} ${savedMeta?.installedAt || 'unknown'}`);
      console.log(`${colors.bright}来源:${colors.reset}     ${savedMeta?.source || 'local'}`);
      if (savedMeta?.repo) {
        console.log(`${colors.bright}仓库:${colors.reset}     https://github.com/${savedMeta.repo}`);
      }
      console.log('');
      return;
    }
  }

  log.error(`找不到插件: ${name}`);
}

// ============================================================================
// 命令行辅助
// ============================================================================

/**
 * 列出插件（带格式化输出）
 */
export async function printPluginList(): Promise<void> {
  console.log('');
  console.log(`${colors.bright}${colors.cyan}=== 可用插件 ===${colors.reset}`);
  console.log('');

  const available = await listAvailablePlugins();
  const installed = await listInstalledPlugins();
  const installedNames = new Set(installed.map(p => p.name));

  if (available.length === 0) {
    log.warn('注册表中没有插件');
  } else {
    for (const plugin of available) {
      const isInstalled = installedNames.has(plugin.name);
      const status = isInstalled 
        ? `${colors.green}[已安装]${colors.reset}` 
        : `${colors.dim}[未安装]${colors.reset}`;
      
      console.log(`  ${colors.bright}${plugin.name}${colors.reset} ${status}`);
      console.log(`    ${colors.dim}${plugin.description}${colors.reset}`);
      console.log(`    ${colors.dim}版本: ${plugin.version} | 作者: ${plugin.author}${colors.reset}`);
      console.log('');
    }
  }

  console.log(`${colors.bright}${colors.cyan}=== 已安装插件 ===${colors.reset}`);
  console.log('');

  if (installed.length === 0) {
    log.info('暂无已安装的插件');
  } else {
    for (const plugin of installed) {
      console.log(`  ${colors.bright}${plugin.name}${colors.reset} v${plugin.version}`);
      console.log(`    ${colors.dim}安装时间: ${plugin.installedAt}${colors.reset}`);
      console.log(`    ${colors.dim}来源: ${plugin.source}${plugin.repo ? ` (${plugin.repo})` : ''}${colors.reset}`);
      console.log('');
    }
  }
}

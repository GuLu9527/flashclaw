#!/usr/bin/env node
/**
 * FlashClaw CLI - 闪电风格命令行入口
 * ⚡ 闪电龙虾 - 快如闪电的 AI 助手
 */

import { program } from 'commander';
import chalk from 'chalk';
import fs from 'fs';
import path from 'path';
import { spawn, execSync, ChildProcess } from 'child_process';
import { fileURLToPath } from 'url';
import readline from 'readline';
import { paths, ensureDirectories, getBuiltinPluginsDir } from './paths.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PACKAGE_ROOT = path.resolve(__dirname, '..');

// ==================== 常量 ====================
const VERSION = '1.0.0';
const ENV_EXAMPLE = path.join(PACKAGE_ROOT, '.env.example');

// ==================== 颜色方案 ====================
const lightning = chalk.yellow('⚡');
const success = chalk.green('✓');
const error = chalk.red('✗');
const info = chalk.cyan;
const warn = chalk.yellow;
const dim = chalk.gray;

// ==================== Banner ====================
function showBanner(): void {
  console.log(chalk.yellow(`
  ⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡
  
       ███████╗██╗      █████╗ ███████╗██╗  ██╗
       ██╔════╝██║     ██╔══██╗██╔════╝██║  ██║
       █████╗  ██║     ███████║███████╗███████║
       ██╔══╝  ██║     ██╔══██║╚════██║██╔══██║
       ██║     ███████╗██║  ██║███████║██║  ██║
       ╚═╝     ╚══════╝╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝
                    ██████╗██╗      █████╗ ██╗    ██╗
                   ██╔════╝██║     ██╔══██╗██║    ██║
                   ██║     ██║     ███████║██║ █╗ ██║
                   ██║     ██║     ██╔══██║██║███╗██║
                   ╚██████╗███████╗██║  ██║╚███╔███╔╝
                    ╚═════╝╚══════╝╚═╝  ╚═╝ ╚══╝╚══╝
  
  ${lightning} 闪电龙虾 - 快如闪电的 AI 助手
  
  ⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡
`));
}

// ==================== 工具函数 ====================

function ensureDataDir(): void {
  // 使用 paths 模块确保数据目录存在
  const dataDir = paths.data();
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
}

function getPid(): number | null {
  try {
    const pidFile = paths.pidFile();
    if (fs.existsSync(pidFile)) {
      const pid = parseInt(fs.readFileSync(pidFile, 'utf-8').trim(), 10);
      return isNaN(pid) ? null : pid;
    }
  } catch {
    // ignore
  }
  return null;
}

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function getServiceStatus(): { running: boolean; pid: number | null; uptime?: string } {
  const pid = getPid();
  if (pid && isProcessRunning(pid)) {
    // 尝试获取进程启动时间
    let uptime: string | undefined;
    try {
      if (process.platform === 'win32') {
        // Windows: 使用 wmic
        const output = execSync(`wmic process where processid=${pid} get creationdate`, { encoding: 'utf-8' });
        const match = output.match(/(\d{14})/);
        if (match) {
          const dateStr = match[1];
          const year = parseInt(dateStr.slice(0, 4));
          const month = parseInt(dateStr.slice(4, 6)) - 1;
          const day = parseInt(dateStr.slice(6, 8));
          const hour = parseInt(dateStr.slice(8, 10));
          const min = parseInt(dateStr.slice(10, 12));
          const sec = parseInt(dateStr.slice(12, 14));
          const startTime = new Date(year, month, day, hour, min, sec);
          const diff = Date.now() - startTime.getTime();
          uptime = formatUptime(diff);
        }
      } else {
        // Unix: 使用 ps
        const output = execSync(`ps -o etime= -p ${pid}`, { encoding: 'utf-8' }).trim();
        uptime = output;
      }
    } catch {
      // 无法获取运行时间
    }
    return { running: true, pid, uptime };
  }
  
  // PID 文件存在但进程不存在，清理
  if (pid) {
    try {
      fs.unlinkSync(paths.pidFile());
    } catch {
      // ignore
    }
  }
  
  return { running: false, pid: null };
}

function formatUptime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) {
    return `${days}天 ${hours % 24}小时`;
  } else if (hours > 0) {
    return `${hours}小时 ${minutes % 60}分钟`;
  } else if (minutes > 0) {
    return `${minutes}分钟 ${seconds % 60}秒`;
  } else {
    return `${seconds}秒`;
  }
}

function loadEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  const envFile = paths.env();
  try {
    if (fs.existsSync(envFile)) {
      const content = fs.readFileSync(envFile, 'utf-8');
      for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#')) {
          const eqIndex = trimmed.indexOf('=');
          if (eqIndex > 0) {
            const key = trimmed.slice(0, eqIndex).trim();
            const value = trimmed.slice(eqIndex + 1).trim();
            env[key] = value;
          }
        }
      }
    }
  } catch {
    // ignore
  }
  return env;
}

function saveEnv(env: Record<string, string>): void {
  const lines: string[] = [];
  const envFile = paths.env();
  
  // 保留原有注释和顺序
  try {
    if (fs.existsSync(envFile)) {
      const content = fs.readFileSync(envFile, 'utf-8');
      const existingKeys = new Set<string>();
      
      for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) {
          lines.push(line);
        } else {
          const eqIndex = trimmed.indexOf('=');
          if (eqIndex > 0) {
            const key = trimmed.slice(0, eqIndex).trim();
            existingKeys.add(key);
            if (key in env) {
              lines.push(`${key}=${env[key]}`);
            } else {
              lines.push(line);
            }
          }
        }
      }
      
      // 添加新的键
      for (const [key, value] of Object.entries(env)) {
        if (!existingKeys.has(key)) {
          lines.push(`${key}=${value}`);
        }
      }
    } else {
      for (const [key, value] of Object.entries(env)) {
        lines.push(`${key}=${value}`);
      }
    }
  } catch {
    for (const [key, value] of Object.entries(env)) {
      lines.push(`${key}=${value}`);
    }
  }
  
  fs.writeFileSync(envFile, lines.join('\n') + '\n');
}

// ==================== 交互式初始化 ====================

async function interactiveInit(): Promise<void> {
  showBanner();
  
  console.log(`${lightning} ${info('开始初始化 FlashClaw...')}\n`);
  
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  
  const question = (prompt: string): Promise<string> => {
    return new Promise((resolve) => {
      rl.question(prompt, (answer) => {
        resolve(answer.trim());
      });
    });
  };
  
  try {
    // 检查是否已有配置
    const existingEnv = loadEnv();
    const hasFeishu = existingEnv.FEISHU_APP_ID && existingEnv.FEISHU_APP_SECRET;
    const hasDingtalk = existingEnv.DINGTALK_APP_KEY && existingEnv.DINGTALK_APP_SECRET;
    
    if (hasFeishu || hasDingtalk) {
      console.log(`${warn('⚠')} 检测到已有配置:`);
      if (hasFeishu) console.log(`   ${success} 飞书已配置`);
      if (hasDingtalk) console.log(`   ${success} 钉钉已配置`);
      console.log('');
      
      const overwrite = await question(`${lightning} 是否重新配置? (y/N): `);
      if (overwrite.toLowerCase() !== 'y') {
        console.log(`\n${lightning} ${info('保留现有配置')}`);
        rl.close();
        return;
      }
    }
    
    // 选择平台
    console.log(`\n${lightning} ${info('选择要配置的消息平台:')}`);
    console.log(`   ${chalk.white('1.')} 飞书 (Feishu/Lark)`);
    console.log(`   ${chalk.white('2.')} 钉钉 (DingTalk)`);
    console.log(`   ${chalk.white('3.')} 两者都配置`);
    console.log('');
    
    const platform = await question(`${lightning} 请选择 (1/2/3): `);
    
    const env: Record<string, string> = { ...existingEnv };
    
    // 配置飞书
    if (platform === '1' || platform === '3') {
      console.log(`\n${lightning} ${info('配置飞书:')}`);
      console.log(dim('   获取方式: https://open.feishu.cn/app → 创建应用 → 凭证与基础信息\n'));
      
      const appId = await question(`   ${info('App ID')}: `);
      const appSecret = await question(`   ${info('App Secret')}: `);
      
      if (appId && appSecret) {
        env.FEISHU_APP_ID = appId;
        env.FEISHU_APP_SECRET = appSecret;
        console.log(`   ${success} 飞书配置完成`);
      } else {
        console.log(`   ${error} 跳过飞书配置`);
      }
    }
    
    // 配置钉钉
    if (platform === '2' || platform === '3') {
      console.log(`\n${lightning} ${info('配置钉钉:')}`);
      console.log(dim('   获取方式: https://open-dev.dingtalk.com → 创建应用 → 应用凭证\n'));
      
      const appKey = await question(`   ${info('App Key')}: `);
      const appSecret = await question(`   ${info('App Secret')}: `);
      
      if (appKey && appSecret) {
        env.DINGTALK_APP_KEY = appKey;
        env.DINGTALK_APP_SECRET = appSecret;
        console.log(`   ${success} 钉钉配置完成`);
      } else {
        console.log(`   ${error} 跳过钉钉配置`);
      }
    }
    
    // 配置机器人名称
    console.log(`\n${lightning} ${info('配置机器人:')}`);
    const botName = await question(`   ${info('机器人名称')} (默认: FlashClaw): `);
    if (botName) {
      env.BOT_NAME = botName;
    }
    
    // 保存配置
    saveEnv(env);
    
    // 确保所有必要目录存在
    ensureDirectories();
    
    console.log(`\n${lightning}${lightning}${lightning} ${chalk.green.bold('初始化完成!')} ${lightning}${lightning}${lightning}\n`);
    console.log(`${lightning} 下一步:`);
    console.log(`   ${info('1.')} 运行 ${chalk.white('flashclaw start')} 启动服务`);
    console.log(`   ${info('2.')} 在飞书/钉钉中添加机器人到群聊`);
    console.log(`   ${info('3.')} @机器人 开始对话\n`);
    
  } finally {
    rl.close();
  }
}

// ==================== 命令实现 ====================

async function startService(daemon: boolean): Promise<void> {
  const status = getServiceStatus();
  
  if (status.running) {
    console.log(`${error} FlashClaw 已在运行中 (PID: ${status.pid})`);
    console.log(`${lightning} 使用 ${info('flashclaw stop')} 停止服务`);
    process.exit(1);
  }
  
  ensureDataDir();
  
  // 检查配置
  const env = loadEnv();
  const hasFeishu = env.FEISHU_APP_ID && env.FEISHU_APP_SECRET;
  const hasDingtalk = env.DINGTALK_APP_KEY && env.DINGTALK_APP_SECRET;
  
  if (!hasFeishu && !hasDingtalk) {
    console.log(`${error} 未配置任何消息平台`);
    console.log(`${lightning} 运行 ${info('flashclaw init')} 进行初始化配置`);
    process.exit(1);
  }
  
  const mainScript = path.join(PACKAGE_ROOT, 'dist', 'index.js');
  
  // 检查是否已编译
  if (!fs.existsSync(mainScript)) {
    console.log(`${lightning} 正在编译 TypeScript...`);
    try {
      execSync('npm run build', { cwd: PACKAGE_ROOT, stdio: 'inherit' });
      console.log(`${success} 编译完成`);
    } catch {
      console.log(`${error} 编译失败`);
      process.exit(1);
    }
  }
  
  const pidFile = paths.pidFile();
  const logFile = paths.logFile();
  
  if (daemon) {
    // 后台模式
    console.log(`${lightning} 正在后台启动 FlashClaw...`);
    
    const logStream = fs.openSync(logFile, 'a');
    
    const child = spawn('node', [mainScript], {
      cwd: PACKAGE_ROOT,
      detached: true,
      stdio: ['ignore', logStream, logStream],
      env: { ...process.env, FORCE_COLOR: '1' }
    });
    
    child.unref();
    
    // 保存 PID
    fs.writeFileSync(pidFile, String(child.pid));
    
    // 等待一下检查是否启动成功
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    if (child.pid && isProcessRunning(child.pid)) {
      console.log(`${success} FlashClaw 已启动 (PID: ${child.pid})`);
      console.log(`${lightning} 查看日志: ${info('flashclaw logs -f')}`);
      console.log(`${lightning} 停止服务: ${info('flashclaw stop')}`);
    } else {
      console.log(`${error} 启动失败，请检查日志: ${logFile}`);
      process.exit(1);
    }
  } else {
    // 前台模式
    showBanner();
    console.log(`${lightning} 正在启动 FlashClaw...\n`);
    
    const child = spawn('node', [mainScript], {
      cwd: PACKAGE_ROOT,
      stdio: 'inherit',
      env: { ...process.env, FORCE_COLOR: '1' }
    });
    
    // 保存 PID
    fs.writeFileSync(pidFile, String(child.pid));
    
    child.on('exit', (code) => {
      // 清理 PID 文件
      try {
        fs.unlinkSync(pidFile);
      } catch {
        // ignore
      }
      process.exit(code || 0);
    });
    
    // 处理信号
    const cleanup = () => {
      child.kill('SIGTERM');
    };
    
    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);
  }
}

async function stopService(): Promise<void> {
  const status = getServiceStatus();
  
  if (!status.running || !status.pid) {
    console.log(`${warn('⚠')} FlashClaw 未在运行`);
    return;
  }
  
  console.log(`${lightning} 正在停止 FlashClaw (PID: ${status.pid})...`);
  
  try {
    process.kill(status.pid, 'SIGTERM');
    
    // 等待进程退出
    let retries = 10;
    while (retries > 0 && isProcessRunning(status.pid)) {
      await new Promise(resolve => setTimeout(resolve, 500));
      retries--;
    }
    
    // 如果还在运行，强制终止
    if (isProcessRunning(status.pid)) {
      process.kill(status.pid, 'SIGKILL');
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    // 清理 PID 文件
    try {
      fs.unlinkSync(paths.pidFile());
    } catch {
      // ignore
    }
    
    console.log(`${success} FlashClaw 已停止`);
  } catch (err) {
    console.log(`${error} 停止失败: ${err}`);
    process.exit(1);
  }
}

function showStatus(): void {
  const status = getServiceStatus();
  const env = loadEnv();
  
  console.log(`\n${lightning} ${chalk.bold('FlashClaw 状态')}\n`);
  
  if (status.running) {
    console.log(`   状态: ${chalk.green.bold('运行中')}`);
    console.log(`   PID:  ${chalk.white(status.pid)}`);
    if (status.uptime) {
      console.log(`   运行: ${chalk.white(status.uptime)}`);
    }
  } else {
    console.log(`   状态: ${chalk.red.bold('已停止')}`);
  }
  
  console.log('');
  console.log(`${lightning} ${chalk.bold('平台配置')}\n`);
  
  const hasFeishu = env.FEISHU_APP_ID && env.FEISHU_APP_SECRET;
  const hasDingtalk = env.DINGTALK_APP_KEY && env.DINGTALK_APP_SECRET;
  
  console.log(`   飞书: ${hasFeishu ? chalk.green('已配置') : chalk.gray('未配置')}`);
  console.log(`   钉钉: ${hasDingtalk ? chalk.green('已配置') : chalk.gray('未配置')}`);
  
  console.log('');
  console.log(`${lightning} ${chalk.bold('路径信息')}\n`);
  console.log(`   主目录: ${chalk.white(paths.home())}`);
  console.log(`   日志: ${chalk.white(paths.logFile())}`);
  console.log(`   配置: ${chalk.white(paths.env())}`);
  console.log(`   数据库: ${chalk.white(paths.database())}`);
  console.log('');
}

// ==================== 插件配置管理 ====================

interface PluginsConfig {
  plugins: Record<string, { enabled: boolean }>;
  hotReload?: boolean;
}

function loadPluginsConfig(): PluginsConfig {
  const pluginsConfigFile = paths.pluginsConfig();
  try {
    if (fs.existsSync(pluginsConfigFile)) {
      return JSON.parse(fs.readFileSync(pluginsConfigFile, 'utf-8'));
    }
  } catch {
    // ignore
  }
  return { plugins: {}, hotReload: true };
}

function savePluginsConfig(config: PluginsConfig): void {
  const pluginsConfigFile = paths.pluginsConfig();
  const configDir = path.dirname(pluginsConfigFile);
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }
  fs.writeFileSync(pluginsConfigFile, JSON.stringify(config, null, 2) + '\n');
}

function isPluginEnabled(name: string): boolean {
  const config = loadPluginsConfig();
  // 默认启用，除非明确禁用
  return config.plugins[name]?.enabled !== false;
}

function setPluginEnabled(name: string, enabled: boolean): void {
  const builtinPluginsDir = getBuiltinPluginsDir();
  const userPluginsDir = paths.userPlugins();
  
  // 检查插件是否存在（内置插件或用户插件）
  const builtinPluginPath = path.join(builtinPluginsDir, name);
  const userPluginPath = path.join(userPluginsDir, name);
  
  if (!fs.existsSync(builtinPluginPath) && !fs.existsSync(userPluginPath)) {
    // 尝试通过 manifest name 查找
    let found = false;
    
    // 搜索内置插件
    if (fs.existsSync(builtinPluginsDir)) {
      const entries = fs.readdirSync(builtinPluginsDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const manifestPath = path.join(builtinPluginsDir, entry.name, 'plugin.json');
        try {
          const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
          if (manifest.name === name) {
            found = true;
            break;
          }
        } catch {
          // ignore
        }
      }
    }
    
    // 搜索用户插件
    if (!found && fs.existsSync(userPluginsDir)) {
      const entries = fs.readdirSync(userPluginsDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const manifestPath = path.join(userPluginsDir, entry.name, 'plugin.json');
        try {
          const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
          if (manifest.name === name) {
            found = true;
            break;
          }
        } catch {
          // ignore
        }
      }
    }
    
    if (!found) {
      console.log(`${error} 插件 ${info(name)} 不存在`);
      console.log(`${lightning} 使用 ${info('flashclaw plugins list')} 查看可用插件`);
      return;
    }
  }
  
  const config = loadPluginsConfig();
  config.plugins[name] = { enabled };
  savePluginsConfig(config);
  
  if (enabled) {
    console.log(`${success} 已启用插件 ${info(name)}`);
  } else {
    console.log(`${success} 已禁用插件 ${info(name)}`);
  }
  
  const status = getServiceStatus();
  if (status.running) {
    console.log(`${lightning} 重启服务以应用更改: ${info('flashclaw restart')}`);
  }
}

async function listPlugins(): Promise<void> {
  const builtinPluginsDir = getBuiltinPluginsDir();
  const userPluginsDir = paths.userPlugins();
  
  console.log(`\n${lightning} ${chalk.bold('已安装插件')}\n`);
  
  const plugins: { name: string; version: string; type: string; description: string; enabled: boolean; source: string }[] = [];
  
  // 加载内置插件
  if (fs.existsSync(builtinPluginsDir)) {
    const entries = fs.readdirSync(builtinPluginsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      
      const manifestPath = path.join(builtinPluginsDir, entry.name, 'plugin.json');
      try {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
        const name = manifest.name || entry.name;
        plugins.push({
          name,
          version: manifest.version || '0.0.0',
          type: manifest.type || 'unknown',
          description: manifest.description || '',
          enabled: isPluginEnabled(name),
          source: 'builtin'
        });
      } catch {
        plugins.push({
          name: entry.name,
          version: '?',
          type: '?',
          description: '(无法读取 plugin.json)',
          enabled: isPluginEnabled(entry.name),
          source: 'builtin'
        });
      }
    }
  }
  
  // 加载用户插件
  if (fs.existsSync(userPluginsDir)) {
    const entries = fs.readdirSync(userPluginsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      
      // 跳过已在内置插件中存在的同名插件
      if (plugins.some(p => p.name === entry.name)) continue;
      
      const manifestPath = path.join(userPluginsDir, entry.name, 'plugin.json');
      try {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
        const name = manifest.name || entry.name;
        // 跳过已在内置插件中存在的同名插件
        if (plugins.some(p => p.name === name)) continue;
        
        plugins.push({
          name,
          version: manifest.version || '0.0.0',
          type: manifest.type || 'unknown',
          description: manifest.description || '',
          enabled: isPluginEnabled(name),
          source: 'user'
        });
      } catch {
        plugins.push({
          name: entry.name,
          version: '?',
          type: '?',
          description: '(无法读取 plugin.json)',
          enabled: isPluginEnabled(entry.name),
          source: 'user'
        });
      }
    }
  }
  
  if (plugins.length === 0) {
    console.log(`   ${dim('(无插件)')}`);
  } else {
    for (const plugin of plugins) {
      const typeColor = plugin.type === 'tool' ? chalk.blue : chalk.magenta;
      const statusIcon = plugin.enabled ? lightning : chalk.gray('○');
      const nameStyle = plugin.enabled ? chalk.white.bold : chalk.gray;
      const sourceTag = plugin.source === 'user' ? chalk.cyan(' [用户]') : '';
      console.log(`   ${statusIcon} ${nameStyle(plugin.name)} ${dim(`v${plugin.version}`)} ${typeColor(`[${plugin.type}]`)}${sourceTag}`);
      if (plugin.description) {
        console.log(`      ${dim(plugin.description)}`);
      }
    }
  }
  
  const enabledCount = plugins.filter(p => p.enabled).length;
  console.log(`\n   ${dim(`共 ${plugins.length} 个插件，${enabledCount} 个已启用`)}`);
  console.log('');
}

async function reloadPlugins(): Promise<void> {
  const status = getServiceStatus();
  
  if (!status.running) {
    console.log(`${error} FlashClaw 未在运行`);
    console.log(`${lightning} 启动服务后插件会自动加载`);
    return;
  }
  
  // 通过 IPC 发送重载信号
  console.log(`${lightning} 正在重载插件...`);
  
  // 发送 SIGUSR1 信号触发重载（需要主进程支持）
  try {
    process.kill(status.pid!, 'SIGUSR1');
    console.log(`${success} 已发送重载信号`);
    console.log(`${lightning} 查看日志确认重载结果: ${info('flashclaw logs')}`);
  } catch (err) {
    console.log(`${error} 发送信号失败: ${err}`);
  }
}

function isSensitiveKey(key: string): boolean {
  const sensitivePatterns = ['SECRET', 'KEY', 'PASSWORD', 'TOKEN', 'CREDENTIAL'];
  const upperKey = key.toUpperCase();
  return sensitivePatterns.some(pattern => upperKey.includes(pattern));
}

function maskValue(value: string): string {
  if (value.length > 8) {
    return value.slice(0, 4) + '****' + value.slice(-4);
  }
  return '****';
}

function getConfig(key: string): void {
  const env = loadEnv();
  
  if (key in env) {
    // 敏感信息脱敏
    let value = env[key];
    if (isSensitiveKey(key)) {
      value = maskValue(value);
    }
    console.log(`${lightning} ${info(key)} = ${chalk.white(value)}`);
  } else {
    console.log(`${warn('⚠')} 配置项 ${info(key)} 不存在`);
    
    // 列出可用配置项
    const keys = Object.keys(env);
    if (keys.length > 0) {
      console.log(`\n${lightning} 可用配置项:`);
      for (const k of keys) {
        console.log(`   ${dim(k)}`);
      }
    }
  }
}

function setConfig(key: string, value: string): void {
  const env = loadEnv();
  env[key] = value;
  saveEnv(env);
  
  console.log(`${success} 已设置 ${info(key)} = ${chalk.white(value)}`);
  
  const status = getServiceStatus();
  if (status.running) {
    console.log(`${lightning} 重启服务以应用更改: ${info('flashclaw stop && flashclaw start')}`);
  }
}

function deleteConfig(key: string): void {
  const env = loadEnv();
  const envFile = paths.env();
  
  if (!(key in env)) {
    console.log(`${warn('⚠')} 配置项 ${info(key)} 不存在`);
    return;
  }
  
  delete env[key];
  
  // 重写 .env 文件，移除该配置项
  try {
    if (fs.existsSync(envFile)) {
      const content = fs.readFileSync(envFile, 'utf-8');
      const lines = content.split('\n').filter(line => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) return true;
        const eqIndex = trimmed.indexOf('=');
        if (eqIndex > 0) {
          const lineKey = trimmed.slice(0, eqIndex).trim();
          return lineKey !== key;
        }
        return true;
      });
      fs.writeFileSync(envFile, lines.join('\n'));
    }
  } catch {
    // 回退到简单保存
    saveEnv(env);
  }
  
  console.log(`${success} 已删除配置项 ${info(key)}`);
  
  const status = getServiceStatus();
  if (status.running) {
    console.log(`${lightning} 重启服务以应用更改: ${info('flashclaw stop && flashclaw start')}`);
  }
}

function showLogs(follow: boolean, lines: number): void {
  const logFile = paths.logFile();
  
  if (!fs.existsSync(logFile)) {
    console.log(`${warn('⚠')} 日志文件不存在: ${logFile}`);
    return;
  }
  
  if (follow) {
    console.log(`${lightning} 实时查看日志 (Ctrl+C 退出)\n`);
    
    // 先显示最后几行
    try {
      const content = fs.readFileSync(logFile, 'utf-8');
      const allLines = content.split('\n');
      const lastLines = allLines.slice(-lines);
      console.log(lastLines.join('\n'));
    } catch {
      // ignore
    }
    
    // 监听文件变化
    let lastSize = fs.statSync(logFile).size;
    
    const watcher = fs.watch(logFile, () => {
      try {
        const stat = fs.statSync(logFile);
        if (stat.size > lastSize) {
          const fd = fs.openSync(logFile, 'r');
          const buffer = Buffer.alloc(stat.size - lastSize);
          fs.readSync(fd, buffer, 0, buffer.length, lastSize);
          fs.closeSync(fd);
          process.stdout.write(buffer.toString());
          lastSize = stat.size;
        } else if (stat.size < lastSize) {
          // 文件被截断（轮转）
          lastSize = stat.size;
        }
      } catch {
        // ignore
      }
    });
    
    process.on('SIGINT', () => {
      watcher.close();
      console.log(`\n${lightning} 已退出日志查看`);
      process.exit(0);
    });
  } else {
    // 显示最后 N 行
    try {
      const content = fs.readFileSync(logFile, 'utf-8');
      const allLines = content.split('\n').filter(l => l.trim());
      const lastLines = allLines.slice(-lines);
      
      console.log(`${lightning} 最近 ${lines} 条日志:\n`);
      console.log(lastLines.join('\n'));
      console.log(`\n${lightning} 实时查看: ${info('flashclaw logs -f')}`);
    } catch (err) {
      console.log(`${error} 读取日志失败: ${err}`);
    }
  }
}

// ==================== 命令定义 ====================

program
  .name('flashclaw')
  .description(`${lightning} 闪电龙虾 - 快如闪电的 AI 助手`)
  .version(VERSION, '-v, --version', '显示版本号');

program
  .command('init')
  .description('交互式初始化配置')
  .action(async () => {
    await interactiveInit();
  });

program
  .command('start')
  .description('启动 FlashClaw 服务')
  .option('-d, --daemon', '后台运行')
  .action(async (options) => {
    await startService(options.daemon || false);
  });

program
  .command('stop')
  .description('停止 FlashClaw 服务')
  .action(async () => {
    await stopService();
  });

program
  .command('restart')
  .description('重启 FlashClaw 服务')
  .option('-d, --daemon', '后台运行')
  .action(async (options) => {
    await stopService();
    await new Promise(resolve => setTimeout(resolve, 1000));
    await startService(options.daemon || false);
  });

program
  .command('status')
  .description('查看服务状态')
  .action(() => {
    showStatus();
  });

// 插件子命令
const plugins = program
  .command('plugins')
  .description('插件管理');

plugins
  .command('list')
  .description('列出所有插件')
  .action(async () => {
    await listPlugins();
  });

plugins
  .command('reload')
  .description('热重载所有插件')
  .action(async () => {
    await reloadPlugins();
  });

plugins
  .command('enable <name>')
  .description('启用插件')
  .action((name) => {
    setPluginEnabled(name, true);
  });

plugins
  .command('disable <name>')
  .description('禁用插件')
  .action((name) => {
    setPluginEnabled(name, false);
  });

// 配置子命令
const config = program
  .command('config')
  .description('配置管理');

config
  .command('get <key>')
  .description('获取配置项')
  .action((key) => {
    getConfig(key);
  });

config
  .command('set <key> <value>')
  .description('设置配置项')
  .action((key, value) => {
    setConfig(key, value);
  });

config
  .command('delete <key>')
  .description('删除配置项')
  .action((key) => {
    deleteConfig(key);
  });

config
  .command('list')
  .description('列出所有配置项')
  .action(() => {
    const env = loadEnv();
    console.log(`\n${lightning} ${chalk.bold('配置项列表')}\n`);
    
    if (Object.keys(env).length === 0) {
      console.log(`   ${dim('(无配置)')}`);
    } else {
      for (const [key, value] of Object.entries(env)) {
        // 敏感信息脱敏
        const displayValue = isSensitiveKey(key) ? maskValue(value) : value;
        console.log(`   ${info(key)} = ${chalk.white(displayValue)}`);
      }
    }
    console.log('');
  });

program
  .command('logs')
  .description('查看日志')
  .option('-f, --follow', '实时查看')
  .option('-n, --lines <number>', '显示行数', '50')
  .action((options) => {
    const lines = parseInt(options.lines, 10) || 50;
    showLogs(options.follow || false, lines);
  });

// 默认命令（无参数时显示帮助）
program
  .action(() => {
    showBanner();
    program.outputHelp();
  });

// 确保配置目录存在
ensureDirectories();

// 解析命令行参数
program.parse();

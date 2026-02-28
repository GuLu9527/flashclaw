#!/usr/bin/env node
/**
 * FlashClaw CLI - 命令行入口
 * ⚡ 闪电龙虾 - 快如闪电的 AI 助手
 */

import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

// 尝试解决 Windows 中文乱码问题
if (process.platform === 'win32') {
  try {
    const { execSync } = await import('child_process');
    // 设置活动代码页为 UTF-8 (65001)
    execSync('chcp 65001', { stdio: 'ignore' });
  } catch {
    // 忽略错误，某些环境可能没有权限
  }
}

// ==================== ANSI 颜色代码 ====================
const colors = {
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
} as const;

// 颜色辅助函数
const green = (text: string) => `${colors.green}${text}${colors.reset}`;
const yellow = (text: string) => `${colors.yellow}${text}${colors.reset}`;
const red = (text: string) => `${colors.red}${text}${colors.reset}`;
const cyan = (text: string) => `${colors.cyan}${text}${colors.reset}`;
const bold = (text: string) => `${colors.bold}${text}${colors.reset}`;
const dim = (text: string) => `${colors.dim}${text}${colors.reset}`;

const PLUGIN_NAME_PATTERN = /^[a-z0-9][a-z0-9-_]{0,63}$/;
const isValidPluginName = (name: string) => PLUGIN_NAME_PATTERN.test(name);

// ==================== 版本信息 ====================
const VERSION = (() => {
  try {
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const pkgPath = join(__dirname, '..', 'package.json');
    const raw = readFileSync(pkgPath, 'utf-8');
    const pkg = JSON.parse(raw) as { version?: string };
    return pkg.version ?? 'unknown';
  } catch {
    return 'unknown';
  }
})();

// ==================== Banner ====================
function showBanner(): void {
  console.log(yellow(`
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

  ⚡ 闪电龙虾 - 快如闪电的 AI 助手

  ⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡
`));
}

// ==================== 帮助信息 ====================
function showHelp(): void {
  console.log(`
${bold('FlashClaw')} ${dim(`v${VERSION}`)} - ⚡ 闪电龙虾 AI 助手

${bold('用法:')}
  flashclaw [命令] [选项]

${bold('命令:')}
  ${cyan('start')}                       启动服务
  ${cyan('plugins list')}                列出已安装插件
  ${cyan('plugins list --available')}    列出可用插件
  ${cyan('plugins install <name>')}      安装插件
  ${cyan('plugins uninstall <name>')}    卸载插件
  ${cyan('plugins update <name>')}       更新插件
  ${cyan('plugins update --all')}        更新所有插件
  ${cyan('init')}                         交互式初始化配置
  ${cyan('init --non-interactive')}      非交互式初始化（需 --api-key）
  ${cyan('doctor')}                      检查运行环境
  ${cyan('security')}                    安全审计
  ${cyan('daemon <action>')}             后台服务管理 (install|uninstall|status|start|stop)
  ${cyan('config list-backups')}         列出配置备份
  ${cyan('config restore [n]')}          恢复配置备份（n=1-5，默认1）
  ${cyan('version')}                     显示版本
  ${cyan('help')}                        显示帮助

${bold('示例:')}
  flashclaw                     启动服务（默认）
  flashclaw init                首次配置
  flashclaw doctor              环境诊断
  flashclaw security            安全审计
  flashclaw daemon install      安装为后台服务（开机自启）
  flashclaw daemon status       查看后台服务状态
  flashclaw start               启动服务
  flashclaw plugins list        查看已安装插件
  flashclaw plugins install feishu  安装飞书插件

${bold('更多信息:')}
  文档: https://github.com/GuLu9527/flashclaw
`);
}

// ==================== 版本信息 ====================
function showVersion(): void {
  console.log(`${bold('FlashClaw')} ${cyan(`v${VERSION}`)}`);
}

// ==================== 插件管理 ====================

interface PluginInfo {
  name: string;
  version: string;
  description: string;
  enabled?: boolean;
}

// 插件安装器（从 ./plugins/installer.js 导入）
let pluginInstaller: {
  listInstalledPlugins: () => Promise<{ name: string; version: string; installedAt: string; source: string }[]>;
  listAvailablePlugins: () => Promise<{ name: string; version: string; description: string }[]>;
  installPlugin: (name: string) => Promise<boolean>;
  uninstallPlugin: (name: string) => Promise<boolean>;
  updatePlugin: (name: string) => Promise<boolean>;
} | null = null;

async function loadPluginInstaller(): Promise<typeof pluginInstaller> {
  if (pluginInstaller) return pluginInstaller;
  
  try {
    const installer = await import('./plugins/installer.js');
    pluginInstaller = {
      listInstalledPlugins: installer.listInstalledPlugins,
      listAvailablePlugins: installer.listAvailablePlugins,
      installPlugin: installer.installPlugin,
      uninstallPlugin: installer.uninstallPlugin,
      updatePlugin: installer.updatePlugin,
    };
    return pluginInstaller;
  } catch (error) {
    // 安装器模块不存在时提供默认实现
    console.log(yellow('⚠') + ' 插件安装器未配置，使用内置插件管理');
    return null;
  }
}

async function listInstalledPlugins(): Promise<void> {
  const installer = await loadPluginInstaller();
  
  if (installer) {
    try {
      const plugins = await installer.listInstalledPlugins();
      
      if (plugins.length === 0) {
        console.log(`\n${yellow('⚡')} 暂无已安装插件\n`);
        console.log(`使用 ${cyan('flashclaw plugins list --available')} 查看可安装插件`);
        return;
      }
      
      console.log(`\n🔌 ${bold('已安装插件')} (${plugins.length}):\n`);
      
      for (const plugin of plugins) {
        console.log(`  ${green('✓')} ${bold(plugin.name.padEnd(16))} ${dim(`v${plugin.version}`.padEnd(10))}`);
      }
      
      console.log(`\n使用 ${cyan('flashclaw plugins list --available')} 查看可安装插件\n`);
    } catch (error) {
      console.log(red('✗') + ` 获取插件列表失败: ${error}`);
    }
  } else {
    // 内置插件列表展示
    await listBuiltinPlugins();
  }
}

async function listBuiltinPlugins(): Promise<void> {
  try {
    const fs = await import('fs');
    const path = await import('path');
    const { fileURLToPath } = await import('url');
    
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const pluginsDir = path.resolve(__dirname, '..', 'plugins');
    
    if (!fs.existsSync(pluginsDir)) {
      console.log(`\n${yellow('⚡')} 暂无已安装插件\n`);
      return;
    }
    
    const entries = fs.readdirSync(pluginsDir, { withFileTypes: true });
    const plugins: PluginInfo[] = [];
    
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      
      const manifestPath = path.join(pluginsDir, entry.name, 'plugin.json');
      try {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
        plugins.push({
          name: manifest.name || entry.name,
          version: manifest.version || '1.0.0',
          description: manifest.description || '',
        });
      } catch {
        // 跳过无效插件
      }
    }
    
    if (plugins.length === 0) {
      console.log(`\n${yellow('⚡')} 暂无已安装插件\n`);
      return;
    }
    
    console.log(`\n🔌 ${bold('已安装插件')} (${plugins.length}):\n`);
    
    for (const plugin of plugins) {
      console.log(`  ${bold(plugin.name.padEnd(16))} ${dim(`v${plugin.version}`.padEnd(10))} ${plugin.description}`);
    }
    
    console.log(`\n使用 ${cyan('flashclaw plugins list --available')} 查看可安装插件\n`);
  } catch (error) {
    console.log(red('✗') + ` 读取插件目录失败: ${error}`);
  }
}

async function listAvailablePlugins(): Promise<void> {
  const installer = await loadPluginInstaller();
  
  if (installer) {
    try {
      const plugins = await installer.listAvailablePlugins();
      
      if (plugins.length === 0) {
        console.log(`\n${yellow('⚡')} 暂无可用插件\n`);
        return;
      }
      
      console.log(`\n📦 ${bold('可用插件')} (${plugins.length}):\n`);
      
      for (const plugin of plugins) {
        console.log(`  ${bold(plugin.name.padEnd(16))} ${dim(`v${plugin.version}`.padEnd(10))} ${plugin.description}`);
      }
      
      console.log(`\n使用 ${cyan('flashclaw plugins install <name>')} 安装插件\n`);
    } catch (error) {
      console.log(red('✗') + ` 获取可用插件列表失败: ${error}`);
    }
  } else {
    console.log(`\n${yellow('⚠')} 插件市场未配置\n`);
    console.log(`请访问 ${cyan('https://github.com/GuLu9527/flashclaw')} 获取更多插件`);
  }
}

/**
 * 插件安装后，读取其 plugin.json 的 config 字段
 * 通用地提示用户需要配置哪些环境变量
 */
function printChannelPluginHint(pluginName: string): void {
  try {
    const { existsSync, readFileSync } = require('fs');
    const { join } = require('path');

    // 查找刚安装到用户插件目录的 plugin.json
    const homedir = process.env.FLASHCLAW_HOME || join(require('os').homedir(), '.flashclaw');
    const manifestPath = join(homedir, 'plugins', pluginName, 'plugin.json');
    if (!existsSync(manifestPath)) return;

    const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
    if (!manifest.config) return;

    const missing: string[] = [];
    const optional: string[] = [];

    for (const [, cfg] of Object.entries(manifest.config)) {
      const envName = (cfg as any)?.env;
      if (!envName) continue;

      if (process.env[envName]) continue; // 已配置，跳过

      if ((cfg as any)?.required) {
        missing.push(envName);
      } else {
        optional.push(envName);
      }
    }

    if (missing.length === 0 && optional.length === 0) return;

    if (missing.length > 0) {
      console.log(`\n${yellow('⚠')} 还需要配置环境变量（在 ~/.flashclaw/.env 中添加）:`);
      for (const v of missing) {
        console.log(`  ${cyan(v)}=你的值`);
      }
    }
    if (optional.length > 0) {
      for (const v of optional) {
        console.log(`  ${dim(`${v}=  # 可选`)}`);
      }
    }
  } catch {
    // 读取失败不影响安装流程
  }
}

async function installPlugin(name: string): Promise<void> {
  const installer = await loadPluginInstaller();
  
  if (!installer) {
    console.log(red('✗') + ' 插件安装器未配置');
    return;
  }

  if (!isValidPluginName(name)) {
    console.log(red('✗') + ` 插件名称不合法: ${name}`);
    console.log('插件名称只能包含小写字母、数字、- 或 _');
    return;
  }
  
  console.log(`${yellow('⚡')} 正在安装插件 ${cyan(name)}...`);
  
  try {
    const success = await installer.installPlugin(name);
    if (success) {
      console.log(green('✓') + ` 插件 ${bold(name)} 安装成功`);
      // 渠道插件提示配置环境变量
      printChannelPluginHint(name);
      console.log(`\n使用 ${cyan('flashclaw start')} 重启服务以加载新插件`);
    } else {
      console.log(red('✗') + ` 安装失败`);
    }
  } catch (error) {
    console.log(red('✗') + ` 安装失败: ${error}`);
  }
}

async function uninstallPlugin(name: string): Promise<void> {
  const installer = await loadPluginInstaller();
  
  if (!installer) {
    console.log(red('✗') + ' 插件安装器未配置');
    return;
  }

  if (!isValidPluginName(name)) {
    console.log(red('✗') + ` 插件名称不合法: ${name}`);
    console.log('插件名称只能包含小写字母、数字、- 或 _');
    return;
  }
  
  console.log(`${yellow('⚡')} 正在卸载插件 ${cyan(name)}...`);
  
  try {
    const success = await installer.uninstallPlugin(name);
    if (success) {
      console.log(green('✓') + ` 插件 ${bold(name)} 已卸载`);
    } else {
      console.log(red('✗') + ` 卸载失败`);
    }
  } catch (error) {
    console.log(red('✗') + ` 卸载失败: ${error}`);
  }
}

async function updatePlugin(name: string): Promise<void> {
  const installer = await loadPluginInstaller();
  
  if (!installer) {
    console.log(red('✗') + ' 插件安装器未配置');
    return;
  }

  if (!isValidPluginName(name)) {
    console.log(red('✗') + ` 插件名称不合法: ${name}`);
    console.log('插件名称只能包含小写字母、数字、- 或 _');
    return;
  }
  
  console.log(`${yellow('⚡')} 正在更新插件 ${cyan(name)}...`);
  
  try {
    const success = await installer.updatePlugin(name);
    if (success) {
      console.log(green('✓') + ` 插件 ${bold(name)} 更新成功`);
    } else {
      console.log(red('✗') + ` 更新失败`);
    }
  } catch (error) {
    console.log(red('✗') + ` 更新失败: ${error}`);
  }
}

async function updateAllPlugins(): Promise<void> {
  const installer = await loadPluginInstaller();
  
  if (!installer) {
    console.log(red('✗') + ' 插件安装器未配置');
    return;
  }
  
  console.log(`${yellow('⚡')} 正在更新所有插件...`);
  
  try {
    const plugins = await installer.listInstalledPlugins();
    let successCount = 0;
    let failCount = 0;
    
    for (const plugin of plugins) {
      console.log(`\n${yellow('⚡')} 更新 ${cyan(plugin.name)}...`);
      const success = await installer.updatePlugin(plugin.name);
      if (success) {
        successCount++;
      } else {
        failCount++;
      }
    }
    
    console.log(`\n${green('✓')} 更新完成: ${successCount} 成功, ${failCount} 失败`);
  } catch (error) {
    console.log(red('✗') + ` 更新失败: ${error}`);
  }
}

// ==================== 启动服务 ====================
async function startService(): Promise<void> {
  showBanner();
  console.log(`${yellow('⚡')} 正在启动 FlashClaw...\n`);
  
  try {
    // 动态导入主模块
    await import('./index.js');
  } catch (error) {
    console.log(red('✗') + ` 启动失败: ${error}`);
    process.exit(1);
  }
}

// ==================== 参数解析 ====================
function parseArgs(): { command: string; subcommand?: string; args: string[]; flags: Record<string, boolean> } {
  const args = process.argv.slice(2);
  const flags: Record<string, boolean> = {};
  const positional: string[] = [];
  
  for (const arg of args) {
    if (arg.startsWith('--')) {
      flags[arg.slice(2)] = true;
    } else if (arg.startsWith('-')) {
      flags[arg.slice(1)] = true;
    } else {
      positional.push(arg);
    }
  }
  
  const command = positional[0] || '';
  const subcommand = positional[1];
  const restArgs = positional.slice(2);
  
  return { command, subcommand, args: restArgs, flags };
}

// ==================== 主入口 ====================
async function main(): Promise<void> {
  const { command, subcommand, args, flags } = parseArgs();
  
  // 处理 -v / --version
  if (flags['v'] || flags['version']) {
    showVersion();
    return;
  }
  
  // 处理 -h / --help
  if (flags['h'] || flags['help']) {
    showHelp();
    return;
  }
  
  switch (command) {
    case '':
    case 'start':
      // 默认启动服务
      await startService();
      break;

    case 'init': {
      // 交互式初始化向导
      const { initCommand } = await import('./commands/init.js');
      // 将 flags 转换为支持字符串值（处理 --api-key=xxx 形式的参数）
      const initFlags: Record<string, string | boolean> = { ...flags };
      // 从原始 argv 中提取 --api-key, --base-url, --model, --bot-name 的值
      const rawArgs = process.argv.slice(2);
      for (let i = 0; i < rawArgs.length; i++) {
        const arg = rawArgs[i];
        if (arg.includes('=')) {
          const [key, ...rest] = arg.replace(/^--/, '').split('=');
          initFlags[key] = rest.join('=');
        } else if (arg.startsWith('--') && i + 1 < rawArgs.length && !rawArgs[i + 1].startsWith('-')) {
          const key = arg.slice(2);
          if (['api-key', 'base-url', 'model', 'bot-name'].includes(key)) {
            initFlags[key] = rawArgs[i + 1];
          }
        }
      }
      await initCommand(initFlags);
      break;
    }

    case 'doctor': {
      const { doctorCommand } = await import('./commands/doctor.js');
      await doctorCommand();
      break;
    }

    case 'security': {
      const { securityAuditCommand } = await import('./commands/security.js');
      await securityAuditCommand();
      break;
    }

    case 'daemon': {
      const action = subcommand || '';
      const { daemonCommand } = await import('./commands/daemon.js');
      await daemonCommand(action);
      break;
    }
      
    case 'plugins':
      await handlePluginsCommand(subcommand, args, flags);
      break;
      
    case 'config':
      await handleConfigCommand(subcommand, args);
      break;

    case 'repl':
      await runRepl({
        group: typeof flags['group'] === 'string' ? flags['group'] as string : undefined,
        batch: flags['batch'] === true,
        ask: typeof flags['ask'] === 'string' ? flags['ask'] as string : undefined
      });
      break;

    case 'version':
      showVersion();
      break;
      
    case 'help':
      showHelp();
      break;
      
    default:
      console.log(red('✗') + ` 未知命令: ${command}`);
      console.log(`\n使用 ${cyan('flashclaw help')} 查看可用命令`);
      process.exit(1);
  }
}

// ==================== REPL 功能 ====================

import readline from 'readline';
import * as fs from 'fs';
import dotenv from 'dotenv';
import { runAgent, AgentInput } from './agent-runner.js';
import { getBuiltinPluginsDir, getCommunityPluginsDir, paths } from './paths.js';
import { loadFromDir } from './plugins/loader.js';
import { initDatabase } from './db.js';
import { getMemoryManager } from './core/memory.js';

interface ReplOptions {
  group?: string;
  batch?: boolean;
  ask?: string;
  loadPlugins?: boolean;
}

interface ReplState {
  messageCount: number;
  inputTokens: number;
  outputTokens: number;
  group: string;
  batch: boolean;
  memoryManager: ReturnType<typeof getMemoryManager>;
}

// 初始化 REPL 环境（插件系统等）
async function initReplEnv(): Promise<void> {
  // 加载环境变量
  dotenv.config();

  // 初始化数据库
  initDatabase();

  // 加载内置插件
  const builtinPluginsDir = getBuiltinPluginsDir();
  if (fs.existsSync(builtinPluginsDir)) {
    await loadFromDir(builtinPluginsDir);
  }

  // 加载社区插件
  const communityPluginsDir = getCommunityPluginsDir();
  if (fs.existsSync(communityPluginsDir)) {
    await loadFromDir(communityPluginsDir);
  }
}

async function runRepl(options: ReplOptions): Promise<void> {
  // 初始化插件系统
  if (options.loadPlugins !== false) {
    if (!options.batch) {
      console.log('⚡ 初始化 CLI 环境...\n');
    }
    await initReplEnv();
  }

  const state: ReplState = {
    messageCount: 0,
    inputTokens: 0,
    outputTokens: 0,
    group: options.group ?? 'cli-default',
    batch: options.batch ?? false,
    memoryManager: getMemoryManager()
  };

  // 单次问答模式
  if (options.ask) {
    await askMode(options.ask, state);
    return;
  }

  // 管道输入模式
  if (!process.stdin.isTTY) {
    await pipeMode(state);
    return;
  }

  // REPL 交互模式
  await replMode(state);
}

async function askMode(prompt: string, state: ReplState): Promise<void> {
  console.log(`\n> ${prompt}\n`);
  await callAgent(prompt, state);
}

async function pipeMode(state: ReplState): Promise<void> {
  let input = '';
  for await (const chunk of process.stdin) {
    input += chunk;
  }
  input = input.trim();
  if (!input) {
    console.error('❌ 没有输入内容');
    process.exit(1);
  }
  console.log(`> ${input}\n`);
  await callAgent(input, state);
}

async function replMode(state: ReplState): Promise<void> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: !state.batch,
    prompt: '> '
  });

  if (!state.batch) {
    console.log('\n⚡ FlashClaw CLI v1.5.0');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('输入 /help 查看可用命令\n');
  }

  rl.prompt();

  rl.on('line', async (line) => {
    const input = line.trim();
    if (!input) {
      rl.prompt();
      return;
    }

    if (input.startsWith('/')) {
      await handleCommand(input, rl, state);
      return;
    }

    await callAgent(input, state);
    rl.prompt();
  });

  rl.on('close', () => {
    if (!state.batch) {
      console.log('\n👋 再见!');
    }
    process.exit(0);
  });
}

async function handleCommand(input: string, rl: readline.Interface, state: ReplState): Promise<void> {
  const parts = input.slice(1).split(/\s+/);
  const cmd = parts[0].toLowerCase();
  const args = parts.slice(1).join(' ');

  switch (cmd) {
    case 'q':
    case 'quit':
    case 'exit':
      if (!state.batch) console.log('👋 再见!');
      rl.close();
      process.exit(0);
      break;

    case '?':
    case 'h':
    case 'help':
      if (!state.batch) {
        console.log(`
可用命令:
  /new, /n           新建会话
  /compact, /c       压缩上下文
  /status, /s        查看状态
  /history, /h [n]   查看最近 n 条消息 (默认 10)
  /clear             清除屏幕
  /help, /?         显示帮助
  /quit, /q         退出程序
`);
      }
      break;

    case 'n':
    case 'new':
      state.messageCount = 0;
      state.inputTokens = 0;
      state.outputTokens = 0;
      // 清除 memory 上下文
      state.memoryManager.clearContext(state.group);
      if (!state.batch) console.log('✅ 已新建会话 (上下文已清除)');
      break;

    case 'c':
    case 'compact':
      // 注意：compact 需要 apiClient 参数，这里只做提示
      // 实际压缩需要在有 API 客户端时调用
      if (!state.batch) {
        console.log('ℹ️ 上下文压缩需要 API 客户端，当前跳过');
        console.log('✅ 上下文状态正常');
      }
      break;

    case 's':
    case 'status':
      if (!state.batch) {
        const memoryKeys = state.memoryManager.getMemoryKeys(state.group);
        console.log('┌─────────────────────────────────────┐');
        console.log(`│ 当前模型: (默认)                      │`);
        console.log(`│ 使用 Token: ${state.inputTokens + state.outputTokens} / 100,000          │`);
        console.log(`│ 消息数: ${state.messageCount}                          │`);
        console.log(`│ 群组: ${state.group}                        │`);
        console.log(`│ 记忆键: ${memoryKeys.length}                          │`);
        console.log('└─────────────────────────────────────┘');
      } else {
        const memoryKeys = state.memoryManager.getMemoryKeys(state.group);
        console.log(`model:default tokens:${state.inputTokens + state.outputTokens} messages:${state.messageCount} group:${state.group} memory_keys:${memoryKeys.length}`);
      }
      break;

    case 'history':
    case 'h':
      const count = args ? parseInt(args, 10) : 10;
      if (!state.batch) {
        console.log(`📜 最近 ${count} 条消息 (模拟显示)`);
        console.log('(记忆系统集成后将从 memory 获取历史)');
      }
      break;

    case 'clear':
      if (!state.batch) console.clear();
      break;

    default:
      if (!state.batch) console.log(`❌ 未知命令: /${cmd}，输入 /help 查看帮助`);
  }

  rl.prompt();
}

async function callAgent(prompt: string, state: ReplState): Promise<void> {
  const thinking = state.batch ? null : setTimeout(() => {
    process.stdout.write('\n🤖 (正在思考... )\n');
  }, 1500);

  const input: AgentInput = {
    prompt,
    groupFolder: state.group,
    chatJid: 'cli',
    isMain: true,
    onToken: (text: string) => {
      process.stdout.write(text);
    }
  };

  try {
    const result = await runAgent(
      {
        name: state.group,
        folder: state.group,
        trigger: '/',
        added_at: new Date().toISOString(),
        agentConfig: {}
      },
      input
    );

    if (thinking) clearTimeout(thinking);

    if (result.status === 'success') {
      state.messageCount++;
      state.inputTokens += Math.ceil(prompt.length / 4);
      state.outputTokens += Math.ceil((result.result?.length ?? 0) / 4);
    } else {
      console.error('\n❌ 错误:', result.error);
    }
  } catch (error) {
    if (thinking) clearTimeout(thinking);
    console.error('\n❌ 异常:', error instanceof Error ? error.message : error);
  }
}

// ==================== 配置管理 ====================

async function handleConfigCommand(
  subcommand: string | undefined,
  args: string[]
): Promise<void> {
  // 动态导入配置相关模块
  const { listBackups, restoreConfig } = await import('./utils.js');
  const { paths } = await import('./paths.js');
  
  const configPath = paths.pluginsConfig();
  
  switch (subcommand) {
    case 'list-backups':
    case 'backups': {
      const backups = listBackups(configPath);
      
      if (backups.length === 0) {
        console.log(`\n${yellow('⚡')} 暂无配置备份\n`);
        return;
      }
      
      console.log(`\n📦 ${bold('配置备份')} (${backups.length}):\n`);
      
      for (const backup of backups) {
        const date = backup.modifiedAt.toLocaleString('zh-CN');
        const size = (backup.size / 1024).toFixed(1);
        console.log(`  ${green('✓')} ${bold(`备份 #${backup.number}`)}  ${dim(`${date}  ${size} KB`)}`);
      }
      
      console.log(`\n使用 ${cyan('flashclaw config restore [n]')} 恢复备份\n`);
      break;
    }
    
    case 'restore': {
      const backupNumber = args[0] ? parseInt(args[0], 10) : 1;
      
      if (isNaN(backupNumber) || backupNumber < 1 || backupNumber > 5) {
        console.log(red('✗') + ' 备份编号必须在 1-5 之间');
        process.exit(1);
      }
      
      console.log(`${yellow('⚡')} 正在恢复配置备份 #${backupNumber}...`);
      
      const success = restoreConfig(configPath, backupNumber);
      
      if (success) {
        console.log(green('✓') + ` 配置已从备份 #${backupNumber} 恢复`);
        console.log(`\n使用 ${cyan('flashclaw start')} 重启服务以应用更改`);
      } else {
        console.log(red('✗') + ` 恢复失败，备份 #${backupNumber} 可能不存在`);
        console.log(`\n使用 ${cyan('flashclaw config list-backups')} 查看可用备份`);
        process.exit(1);
      }
      break;
    }
    
    default:
      console.log(red('✗') + ` 未知配置命令: ${subcommand || '(空)'}`);
      console.log(`\n可用命令:`);
      console.log(`  ${cyan('flashclaw config list-backups')}   列出配置备份`);
      console.log(`  ${cyan('flashclaw config restore [n]')}    恢复配置备份（n=1-5）`);
      process.exit(1);
  }
}

async function handlePluginsCommand(
  subcommand: string | undefined,
  args: string[],
  flags: Record<string, boolean>
): Promise<void> {
  switch (subcommand) {
    case 'list':
      if (flags['available']) {
        await listAvailablePlugins();
      } else {
        await listInstalledPlugins();
      }
      break;
      
    case 'install':
      if (!args[0]) {
        console.log(red('✗') + ' 请指定插件名称');
        console.log(`\n用法: ${cyan('flashclaw plugins install <name>')}`);
        process.exit(1);
      }
      await installPlugin(args[0]);
      break;
      
    case 'uninstall':
      if (!args[0]) {
        console.log(red('✗') + ' 请指定插件名称');
        console.log(`\n用法: ${cyan('flashclaw plugins uninstall <name>')}`);
        process.exit(1);
      }
      await uninstallPlugin(args[0]);
      break;
      
    case 'update':
      if (flags['all']) {
        await updateAllPlugins();
      } else if (args[0]) {
        await updatePlugin(args[0]);
      } else {
        console.log(red('✗') + ' 请指定插件名称或使用 --all 更新所有插件');
        console.log(`\n用法: ${cyan('flashclaw plugins update <name>')}`);
        console.log(`      ${cyan('flashclaw plugins update --all')}`);
        process.exit(1);
      }
      break;
      
    default:
      console.log(red('✗') + ` 未知插件命令: ${subcommand || '(空)'}`);
      console.log(`\n可用命令:`);
      console.log(`  ${cyan('flashclaw plugins list')}                列出已安装插件`);
      console.log(`  ${cyan('flashclaw plugins list --available')}    列出可用插件`);
      console.log(`  ${cyan('flashclaw plugins install <name>')}      安装插件`);
      console.log(`  ${cyan('flashclaw plugins uninstall <name>')}    卸载插件`);
      console.log(`  ${cyan('flashclaw plugins update <name>')}       更新插件`);
      console.log(`  ${cyan('flashclaw plugins update --all')}        更新所有插件`);
      process.exit(1);
  }
}

// 运行主函数
main().catch((error) => {
  console.log(red('✗') + ` 发生错误: ${error}`);
  process.exit(1);
});

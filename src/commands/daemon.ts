/**
 * FlashClaw 后台服务管理命令
 * 使用 Windows Scheduled Tasks (schtasks.exe) 实现开机自启
 */

import { execFile, spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, unlinkSync, mkdirSync, openSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);

// ==================== ANSI 颜色（与其他命令保持一致） ====================
const colors = {
  green: '\x1b[32m', yellow: '\x1b[33m', red: '\x1b[31m',
  cyan: '\x1b[36m', reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
} as const;

const green = (t: string) => `${colors.green}${t}${colors.reset}`;
const yellow = (t: string) => `${colors.yellow}${t}${colors.reset}`;
const red = (t: string) => `${colors.red}${t}${colors.reset}`;
const cyan = (t: string) => `${colors.cyan}${t}${colors.reset}`;
const bold = (t: string) => `${colors.bold}${t}${colors.reset}`;
const dim = (t: string) => `${colors.dim}${t}${colors.reset}`;

/** 计划任务名称 */
const TASK_NAME = 'FlashClaw';

// ==================== schtasks 封装 ====================

/**
 * 执行 schtasks 命令
 * Windows 上 schtasks 输出可能是 GBK 编码，CLI 入口已通过 chcp 65001 切换为 UTF-8
 */
async function execSchtasks(
  args: string[],
): Promise<{ stdout: string; stderr: string; code: number }> {
  try {
    const { stdout, stderr } = await execFileAsync('schtasks', args, {
      encoding: 'utf8',
      windowsHide: true,
    });
    return {
      stdout: String(stdout ?? ''),
      stderr: String(stderr ?? ''),
      code: 0,
    };
  } catch (error) {
    const e = error as {
      stdout?: unknown;
      stderr?: unknown;
      code?: unknown;
      message?: unknown;
    };
    return {
      stdout: typeof e.stdout === 'string' ? e.stdout : '',
      stderr: typeof e.stderr === 'string' ? e.stderr : typeof e.message === 'string' ? e.message : '',
      code: typeof e.code === 'number' ? e.code : 1,
    };
  }
}

// ==================== 路径解析 ====================

/**
 * 解析 flashclaw CLI 的实际路径
 * 优先使用 dist/cli.js，回退到 process.argv[1]
 */
function resolveCliPath(): string {
  // 如果 process.argv[1] 已经指向 dist/cli.js，直接使用
  const scriptPath = process.argv[1];
  if (scriptPath && scriptPath.endsWith('cli.js') && existsSync(scriptPath)) {
    return resolve(scriptPath);
  }

  // 尝试从当前文件位置推断项目根目录
  // src/commands/daemon.ts -> ../../dist/cli.js
  // dist/commands/daemon.js -> ../../dist/cli.js
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  const distCliPath = resolve(__dirname, '..', '..', 'dist', 'cli.js');
  if (existsSync(distCliPath)) {
    return distCliPath;
  }

  // 最终回退：使用 process.argv[1]
  if (scriptPath && existsSync(scriptPath)) {
    return resolve(scriptPath);
  }

  throw new Error('无法找到 FlashClaw CLI 入口文件，请确保已运行 npm run build');
}

// ==================== install ====================

/**
 * 安装 Windows 计划任务，开机自启 flashclaw
 */
async function installDaemon(): Promise<void> {
  if (process.platform !== 'win32') {
    console.log(red('✗') + ' daemon install 目前仅支持 Windows');
    process.exit(1);
  }

  console.log(`\n${yellow('⚡')} 正在安装 FlashClaw 后台服务...\n`);

  const nodePath = process.execPath;
  const cliPath = resolveCliPath();

  // 构建任务命令：node <cli.js> start
  const taskCommand = `"${nodePath}" "${cliPath}" start`;

  console.log(`  ${dim('Node 路径:')} ${nodePath}`);
  console.log(`  ${dim('CLI 路径:')}  ${cliPath}`);
  console.log(`  ${dim('执行命令:')} ${taskCommand}`);
  console.log('');

  // 先删除已有任务（忽略不存在的情况）
  await execSchtasks(['/Delete', '/TN', TASK_NAME, '/F']);

  // 创建计划任务
  const res = await execSchtasks([
    '/Create',
    '/SC', 'ONLOGON',
    '/RL', 'HIGHEST',
    '/TN', TASK_NAME,
    '/TR', taskCommand,
    '/F',
  ]);

  if (res.code !== 0) {
    const detail = res.stderr || res.stdout;
    const hint = /access is denied/i.test(detail)
      ? '\n  请以管理员权限运行 PowerShell 重试'
      : '';
    console.log(red('✗') + ` 安装失败: ${detail.trim()}${hint}`);
    process.exit(1);
  }

  console.log(green('✓') + ` 计划任务 ${bold(TASK_NAME)} 已创建`);
  console.log(`  ${dim('触发方式:')} 用户登录时自动启动`);
  console.log(`  ${dim('权限级别:')} 最高权限`);
  console.log(`\n  使用 ${cyan('flashclaw daemon status')} 查看状态`);
  console.log(`  使用 ${cyan('flashclaw daemon start')} 立即启动后台进程\n`);
}

// ==================== uninstall ====================

/**
 * 删除 Windows 计划任务
 */
async function uninstallDaemon(): Promise<void> {
  if (process.platform !== 'win32') {
    console.log(red('✗') + ' daemon uninstall 目前仅支持 Windows');
    process.exit(1);
  }

  console.log(`\n${yellow('⚡')} 正在卸载 FlashClaw 后台服务...\n`);

  // 先尝试停止进程
  await stopDaemonSilent();

  // 删除计划任务
  const res = await execSchtasks(['/Delete', '/TN', TASK_NAME, '/F']);

  if (res.code !== 0) {
    const detail = (res.stderr || res.stdout).toLowerCase();
    if (detail.includes('cannot find') || detail.includes('does not exist')) {
      console.log(yellow('⚠') + ' 计划任务不存在，可能已被删除');
    } else {
      console.log(red('✗') + ` 卸载失败: ${(res.stderr || res.stdout).trim()}`);
      process.exit(1);
    }
  } else {
    console.log(green('✓') + ` 计划任务 ${bold(TASK_NAME)} 已删除`);
  }

  console.log('');
}

// ==================== status ====================

/**
 * 查看计划任务和进程状态
 */
async function statusDaemon(): Promise<void> {
  const { paths } = await import('../paths.js');

  console.log(`\n${bold('⚡ FlashClaw 后台服务状态')}\n`);

  // 1. 检查计划任务
  if (process.platform === 'win32') {
    const res = await execSchtasks(['/Query', '/TN', TASK_NAME, '/FO', 'LIST', '/V']);

    if (res.code !== 0) {
      const detail = (res.stderr || res.stdout).toLowerCase();
      if (detail.includes('cannot find') || detail.includes('does not exist')) {
        console.log(`  ${red('✗')} 计划任务: ${dim('未安装')}`);
      } else {
        console.log(`  ${yellow('⚠')} 计划任务: ${dim('查询失败')}`);
      }
    } else {
      // 解析 schtasks /FO LIST /V 输出（支持中英文系统）
      const output = res.stdout;
      const statusMatch = output.match(/Status:\s*(.+)/i) || output.match(/状态:\s*(.+)/i);
      const taskStatus = statusMatch?.[1]?.trim() || '未知';

      const isRunning = taskStatus.toLowerCase() === 'running' || taskStatus === '正在运行';
      const statusIcon = isRunning ? green('✓') : yellow('⚠');
      console.log(`  ${statusIcon} 计划任务: ${bold(taskStatus)}`);

      // 上次运行时间
      const lastRunMatch = output.match(/Last Run Time:\s*(.+)/i) || output.match(/上次运行时间:\s*(.+)/i);
      if (lastRunMatch) {
        console.log(`    ${dim('上次运行:')} ${lastRunMatch[1].trim()}`);
      }

      // 上次运行结果
      const lastResultMatch = output.match(/Last Result:\s*(.+)/i) || output.match(/上次结果:\s*(.+)/i);
      if (lastResultMatch) {
        console.log(`    ${dim('上次结果:')} ${lastResultMatch[1].trim()}`);
      }
    }
  } else {
    console.log(`  ${yellow('⚠')} 计划任务: ${dim('仅支持 Windows')}`);
  }

  // 2. 检查 PID 文件
  const pidFile = paths.pidFile();

  if (existsSync(pidFile)) {
    try {
      const pid = parseInt(readFileSync(pidFile, 'utf-8').trim(), 10);

      if (isNaN(pid)) {
        console.log(`  ${yellow('⚠')} 后台进程: ${dim('PID 文件损坏')}`);
      } else {
        // 检查进程是否存活（signal 0 只做检查不发送信号）
        try {
          process.kill(pid, 0);
          console.log(`  ${green('✓')} 后台进程: ${bold('运行中')} ${dim(`(PID: ${pid})`)}`);
        } catch {
          console.log(`  ${red('✗')} 后台进程: ${dim(`已停止 (PID 文件残留: ${pid})`)}`);
        }
      }
    } catch {
      console.log(`  ${yellow('⚠')} 后台进程: ${dim('PID 文件无法读取')}`);
    }
  } else {
    console.log(`  ${dim('  后台进程: 未运行 (无 PID 文件)')}`);
  }

  // 3. 路径信息
  console.log('');
  console.log(`  ${dim('PID 文件:')} ${pidFile}`);
  console.log(`  ${dim('日志目录:')} ${paths.logs()}`);
  console.log('');
}

// ==================== start ====================

/**
 * 手动启动后台进程（使用 detached spawn）
 */
async function startDaemon(): Promise<void> {
  const { paths, ensureDirectories } = await import('../paths.js');
  ensureDirectories();

  const pidFile = paths.pidFile();

  // 检查是否已有进程运行
  if (existsSync(pidFile)) {
    try {
      const existingPid = parseInt(readFileSync(pidFile, 'utf-8').trim(), 10);

      if (!isNaN(existingPid)) {
        try {
          process.kill(existingPid, 0);
          console.log(yellow('⚠') + ` FlashClaw 已在运行中 (PID: ${existingPid})`);
          console.log(`  使用 ${cyan('flashclaw daemon stop')} 先停止当前进程`);
          return;
        } catch {
          // 进程不存在，清理残留 PID 文件
          unlinkSync(pidFile);
        }
      }
    } catch {
      // 忽略读取错误
    }
  }

  console.log(`\n${yellow('⚡')} 正在启动 FlashClaw 后台进程...\n`);

  const nodePath = process.execPath;
  const cliPath = resolveCliPath();

  // 确保日志目录存在
  const logsDir = paths.logs();
  if (!existsSync(logsDir)) {
    mkdirSync(logsDir, { recursive: true });
  }

  // stdout/stderr 重定向到日志文件
  const outLogPath = join(logsDir, 'flashclaw-daemon.out.log');
  const errLogPath = join(logsDir, 'flashclaw-daemon.err.log');
  const outFd = openSync(outLogPath, 'a');
  const errFd = openSync(errLogPath, 'a');

  // 以 detached 模式启动子进程
  const child = spawn(nodePath, [cliPath, 'start'], {
    detached: true,
    stdio: ['ignore', outFd, errFd],
    cwd: dirname(cliPath),
    windowsHide: true,
  });

  const pid = child.pid;
  if (!pid) {
    console.log(red('✗') + ' 启动失败：无法获取进程 PID');
    process.exit(1);
  }

  // 写入 PID 文件
  writeFileSync(pidFile, String(pid), 'utf-8');

  // 脱离父进程，让子进程独立运行
  child.unref();

  console.log(green('✓') + ` FlashClaw 后台进程已启动`);
  console.log(`  ${dim('PID:')}      ${pid}`);
  console.log(`  ${dim('日志输出:')} ${outLogPath}`);
  console.log(`  ${dim('错误日志:')} ${errLogPath}`);
  console.log(`\n  使用 ${cyan('flashclaw daemon status')} 查看状态`);
  console.log(`  使用 ${cyan('flashclaw daemon stop')} 停止进程\n`);
}

// ==================== stop ====================

/**
 * 停止后台进程
 */
async function stopDaemon(): Promise<void> {
  const { paths } = await import('../paths.js');
  const pidFile = paths.pidFile();

  console.log(`\n${yellow('⚡')} 正在停止 FlashClaw 后台进程...\n`);

  if (!existsSync(pidFile)) {
    console.log(yellow('⚠') + ' 未找到 PID 文件，进程可能未在运行');
    console.log(`  ${dim('PID 文件路径:')} ${pidFile}\n`);
    return;
  }

  try {
    const pid = parseInt(readFileSync(pidFile, 'utf-8').trim(), 10);

    if (isNaN(pid)) {
      console.log(red('✗') + ' PID 文件内容无效');
      unlinkSync(pidFile);
      return;
    }

    // 检查进程是否存活
    try {
      process.kill(pid, 0);
    } catch {
      console.log(yellow('⚠') + ` 进程 ${pid} 已不存在，清理 PID 文件`);
      unlinkSync(pidFile);
      return;
    }

    // 发送终止信号
    // Windows 上 SIGTERM 不被完全支持，使用 taskkill 更可靠
    if (process.platform === 'win32') {
      try {
        await execFileAsync('taskkill', ['/PID', String(pid), '/T', '/F'], {
          windowsHide: true,
        });
      } catch {
        // taskkill 失败时回退到 process.kill
        try {
          process.kill(pid);
        } catch {
          // 进程可能已经结束
        }
      }
    } else {
      process.kill(pid, 'SIGTERM');
    }

    // 删除 PID 文件
    try {
      unlinkSync(pidFile);
    } catch {
      // 忽略删除失败
    }

    console.log(green('✓') + ` FlashClaw 后台进程已停止 (PID: ${pid})\n`);
  } catch (error) {
    console.log(red('✗') + ` 停止失败: ${error}\n`);
  }
}

/**
 * 静默停止后台进程（用于 uninstall 时内部调用）
 */
async function stopDaemonSilent(): Promise<void> {
  try {
    const { paths } = await import('../paths.js');
    const pidFile = paths.pidFile();

    if (!existsSync(pidFile)) return;

    const pid = parseInt(readFileSync(pidFile, 'utf-8').trim(), 10);
    if (isNaN(pid)) {
      unlinkSync(pidFile);
      return;
    }

    try {
      process.kill(pid, 0);

      if (process.platform === 'win32') {
        await execFileAsync('taskkill', ['/PID', String(pid), '/T', '/F'], {
          windowsHide: true,
        });
      } else {
        process.kill(pid, 'SIGTERM');
      }
    } catch {
      // 进程不存在，忽略
    }

    try { unlinkSync(pidFile); } catch { /* 忽略 */ }
  } catch {
    // 忽略所有错误
  }
}

// ==================== 命令入口 ====================

const VALID_ACTIONS = ['install', 'uninstall', 'status', 'start', 'stop'] as const;
type DaemonAction = typeof VALID_ACTIONS[number];

/**
 * daemon 命令入口
 */
export async function daemonCommand(action: string): Promise<void> {
  if (!VALID_ACTIONS.includes(action as DaemonAction)) {
    console.log(red('✗') + ` 未知操作: ${action}`);
    console.log(`\n${bold('可用操作:')}`);
    console.log(`  ${cyan('install')}     创建 Windows 计划任务，开机自启`);
    console.log(`  ${cyan('uninstall')}   删除计划任务`);
    console.log(`  ${cyan('status')}      查看服务状态`);
    console.log(`  ${cyan('start')}       手动启动后台进程`);
    console.log(`  ${cyan('stop')}        停止后台进程`);
    console.log(`\n${bold('示例:')}`);
    console.log(`  flashclaw daemon install   安装为后台服务`);
    console.log(`  flashclaw daemon start     启动后台进程`);
    console.log(`  flashclaw daemon status    查看运行状态\n`);
    process.exit(1);
  }

  switch (action as DaemonAction) {
    case 'install':
      await installDaemon();
      break;
    case 'uninstall':
      await uninstallDaemon();
      break;
    case 'status':
      await statusDaemon();
      break;
    case 'start':
      await startDaemon();
      break;
    case 'stop':
      await stopDaemon();
      break;
  }
}

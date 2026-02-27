/**
 * FlashClaw 环境诊断命令
 * 快速检查运行环境，帮助用户排查问题
 */

import { existsSync, statSync } from 'fs';

// ==================== ANSI 颜色 ====================
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

/** 诊断项结果 */
type CheckStatus = 'ok' | 'warn' | 'fail';

interface CheckResult {
  status: CheckStatus;
  label: string;
  detail?: string;
}

/**
 * 执行环境诊断命令
 */
export async function doctorCommand(): Promise<void> {
  console.log(`\n${bold('⚡ FlashClaw 环境诊断')}\n`);

  const results: CheckResult[] = [];

  // 1. Node.js 版本
  results.push(checkNodeVersion());

  // 2. FlashClaw 主目录
  const { paths } = await import('../paths.js');
  results.push(checkDirectory('配置目录', paths.home()));

  // 3. .env 配置文件
  results.push(checkFile('.env 配置文件', paths.env()));

  // 4. API Key 配置
  const apiKeyResult = await checkApiKey(paths.env());
  results.push(apiKeyResult);

  // 5. API 连通性（仅在 Key 存在时测试）
  if (apiKeyResult.status === 'ok') {
    const connectResult = await checkApiConnectivity();
    results.push(connectResult);
  } else {
    results.push({ status: 'fail', label: 'API 连通性', detail: '跳过（未配置 API Key）' });
  }

  // 6. 数据库
  results.push(checkDatabase(paths.database()));

  // 7. 插件目录
  results.push(checkDirectory('内置插件目录', await getBuiltinPluginsPath()));
  results.push(checkDirectory('用户插件目录', paths.userPlugins()));

  // 8. 已加载插件数量
  results.push(await checkPlugins());

  // 9. 飞书配置
  results.push(checkFeishuConfig());

  // 10. 用户插件配置检查（通用：读取 plugin.json 的 config 字段）
  const userPluginResults = await checkUserPluginConfigs(paths.userPlugins());
  results.push(...userPluginResults);

  // 输出所有结果
  console.log('');
  for (const r of results) {
    const icon = r.status === 'ok' ? green('✓') : r.status === 'warn' ? yellow('⚠') : red('✗');
    const detail = r.detail ? ` ${dim(r.detail)}` : '';
    console.log(`  ${icon} ${r.label}${detail}`);
  }

  // 统计
  const okCount = results.filter(r => r.status === 'ok').length;
  const warnCount = results.filter(r => r.status === 'warn').length;
  const failCount = results.filter(r => r.status === 'fail').length;

  console.log('');
  if (failCount > 0) {
    console.log(`  ${red(`${failCount} 个问题`)} 需要修复`);
    console.log(`  运行 ${cyan('flashclaw init')} 进行初始化配置\n`);
  } else if (warnCount > 0) {
    console.log(`  ${green(`${okCount} 项正常`)}, ${yellow(`${warnCount} 项警告`)}`);
    console.log(`  整体状态: ${yellow('基本就绪')}\n`);
  } else {
    console.log(`  全部 ${green(`${okCount} 项检查通过`)}`);
    console.log(`  整体状态: ${green('运行就绪')} ⚡\n`);
  }
}

// ==================== 各项诊断检查 ====================

function checkNodeVersion(): CheckResult {
  const version = process.version;
  const major = parseInt(version.slice(1).split('.')[0], 10);

  if (major >= 20) {
    return { status: 'ok', label: 'Node.js 版本', detail: `${version} (>= 20)` };
  }
  return { status: 'fail', label: 'Node.js 版本', detail: `${version} (需要 >= 20)` };
}

function checkDirectory(label: string, dirPath: string): CheckResult {
  if (existsSync(dirPath)) {
    return { status: 'ok', label, detail: dirPath };
  }
  return { status: 'fail', label, detail: `不存在: ${dirPath}` };
}

function checkFile(label: string, filePath: string): CheckResult {
  if (existsSync(filePath)) {
    return { status: 'ok', label, detail: filePath };
  }
  return { status: 'fail', label, detail: `不存在 (运行 flashclaw init 创建)` };
}

async function checkApiKey(envPath: string): Promise<CheckResult> {
  // 先检查环境变量（可能通过其他方式设置）
  const envKey = process.env.ANTHROPIC_AUTH_TOKEN || process.env.ANTHROPIC_API_KEY;
  if (envKey) {
    const masked = envKey.slice(0, 8) + '...' + envKey.slice(-4);
    return { status: 'ok', label: 'API Key', detail: masked };
  }

  // 尝试从 .env 文件读取
  if (existsSync(envPath)) {
    try {
      const { readFileSync } = await import('fs');
      const content = readFileSync(envPath, 'utf-8');
      const match = content.match(/ANTHROPIC_AUTH_TOKEN=(.+)/);
      const key = match?.[1]?.trim();
      if (key && key !== 'sk-xxx' && key.length > 5) {
        const masked = key.slice(0, 8) + '...' + key.slice(-4);
        return { status: 'ok', label: 'API Key', detail: masked };
      }
    } catch {
      // 忽略读取错误
    }
  }

  return { status: 'fail', label: 'API Key', detail: '未配置 (运行 flashclaw init 设置)' };
}

async function checkApiConnectivity(): Promise<CheckResult> {
  try {
    const apiKey = process.env.ANTHROPIC_AUTH_TOKEN || process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return { status: 'fail', label: 'API 连通性', detail: '无 Key' };

    const baseUrl = process.env.ANTHROPIC_BASE_URL;
    const model = process.env.AI_MODEL || process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514';

    const Anthropic = (await import('@anthropic-ai/sdk')).default;
    const client = new Anthropic({
      apiKey,
      baseURL: baseUrl || undefined,
      maxRetries: 0,
      timeout: 10000,
    });

    const start = Date.now();
    await client.messages.create({
      model,
      max_tokens: 8,
      messages: [{ role: 'user', content: 'hi' }],
    });
    const elapsed = Date.now() - start;

    return { status: 'ok', label: 'API 连通性', detail: `${model}, 响应 ${elapsed}ms` };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // 截断过长的错误信息
    const short = msg.length > 60 ? msg.slice(0, 60) + '...' : msg;
    return { status: 'fail', label: 'API 连通性', detail: short };
  }
}

function checkDatabase(dbPath: string): CheckResult {
  if (existsSync(dbPath)) {
    try {
      const stat = statSync(dbPath);
      const sizeMB = (stat.size / (1024 * 1024)).toFixed(1);
      return { status: 'ok', label: '数据库', detail: `${dbPath} (${sizeMB} MB)` };
    } catch {
      return { status: 'warn', label: '数据库', detail: '文件存在但无法读取' };
    }
  }
  return { status: 'warn', label: '数据库', detail: '尚未创建 (首次启动时自动创建)' };
}

async function getBuiltinPluginsPath(): Promise<string> {
  try {
    const { getBuiltinPluginsDir } = await import('../paths.js');
    return getBuiltinPluginsDir();
  } catch {
    return 'unknown';
  }
}

async function checkPlugins(): Promise<CheckResult> {
  try {
    const { getBuiltinPluginsDir } = await import('../paths.js');
    const { readdirSync } = await import('fs');
    const { join } = await import('path');

    const builtinDir = getBuiltinPluginsDir();
    if (!existsSync(builtinDir)) {
      return { status: 'warn', label: '内置插件', detail: '目录不存在' };
    }

    const entries = readdirSync(builtinDir, { withFileTypes: true });
    const pluginNames: string[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const manifestPath = join(builtinDir, entry.name, 'plugin.json');
      if (existsSync(manifestPath)) {
        pluginNames.push(entry.name);
      }
    }

    if (pluginNames.length === 0) {
      return { status: 'warn', label: '内置插件', detail: '无插件' };
    }

    const names = pluginNames.slice(0, 5).join(', ');
    const suffix = pluginNames.length > 5 ? `...等 ${pluginNames.length} 个` : `共 ${pluginNames.length} 个`;
    return { status: 'ok', label: '内置插件', detail: `${names} (${suffix})` };
  } catch {
    return { status: 'warn', label: '内置插件', detail: '检查失败' };
  }
}

function checkFeishuConfig(): CheckResult {
  const appId = process.env.FEISHU_APP_ID;
  const appSecret = process.env.FEISHU_APP_SECRET;

  if (appId && appSecret) {
    return { status: 'ok', label: '飞书配置', detail: `App ID: ${appId.slice(0, 8)}...` };
  }
  return { status: 'warn', label: '飞书配置', detail: '未配置 (可选)' };
}

/**
 * 通用：检查用户已安装插件的环境变量配置
 * 读取每个插件的 plugin.json config 字段，检查 required env 是否已设置
 */
async function checkUserPluginConfigs(userPluginsDir: string): Promise<CheckResult[]> {
  const results: CheckResult[] = [];

  if (!existsSync(userPluginsDir)) return results;

  try {
    const { readdirSync, readFileSync } = await import('fs');
    const { join } = await import('path');
    const entries = readdirSync(userPluginsDir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const manifestPath = join(userPluginsDir, entry.name, 'plugin.json');
      if (!existsSync(manifestPath)) continue;

      try {
        const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
        if (!manifest.config) continue;

        // 检查所有 required 的 env 变量
        const missingEnvs: string[] = [];
        const configuredEnvs: string[] = [];

        for (const [key, cfg] of Object.entries(manifest.config)) {
          const envName = (cfg as any)?.env;
          const required = (cfg as any)?.required;
          if (!envName) continue;

          if (process.env[envName]) {
            configuredEnvs.push(envName);
          } else if (required) {
            missingEnvs.push(envName);
          }
        }

        const label = `插件 ${manifest.name || entry.name}`;

        if (missingEnvs.length > 0) {
          results.push({
            status: 'warn',
            label,
            detail: `缺少环境变量: ${missingEnvs.join(', ')}`,
          });
        } else if (configuredEnvs.length > 0) {
          results.push({
            status: 'ok',
            label,
            detail: `已配置 (${configuredEnvs.length} 个环境变量)`,
          });
        }
      } catch {
        // 单个插件解析失败跳过
      }
    }
  } catch {
    // 目录读取失败跳过
  }

  return results;
}

/**
 * FlashClaw 安全审计命令
 * 检查配置和环境的安全隐患，帮助用户加固部署
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { join, resolve } from 'path';
import { homedir } from 'os';

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

/** 审计项结果 */
type CheckStatus = 'ok' | 'warn' | 'fail';

interface CheckResult {
  status: CheckStatus;
  label: string;
  detail?: string;
}

/**
 * 执行安全审计命令
 */
export async function securityAuditCommand(): Promise<void> {
  console.log(`\n${bold('🔒 FlashClaw 安全审计')}\n`);

  const { paths } = await import('../paths.js');
  const results: CheckResult[] = [];

  // 1. API Key 安全
  results.push(...checkApiKeySecurity(paths.env()));

  // 2. .env 文件安全
  results.push(...checkEnvFileSecurity(paths.env()));

  // 3. 数据目录安全
  results.push(...checkDataDirSecurity(paths.home()));

  // 4. Telegram 白名单
  results.push(...checkTelegramSecurity());

  // 5. 代理安全
  results.push(...checkProxySecurity());

  // 6. 日志安全
  results.push(...checkLogSecurity());

  // 7. 插件安全
  results.push(...checkPluginSecurity(paths.userPlugins()));

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
    console.log(`  ${red(`${failCount} 个安全问题`)} 需要立即修复`);
    if (warnCount > 0) {
      console.log(`  ${yellow(`${warnCount} 个安全警告`)} 建议处理`);
    }
    console.log(`  整体评估: ${red('存在风险')} 🚨\n`);
  } else if (warnCount > 0) {
    console.log(`  ${green(`${okCount} 项安全`)}, ${yellow(`${warnCount} 项警告`)}`);
    console.log(`  整体评估: ${yellow('基本安全')} ⚠\n`);
  } else {
    console.log(`  全部 ${green(`${okCount} 项检查通过`)}`);
    console.log(`  整体评估: ${green('安全就绪')} 🔒\n`);
  }
}

// ==================== 1. API Key 安全 ====================

function checkApiKeySecurity(envPath: string): CheckResult[] {
  const results: CheckResult[] = [];

  // 从环境变量或 .env 文件获取 key
  let apiKey = process.env.ANTHROPIC_AUTH_TOKEN || process.env.ANTHROPIC_API_KEY || '';

  if (!apiKey && existsSync(envPath)) {
    try {
      const content = readFileSync(envPath, 'utf-8');
      const match = content.match(/ANTHROPIC_(?:AUTH_TOKEN|API_KEY)=(.+)/);
      apiKey = match?.[1]?.trim() || '';
    } catch {
      // 忽略读取错误
    }
  }

  // 检查是否已配置
  if (!apiKey) {
    results.push({ status: 'fail', label: 'API Key 配置', detail: '未配置 API Key' });
    return results;
  }

  results.push({ status: 'ok', label: 'API Key 配置', detail: '已配置' });

  // 检查是否使用了测试/假 Key
  const lowerKey = apiKey.toLowerCase();
  const testPatterns = ['test', 'fake', 'example', 'demo', 'placeholder', 'xxx', 'your-key', 'sk-xxx', 'your_api_key'];
  const isTestKey = testPatterns.some(p => lowerKey.includes(p));

  if (isTestKey) {
    results.push({ status: 'fail', label: 'API Key 有效性', detail: '检测到测试/示例 Key，请使用真实 Key' });
  } else if (apiKey.length < 20) {
    results.push({ status: 'warn', label: 'API Key 有效性', detail: `长度 ${apiKey.length}，看起来过短` });
  } else {
    results.push({ status: 'ok', label: 'API Key 有效性', detail: '未检测到明显问题' });
  }

  return results;
}

// ==================== 2. .env 文件安全 ====================

function checkEnvFileSecurity(envPath: string): CheckResult[] {
  const results: CheckResult[] = [];

  // 检查 ~/.flashclaw/.env
  if (existsSync(envPath)) {
    results.push({ status: 'ok', label: '.env 文件 (主目录)', detail: envPath });

    // Windows 下检查是否在公共目录
    if (process.platform === 'win32') {
      const publicCheck = checkWindowsPublicDir(envPath);
      if (publicCheck) {
        results.push(publicCheck);
      }
    }
  } else {
    results.push({ status: 'warn', label: '.env 文件 (主目录)', detail: '不存在（运行 flashclaw init 创建）' });
  }

  // 检查项目根目录 .env（如果存在，可能包含敏感信息）
  const projectRootEnv = resolve(process.cwd(), '.env');
  if (existsSync(projectRootEnv)) {
    // 检查项目根 .env 是否包含 API Key 等敏感信息
    try {
      const content = readFileSync(projectRootEnv, 'utf-8');
      const hasSensitive = /(?:API_KEY|AUTH_TOKEN|SECRET|PASSWORD)=/i.test(content);
      if (hasSensitive) {
        results.push({
          status: 'warn',
          label: '.env 文件 (项目根)',
          detail: '包含敏感信息，请确保已加入 .gitignore',
        });

        // 检查 .gitignore 是否包含 .env
        const gitignorePath = resolve(process.cwd(), '.gitignore');
        if (existsSync(gitignorePath)) {
          const gitignore = readFileSync(gitignorePath, 'utf-8');
          const hasEnvRule = gitignore.split('\n').some(line => {
            const trimmed = line.trim();
            return trimmed === '.env' || trimmed === '.env*' || trimmed === '*.env';
          });
          if (!hasEnvRule) {
            results.push({
              status: 'warn',
              label: '.gitignore 保护',
              detail: '.gitignore 未包含 .env 规则，敏感信息可能被提交',
            });
          } else {
            results.push({ status: 'ok', label: '.gitignore 保护', detail: '.env 已在 .gitignore 中' });
          }
        }
      } else {
        results.push({ status: 'ok', label: '.env 文件 (项目根)', detail: '存在但未包含敏感信息' });
      }
    } catch {
      results.push({ status: 'warn', label: '.env 文件 (项目根)', detail: '存在但无法读取' });
    }
  }

  return results;
}

/**
 * Windows 下检查路径是否在公共目录中
 * 公共目录如 C:\Users\Public 下的文件所有用户可访问
 */
function checkWindowsPublicDir(filePath: string): CheckResult | null {
  const normalized = filePath.toLowerCase().replace(/\//g, '\\');

  // 检查常见公共目录
  const publicPaths = [
    join(homedir(), '..', 'Public').toLowerCase().replace(/\//g, '\\'),
    'c:\\users\\public',
    'c:\\temp',
    'c:\\tmp',
  ];

  for (const pubPath of publicPaths) {
    if (normalized.startsWith(pubPath)) {
      return {
        status: 'fail',
        label: '.env 文件位置',
        detail: `位于公共目录 ${pubPath}，所有用户可访问！请移至私有目录`,
      };
    }
  }

  // 检查桌面目录（可能被他人物理访问到）
  const desktopPath = join(homedir(), 'Desktop').toLowerCase().replace(/\//g, '\\');
  const oneDriveDesktop = join(homedir(), 'OneDrive', 'Desktop').toLowerCase().replace(/\//g, '\\');

  if (normalized.startsWith(desktopPath) || normalized.startsWith(oneDriveDesktop)) {
    return {
      status: 'warn',
      label: '.env 文件位置',
      detail: '位于桌面目录，可能被意外访问',
    };
  }

  return null;
}

// ==================== 3. 数据目录安全 ====================

function checkDataDirSecurity(flashclawHome: string): CheckResult[] {
  const results: CheckResult[] = [];

  // 检查 ~/.flashclaw/ 是否存在
  if (!existsSync(flashclawHome)) {
    results.push({
      status: 'warn',
      label: '数据目录',
      detail: `${flashclawHome} 不存在（运行 flashclaw init 创建）`,
    });
    return results;
  }

  results.push({ status: 'ok', label: '数据目录', detail: flashclawHome });

  // 检查目录权限（Unix 系统下检查文件模式）
  if (process.platform !== 'win32') {
    try {
      const stat = statSync(flashclawHome);
      const mode = stat.mode & 0o777;
      // 权限过于开放（其他用户可读写）
      if (mode & 0o007) {
        results.push({
          status: 'warn',
          label: '数据目录权限',
          detail: `权限 ${mode.toString(8)}，其他用户可访问，建议 chmod 700`,
        });
      } else {
        results.push({ status: 'ok', label: '数据目录权限', detail: `权限 ${mode.toString(8)}` });
      }
    } catch {
      results.push({ status: 'warn', label: '数据目录权限', detail: '无法读取权限信息' });
    }
  } else {
    // Windows: 检查目录是否在公共位置
    const publicCheck = checkWindowsPublicDir(flashclawHome);
    if (publicCheck) {
      publicCheck.label = '数据目录位置';
      results.push(publicCheck);
    } else {
      results.push({ status: 'ok', label: '数据目录位置', detail: '位于私有用户目录' });
    }
  }

  // 检查数据库文件
  const dbPath = join(flashclawHome, 'data', 'flashclaw.db');
  if (existsSync(dbPath)) {
    try {
      const stat = statSync(dbPath);
      const sizeMB = (stat.size / (1024 * 1024)).toFixed(1);
      results.push({ status: 'ok', label: '数据库文件', detail: `${sizeMB} MB` });
    } catch {
      results.push({ status: 'warn', label: '数据库文件', detail: '存在但无法读取' });
    }
  }

  return results;
}

// ==================== 4. Telegram 白名单 ====================

function checkTelegramSecurity(): CheckResult[] {
  const results: CheckResult[] = [];

  const telegramToken = process.env.TELEGRAM_BOT_TOKEN;
  const allowedUsers = process.env.TELEGRAM_ALLOWED_USERS;

  if (!telegramToken) {
    results.push({ status: 'ok', label: 'Telegram 渠道', detail: '未启用（无需检查）' });
    return results;
  }

  // Telegram 已启用，检查白名单
  if (allowedUsers && allowedUsers.trim().length > 0) {
    const userCount = allowedUsers.split(',').filter(u => u.trim()).length;
    results.push({
      status: 'ok',
      label: 'Telegram 用户白名单',
      detail: `已配置 ${userCount} 个允许用户`,
    });
  } else {
    results.push({
      status: 'warn',
      label: 'Telegram 用户白名单',
      detail: '未配置 TELEGRAM_ALLOWED_USERS，任何人可使用机器人',
    });
  }

  return results;
}

// ==================== 5. 代理安全 ====================

function checkProxySecurity(): CheckResult[] {
  const results: CheckResult[] = [];

  const httpProxy = process.env.HTTP_PROXY || process.env.http_proxy || '';
  const httpsProxy = process.env.HTTPS_PROXY || process.env.https_proxy || '';
  const telegramProxy = process.env.TELEGRAM_PROXY || '';

  const allProxies = [httpProxy, httpsProxy, telegramProxy].filter(Boolean);

  if (allProxies.length === 0) {
    results.push({ status: 'ok', label: '代理配置', detail: '未使用代理' });
    return results;
  }

  for (const proxy of allProxies) {
    try {
      const url = new URL(proxy);
      const host = url.hostname;

      // 检查是否指向公网（非本机/内网地址）
      const isLocal = isLocalAddress(host);

      if (isLocal) {
        results.push({
          status: 'ok',
          label: '代理地址',
          detail: `${proxy} (本地代理)`,
        });
      } else {
        results.push({
          status: 'warn',
          label: '代理地址',
          detail: `${proxy} 指向公网，流量经第三方转发，存在泄露风险`,
        });
      }
    } catch {
      results.push({
        status: 'warn',
        label: '代理地址',
        detail: `${proxy} 格式不正确`,
      });
    }
  }

  return results;
}

/**
 * 判断地址是否为本地/内网地址
 */
function isLocalAddress(host: string): boolean {
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return true;
  // 内网地址段
  if (host.startsWith('192.168.')) return true;
  if (host.startsWith('10.')) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return true;
  return false;
}

// ==================== 6. 日志安全 ====================

function checkLogSecurity(): CheckResult[] {
  const results: CheckResult[] = [];

  const logLevel = (process.env.LOG_LEVEL || 'info').toLowerCase();

  if (logLevel === 'debug') {
    results.push({
      status: 'warn',
      label: '日志级别',
      detail: 'debug 级别可能泄露敏感信息，生产环境建议使用 info 或 warn',
    });
  } else {
    results.push({ status: 'ok', label: '日志级别', detail: logLevel });
  }

  // 检查环境变量中敏感键的数量（提醒用户注意日志输出）
  const sensitivePatterns = ['PASSWORD', 'SECRET', 'TOKEN', 'API_KEY', 'AUTH_TOKEN', 'PRIVATE_KEY'];
  const envKeys = Object.keys(process.env);
  const sensitiveEnvVars = envKeys.filter(key =>
    sensitivePatterns.some(sp => key.toUpperCase().includes(sp)) && process.env[key],
  );

  if (sensitiveEnvVars.length > 0) {
    const preview = sensitiveEnvVars.slice(0, 3).join(', ');
    const suffix = sensitiveEnvVars.length > 3 ? `...共 ${sensitiveEnvVars.length} 个` : '';
    results.push({
      status: 'ok',
      label: '敏感环境变量',
      detail: `检测到 ${preview}${suffix}，请确保日志中不输出其值`,
    });
  } else {
    results.push({ status: 'ok', label: '敏感环境变量', detail: '未检测到敏感环境变量' });
  }

  return results;
}

// ==================== 7. 插件安全 ====================

function checkPluginSecurity(userPluginsDir: string): CheckResult[] {
  const results: CheckResult[] = [];

  if (!existsSync(userPluginsDir)) {
    results.push({ status: 'ok', label: '用户插件', detail: '目录不存在，无需检查' });
    return results;
  }

  try {
    const entries = readdirSync(userPluginsDir, { withFileTypes: true });
    const dirs = entries.filter(e => e.isDirectory());

    if (dirs.length === 0) {
      results.push({ status: 'ok', label: '用户插件', detail: '无已安装插件' });
      return results;
    }

    const suspicious: string[] = [];
    const untrusted: string[] = [];
    let validCount = 0;

    for (const dir of dirs) {
      const manifestPath = join(userPluginsDir, dir.name, 'plugin.json');

      if (!existsSync(manifestPath)) {
        suspicious.push(dir.name);
        continue;
      }

      try {
        const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));

        // 检查插件来源：有 source 字段且指向官方仓库认为可信
        const source: string = manifest.source || '';
        const isTrusted = !source || source.includes('github.com/GuLu9527/flashclaw');

        if (!isTrusted) {
          untrusted.push(`${dir.name} (${source})`);
        } else {
          validCount++;
        }
      } catch {
        suspicious.push(dir.name);
      }
    }

    // 报告结果
    if (suspicious.length > 0) {
      results.push({
        status: 'warn',
        label: '可疑插件目录',
        detail: `${suspicious.join(', ')} 缺少 plugin.json 或格式错误`,
      });
    }

    if (untrusted.length > 0) {
      results.push({
        status: 'warn',
        label: '第三方插件',
        detail: `${untrusted.join(', ')} 来自非官方源，请确认可信`,
      });
    }

    if (validCount > 0) {
      results.push({
        status: 'ok',
        label: '用户插件',
        detail: `${validCount} 个插件来源正常`,
      });
    }
  } catch {
    results.push({ status: 'warn', label: '用户插件', detail: '无法读取插件目录' });
  }

  return results;
}

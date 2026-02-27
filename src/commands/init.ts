/**
 * FlashClaw 交互式初始化向导
 * 引导用户完成首次配置，生成 ~/.flashclaw/.env
 */

import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

// ==================== ANSI 颜色（与 cli.ts 保持一致） ====================
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

// ==================== 预定义模型列表 ====================
const MODELS = [
  { value: 'claude-sonnet-4-20250514', label: 'Claude Sonnet 4 (推荐，平衡性能与速度)' },
  { value: 'claude-opus-4-20250514', label: 'Claude Opus 4 (最强，适合复杂任务)' },
  { value: 'claude-4-5-sonnet-20250929', label: 'Claude 4.5 Sonnet (最新)' },
  { value: 'claude-3-5-haiku-20241022', label: 'Claude 3.5 Haiku (最快，适合简单任务)' },
];

/**
 * 交互式初始化命令
 * 
 * @param flags - CLI 标志参数
 *   - non-interactive: 非交互式模式
 *   - api-key: 直接传入 API Key（非交互式模式用）
 */
export async function initCommand(flags: Record<string, string | boolean>): Promise<void> {
  const { paths, ensureDirectories } = await import('../paths.js');

  const envPath = paths.env();
  const isFirstTime = !existsSync(envPath);
  const nonInteractive = flags['non-interactive'] === true;

  // 非交互式模式
  if (nonInteractive) {
    await runNonInteractive(flags, envPath, ensureDirectories);
    return;
  }

  // 交互式模式：动态导入 @clack/prompts
  let prompts: typeof import('@clack/prompts');
  try {
    prompts = await import('@clack/prompts');
  } catch {
    console.log(red('✗') + ' 缺少依赖 @clack/prompts，请先运行: npm install @clack/prompts');
    process.exit(1);
  }

  await runInteractive(prompts, envPath, isFirstTime, paths, ensureDirectories);
}

// ==================== 非交互式模式 ====================

async function runNonInteractive(
  flags: Record<string, string | boolean>,
  envPath: string,
  ensureDirectories: () => void,
): Promise<void> {
  const apiKey = typeof flags['api-key'] === 'string' ? flags['api-key'] : '';

  if (!apiKey) {
    console.log(red('✗') + ' 非交互式模式需要 --api-key 参数');
    console.log(`\n用法: ${cyan('flashclaw init --non-interactive --api-key sk-xxx')}`);
    process.exit(1);
  }

  console.log(`${yellow('⚡')} FlashClaw 非交互式初始化...\n`);

  // 创建目录
  ensureDirectories();
  console.log(`  ${green('✓')} 目录结构已创建`);

  // 生成 .env
  const baseUrl = typeof flags['base-url'] === 'string' ? flags['base-url'] : 'https://api.anthropic.com';
  const model = typeof flags['model'] === 'string' ? flags['model'] : 'claude-sonnet-4-20250514';
  const botName = typeof flags['bot-name'] === 'string' ? flags['bot-name'] : 'FlashClaw';

  const envContent = buildEnvContent({ apiKey, baseUrl, model, botName });
  writeFileSync(envPath, envContent, 'utf-8');
  console.log(`  ${green('✓')} 配置文件已生成: ${dim(envPath)}`);

  // 验证 API 连通性
  const ok = await testApiConnection(apiKey, baseUrl, model);
  if (ok) {
    console.log(`  ${green('✓')} API 连通性验证通过`);
  } else {
    console.log(`  ${yellow('⚠')} API 连通性验证失败，请检查配置`);
  }

  console.log(`\n${green('✓')} 初始化完成！运行 ${cyan('flashclaw start')} 启动服务`);
}

// ==================== 交互式模式 ====================

async function runInteractive(
  prompts: typeof import('@clack/prompts'),
  envPath: string,
  isFirstTime: boolean,
  paths: { home: () => string; env: () => string },
  ensureDirectories: () => void,
): Promise<void> {
  prompts.intro(`${colors.yellow}⚡ FlashClaw 初始化向导${colors.reset}`);

  // 已有配置时询问是否重新配置
  if (!isFirstTime) {
    const shouldReconfigure = await prompts.confirm({
      message: '检测到已有配置文件，是否重新配置？',
      initialValue: false,
    });

    if (prompts.isCancel(shouldReconfigure) || !shouldReconfigure) {
      prompts.outro('已取消，现有配置保持不变');
      return;
    }
  }

  // Step 1: 创建目录结构
  const s = prompts.spinner();
  s.start('创建目录结构...');
  ensureDirectories();
  s.stop(`目录结构已就绪 ${dim(paths.home())}`);

  // Step 2: API Key
  const apiKey = await prompts.password({
    message: 'Anthropic API Key (必填)',
    validate: (value) => {
      if (!value || value.trim().length === 0) return '请输入 API Key';
      return undefined;
    },
  });

  if (prompts.isCancel(apiKey)) {
    prompts.cancel('已取消初始化');
    process.exit(0);
  }

  // Step 3: Base URL
  const baseUrl = await prompts.text({
    message: 'API Base URL',
    placeholder: 'https://api.anthropic.com',
    defaultValue: 'https://api.anthropic.com',
    validate: (value) => {
      if (value && !value.startsWith('http')) return 'URL 必须以 http:// 或 https:// 开头';
      return undefined;
    },
  });

  if (prompts.isCancel(baseUrl)) {
    prompts.cancel('已取消初始化');
    process.exit(0);
  }

  // Step 4: 模型选择
  const model = await prompts.select({
    message: '选择默认 AI 模型',
    options: MODELS.map(m => ({ value: m.value, label: m.label })),
    initialValue: 'claude-sonnet-4-20250514',
  });

  if (prompts.isCancel(model)) {
    prompts.cancel('已取消初始化');
    process.exit(0);
  }

  // Step 5: Bot 名称
  const botName = await prompts.text({
    message: '机器人名称',
    placeholder: 'FlashClaw',
    defaultValue: 'FlashClaw',
  });

  if (prompts.isCancel(botName)) {
    prompts.cancel('已取消初始化');
    process.exit(0);
  }

  // Step 6: AI 人格设定（可选）
  const configSoul = await prompts.confirm({
    message: '是否设置 AI 人格？(让 Bot 有独特的性格和语调)',
    initialValue: false,
  });

  if (!prompts.isCancel(configSoul) && configSoul) {
    const soulContent = await prompts.text({
      message: '描述你希望 AI 拥有的人格（直接输入，或稍后编辑 SOUL.md）',
      placeholder: '例如：你是一只幽默的龙虾，说话简短有力，偶尔用海洋相关的比喻',
    });

    if (!prompts.isCancel(soulContent) && soulContent && (soulContent as string).trim()) {
      const { mkdirSync } = await import('fs');
      const soulPath = join(paths.home(), 'SOUL.md');
      mkdirSync(dirname(soulPath), { recursive: true });
      writeFileSync(soulPath, (soulContent as string).trim() + '\n', 'utf-8');
      prompts.log.success(`人格设定已保存到 ${dim(soulPath)}`);
      prompts.log.info(`提示: 可随时编辑该文件修改人格，删除文件则恢复默认`);
    }
  }

  // Step 7: 飞书配置（可选）
  let feishuAppId = '';
  let feishuAppSecret = '';

  const configFeishu = await prompts.confirm({
    message: '是否配置飞书渠道？(可稍后再配置)',
    initialValue: false,
  });

  if (!prompts.isCancel(configFeishu) && configFeishu) {
    const appId = await prompts.text({
      message: '飞书 App ID',
      placeholder: '从飞书开放平台获取',
      validate: (v) => (!v?.trim() ? '请输入 App ID' : undefined),
    });
    if (!prompts.isCancel(appId)) feishuAppId = appId;

    const appSecret = await prompts.password({
      message: '飞书 App Secret',
      validate: (v) => (!v?.trim() ? '请输入 App Secret' : undefined),
    });
    if (!prompts.isCancel(appSecret)) feishuAppSecret = appSecret;
  }

  // Step 8: 生成配置文件
  s.start('写入配置文件...');

  const envContent = buildEnvContent({
    apiKey: apiKey as string,
    baseUrl: (baseUrl as string) || 'https://api.anthropic.com',
    model: model as string,
    botName: (botName as string) || 'FlashClaw',
    feishuAppId,
    feishuAppSecret,
  });

  writeFileSync(envPath, envContent, 'utf-8');
  s.stop(`配置文件已保存到 ${dim(envPath)}`);

  // Step 9: 验证 API 连通性
  s.start('验证 API 连通性...');
  const ok = await testApiConnection(
    apiKey as string,
    (baseUrl as string) || 'https://api.anthropic.com',
    model as string,
  );

  if (ok) {
    s.stop(`${green('✓')} API 连通性验证通过`);
  } else {
    s.stop(`${yellow('⚠')} API 验证失败，请稍后检查配置（不影响初始化）`);
  }

  // 完成
  prompts.outro(`${green('初始化完成！')} 运行 ${cyan('flashclaw start')} 启动服务`);

  // 额外提示
  console.log(`
${bold('下一步:')}
  ${cyan('flashclaw start')}                 启动服务
  ${cyan('flashclaw doctor')}                检查运行环境
  ${cyan('flashclaw plugins list --available')}  查看可用插件
`);
}

// ==================== 工具函数 ====================

interface EnvConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  botName: string;
  feishuAppId?: string;
  feishuAppSecret?: string;
}

/**
 * 生成 .env 文件内容
 */
function buildEnvContent(config: EnvConfig): string {
  let content = `# ⚡ FlashClaw 配置
# 由 flashclaw init 生成于 ${new Date().toLocaleString('zh-CN')}

# ==================== API 配置 (必需) ====================
ANTHROPIC_AUTH_TOKEN=${config.apiKey}
ANTHROPIC_BASE_URL=${config.baseUrl}
ANTHROPIC_MODEL=${config.model}

# ==================== 其他 ====================
BOT_NAME=${config.botName}
LOG_LEVEL=info
AGENT_TIMEOUT=300000
# TZ=Asia/Shanghai
`;

  if (config.feishuAppId && config.feishuAppSecret) {
    content += `
# ==================== 飞书 ====================
FEISHU_APP_ID=${config.feishuAppId}
FEISHU_APP_SECRET=${config.feishuAppSecret}
`;
  } else {
    content += `
# ==================== 飞书 (可选) ====================
# 从飞书开放平台获取: https://open.feishu.cn/app
# FEISHU_APP_ID=
# FEISHU_APP_SECRET=
`;
  }

  return content;
}

/**
 * 测试 API 连通性
 * 发送一条极简消息验证 API Key 是否有效
 */
async function testApiConnection(apiKey: string, baseUrl: string, model: string): Promise<boolean> {
  try {
    const Anthropic = (await import('@anthropic-ai/sdk')).default;
    const client = new Anthropic({
      apiKey,
      baseURL: baseUrl || undefined,
      maxRetries: 0,
      timeout: 15000,
    });

    await client.messages.create({
      model,
      max_tokens: 8,
      messages: [{ role: 'user', content: 'hi' }],
    });

    return true;
  } catch {
    return false;
  }
}

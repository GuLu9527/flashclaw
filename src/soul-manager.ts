/**
 * FlashClaw 人格管理器
 * 
 * 管理 SOUL.md 人格文件的查找、加载、切换。
 * 人格模板存放在项目 souls/ 目录，用户人格存放在 ~/.flashclaw/souls/。
 */

import fs from 'fs';
import path from 'path';
import { paths } from './paths.js';
import { createLogger } from './logger.js';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const logger = createLogger('SoulManager');

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/** 内置人格模板目录（项目内 souls/） */
function getBundledSoulsDir(): string {
  return path.join(__dirname, '..', 'souls');
}

export interface SoulInfo {
  name: string;
  title: string;
  path: string;
  isBuiltin: boolean;
}

/**
 * 从 SOUL.md 文件提取标题（第一个 # 标题行）
 */
function extractTitle(content: string): string {
  const match = content.match(/^#\s+(.+?)$/m);
  if (match) {
    // 去掉 "FlashClaw SOUL — " 前缀
    return match[1].replace(/^FlashClaw SOUL\s*[—–-]\s*/, '').trim();
  }
  return '';
}

/**
 * 确保用户 souls 目录中有默认模板
 * 首次运行时从项目内置 souls/ 复制到 ~/.flashclaw/souls/
 */
export function ensureSoulTemplates(): void {
  const userSoulsDir = paths.souls();
  const bundledDir = getBundledSoulsDir();

  if (!fs.existsSync(bundledDir)) return;

  try {
    const bundledFiles = fs.readdirSync(bundledDir).filter(f => f.endsWith('.md'));
    for (const file of bundledFiles) {
      const userPath = path.join(userSoulsDir, file);
      if (!fs.existsSync(userPath)) {
        fs.copyFileSync(path.join(bundledDir, file), userPath);
        logger.debug({ file }, '已复制内置人格模板');
      }
    }
  } catch (err) {
    logger.debug({ err }, '复制人格模板失败');
  }
}

/**
 * 列出所有可用人格
 */
export function listSouls(): SoulInfo[] {
  const userSoulsDir = paths.souls();
  const bundledDir = getBundledSoulsDir();
  const result: SoulInfo[] = [];
  const seen = new Set<string>();

  // 用户 souls 目录
  if (fs.existsSync(userSoulsDir)) {
    try {
      for (const file of fs.readdirSync(userSoulsDir)) {
        if (!file.endsWith('.md')) continue;
        const name = file.replace(/\.md$/, '');
        const fullPath = path.join(userSoulsDir, file);
        const content = fs.readFileSync(fullPath, 'utf-8');
        result.push({
          name,
          title: extractTitle(content) || name,
          path: fullPath,
          isBuiltin: false,
        });
        seen.add(name);
      }
    } catch { /* ignore */ }
  }

  // 内置 souls 目录（补充用户目录中没有的）
  if (fs.existsSync(bundledDir)) {
    try {
      for (const file of fs.readdirSync(bundledDir)) {
        if (!file.endsWith('.md')) continue;
        const name = file.replace(/\.md$/, '');
        if (seen.has(name)) continue;
        const fullPath = path.join(bundledDir, file);
        const content = fs.readFileSync(fullPath, 'utf-8');
        result.push({
          name,
          title: extractTitle(content) || name,
          path: fullPath,
          isBuiltin: true,
        });
      }
    } catch { /* ignore */ }
  }

  return result;
}

/**
 * 获取指定人格的内容
 */
export function getSoulContent(name: string): string | null {
  // 先找用户目录
  const userPath = path.join(paths.souls(), `${name}.md`);
  if (fs.existsSync(userPath)) {
    return fs.readFileSync(userPath, 'utf-8').trim();
  }
  // 再找内置目录
  const bundledPath = path.join(getBundledSoulsDir(), `${name}.md`);
  if (fs.existsSync(bundledPath)) {
    return fs.readFileSync(bundledPath, 'utf-8').trim();
  }
  return null;
}

/**
 * 获取当前会话使用的人格名称
 */
export function getCurrentSoulName(groupFolder: string): string | null {
  const groupDir = path.join(paths.groups(), groupFolder);
  const soulPath = path.join(groupDir, 'SOUL.md');
  
  if (fs.existsSync(soulPath)) {
    const content = fs.readFileSync(soulPath, 'utf-8').trim();
    // 尝试匹配已知人格
    const souls = listSouls();
    for (const soul of souls) {
      const soulContent = getSoulContent(soul.name);
      if (soulContent && soulContent === content) {
        return soul.name;
      }
    }
    return '(自定义)';
  }

  // 检查全局 SOUL.md
  const globalPath = path.join(paths.home(), 'SOUL.md');
  if (fs.existsSync(globalPath)) {
    const content = fs.readFileSync(globalPath, 'utf-8').trim();
    const souls = listSouls();
    for (const soul of souls) {
      const soulContent = getSoulContent(soul.name);
      if (soulContent && soulContent === content) {
        return soul.name;
      }
    }
    return '(自定义全局)';
  }

  return null;
}

/**
 * 切换当前会话的人格
 */
export function useSoul(groupFolder: string, soulName: string): boolean {
  const content = getSoulContent(soulName);
  if (!content) return false;

  const groupDir = path.join(paths.groups(), groupFolder);
  fs.mkdirSync(groupDir, { recursive: true });
  fs.writeFileSync(path.join(groupDir, 'SOUL.md'), content + '\n', 'utf-8');
  logger.info({ groupFolder, soul: soulName }, '⚡ 人格已切换');
  return true;
}

/**
 * 重置当前会话人格（删除会话级 SOUL.md，回退到全局）
 */
export function resetSoul(groupFolder: string): void {
  const groupDir = path.join(paths.groups(), groupFolder);
  const soulPath = path.join(groupDir, 'SOUL.md');
  if (fs.existsSync(soulPath)) {
    fs.unlinkSync(soulPath);
    logger.info({ groupFolder }, '⚡ 会话人格已重置');
  }
}

/**
 * 获取当前生效的 SOUL 内容摘要（用于 /soul show）
 */
export function getSoulSummary(groupFolder: string): string {
  const groupDir = path.join(paths.groups(), groupFolder);
  const soulSessionPath = path.join(groupDir, 'SOUL.md');
  const soulGlobalPath = path.join(paths.home(), 'SOUL.md');

  let content = '';
  let source = '';

  if (fs.existsSync(soulSessionPath)) {
    content = fs.readFileSync(soulSessionPath, 'utf-8').trim();
    source = '会话级';
  } else if (fs.existsSync(soulGlobalPath)) {
    content = fs.readFileSync(soulGlobalPath, 'utf-8').trim();
    source = '全局';
  } else {
    return '当前未设置人格（使用默认系统提示词）';
  }

  const title = extractTitle(content) || '自定义人格';
  const name = getCurrentSoulName(groupFolder);
  const preview = content.slice(0, 200) + (content.length > 200 ? '...' : '');

  return `**${title}**${name ? ` (${name})` : ''}\n来源: ${source}\n\n\`\`\`\n${preview}\n\`\`\``;
}

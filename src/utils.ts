import fs from 'fs';
import path from 'path';
import { substituteEnvVarsDeep } from './utils/env-substitute.js';
import { createLogger } from './logger.js';

const logger = createLogger('ConfigBackup');

// ============================================================================
// 配置备份功能
// ============================================================================

/**
 * 配置备份选项
 */
export interface BackupOptions {
  /** 最大备份数量，默认 5 */
  maxBackups?: number;
  /** 是否启用备份，默认 true */
  enabled?: boolean;
}

const DEFAULT_BACKUP_OPTIONS: Required<BackupOptions> = {
  maxBackups: 5,
  enabled: true,
};

/**
 * 转义正则表达式特殊字符
 */
function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 获取备份文件列表（按编号排序）
 * 返回格式：[{ path: string, number: number }, ...]
 */
export function getBackupFiles(filePath: string): Array<{ path: string; number: number }> {
  const dir = path.dirname(filePath);
  const baseName = path.basename(filePath);
  
  if (!fs.existsSync(dir)) {
    return [];
  }
  
  const files = fs.readdirSync(dir);
  const backupPattern = new RegExp(`^${escapeRegExp(baseName)}\\.bak\\.(\\d+)$`);
  
  const backups: Array<{ path: string; number: number }> = [];
  
  for (const file of files) {
    const match = file.match(backupPattern);
    if (match) {
      backups.push({
        path: path.join(dir, file),
        number: parseInt(match[1], 10),
      });
    }
  }
  
  // 按编号升序排序
  return backups.sort((a, b) => a.number - b.number);
}

/**
 * 轮转备份文件
 * 将现有备份编号+1，删除超出限制的旧备份
 */
export function rotateBackups(filePath: string, maxBackups: number): void {
  const backups = getBackupFiles(filePath);
  
  if (backups.length === 0) {
    return;
  }
  
  // 按编号降序处理（从大到小重命名，避免覆盖）
  const sortedDesc = [...backups].sort((a, b) => b.number - a.number);
  
  for (const backup of sortedDesc) {
    const newNumber = backup.number + 1;
    
    if (newNumber > maxBackups) {
      // 超出限制，删除
      try {
        fs.unlinkSync(backup.path);
        logger.debug({ path: backup.path }, '删除旧备份');
      } catch (err) {
        logger.warn({ path: backup.path, err }, '删除旧备份失败');
      }
    } else {
      // 重命名为新编号
      const newPath = backup.path.replace(/\.bak\.\d+$/, `.bak.${newNumber}`);
      try {
        fs.renameSync(backup.path, newPath);
      } catch (err) {
        logger.warn({ from: backup.path, to: newPath, err }, '重命名备份失败');
      }
    }
  }
}

/**
 * 创建配置文件备份
 * 
 * @param filePath 原配置文件路径
 * @param options 备份选项
 * @returns 是否备份成功
 */
export function backupConfig(filePath: string, options?: BackupOptions): boolean {
  const opts = { ...DEFAULT_BACKUP_OPTIONS, ...options };
  
  if (!opts.enabled) {
    return true;
  }
  
  // 如果原文件不存在，无需备份
  if (!fs.existsSync(filePath)) {
    return true;
  }
  
  try {
    // 先轮转现有备份
    rotateBackups(filePath, opts.maxBackups);
    
    // 创建新备份（编号为 1）
    const backupPath = `${filePath}.bak.1`;
    fs.copyFileSync(filePath, backupPath);
    
    logger.debug({ original: filePath, backup: backupPath }, '配置已备份');
    return true;
  } catch (err) {
    logger.warn({ filePath, err }, '配置备份失败');
    return false;
  }
}

/**
 * 列出可用的备份
 * 
 * @param filePath 原配置文件路径
 * @returns 备份信息列表
 */
export function listBackups(filePath: string): Array<{
  path: string;
  number: number;
  modifiedAt: Date;
  size: number;
}> {
  const backups = getBackupFiles(filePath);
  
  return backups.map((backup) => {
    try {
      const stat = fs.statSync(backup.path);
      return {
        ...backup,
        modifiedAt: stat.mtime,
        size: stat.size,
      };
    } catch {
      return {
        ...backup,
        modifiedAt: new Date(0),
        size: 0,
      };
    }
  });
}

/**
 * 从备份恢复配置
 * 
 * @param filePath 原配置文件路径
 * @param backupNumber 备份编号（1-5），默认恢复最新的备份（编号 1）
 * @returns 是否恢复成功
 */
export function restoreConfig(filePath: string, backupNumber = 1): boolean {
  const backupPath = `${filePath}.bak.${backupNumber}`;
  
  if (!fs.existsSync(backupPath)) {
    logger.error({ backupPath }, '备份文件不存在');
    return false;
  }
  
  try {
    // 先备份当前配置（如果存在）
    if (fs.existsSync(filePath)) {
      const currentBackupPath = `${filePath}.before-restore`;
      fs.copyFileSync(filePath, currentBackupPath);
      logger.debug({ path: currentBackupPath }, '已保存恢复前的配置');
    }
    
    // 恢复备份
    fs.copyFileSync(backupPath, filePath);
    logger.info({ from: backupPath, to: filePath }, '配置已从备份恢复');
    return true;
  } catch (err) {
    logger.error({ backupPath, filePath, err }, '恢复配置失败');
    return false;
  }
}

// ============================================================================
// JSON 文件操作
// ============================================================================

/**
 * 加载 JSON 文件
 * 
 * @param filePath - JSON 文件路径
 * @param defaultValue - 文件不存在或解析失败时的默认值
 * @returns 解析后的 JSON 对象
 */
export function loadJson<T>(filePath: string, defaultValue: T): T {
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    }
  } catch {
    // Return default on error
  }
  return defaultValue;
}

/**
 * 加载 JSON 文件并替换环境变量
 * 
 * 支持的环境变量语法:
 * - ${VAR} - 从环境变量获取值
 * - ${VAR:-default} - 有默认值的环境变量
 * 
 * @param filePath - JSON 文件路径
 * @param defaultValue - 文件不存在或解析失败时的默认值
 * @param env - 环境变量对象 (默认使用 process.env)
 * @returns 替换环境变量后的 JSON 对象
 * 
 * @example
 * // config.json: { "apiUrl": "${API_URL:-http://localhost:3000}" }
 * loadJsonWithEnv('config.json', {})
 * // 返回: { "apiUrl": "http://localhost:3000" } (如果 API_URL 未定义)
 */
export function loadJsonWithEnv<T>(
  filePath: string,
  defaultValue: T,
  env: Record<string, string | undefined> = process.env
): T {
  const data = loadJson(filePath, defaultValue);
  return substituteEnvVarsDeep(data, env);
}

/**
 * 保存 JSON 配置文件
 * 写入前自动创建备份，备份失败不阻塞写入
 * 
 * @param filePath 文件路径
 * @param data 要保存的数据
 * @param backupOptions 备份选项
 */
export function saveJson(filePath: string, data: unknown, backupOptions?: BackupOptions): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  
  // 写入前备份（备份失败只记录警告，不阻塞写入）
  backupConfig(filePath, backupOptions);
  
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

/**
 * 配置备份功能单元测试
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import {
  backupConfig,
  restoreConfig,
  rotateBackups,
  getBackupFiles,
  listBackups,
  saveJson,
  loadJson,
} from '../../src/utils.js';

describe('Config Backup', () => {
  let tempDir: string;
  let configPath: string;

  beforeEach(() => {
    // 创建临时目录
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flashclaw-test-'));
    configPath = path.join(tempDir, 'config.json');
  });

  afterEach(() => {
    // 清理临时目录
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('getBackupFiles', () => {
    it('应返回空数组当没有备份时', () => {
      const backups = getBackupFiles(configPath);
      expect(backups).toEqual([]);
    });

    it('应正确识别备份文件', () => {
      // 创建测试备份文件
      fs.writeFileSync(`${configPath}.bak.1`, 'backup1');
      fs.writeFileSync(`${configPath}.bak.2`, 'backup2');
      fs.writeFileSync(`${configPath}.bak.3`, 'backup3');

      const backups = getBackupFiles(configPath);
      
      expect(backups).toHaveLength(3);
      expect(backups[0].number).toBe(1);
      expect(backups[1].number).toBe(2);
      expect(backups[2].number).toBe(3);
    });

    it('应忽略非备份文件', () => {
      fs.writeFileSync(configPath, 'original');
      fs.writeFileSync(`${configPath}.bak.1`, 'backup1');
      fs.writeFileSync(`${configPath}.backup`, 'not a backup');
      fs.writeFileSync(`${configPath}.bak.abc`, 'invalid number');

      const backups = getBackupFiles(configPath);
      
      expect(backups).toHaveLength(1);
      expect(backups[0].number).toBe(1);
    });
  });

  describe('rotateBackups', () => {
    it('应轮转备份编号', () => {
      fs.writeFileSync(`${configPath}.bak.1`, 'backup1');
      fs.writeFileSync(`${configPath}.bak.2`, 'backup2');

      rotateBackups(configPath, 5);

      // 原来的 .bak.1 应变成 .bak.2
      // 原来的 .bak.2 应变成 .bak.3
      expect(fs.existsSync(`${configPath}.bak.1`)).toBe(false);
      expect(fs.existsSync(`${configPath}.bak.2`)).toBe(true);
      expect(fs.existsSync(`${configPath}.bak.3`)).toBe(true);
      expect(fs.readFileSync(`${configPath}.bak.2`, 'utf-8')).toBe('backup1');
      expect(fs.readFileSync(`${configPath}.bak.3`, 'utf-8')).toBe('backup2');
    });

    it('应删除超出限制的旧备份', () => {
      fs.writeFileSync(`${configPath}.bak.1`, 'backup1');
      fs.writeFileSync(`${configPath}.bak.2`, 'backup2');
      fs.writeFileSync(`${configPath}.bak.3`, 'backup3');
      fs.writeFileSync(`${configPath}.bak.4`, 'backup4');
      fs.writeFileSync(`${configPath}.bak.5`, 'backup5');

      rotateBackups(configPath, 5);

      // .bak.5 应被删除（轮转后会变成 .bak.6，超出限制）
      expect(fs.existsSync(`${configPath}.bak.5`)).toBe(true);
      expect(fs.existsSync(`${configPath}.bak.6`)).toBe(false);
      
      // 检查轮转后的内容
      expect(fs.readFileSync(`${configPath}.bak.2`, 'utf-8')).toBe('backup1');
      expect(fs.readFileSync(`${configPath}.bak.5`, 'utf-8')).toBe('backup4');
    });

    it('当没有备份时应无操作', () => {
      // 不应抛出错误
      expect(() => rotateBackups(configPath, 5)).not.toThrow();
    });
  });

  describe('backupConfig', () => {
    it('应创建备份文件', () => {
      fs.writeFileSync(configPath, '{"test": true}');

      const success = backupConfig(configPath);

      expect(success).toBe(true);
      expect(fs.existsSync(`${configPath}.bak.1`)).toBe(true);
      expect(fs.readFileSync(`${configPath}.bak.1`, 'utf-8')).toBe('{"test": true}');
    });

    it('原文件不存在时应返回 true', () => {
      const success = backupConfig(configPath);
      expect(success).toBe(true);
    });

    it('应轮转现有备份', () => {
      fs.writeFileSync(configPath, 'current');
      fs.writeFileSync(`${configPath}.bak.1`, 'old-backup');

      backupConfig(configPath);

      expect(fs.existsSync(`${configPath}.bak.1`)).toBe(true);
      expect(fs.existsSync(`${configPath}.bak.2`)).toBe(true);
      expect(fs.readFileSync(`${configPath}.bak.1`, 'utf-8')).toBe('current');
      expect(fs.readFileSync(`${configPath}.bak.2`, 'utf-8')).toBe('old-backup');
    });

    it('应尊重 maxBackups 选项', () => {
      fs.writeFileSync(configPath, 'current');
      fs.writeFileSync(`${configPath}.bak.1`, 'b1');
      fs.writeFileSync(`${configPath}.bak.2`, 'b2');
      fs.writeFileSync(`${configPath}.bak.3`, 'b3');

      backupConfig(configPath, { maxBackups: 3 });

      // .bak.1, .bak.2, .bak.3 应存在
      expect(fs.existsSync(`${configPath}.bak.1`)).toBe(true);
      expect(fs.existsSync(`${configPath}.bak.2`)).toBe(true);
      expect(fs.existsSync(`${configPath}.bak.3`)).toBe(true);
      // .bak.4 不应存在（超出限制）
      expect(fs.existsSync(`${configPath}.bak.4`)).toBe(false);
    });

    it('enabled=false 时应跳过备份', () => {
      fs.writeFileSync(configPath, 'data');

      const success = backupConfig(configPath, { enabled: false });

      expect(success).toBe(true);
      expect(fs.existsSync(`${configPath}.bak.1`)).toBe(false);
    });
  });

  describe('restoreConfig', () => {
    it('应从备份恢复配置', () => {
      fs.writeFileSync(configPath, 'corrupted');
      fs.writeFileSync(`${configPath}.bak.1`, '{"valid": true}');

      const success = restoreConfig(configPath, 1);

      expect(success).toBe(true);
      expect(fs.readFileSync(configPath, 'utf-8')).toBe('{"valid": true}');
    });

    it('应保存恢复前的配置', () => {
      fs.writeFileSync(configPath, 'before-restore');
      fs.writeFileSync(`${configPath}.bak.1`, 'backup-data');

      restoreConfig(configPath, 1);

      expect(fs.existsSync(`${configPath}.before-restore`)).toBe(true);
      expect(fs.readFileSync(`${configPath}.before-restore`, 'utf-8')).toBe('before-restore');
    });

    it('备份不存在时应返回 false', () => {
      const success = restoreConfig(configPath, 1);
      expect(success).toBe(false);
    });

    it('应支持从指定编号恢复', () => {
      fs.writeFileSync(configPath, 'current');
      fs.writeFileSync(`${configPath}.bak.1`, 'backup1');
      fs.writeFileSync(`${configPath}.bak.2`, 'backup2');
      fs.writeFileSync(`${configPath}.bak.3`, 'backup3');

      const success = restoreConfig(configPath, 2);

      expect(success).toBe(true);
      expect(fs.readFileSync(configPath, 'utf-8')).toBe('backup2');
    });
  });

  describe('listBackups', () => {
    it('应返回备份详细信息', () => {
      fs.writeFileSync(`${configPath}.bak.1`, 'data1');
      fs.writeFileSync(`${configPath}.bak.2`, 'data22');

      const backups = listBackups(configPath);

      expect(backups).toHaveLength(2);
      expect(backups[0].number).toBe(1);
      expect(backups[0].size).toBe(5);
      expect(backups[0].modifiedAt).toBeInstanceOf(Date);
      expect(backups[1].number).toBe(2);
      expect(backups[1].size).toBe(6);
    });
  });

  describe('saveJson with backup', () => {
    it('应在保存前创建备份', () => {
      // 先创建原始文件
      fs.writeFileSync(configPath, '{"version": 1}');

      // 保存新内容
      saveJson(configPath, { version: 2 });

      // 应创建备份
      expect(fs.existsSync(`${configPath}.bak.1`)).toBe(true);
      expect(fs.readFileSync(`${configPath}.bak.1`, 'utf-8')).toBe('{"version": 1}');
      
      // 新内容应保存成功
      const content = loadJson(configPath, {});
      expect(content).toEqual({ version: 2 });
    });

    it('应支持禁用备份', () => {
      fs.writeFileSync(configPath, '{"old": true}');

      saveJson(configPath, { new: true }, { enabled: false });

      expect(fs.existsSync(`${configPath}.bak.1`)).toBe(false);
    });

    it('首次保存时不应创建备份', () => {
      saveJson(configPath, { first: true });

      expect(fs.existsSync(`${configPath}.bak.1`)).toBe(false);
      expect(fs.existsSync(configPath)).toBe(true);
    });
  });

  describe('backup rotation integration', () => {
    it('应正确轮转多次备份', () => {
      // 模拟多次保存操作
      saveJson(configPath, { v: 1 });
      saveJson(configPath, { v: 2 });
      saveJson(configPath, { v: 3 });
      saveJson(configPath, { v: 4 });
      saveJson(configPath, { v: 5 });
      saveJson(configPath, { v: 6 });

      // 当前文件应是 v6
      expect(loadJson(configPath, {})).toEqual({ v: 6 });

      // 备份应存在
      expect(fs.existsSync(`${configPath}.bak.1`)).toBe(true);
      expect(fs.existsSync(`${configPath}.bak.5`)).toBe(true);

      // .bak.1 应是最新的备份 (v5)
      const bak1 = JSON.parse(fs.readFileSync(`${configPath}.bak.1`, 'utf-8'));
      expect(bak1.v).toBe(5);
    });

    it('恢复后可继续正常备份', () => {
      saveJson(configPath, { v: 1 });
      saveJson(configPath, { v: 2 });
      
      // 恢复备份
      restoreConfig(configPath, 1);
      expect(loadJson(configPath, {})).toEqual({ v: 1 });

      // 继续保存
      saveJson(configPath, { v: 3 });
      
      // 应正常工作
      expect(loadJson(configPath, {})).toEqual({ v: 3 });
      expect(fs.existsSync(`${configPath}.bak.1`)).toBe(true);
    });
  });
});

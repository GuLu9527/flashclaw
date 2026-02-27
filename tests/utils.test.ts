import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  loadJson,
  saveJson,
  backupConfig,
  restoreConfig,
  listBackups,
  getBackupFiles,
  rotateBackups,
} from '../src/utils.js';

let tempDir = '';

describe('utils', () => {
  beforeEach(async () => {
    tempDir = await fs.mkdtemp(join(tmpdir(), 'flashclaw-utils-'));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('loadJson', () => {
    it('should load valid JSON file', () => {
      const filePath = join(tempDir, 'test.json');
      const data = { name: 'test', value: 123 };
      
      require('fs').writeFileSync(filePath, JSON.stringify(data));

      const result = loadJson(filePath, {});

      expect(result).toEqual(data);
    });

    it('should return default value for non-existent file', () => {
      const filePath = join(tempDir, 'non-existent.json');
      const defaultValue = { default: true };

      const result = loadJson(filePath, defaultValue);

      expect(result).toEqual(defaultValue);
    });

    it('should return default value for invalid JSON', () => {
      const filePath = join(tempDir, 'invalid.json');
      require('fs').writeFileSync(filePath, 'not valid json {{{');

      const result = loadJson(filePath, { fallback: true });

      expect(result).toEqual({ fallback: true });
    });
  });

  describe('saveJson', () => {
    it('should save JSON to file', () => {
      const filePath = join(tempDir, 'save-test.json');
      const data = { saved: true, count: 42 };

      saveJson(filePath, data, { enabled: false }); // 禁用备份简化测试

      const content = require('fs').readFileSync(filePath, 'utf-8');
      expect(JSON.parse(content)).toEqual(data);
    });

    it('should create parent directories', () => {
      const filePath = join(tempDir, 'nested', 'dir', 'file.json');

      saveJson(filePath, { nested: true }, { enabled: false });

      expect(require('fs').existsSync(filePath)).toBe(true);
    });

    it('should format JSON with indentation', () => {
      const filePath = join(tempDir, 'formatted.json');
      
      saveJson(filePath, { a: 1 }, { enabled: false });

      const content = require('fs').readFileSync(filePath, 'utf-8');
      expect(content).toContain('\n'); // 有换行说明有格式化
    });
  });

  describe('backupConfig', () => {
    it('should create backup file', () => {
      const filePath = join(tempDir, 'config.json');
      require('fs').writeFileSync(filePath, JSON.stringify({ original: true }));

      const result = backupConfig(filePath);

      expect(result).toBe(true);
      expect(require('fs').existsSync(`${filePath}.bak.1`)).toBe(true);
    });

    it('should return true for non-existent file', () => {
      const filePath = join(tempDir, 'non-existent.json');

      const result = backupConfig(filePath);

      expect(result).toBe(true); // 无需备份
    });

    it('should skip backup when disabled', () => {
      const filePath = join(tempDir, 'skip-backup.json');
      require('fs').writeFileSync(filePath, '{}');

      backupConfig(filePath, { enabled: false });

      expect(require('fs').existsSync(`${filePath}.bak.1`)).toBe(false);
    });
  });

  describe('rotateBackups', () => {
    it('should rotate backup numbers', () => {
      const filePath = join(tempDir, 'rotate.json');
      
      // 创建现有备份
      require('fs').writeFileSync(`${filePath}.bak.1`, 'backup 1');
      require('fs').writeFileSync(`${filePath}.bak.2`, 'backup 2');

      rotateBackups(filePath, 5);

      // 备份编号应该增加
      expect(require('fs').existsSync(`${filePath}.bak.2`)).toBe(true);
      expect(require('fs').existsSync(`${filePath}.bak.3`)).toBe(true);
      expect(require('fs').existsSync(`${filePath}.bak.1`)).toBe(false);
    });

    it('should delete backups exceeding max', () => {
      const filePath = join(tempDir, 'max-backup.json');
      
      // 创建 5 个备份
      for (let i = 1; i <= 5; i++) {
        require('fs').writeFileSync(`${filePath}.bak.${i}`, `backup ${i}`);
      }

      rotateBackups(filePath, 3);

      // 只保留 3 个
      expect(require('fs').existsSync(`${filePath}.bak.4`)).toBe(false);
      // bak.1, bak.2, bak.3 -> bak.2, bak.3, bak.4 (然后 4 超限被删)
    });
  });

  describe('getBackupFiles', () => {
    it('should list backup files in order', () => {
      const filePath = join(tempDir, 'list.json');
      
      require('fs').writeFileSync(`${filePath}.bak.3`, '3');
      require('fs').writeFileSync(`${filePath}.bak.1`, '1');
      require('fs').writeFileSync(`${filePath}.bak.2`, '2');

      const backups = getBackupFiles(filePath);

      expect(backups.length).toBe(3);
      expect(backups[0].number).toBe(1);
      expect(backups[1].number).toBe(2);
      expect(backups[2].number).toBe(3);
    });

    it('should return empty array for no backups', () => {
      const filePath = join(tempDir, 'no-backups.json');

      const backups = getBackupFiles(filePath);

      expect(backups).toEqual([]);
    });

    it('should ignore non-backup files', () => {
      const filePath = join(tempDir, 'mixed.json');
      
      require('fs').writeFileSync(`${filePath}.bak.1`, '1');
      require('fs').writeFileSync(`${filePath}.tmp`, 'temp');
      require('fs').writeFileSync(`${filePath}.bak.abc`, 'invalid');

      const backups = getBackupFiles(filePath);

      expect(backups.length).toBe(1);
    });
  });

  describe('restoreConfig', () => {
    it('should restore from backup', () => {
      const filePath = join(tempDir, 'restore.json');
      
      require('fs').writeFileSync(filePath, JSON.stringify({ current: true }));
      require('fs').writeFileSync(`${filePath}.bak.1`, JSON.stringify({ backup: true }));

      const result = restoreConfig(filePath, 1);

      expect(result).toBe(true);
      const content = JSON.parse(require('fs').readFileSync(filePath, 'utf-8'));
      expect(content).toEqual({ backup: true });
    });

    it('should save current config before restore', () => {
      const filePath = join(tempDir, 'save-before.json');
      
      require('fs').writeFileSync(filePath, JSON.stringify({ current: true }));
      require('fs').writeFileSync(`${filePath}.bak.1`, JSON.stringify({ backup: true }));

      restoreConfig(filePath, 1);

      expect(require('fs').existsSync(`${filePath}.before-restore`)).toBe(true);
    });

    it('should return false for non-existent backup', () => {
      const filePath = join(tempDir, 'no-backup.json');

      const result = restoreConfig(filePath, 1);

      expect(result).toBe(false);
    });
  });

  describe('listBackups', () => {
    it('should list backups with metadata', async () => {
      const filePath = join(tempDir, 'meta.json');
      
      require('fs').writeFileSync(`${filePath}.bak.1`, 'content 1');
      
      // 等待一小段时间确保时间戳不同
      await new Promise(resolve => setTimeout(resolve, 10));

      const backups = listBackups(filePath);

      expect(backups.length).toBe(1);
      expect(backups[0].number).toBe(1);
      expect(backups[0].size).toBeGreaterThan(0);
      expect(backups[0].modifiedAt).toBeInstanceOf(Date);
    });
  });
});

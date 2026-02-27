import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  loadJson,
  loadJsonWithEnv,
  saveJson,
  backupConfig,
  restoreConfig,
  listBackups,
  getBackupFiles,
  rotateBackups,
} from '../../src/utils.js';

// Mock logger
vi.mock('../../src/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}));

let tempDir = '';

describe('JSON operations', () => {
  beforeEach(async () => {
    tempDir = await fs.mkdir(join(tmpdir(), `flashclaw-json-${Date.now()}`), { recursive: true }).then(() => 
      join(tmpdir(), `flashclaw-json-${Date.now()}`)
    );
    tempDir = await fs.mkdtemp(join(tmpdir(), 'flashclaw-json-'));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('loadJson', () => {
    it('should load existing JSON file', () => {
      const filePath = join(tempDir, 'test.json');
      const data = { key: 'value', nested: { a: 1 } };
      writeFileSync(filePath, JSON.stringify(data));

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
      writeFileSync(filePath, 'not valid json {');
      const defaultValue = { fallback: true };

      const result = loadJson(filePath, defaultValue);

      expect(result).toEqual(defaultValue);
    });
  });

  describe('loadJsonWithEnv', () => {
    it('should substitute environment variables', () => {
      const filePath = join(tempDir, 'env-test.json');
      const data = {
        apiUrl: '${API_URL}',
        port: '${PORT:-3000}',
      };
      writeFileSync(filePath, JSON.stringify(data));

      const env = { API_URL: 'https://api.example.com', PORT: '8080' };
      const result = loadJsonWithEnv(filePath, {}, env);

      expect(result.apiUrl).toBe('https://api.example.com');
      expect(result.port).toBe('8080');
    });

    it('should use default values when env not set', () => {
      const filePath = join(tempDir, 'env-default.json');
      const data = {
        url: '${MISSING_VAR:-http://localhost}',
      };
      writeFileSync(filePath, JSON.stringify(data));

      const result = loadJsonWithEnv(filePath, {}, {});

      expect(result.url).toBe('http://localhost');
    });
  });

  describe('saveJson', () => {
    it('should save JSON file', () => {
      const filePath = join(tempDir, 'save-test.json');
      const data = { saved: true, timestamp: Date.now() };

      saveJson(filePath, data, { enabled: false });

      const content = readFileSync(filePath, 'utf-8');
      expect(JSON.parse(content)).toEqual(data);
    });

    it('should create parent directories', () => {
      const filePath = join(tempDir, 'deep', 'nested', 'save.json');
      const data = { deep: true };

      saveJson(filePath, data, { enabled: false });

      expect(existsSync(filePath)).toBe(true);
    });

    it('should create backup before saving', () => {
      const filePath = join(tempDir, 'backup-on-save.json');
      
      // 创建初始文件
      writeFileSync(filePath, JSON.stringify({ version: 1 }));
      
      // 保存新内容（会创建备份）
      saveJson(filePath, { version: 2 }, { enabled: true });

      const backupPath = `${filePath}.bak.1`;
      expect(existsSync(backupPath)).toBe(true);
      
      const backupContent = JSON.parse(readFileSync(backupPath, 'utf-8'));
      expect(backupContent.version).toBe(1);
    });
  });
});

describe('backup operations', () => {
  beforeEach(async () => {
    tempDir = await fs.mkdtemp(join(tmpdir(), 'flashclaw-backup-'));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('backupConfig', () => {
    it('should create backup of existing file', () => {
      const filePath = join(tempDir, 'config.json');
      writeFileSync(filePath, JSON.stringify({ original: true }));

      const result = backupConfig(filePath);

      expect(result).toBe(true);
      expect(existsSync(`${filePath}.bak.1`)).toBe(true);
    });

    it('should skip backup if file does not exist', () => {
      const filePath = join(tempDir, 'non-existent.json');

      const result = backupConfig(filePath);

      expect(result).toBe(true);
      expect(existsSync(`${filePath}.bak.1`)).toBe(false);
    });

    it('should skip backup if disabled', () => {
      const filePath = join(tempDir, 'no-backup.json');
      writeFileSync(filePath, JSON.stringify({ data: true }));

      const result = backupConfig(filePath, { enabled: false });

      expect(result).toBe(true);
      expect(existsSync(`${filePath}.bak.1`)).toBe(false);
    });
  });

  describe('rotateBackups', () => {
    it('should rotate existing backups', () => {
      const filePath = join(tempDir, 'rotate.json');
      
      // 创建一些备份
      writeFileSync(`${filePath}.bak.1`, 'backup1');
      writeFileSync(`${filePath}.bak.2`, 'backup2');

      rotateBackups(filePath, 5);

      // 检查备份编号已增加
      expect(existsSync(`${filePath}.bak.2`)).toBe(true);
      expect(existsSync(`${filePath}.bak.3`)).toBe(true);
      expect(existsSync(`${filePath}.bak.1`)).toBe(false);
    });

    it('should delete old backups exceeding limit', () => {
      const filePath = join(tempDir, 'limit.json');
      
      // 创建超出限制的备份
      writeFileSync(`${filePath}.bak.1`, 'backup1');
      writeFileSync(`${filePath}.bak.2`, 'backup2');
      writeFileSync(`${filePath}.bak.3`, 'backup3');

      // rotateBackups 逻辑：
      // 按降序处理：bak.3, bak.2, bak.1
      // bak.3 → 4 > 2，删除
      // bak.2 → 3 > 2，删除  
      // bak.1 → 2 <= 2，重命名为 bak.2
      rotateBackups(filePath, 2);

      // 最终只剩 bak.2（原来的 bak.1）
      expect(existsSync(`${filePath}.bak.2`)).toBe(true);
      expect(existsSync(`${filePath}.bak.1`)).toBe(false);
      expect(existsSync(`${filePath}.bak.3`)).toBe(false);
    });
  });

  describe('getBackupFiles', () => {
    it('should list all backup files sorted by number', () => {
      const filePath = join(tempDir, 'list.json');
      
      writeFileSync(`${filePath}.bak.3`, 'backup3');
      writeFileSync(`${filePath}.bak.1`, 'backup1');
      writeFileSync(`${filePath}.bak.2`, 'backup2');

      const backups = getBackupFiles(filePath);

      expect(backups.length).toBe(3);
      expect(backups[0].number).toBe(1);
      expect(backups[1].number).toBe(2);
      expect(backups[2].number).toBe(3);
    });

    it('should return empty array for non-existent directory', () => {
      const filePath = join(tempDir, 'missing-dir', 'config.json');

      const backups = getBackupFiles(filePath);

      expect(backups).toEqual([]);
    });
  });

  describe('listBackups', () => {
    it('should list backups with metadata', () => {
      const filePath = join(tempDir, 'meta.json');
      
      writeFileSync(`${filePath}.bak.1`, 'content1');
      writeFileSync(`${filePath}.bak.2`, 'content two');

      const backups = listBackups(filePath);

      expect(backups.length).toBe(2);
      expect(backups[0]).toHaveProperty('modifiedAt');
      expect(backups[0]).toHaveProperty('size');
      expect(backups[0].number).toBe(1);
    });
  });

  describe('restoreConfig', () => {
    it('should restore from backup', () => {
      const filePath = join(tempDir, 'restore.json');
      
      // 创建原始文件和备份
      writeFileSync(filePath, JSON.stringify({ current: true }));
      writeFileSync(`${filePath}.bak.1`, JSON.stringify({ backup: true }));

      const result = restoreConfig(filePath, 1);

      expect(result).toBe(true);
      const content = JSON.parse(readFileSync(filePath, 'utf-8'));
      expect(content.backup).toBe(true);
    });

    it('should save pre-restore backup', () => {
      const filePath = join(tempDir, 'pre-restore.json');
      
      writeFileSync(filePath, JSON.stringify({ before: true }));
      writeFileSync(`${filePath}.bak.1`, JSON.stringify({ after: true }));

      restoreConfig(filePath, 1);

      const preRestorePath = `${filePath}.before-restore`;
      expect(existsSync(preRestorePath)).toBe(true);
      const preRestoreContent = JSON.parse(readFileSync(preRestorePath, 'utf-8'));
      expect(preRestoreContent.before).toBe(true);
    });

    it('should return false if backup does not exist', () => {
      const filePath = join(tempDir, 'no-backup.json');

      const result = restoreConfig(filePath, 99);

      expect(result).toBe(false);
    });
  });
});

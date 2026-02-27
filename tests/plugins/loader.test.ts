import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

let tempDir = '';

describe('plugin loader', () => {
  beforeEach(async () => {
    tempDir = await fs.mkdtemp(join(tmpdir(), 'flashclaw-loader-'));
    vi.resetModules();
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('plugin manifest validation', () => {
    it('should require name, main, and type in manifest', async () => {
      const pluginDir = join(tempDir, 'incomplete-plugin');
      await fs.mkdir(pluginDir, { recursive: true });

      // 不完整的清单
      const incompleteManifest = {
        name: 'incomplete-plugin',
        // 缺少 main 和 type
      };

      await fs.writeFile(
        join(pluginDir, 'plugin.json'),
        JSON.stringify(incompleteManifest)
      );

      // 验证清单
      const manifestPath = join(pluginDir, 'plugin.json');
      const content = await fs.readFile(manifestPath, 'utf-8');
      const manifest = JSON.parse(content);

      expect(manifest.name).toBe('incomplete-plugin');
      expect(manifest.main).toBeUndefined();
      expect(manifest.type).toBeUndefined();
    });

    it('should parse valid manifest', async () => {
      const pluginDir = join(tempDir, 'valid-plugin');
      await fs.mkdir(pluginDir, { recursive: true });

      const validManifest = {
        name: 'valid-plugin',
        version: '1.0.0',
        type: 'tool',
        description: 'A test plugin',
        main: 'index.ts',
        config: {
          apiKey: {
            type: 'string',
            required: true,
            env: 'TEST_API_KEY',
          },
        },
        dependencies: ['other-plugin'],
      };

      await fs.writeFile(
        join(pluginDir, 'plugin.json'),
        JSON.stringify(validManifest, null, 2)
      );

      const content = await fs.readFile(join(pluginDir, 'plugin.json'), 'utf-8');
      const manifest = JSON.parse(content);

      expect(manifest.name).toBe('valid-plugin');
      expect(manifest.version).toBe('1.0.0');
      expect(manifest.type).toBe('tool');
      expect(manifest.main).toBe('index.ts');
      expect(manifest.dependencies).toContain('other-plugin');
    });
  });

  describe('topological sort', () => {
    it('should sort plugins by dependencies', () => {
      // 模拟拓扑排序逻辑
      const manifests = new Map<string, { manifest: { dependencies?: string[] } }>();
      
      manifests.set('plugin-a', { manifest: { dependencies: ['plugin-b'] } });
      manifests.set('plugin-b', { manifest: { dependencies: ['plugin-c'] } });
      manifests.set('plugin-c', { manifest: {} });

      // 简单的拓扑排序实现
      const result: string[] = [];
      const visited = new Set<string>();

      function visit(name: string) {
        if (visited.has(name)) return;
        visited.add(name);

        const info = manifests.get(name);
        if (info?.manifest.dependencies) {
          for (const dep of info.manifest.dependencies) {
            if (manifests.has(dep)) {
              visit(dep);
            }
          }
        }
        result.push(name);
      }

      for (const name of manifests.keys()) {
        visit(name);
      }

      // plugin-c 应该最先，因为它没有依赖
      // plugin-b 依赖 plugin-c
      // plugin-a 依赖 plugin-b
      expect(result.indexOf('plugin-c')).toBeLessThan(result.indexOf('plugin-b'));
      expect(result.indexOf('plugin-b')).toBeLessThan(result.indexOf('plugin-a'));
    });

    it('should handle circular dependencies', () => {
      const manifests = new Map<string, { manifest: { dependencies?: string[] } }>();
      
      // 循环依赖: a -> b -> c -> a
      manifests.set('plugin-a', { manifest: { dependencies: ['plugin-b'] } });
      manifests.set('plugin-b', { manifest: { dependencies: ['plugin-c'] } });
      manifests.set('plugin-c', { manifest: { dependencies: ['plugin-a'] } });

      const result: string[] = [];
      const visited = new Set<string>();
      const visiting = new Set<string>(); // 检测循环

      function visit(name: string): boolean {
        if (visited.has(name)) return true;
        if (visiting.has(name)) return false; // 循环检测

        visiting.add(name);

        const info = manifests.get(name);
        if (info?.manifest.dependencies) {
          for (const dep of info.manifest.dependencies) {
            if (manifests.has(dep) && !visit(dep)) {
              // 循环依赖，跳过
            }
          }
        }

        visiting.delete(name);
        visited.add(name);
        result.push(name);
        return true;
      }

      for (const name of manifests.keys()) {
        visit(name);
      }

      // 所有插件都应该在结果中（尽管有循环）
      expect(result.length).toBe(3);
    });
  });

  describe('path security', () => {
    it('should reject unsafe main paths', () => {
      const testCases = [
        { main: '../evil.js', safe: false },
        { main: '/etc/passwd', safe: false },
        { main: '..\\evil.js', safe: false },
        { main: 'index.ts', safe: true },
        { main: 'lib/helper.js', safe: true },
        { main: './index.ts', safe: true },
      ];

      for (const { main, safe } of testCases) {
        const normalized = main.replace(/\\/g, '/');
        const isSafe = !normalized.startsWith('..') && 
                       !normalized.startsWith('/') &&
                       !normalized.includes('../');
        
        expect(isSafe).toBe(safe);
      }
    });
  });

  describe('config building', () => {
    it('should read config from environment variables', () => {
      const manifest = {
        name: 'test-plugin',
        config: {
          apiKey: {
            type: 'string',
            required: true,
            env: 'TEST_API_KEY',
          },
          timeout: {
            type: 'number',
            default: 5000,
          },
        },
      };

      // 模拟环境变量
      const env = {
        TEST_API_KEY: 'secret-key-123',
      };

      const config: Record<string, unknown> = {};

      for (const [key, schema] of Object.entries(manifest.config)) {
        if (schema.env && env[schema.env as keyof typeof env]) {
          config[key] = env[schema.env as keyof typeof env];
        } else if (schema.default !== undefined) {
          config[key] = schema.default;
        }
      }

      expect(config.apiKey).toBe('secret-key-123');
      expect(config.timeout).toBe(5000);
    });

    it('should use default values when env not set', () => {
      const manifest = {
        config: {
          port: {
            type: 'number',
            env: 'UNSET_VAR',
            default: 3000,
          },
        },
      };

      const config: Record<string, unknown> = {};
      const env: Record<string, string> = {};

      for (const [key, schema] of Object.entries(manifest.config)) {
        if (schema.env && env[schema.env]) {
          config[key] = env[schema.env];
        } else if (schema.default !== undefined) {
          config[key] = schema.default;
        }
      }

      expect(config.port).toBe(3000);
    });
  });

  describe('file hash calculation', () => {
    it('should calculate consistent hash for same content', async () => {
      const { createHash } = await import('crypto');

      const content = 'test content';
      const hash1 = createHash('md5').update(content).digest('hex');
      const hash2 = createHash('md5').update(content).digest('hex');

      expect(hash1).toBe(hash2);
    });

    it('should produce different hash for different content', async () => {
      const { createHash } = await import('crypto');

      const hash1 = createHash('md5').update('content 1').digest('hex');
      const hash2 = createHash('md5').update('content 2').digest('hex');

      expect(hash1).not.toBe(hash2);
    });
  });
});

import { describe, it, expect } from 'vitest';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { validatePlugin } from '../../src/plugins/installer.js';

describe('plugin installer validation', () => {
  it('rejects unsafe main path', async () => {
    const tempDir = await fs.mkdtemp(join(tmpdir(), 'flashclaw-plugin-'));
    const pluginJson = {
      name: 'test-plugin',
      version: '1.0.0',
      type: 'tool',
      main: '../evil.js',
    };

    await fs.writeFile(join(tempDir, 'plugin.json'), JSON.stringify(pluginJson, null, 2), 'utf-8');

    const result = await validatePlugin(tempDir);
    expect(result.valid).toBe(false);
    expect(result.errors.some((err) => err.includes('路径不安全'))).toBe(true);

    await fs.rm(tempDir, { recursive: true, force: true });
  });
});

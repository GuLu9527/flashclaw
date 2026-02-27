import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import { existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  installPlugin,
  updatePlugin,
  uninstallPlugin,
  listInstalledPlugins,
} from '../../src/plugins/installer.js';

const PLUGIN_NAME = 'sample-plugin';

async function writePlugin(sourceDir: string, version: string, valid = true): Promise<void> {
  const pluginDir = join(sourceDir, PLUGIN_NAME);
  await fs.rm(pluginDir, { recursive: true, force: true });
  await fs.mkdir(pluginDir, { recursive: true });

  if (!valid) {
    await fs.writeFile(join(pluginDir, 'README.md'), 'invalid plugin');
    return;
  }

  await fs.writeFile(
    join(pluginDir, 'plugin.json'),
    JSON.stringify({
      name: PLUGIN_NAME,
      version,
      type: 'tool',
      main: 'index.ts',
      description: 'Sample plugin for integration tests',
    }, null, 2)
  );
  await fs.writeFile(
    join(pluginDir, 'index.ts'),
    `export default { name: '${PLUGIN_NAME}', version: '${version}', description: 'sample', execute: async () => ({ success: true, data: 'ok' }) };`
  );
}

async function readInstalledMeta(homeDir: string): Promise<Record<string, { version: string }>> {
  const metaPath = join(homeDir, 'plugins', '.installed.json');
  const raw = await fs.readFile(metaPath, 'utf-8');
  return JSON.parse(raw) as Record<string, { version: string }>;
}

describe('plugin installer integration', () => {
  let tempHome = '';
  let sourceDir = '';

  beforeEach(async () => {
    tempHome = await fs.mkdtemp(join(tmpdir(), 'flashclaw-installer-'));
    sourceDir = await fs.mkdtemp(join(tmpdir(), 'flashclaw-plugin-source-'));
    process.env.FLASHCLAW_HOME = tempHome;
    process.env.FLASHCLAW_PLUGIN_SOURCE = 'local';
    process.env.FLASHCLAW_PLUGIN_SOURCE_DIR = sourceDir;
    await writePlugin(sourceDir, '1.0.0', true);
  });

  afterEach(async () => {
    await fs.rm(tempHome, { recursive: true, force: true });
    await fs.rm(sourceDir, { recursive: true, force: true });
    delete process.env.FLASHCLAW_HOME;
    delete process.env.FLASHCLAW_PLUGIN_SOURCE;
    delete process.env.FLASHCLAW_PLUGIN_SOURCE_DIR;
  });

  it('installs and uninstalls plugin', async () => {
    const installed = await installPlugin(PLUGIN_NAME);
    expect(installed).toBe(true);

    const pluginDir = join(tempHome, 'plugins', PLUGIN_NAME);
    expect(existsSync(pluginDir)).toBe(true);

    const meta = await readInstalledMeta(tempHome);
    expect(meta[PLUGIN_NAME].version).toBe('1.0.0');

    const list = await listInstalledPlugins();
    expect(list.some(p => p.name === PLUGIN_NAME)).toBe(true);

    const uninstalled = await uninstallPlugin(PLUGIN_NAME);
    expect(uninstalled).toBe(true);
    expect(existsSync(pluginDir)).toBe(false);
  });

  it('updates plugin and rolls back on invalid update', async () => {
    expect(await installPlugin(PLUGIN_NAME)).toBe(true);

    await writePlugin(sourceDir, '1.1.0', true);
    const updated = await updatePlugin(PLUGIN_NAME);
    expect(updated).toBe(true);

    const pluginJson = await fs.readFile(join(tempHome, 'plugins', PLUGIN_NAME, 'plugin.json'), 'utf-8');
    expect(JSON.parse(pluginJson).version).toBe('1.1.0');

    await writePlugin(sourceDir, '1.2.0', false);
    const updateFailed = await updatePlugin(PLUGIN_NAME);
    expect(updateFailed).toBe(false);

    const pluginJsonAfter = await fs.readFile(join(tempHome, 'plugins', PLUGIN_NAME, 'plugin.json'), 'utf-8');
    expect(JSON.parse(pluginJsonAfter).version).toBe('1.1.0');
  });
});

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

vi.mock('../src/plugins/manager.js', () => ({
  pluginManager: {
    getActiveTools: vi.fn(),
    getTool: vi.fn(),
  },
}));

describe('agent-runner', () => {
  let tempDir = '';

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(join(tmpdir(), 'flashclaw-agent-'));
    process.env.FLASHCLAW_HOME = tempDir;
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
    delete process.env.FLASHCLAW_HOME;
    vi.clearAllMocks();
  });

  it('getAllTools returns active tools', async () => {
    const { pluginManager } = await import('../src/plugins/manager.js');
    const { getAllTools } = await import('../src/agent-runner.js');
    const tools = [{ name: 'tool_a', description: 'A', input_schema: { type: 'object' } }];
    (pluginManager.getActiveTools as ReturnType<typeof vi.fn>).mockReturnValue(tools);
    expect(getAllTools()).toEqual(tools);
  });

  it('createToolExecutor uses single tool plugin', async () => {
    const { pluginManager } = await import('../src/plugins/manager.js');
    const { createToolExecutor } = await import('../src/agent-runner.js');

    const plugin = {
      execute: vi.fn().mockResolvedValue({ success: true, data: 'ok' }),
    };
    (pluginManager.getTool as ReturnType<typeof vi.fn>).mockReturnValue({
      plugin,
      isMultiTool: false,
    });

    const executor = createToolExecutor(
      { chatJid: 'chat-1', groupFolder: 'group-1', isMain: true, userId: 'user-1' },
      {} as any
    );

    const result = await executor('tool_a', { foo: 'bar' });
    expect(plugin.execute).toHaveBeenCalled();
    expect(result).toEqual({ content: 'ok' });
  });

  it('createToolExecutor uses multi tool plugin', async () => {
    const { pluginManager } = await import('../src/plugins/manager.js');
    const { createToolExecutor } = await import('../src/agent-runner.js');

    const plugin = {
      execute: vi.fn().mockResolvedValue({ success: true, data: { ok: true } }),
    };
    (pluginManager.getTool as ReturnType<typeof vi.fn>).mockReturnValue({
      plugin,
      isMultiTool: true,
    });

    const executor = createToolExecutor(
      { chatJid: 'chat-2', groupFolder: 'group-2', isMain: false, userId: 'user-2' },
      {} as any
    );

    const result = await executor('tool_b', { count: 1 });
    expect(plugin.execute).toHaveBeenCalledWith('tool_b', { count: 1 }, expect.any(Object));
    expect(result.content).toContain('"ok": true');
  });

  it('createToolExecutor handles plugin errors', async () => {
    const { pluginManager } = await import('../src/plugins/manager.js');
    const { createToolExecutor } = await import('../src/agent-runner.js');

    const plugin = {
      execute: vi.fn().mockResolvedValue({ success: false, error: 'fail' }),
    };
    (pluginManager.getTool as ReturnType<typeof vi.fn>).mockReturnValue({
      plugin,
      isMultiTool: false,
    });

    const executor = createToolExecutor(
      { chatJid: 'chat-3', groupFolder: 'group-3', isMain: true, userId: 'user-3' },
      {} as any
    );

    const result = await executor('tool_c', {});
    expect(result.isError).toBe(true);
    expect(result.content).toBe('fail');
  });

  it('createToolExecutor reports unknown tool', async () => {
    const { pluginManager } = await import('../src/plugins/manager.js');
    const { createToolExecutor } = await import('../src/agent-runner.js');

    (pluginManager.getTool as ReturnType<typeof vi.fn>).mockReturnValue(undefined);

    const executor = createToolExecutor(
      { chatJid: 'chat-4', groupFolder: 'group-4', isMain: false, userId: 'user-4' },
      {} as any
    );

    const result = await executor('tool_missing', {});
    expect(result.isError).toBe(true);
    expect(result.content).toContain('Unknown tool');
  });

  it('writeTasksSnapshot filters tasks for non-main groups', async () => {
    const { writeTasksSnapshot } = await import('../src/agent-runner.js');
    const { paths } = await import('../src/paths.js');

    writeTasksSnapshot('group-5', false, [
      {
        id: 't1',
        groupFolder: 'group-5',
        prompt: 'A',
        schedule_type: 'cron',
        schedule_value: '* * * * *',
        status: 'active',
        next_run: null,
      },
      {
        id: 't2',
        groupFolder: 'group-other',
        prompt: 'B',
        schedule_type: 'once',
        schedule_value: '2026-01-01T00:00:00Z',
        status: 'active',
        next_run: null,
      },
    ]);

    const tasksFile = join(paths.data(), 'ipc', 'group-5', 'current_tasks.json');
    const content = await fs.readFile(tasksFile, 'utf-8');
    const parsed = JSON.parse(content) as Array<{ id: string }>;
    expect(parsed).toHaveLength(1);
    expect(parsed[0].id).toBe('t1');
  });

  it('writeGroupsSnapshot hides groups for non-main', async () => {
    const { writeGroupsSnapshot } = await import('../src/agent-runner.js');
    const { paths } = await import('../src/paths.js');

    writeGroupsSnapshot('group-6', false, [
      { jid: 'jid-1', name: 'Group1', lastActivity: '2026-01-01', isRegistered: true },
    ], new Set());

    const groupsFile = join(paths.data(), 'ipc', 'group-6', 'available_groups.json');
    const content = await fs.readFile(groupsFile, 'utf-8');
    const parsed = JSON.parse(content) as { groups: Array<unknown> };
    expect(parsed.groups).toEqual([]);
  });
});

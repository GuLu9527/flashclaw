import { describe, it, expect } from 'vitest';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { MemoryManager } from '../../src/core/memory.js';

describe('MemoryManager', () => {
  it('keeps latest message even if over token limit', () => {
    const memory = new MemoryManager({ contextTokenLimit: 1 });
    memory.addMessage('group-1', { role: 'user', content: 'a'.repeat(200) } as any);

    const context = memory.getContext('group-1');
    expect(context.length).toBe(1);
  });

  it('estimateTokens handles non-string content', () => {
    const memory = new MemoryManager();
    const tokens = memory.estimateTokens([
      { role: 'user', content: [{ type: 'text', text: 'hi' }] } as any,
    ]);

    expect(tokens).toBeGreaterThan(0);
  });

  it('stores long-term memory globally across groups', async () => {
    const dir = await fs.mkdtemp(join(tmpdir(), 'flashclaw-memory-global-'));
    const memory = new MemoryManager({ memoryDir: dir });
    memory.remember('project_name', 'FlashClaw');

    const fromAnyGroup = memory.buildSystemPrompt('group-a', 'user-a', 'base');
    expect(fromAnyGroup).toContain('project_name: FlashClaw');

    await fs.rm(dir, { recursive: true, force: true });
  });

  it('appendDailyLog writes entry and exposes in system prompt', async () => {
    const dir = await fs.mkdtemp(join(tmpdir(), 'flashclaw-memory-'));
    const memory = new MemoryManager({ memoryDir: dir });

    memory.appendDailyLog('今天修复了记忆系统');
    const prompt = memory.buildSystemPrompt('group-x', 'user-x', 'base');

    expect(prompt).toContain('今天修复了记忆系统');

    await fs.rm(dir, { recursive: true, force: true });
  });

  it('parses memory values with markdown-like lines', () => {
    const memory = new MemoryManager();
    memory.remember('note', '# 标题\n> 引用\n正文');

    const recalled = memory.recall('note');
    expect(recalled).toContain('# 标题');
    expect(recalled).toContain('> 引用');
    expect(recalled).toContain('正文');
  });
});

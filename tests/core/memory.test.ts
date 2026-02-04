import { describe, it, expect } from 'vitest';
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
});

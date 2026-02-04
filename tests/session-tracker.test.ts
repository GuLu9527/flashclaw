import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

let tempDir = '';

async function loadTracker() {
  return await import('../src/session-tracker.js');
}

describe('session-tracker', () => {
  beforeEach(async () => {
    tempDir = await fs.mkdtemp(join(tmpdir(), 'flashclaw-tracker-'));
    process.env.FLASHCLAW_HOME = tempDir;
    vi.resetModules();
  });

  afterEach(async () => {
    vi.useRealTimers();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('guards invalid token inputs', async () => {
    const tracker = await loadTracker();
    tracker.recordTokenUsage('chat-1', { inputTokens: -1, outputTokens: Number.NaN });
    const stats = tracker.getSessionStats('chat-1');
    expect(stats?.tokenCount).toBe(0);
    expect(stats?.usagePercent).toBeGreaterThanOrEqual(0);
  });

  it('returns default context window for missing model', async () => {
    const tracker = await loadTracker();
    expect(tracker.getContextWindowSize()).toBeGreaterThan(0);
  });

  it('persists session cache to disk', async () => {
    const tracker = await loadTracker();

    tracker.recordTokenUsage('chat-2', { inputTokens: 10, outputTokens: 5 });
    await new Promise((resolve) => setTimeout(resolve, 1200));

    const cachePath = join(tempDir, 'cache', 'session-tracker.json');
    const content = await fs.readFile(cachePath, 'utf-8');
    const data = JSON.parse(content);
    expect(Array.isArray(data)).toBe(true);
    expect(data[0].chatId).toBe('chat-2');
  });
});

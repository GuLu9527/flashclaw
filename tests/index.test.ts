import { describe, it, expect, beforeAll, afterAll } from 'vitest';

let indexModule: typeof import('../src/index.js');

beforeAll(async () => {
  process.env.FLASHCLAW_SKIP_MAIN = '1';
  indexModule = await import('../src/index.js');
});

afterAll(() => {
  delete process.env.FLASHCLAW_SKIP_MAIN;
});

describe('index helpers', () => {
  it('extractFirstUrl strips trailing punctuation', () => {
    const url = indexModule.extractFirstUrl('请看 https://example.com/test) 谢谢');
    expect(url).toBe('https://example.com/test');
  });

  it('extractFirstUrl builds https for bare domains', () => {
    const url = indexModule.extractFirstUrl('访问 example.com/path 了解更多');
    expect(url).toBe('https://example.com/path');
  });

  it('detects private IPs and blocked hostnames', () => {
    expect(indexModule.isPrivateIp('10.0.0.1')).toBe(true);
    expect(indexModule.isPrivateIp('8.8.8.8')).toBe(false);
    expect(indexModule.isPrivateIp('::1')).toBe(true);
    expect(indexModule.isBlockedHostname('localhost')).toBe(true);
    expect(indexModule.isBlockedHostname('app.local')).toBe(true);
    expect(indexModule.isBlockedHostname('example.com')).toBe(false);
  });

  it('estimates base64 bytes and truncates text', () => {
    const bytes = indexModule.estimateBase64Bytes('data:text/plain;base64,SGVsbG8=');
    expect(bytes).toBe(5);

    const { text, truncated } = indexModule.truncateText('HelloWorld', 5);
    expect(truncated).toBe(true);
    expect(text).toContain('Hello');
    expect(text).toContain('内容已截断');
  });

  it('formats direct web fetch responses', () => {
    const success = indexModule.formatDirectWebFetchResponse('https://example.com', {
      success: true,
      data: {
        content: 'Hello',
        title: 'Example',
        status: 200,
        finalUrl: 'https://example.com',
        contentType: 'text/html',
        bytes: 5,
      },
    });

    expect(success).toContain('✅ 已抓取');
    expect(success).toContain('Example');
    expect(success).toContain('Hello');

    const failure = indexModule.formatDirectWebFetchResponse('https://example.com', {
      success: false,
      error: 'timeout',
    });
    expect(failure).toContain('❌ 抓取失败');
  });
});

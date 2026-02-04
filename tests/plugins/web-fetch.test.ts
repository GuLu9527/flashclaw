import { describe, it, expect, vi } from 'vitest';
import type { ToolContext } from '../../src/plugins/types.js';
import plugin from '../../community-plugins/web-fetch/index.js';

const mockContext: ToolContext = {
  chatId: 'test-chat',
  groupId: 'test-group',
  userId: 'test-user',
  sendMessage: vi.fn().mockResolvedValue(undefined)
};

describe('web-fetch 参数校验', () => {
  it('拒绝缺少 url', async () => {
    const result = await plugin.execute({}, mockContext);
    expect(result.success).toBe(false);
    expect(result.error).toContain('url');
  });

  it('拒绝无效 URL', async () => {
    const result = await plugin.execute({ url: 'not-a-url' }, mockContext);
    expect(result.success).toBe(false);
    expect(result.error).toContain('URL');
  });

  it('拒绝非 http/https 协议', async () => {
    const result = await plugin.execute({ url: 'file:///etc/passwd' }, mockContext);
    expect(result.success).toBe(false);
    expect(result.error).toContain('HTTP/HTTPS');
  });

  it('拒绝非法 method', async () => {
    const result = await plugin.execute({ url: 'https://example.com', method: 'TRACE' }, mockContext);
    expect(result.success).toBe(false);
    expect(result.error).toContain('method');
  });

  it('拒绝非法 maxBytes', async () => {
    const result = await plugin.execute({ url: 'https://example.com', maxBytes: -1 }, mockContext);
    expect(result.success).toBe(false);
    expect(result.error).toContain('maxBytes');
  });

  it('拒绝非法 selector', async () => {
    const result = await plugin.execute({ url: 'https://example.com', selector: 123 as unknown as string }, mockContext);
    expect(result.success).toBe(false);
    expect(result.error).toContain('selector');
  });
});

describe('web-fetch SSRF 防护', () => {
  it('拒绝本地回环地址', async () => {
    const result = await plugin.execute({ url: 'http://127.0.0.1:8080' }, mockContext);
    expect(result.success).toBe(false);
    expect(result.error).toContain('内网');
  });

  it('拒绝 localhost 域名', async () => {
    const result = await plugin.execute({ url: 'http://localhost:3000' }, mockContext);
    expect(result.success).toBe(false);
    expect(result.error).toContain('禁止');
  });
});

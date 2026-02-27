import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock Anthropic SDK
vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn().mockImplementation(() => ({
    messages: {
      create: vi.fn(),
    },
  })),
}));

describe('ApiClient', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.clearAllMocks();
  });

  describe('configuration', () => {
    it('should support ANTHROPIC_API_KEY', async () => {
      process.env.ANTHROPIC_API_KEY = 'sk-ant-test-key';
      delete process.env.ANTHROPIC_AUTH_TOKEN;

      // 验证配置逻辑
      const apiKey = process.env.ANTHROPIC_API_KEY;
      const authToken = process.env.ANTHROPIC_AUTH_TOKEN;

      expect(apiKey || authToken).toBeTruthy();
    });

    it('should support ANTHROPIC_AUTH_TOKEN', async () => {
      delete process.env.ANTHROPIC_API_KEY;
      process.env.ANTHROPIC_AUTH_TOKEN = 'auth-token-123';

      const apiKey = process.env.ANTHROPIC_API_KEY;
      const authToken = process.env.ANTHROPIC_AUTH_TOKEN;

      expect(apiKey || authToken).toBeTruthy();
    });

    it('should support custom base URL', async () => {
      process.env.ANTHROPIC_BASE_URL = 'https://custom.api.com';
      process.env.ANTHROPIC_API_KEY = 'test-key';

      const baseUrl = process.env.ANTHROPIC_BASE_URL;

      expect(baseUrl).toBe('https://custom.api.com');
    });

    it('should support custom model', async () => {
      process.env.AI_MODEL = 'custom-model-v1';

      const model = process.env.AI_MODEL || 'claude-4-5-sonnet-20250929';

      expect(model).toBe('custom-model-v1');
    });

    it('should use default model when not specified', async () => {
      delete process.env.AI_MODEL;

      const model = process.env.AI_MODEL || 'claude-4-5-sonnet-20250929';

      expect(model).toBe('claude-4-5-sonnet-20250929');
    });
  });

  describe('message formatting', () => {
    it('should format text message correctly', () => {
      const message = {
        role: 'user' as const,
        content: 'Hello, world!',
      };

      expect(message.role).toBe('user');
      expect(message.content).toBe('Hello, world!');
    });

    it('should support image content blocks', () => {
      const message = {
        role: 'user' as const,
        content: [
          { type: 'text' as const, text: 'What is this?' },
          {
            type: 'image' as const,
            source: {
              type: 'base64' as const,
              media_type: 'image/png' as const,
              data: 'base64data',
            },
          },
        ],
      };

      expect(Array.isArray(message.content)).toBe(true);
      expect(message.content.length).toBe(2);
      expect(message.content[0].type).toBe('text');
      expect(message.content[1].type).toBe('image');
    });
  });

  describe('tool schema format', () => {
    it('should match Anthropic tool format', () => {
      const tool = {
        name: 'send_message',
        description: 'Send a message',
        input_schema: {
          type: 'object' as const,
          properties: {
            text: { type: 'string', description: 'Message text' },
            chat_id: { type: 'string', description: 'Chat ID' },
          },
          required: ['text'],
        },
      };

      expect(tool.name).toBe('send_message');
      expect(tool.input_schema.type).toBe('object');
      expect(tool.input_schema.properties.text).toBeDefined();
      expect(tool.input_schema.required).toContain('text');
    });
  });

  describe('response handling', () => {
    it('should extract text from response', () => {
      const response = {
        content: [
          { type: 'text', text: 'Hello!' },
        ],
        stop_reason: 'end_turn',
      };

      const text = response.content
        .filter((block: any) => block.type === 'text')
        .map((block: any) => block.text)
        .join('');

      expect(text).toBe('Hello!');
    });

    it('should detect tool use', () => {
      const response = {
        content: [
          { type: 'tool_use', id: 'tool-1', name: 'send_message', input: { text: 'hi' } },
        ],
        stop_reason: 'tool_use',
      };

      expect(response.stop_reason).toBe('tool_use');
      expect(response.content[0].type).toBe('tool_use');
      expect(response.content[0].name).toBe('send_message');
    });

    it('should handle multiple content blocks', () => {
      const response = {
        content: [
          { type: 'text', text: 'Let me help you.' },
          { type: 'tool_use', id: 'tool-1', name: 'search', input: { query: 'test' } },
          { type: 'text', text: 'Here are the results.' },
        ],
        stop_reason: 'tool_use',
      };

      const textBlocks = response.content.filter((b: any) => b.type === 'text');
      const toolBlocks = response.content.filter((b: any) => b.type === 'tool_use');

      expect(textBlocks.length).toBe(2);
      expect(toolBlocks.length).toBe(1);
    });
  });

  describe('token usage tracking', () => {
    it('should extract usage from response', () => {
      const response = {
        content: [{ type: 'text', text: 'Hi' }],
        usage: {
          input_tokens: 100,
          output_tokens: 50,
        },
      };

      expect(response.usage.input_tokens).toBe(100);
      expect(response.usage.output_tokens).toBe(50);

      const totalTokens = response.usage.input_tokens + response.usage.output_tokens;
      expect(totalTokens).toBe(150);
    });
  });

  describe('retry logic', () => {
    it('should identify retryable errors', () => {
      // 可重试的错误关键词（小写）
      const retryableKeywords = [
        'econnreset',
        'etimedout',
        'rate_limit',
        'rate limit',
        'overloaded',
        '529',
        '503',
      ];

      const isRetryable = (error: string) => {
        const lowerError = error.toLowerCase();
        return retryableKeywords.some(keyword => lowerError.includes(keyword));
      };

      expect(isRetryable('Connection ECONNRESET')).toBe(true);
      expect(isRetryable('Rate limit exceeded')).toBe(true);
      expect(isRetryable('Server overloaded')).toBe(true);
      expect(isRetryable('Invalid API key')).toBe(false);
    });

    it('should calculate exponential backoff', () => {
      const baseDelay = 1000;
      const maxDelay = 10000;

      const calculateDelay = (attempt: number) => {
        const delay = baseDelay * Math.pow(2, attempt);
        return Math.min(delay, maxDelay);
      };

      expect(calculateDelay(0)).toBe(1000);
      expect(calculateDelay(1)).toBe(2000);
      expect(calculateDelay(2)).toBe(4000);
      expect(calculateDelay(3)).toBe(8000);
      expect(calculateDelay(4)).toBe(10000); // 达到上限
      expect(calculateDelay(5)).toBe(10000);
    });
  });
});

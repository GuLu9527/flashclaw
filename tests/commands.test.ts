import { describe, it, expect, vi } from 'vitest';
import {
  isCommand,
  handleCommand,
  shouldSuggestCompact,
  getCompactSuggestion,
  CommandContext,
  SessionStats,
  TaskInfo,
} from '../src/commands.js';

describe('commands', () => {
  const createMockContext = (overrides: Partial<CommandContext> = {}): CommandContext => ({
    chatId: 'test-chat-123',
    userId: 'test-user-456',
    userName: '测试用户',
    platform: 'feishu',
    ...overrides,
  });

  describe('isCommand', () => {
    it('should recognize slash commands', () => {
      expect(isCommand('/help')).toBe(true);
      expect(isCommand('/status')).toBe(true);
      expect(isCommand('  /help  ')).toBe(true);
    });

    it('should not recognize non-commands', () => {
      expect(isCommand('hello')).toBe(false);
      // '/ help' 以 '/' 开头（空格在中间），所以会被识别为命令
      // 这是正确的行为 - 只检查是否以 / 开头
      expect(isCommand('')).toBe(false);
      expect(isCommand('help /')).toBe(false);
    });
  });

  describe('handleCommand', () => {
    describe('/help', () => {
      it('should return help text', () => {
        const result = handleCommand('/help', createMockContext());

        expect(result.isCommand).toBe(true);
        expect(result.shouldRespond).toBe(true);
        expect(result.response).toContain('FlashClaw');
        expect(result.response).toContain('/status');
      });

      it('should support Chinese alias', () => {
        const result = handleCommand('/帮助', createMockContext());

        expect(result.isCommand).toBe(true);
        expect(result.shouldRespond).toBe(true);
      });

      it('should support short alias', () => {
        const result = handleCommand('/h', createMockContext());

        expect(result.isCommand).toBe(true);
        expect(result.shouldRespond).toBe(true);
      });
    });

    describe('/status', () => {
      it('should show session status with stats', () => {
        const stats: SessionStats = {
          messageCount: 10,
          tokenCount: 5000,
          maxTokens: 200000,
          model: 'claude-4-5-sonnet',
          startedAt: '2026-02-04T10:00:00Z',
        };

        const result = handleCommand('/status', createMockContext({
          getSessionStats: () => stats,
        }));

        expect(result.isCommand).toBe(true);
        expect(result.shouldRespond).toBe(true);
        expect(result.response).toContain('会话状态');
        expect(result.response).toContain('10');
        expect(result.response).toContain('5,000');
        expect(result.response).toContain('claude-4-5-sonnet');
      });

      it('should handle missing stats', () => {
        const result = handleCommand('/status', createMockContext({
          getSessionStats: () => null,
        }));

        expect(result.isCommand).toBe(true);
        expect(result.response).toContain('会话状态');
        expect(result.response).toContain('暂不可用');
      });

      it('should mask long user IDs', () => {
        const result = handleCommand('/status', createMockContext({
          userName: 'ou_1234567890abcdef',
        }));

        expect(result.response).not.toContain('ou_1234567890abcdef');
        expect(result.response).toContain('用户#');
      });
    });

    describe('/new', () => {
      it('should reset session when resetSession is provided', () => {
        const resetSession = vi.fn();

        const result = handleCommand('/new', createMockContext({
          resetSession,
        }));

        expect(result.isCommand).toBe(true);
        expect(result.shouldRespond).toBe(true);
        expect(result.response).toContain('已重置');
        expect(resetSession).toHaveBeenCalled();
      });

      it('should handle missing resetSession', () => {
        const result = handleCommand('/new', createMockContext());

        expect(result.isCommand).toBe(true);
        expect(result.response).toContain('暂不可用');
      });

      it('should support aliases', () => {
        const resetSession = vi.fn();

        handleCommand('/reset', createMockContext({ resetSession }));
        expect(resetSession).toHaveBeenCalled();

        resetSession.mockClear();
        handleCommand('/重置', createMockContext({ resetSession }));
        expect(resetSession).toHaveBeenCalled();
      });
    });

    describe('/tasks', () => {
      it('should show empty task list', () => {
        const result = handleCommand('/tasks', createMockContext({
          getTasks: () => [],
        }));

        expect(result.isCommand).toBe(true);
        expect(result.response).toContain('没有定时任务');
      });

      it('should show task list', () => {
        const tasks: TaskInfo[] = [
          {
            id: 'task_12345678',
            prompt: '提醒我喝水',
            scheduleType: 'cron',
            nextRun: '2026-02-04T09:00:00Z',
            status: 'active',
          },
          {
            id: 'task_87654321',
            prompt: '检查邮件',
            scheduleType: 'interval',
            status: 'paused',
          },
        ];

        const result = handleCommand('/tasks', createMockContext({
          getTasks: () => tasks,
        }));

        expect(result.isCommand).toBe(true);
        expect(result.response).toContain('2个');
        expect(result.response).toContain('提醒我喝水');
        expect(result.response).toContain('🟢'); // active
        expect(result.response).toContain('⏸️'); // paused
      });

      it('should truncate long prompts', () => {
        // prompt 长度需要超过 50 字符才会被截断（中文字符长度为 1）
        const longPrompt = '这是一个非常长的任务描述需要被截断以保持输出整洁这是一个非常长的任务描述需要被截断以保持输出整洁的测试文字';
        const tasks: TaskInfo[] = [
          {
            id: 'task_12345678',
            prompt: longPrompt,
            scheduleType: 'once',
            status: 'active',
          },
        ];

        const result = handleCommand('/tasks', createMockContext({
          getTasks: () => tasks,
        }));

        // 代码截取前 50 字符，超过 50 才加 '...'
        expect(longPrompt.length).toBeGreaterThan(50);
        expect(result.response).toContain('...');
      });
    });

    describe('/ping', () => {
      it('should return pong', () => {
        const result = handleCommand('/ping', createMockContext());

        expect(result.isCommand).toBe(true);
        expect(result.shouldRespond).toBe(true);
        expect(result.response).toContain('Pong');
      });
    });

    describe('/compact', () => {
      it('should trigger compact when available', () => {
        const compactSession = vi.fn();

        const result = handleCommand('/compact', createMockContext({
          compactSession,
        }));

        expect(result.isCommand).toBe(true);
        expect(result.response).toContain('正在压缩');
      });

      it('should handle missing compactSession', () => {
        const result = handleCommand('/compact', createMockContext());

        expect(result.isCommand).toBe(true);
        expect(result.response).toContain('暂不可用');
      });
    });

    describe('unknown command', () => {
      it('should return error for unknown command', () => {
        const result = handleCommand('/unknown', createMockContext());

        expect(result.isCommand).toBe(true);
        expect(result.shouldRespond).toBe(true);
        expect(result.response).toContain('未知命令');
        expect(result.response).toContain('/help');
      });
    });

    describe('non-command input', () => {
      it('should return isCommand: false for non-commands', () => {
        const result = handleCommand('hello world', createMockContext());

        expect(result.isCommand).toBe(false);
        expect(result.response).toBeUndefined();
      });
    });
  });

  describe('shouldSuggestCompact', () => {
    it('should return true when above threshold', () => {
      expect(shouldSuggestCompact(70000, 100000, 0.7)).toBe(true);
      expect(shouldSuggestCompact(80000, 100000, 0.7)).toBe(true);
    });

    it('should return false when below threshold', () => {
      expect(shouldSuggestCompact(50000, 100000, 0.7)).toBe(false);
      expect(shouldSuggestCompact(69999, 100000, 0.7)).toBe(false);
    });

    it('should return false for invalid inputs', () => {
      expect(shouldSuggestCompact(0, 100000)).toBe(false);
      expect(shouldSuggestCompact(50000, 0)).toBe(false);
    });

    it('should use default threshold of 0.7', () => {
      expect(shouldSuggestCompact(70000, 100000)).toBe(true);
      expect(shouldSuggestCompact(69000, 100000)).toBe(false);
    });
  });

  describe('getCompactSuggestion', () => {
    it('should generate correct suggestion message', () => {
      const suggestion = getCompactSuggestion(140000, 200000);

      expect(suggestion).toContain('70%');
      expect(suggestion).toContain('140,000');
      expect(suggestion).toContain('200,000');
      expect(suggestion).toContain('/compact');
      expect(suggestion).toContain('/new');
    });
  });
});

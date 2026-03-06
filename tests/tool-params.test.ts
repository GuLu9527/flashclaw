/**
 * 工具参数后处理测试
 */

import { describe, it, expect } from 'vitest';
import { normalizeToolParams } from '../src/tool-params.js';

describe('normalizeToolParams', () => {
  describe('unknown tool', () => {
    it('should return params unchanged for unknown tools', () => {
      const params = { foo: 'bar' };
      expect(normalizeToolParams('unknown_tool', params)).toEqual(params);
    });

    it('should return null/undefined unchanged', () => {
      expect(normalizeToolParams('schedule_task', null)).toBeNull();
      expect(normalizeToolParams('schedule_task', undefined)).toBeUndefined();
    });
  });

  describe('schedule_task', () => {
    it('should fix snake_case to camelCase field names', () => {
      const result = normalizeToolParams('schedule_task', {
        prompt: '提醒我',
        schedule_type: 'once',
        schedule_value: '2026-12-31T09:00:00Z',
      }) as Record<string, unknown>;
      expect(result.scheduleType).toBe('once');
      expect(result.scheduleValue).toBe('2026-12-31T09:00:00Z');
      expect(result.schedule_type).toBeUndefined();
      expect(result.schedule_value).toBeUndefined();
    });

    it('should fix non-ISO date format "YYYY-MM-DD HH:MM"', () => {
      const result = normalizeToolParams('schedule_task', {
        prompt: '提醒我',
        scheduleType: 'once',
        scheduleValue: '2026-12-31 9:00',
      }) as Record<string, unknown>;
      expect(result.scheduleValue).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(new Date(result.scheduleValue as string).getTime()).not.toBeNaN();
    });

    it('should fix date with slash separator', () => {
      const result = normalizeToolParams('schedule_task', {
        prompt: '提醒我',
        scheduleType: 'once',
        scheduleValue: '2026/12/31 09:00',
      }) as Record<string, unknown>;
      expect(result.scheduleValue).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('should convert Chinese interval "30分钟" to ms', () => {
      const result = normalizeToolParams('schedule_task', {
        prompt: '提醒我',
        scheduleType: 'interval',
        scheduleValue: '30分钟',
      }) as Record<string, unknown>;
      expect(result.scheduleValue).toBe('1800000');
    });

    it('should convert "2小时" to ms', () => {
      const result = normalizeToolParams('schedule_task', {
        prompt: '提醒我',
        scheduleType: 'interval',
        scheduleValue: '2小时',
      }) as Record<string, unknown>;
      expect(result.scheduleValue).toBe('7200000');
    });

    it('should convert small number interval as seconds to ms', () => {
      const result = normalizeToolParams('schedule_task', {
        prompt: '提醒我',
        scheduleType: 'interval',
        scheduleValue: '60',
      }) as Record<string, unknown>;
      expect(result.scheduleValue).toBe('60000');
    });

    it('should leave large number interval as-is (already ms)', () => {
      const result = normalizeToolParams('schedule_task', {
        prompt: '提醒我',
        scheduleType: 'interval',
        scheduleValue: '3600000',
      }) as Record<string, unknown>;
      expect(result.scheduleValue).toBe('3600000');
    });

    it('should convert numeric scheduleValue to string', () => {
      const result = normalizeToolParams('schedule_task', {
        prompt: '提醒我',
        scheduleType: 'interval',
        scheduleValue: 60000,
      }) as Record<string, unknown>;
      expect(result.scheduleValue).toBe('60000');
    });

    it('should fix scheduleType aliases', () => {
      expect((normalizeToolParams('schedule_task', {
        prompt: 'x', scheduleType: 'one', scheduleValue: '2026-12-31T00:00:00Z'
      }) as Record<string, unknown>).scheduleType).toBe('once');

      expect((normalizeToolParams('schedule_task', {
        prompt: 'x', scheduleType: 'repeat', scheduleValue: '60000'
      }) as Record<string, unknown>).scheduleType).toBe('interval');
    });

    it('should not modify already-correct params', () => {
      const params = {
        prompt: '提醒我',
        scheduleType: 'once',
        scheduleValue: '2026-12-31T09:00:00.000Z',
      };
      const result = normalizeToolParams('schedule_task', params);
      expect(result).toEqual(params);
    });
  });

  describe('memory', () => {
    it('should fix "content" → "value"', () => {
      const result = normalizeToolParams('memory', {
        action: 'remember',
        key: 'name',
        content: '张三',
      }) as Record<string, unknown>;
      expect(result.value).toBe('张三');
      expect(result.content).toBeUndefined();
    });

    it('should fix "text" → "value"', () => {
      const result = normalizeToolParams('memory', {
        action: 'log',
        text: '今天开了会',
      }) as Record<string, unknown>;
      expect(result.value).toBe('今天开了会');
      expect(result.text).toBeUndefined();
    });

    it('should fix "name" → "key"', () => {
      const result = normalizeToolParams('memory', {
        action: 'remember',
        name: 'favorite_food',
        value: '火锅',
      }) as Record<string, unknown>;
      expect(result.key).toBe('favorite_food');
      expect(result.name).toBeUndefined();
    });

    it('should fix scope aliases', () => {
      expect((normalizeToolParams('memory', {
        action: 'remember', key: 'k', value: 'v', scope: 'personal'
      }) as Record<string, unknown>).scope).toBe('user');

      expect((normalizeToolParams('memory', {
        action: 'remember', key: 'k', value: 'v', scope: 'shared'
      }) as Record<string, unknown>).scope).toBe('global');
    });

    it('should not modify already-correct params', () => {
      const params = { action: 'remember', key: 'name', value: '张三', scope: 'global' };
      const result = normalizeToolParams('memory', params);
      expect(result).toEqual(params);
    });
  });

  describe('send_message', () => {
    it('should fix "text" → "content"', () => {
      const result = normalizeToolParams('send_message', {
        text: '你好',
      }) as Record<string, unknown>;
      expect(result.content).toBe('你好');
      expect(result.text).toBeUndefined();
    });

    it('should fix "message" → "content"', () => {
      const result = normalizeToolParams('send_message', {
        message: '你好',
      }) as Record<string, unknown>;
      expect(result.content).toBe('你好');
      expect(result.message).toBeUndefined();
    });

    it('should not modify when content already exists', () => {
      const params = { content: '你好', text: '其他' };
      const result = normalizeToolParams('send_message', params) as Record<string, unknown>;
      expect(result.content).toBe('你好');
    });
  });
});

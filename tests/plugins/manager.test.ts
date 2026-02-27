import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PluginManager } from '../../src/plugins/manager.js';
import { ToolPlugin, ChannelPlugin, ToolSchema } from '../../src/plugins/types.js';

describe('PluginManager', () => {
  let manager: PluginManager;

  beforeEach(() => {
    manager = new PluginManager();
  });

  describe('register', () => {
    it('should register a tool plugin', () => {
      const toolPlugin: ToolPlugin = {
        name: 'test-tool',
        version: '1.0.0',
        description: 'A test tool',
        schema: {
          name: 'test_tool',
          description: 'Test tool',
          input_schema: {
            type: 'object',
            properties: {},
          },
        },
        execute: vi.fn(),
      };

      const result = manager.register(toolPlugin);

      expect(result).toBe(true);
      expect(manager.getPluginNames()).toContain('test-tool');
    });

    it('should register a channel plugin', () => {
      const channelPlugin: ChannelPlugin = {
        name: 'test-channel',
        version: '1.0.0',
        init: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
        onMessage: vi.fn(),
        sendMessage: vi.fn(),
      };

      const result = manager.register(channelPlugin);

      expect(result).toBe(true);
      expect(manager.getPluginNames()).toContain('test-channel');
    });

    it('should reject duplicate plugin', () => {
      const plugin: ToolPlugin = {
        name: 'duplicate',
        version: '1.0.0',
        description: 'Test',
        schema: {
          name: 'duplicate',
          description: 'Test',
          input_schema: { type: 'object', properties: {} },
        },
        execute: vi.fn(),
      };

      manager.register(plugin);
      const result = manager.register(plugin);

      expect(result).toBe(false);
    });
  });

  describe('unregister', () => {
    it('should unregister a tool plugin', async () => {
      const plugin: ToolPlugin = {
        name: 'to-unregister',
        version: '1.0.0',
        description: 'Test',
        schema: {
          name: 'to_unregister',
          description: 'Test',
          input_schema: { type: 'object', properties: {} },
        },
        execute: vi.fn(),
      };

      manager.register(plugin);
      expect(manager.getPluginNames()).toContain('to-unregister');

      const result = await manager.unregister('to-unregister');

      expect(result).toBe(true);
      expect(manager.getPluginNames()).not.toContain('to-unregister');
    });

    it('should call stop on channel plugin before unregister', async () => {
      const stopFn = vi.fn();
      const channelPlugin: ChannelPlugin = {
        name: 'channel-to-stop',
        version: '1.0.0',
        init: vi.fn(),
        start: vi.fn(),
        stop: stopFn,
        onMessage: vi.fn(),
        sendMessage: vi.fn(),
      };

      manager.register(channelPlugin);
      await manager.unregister('channel-to-stop');

      expect(stopFn).toHaveBeenCalled();
    });

    it('should return false for non-existent plugin', async () => {
      const result = await manager.unregister('non-existent');

      expect(result).toBe(false);
    });
  });

  describe('getActiveTools', () => {
    it('should return all tool schemas', () => {
      const tool1: ToolPlugin = {
        name: 'tool-1',
        version: '1.0.0',
        description: 'Tool 1',
        schema: {
          name: 'tool_1',
          description: 'First tool',
          input_schema: { type: 'object', properties: { a: { type: 'string' } } },
        },
        execute: vi.fn(),
      };

      const tool2: ToolPlugin = {
        name: 'tool-2',
        version: '1.0.0',
        description: 'Tool 2',
        schema: {
          name: 'tool_2',
          description: 'Second tool',
          input_schema: { type: 'object', properties: { b: { type: 'number' } } },
        },
        execute: vi.fn(),
      };

      manager.register(tool1);
      manager.register(tool2);

      const tools = manager.getActiveTools();

      expect(tools.length).toBe(2);
      expect(tools.map(t => t.name)).toContain('tool_1');
      expect(tools.map(t => t.name)).toContain('tool_2');
    });

    it('should return tools from multi-tool plugins', () => {
      const multiToolPlugin: ToolPlugin = {
        name: 'multi-tool',
        version: '1.0.0',
        description: 'Multi tool plugin',
        tools: [
          {
            name: 'sub_tool_1',
            description: 'Sub tool 1',
            input_schema: { type: 'object', properties: {} },
          },
          {
            name: 'sub_tool_2',
            description: 'Sub tool 2',
            input_schema: { type: 'object', properties: {} },
          },
        ],
        execute: vi.fn(),
      };

      manager.register(multiToolPlugin);

      const tools = manager.getActiveTools();

      expect(tools.length).toBe(2);
      expect(tools.map(t => t.name)).toContain('sub_tool_1');
      expect(tools.map(t => t.name)).toContain('sub_tool_2');
    });
  });

  describe('getActiveChannels', () => {
    it('should return all channel plugins', () => {
      const channel1: ChannelPlugin = {
        name: 'channel-1',
        version: '1.0.0',
        init: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
        onMessage: vi.fn(),
        sendMessage: vi.fn(),
      };

      const channel2: ChannelPlugin = {
        name: 'channel-2',
        version: '1.0.0',
        init: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
        onMessage: vi.fn(),
        sendMessage: vi.fn(),
      };

      manager.register(channel1);
      manager.register(channel2);

      const channels = manager.getActiveChannels();

      expect(channels.length).toBe(2);
      expect(channels.map(c => c.name)).toContain('channel-1');
      expect(channels.map(c => c.name)).toContain('channel-2');
    });
  });

  describe('getTool', () => {
    it('should find tool by name (single tool mode)', () => {
      const plugin: ToolPlugin = {
        name: 'find-me',
        version: '1.0.0',
        description: 'Test',
        schema: {
          name: 'find_me',
          description: 'Test',
          input_schema: { type: 'object', properties: {} },
        },
        execute: vi.fn(),
      };

      manager.register(plugin);

      const result = manager.getTool('find-me');

      expect(result).not.toBeNull();
      expect(result?.plugin.name).toBe('find-me');
      expect(result?.isMultiTool).toBe(false);
    });

    it('should find tool by name (multi tool mode)', () => {
      const plugin: ToolPlugin = {
        name: 'multi-plugin',
        version: '1.0.0',
        description: 'Multi',
        tools: [
          { name: 'action_a', description: 'A', input_schema: { type: 'object', properties: {} } },
          { name: 'action_b', description: 'B', input_schema: { type: 'object', properties: {} } },
        ],
        execute: vi.fn(),
      };

      manager.register(plugin);

      const result = manager.getTool('action_a');

      expect(result).not.toBeNull();
      expect(result?.plugin.name).toBe('multi-plugin');
      expect(result?.isMultiTool).toBe(true);
    });

    it('should return null for non-existent tool', () => {
      const result = manager.getTool('non-existent');

      expect(result).toBeNull();
    });
  });

  describe('getChannel', () => {
    it('should find channel by name', () => {
      const channel: ChannelPlugin = {
        name: 'my-channel',
        version: '1.0.0',
        init: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
        onMessage: vi.fn(),
        sendMessage: vi.fn(),
      };

      manager.register(channel);

      const result = manager.getChannel('my-channel');

      expect(result).not.toBeNull();
      expect(result?.name).toBe('my-channel');
    });

    it('should return null for non-existent channel', () => {
      const result = manager.getChannel('non-existent');

      expect(result).toBeNull();
    });
  });

  describe('getStats', () => {
    it('should return correct counts', () => {
      const tool: ToolPlugin = {
        name: 'stat-tool',
        version: '1.0.0',
        description: 'Test',
        schema: {
          name: 'stat_tool',
          description: 'Test',
          input_schema: { type: 'object', properties: {} },
        },
        execute: vi.fn(),
      };

      const channel: ChannelPlugin = {
        name: 'stat-channel',
        version: '1.0.0',
        init: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
        onMessage: vi.fn(),
        sendMessage: vi.fn(),
      };

      manager.register(tool);
      manager.register(channel);

      const stats = manager.getStats();

      expect(stats.total).toBe(2);
      expect(stats.tools).toBe(1);
      expect(stats.channels).toBe(1);
    });
  });

  describe('clear', () => {
    it('should remove all plugins', async () => {
      const tool: ToolPlugin = {
        name: 'clear-tool',
        version: '1.0.0',
        description: 'Test',
        schema: {
          name: 'clear_tool',
          description: 'Test',
          input_schema: { type: 'object', properties: {} },
        },
        execute: vi.fn(),
      };

      manager.register(tool);
      expect(manager.getPluginNames().length).toBe(1);

      await manager.clear();

      expect(manager.getPluginNames().length).toBe(0);
    });

    it('should stop all channels before clearing', async () => {
      const stopFn = vi.fn().mockResolvedValue(undefined);
      const channel: ChannelPlugin = {
        name: 'clear-channel',
        version: '1.0.0',
        init: vi.fn(),
        start: vi.fn(),
        stop: stopFn,
        onMessage: vi.fn(),
        sendMessage: vi.fn(),
      };

      manager.register(channel);
      await manager.clear();

      expect(stopFn).toHaveBeenCalled();
    });
  });

  describe('stopAll', () => {
    it('should stop all channels without clearing', async () => {
      const stop1 = vi.fn().mockResolvedValue(undefined);
      const stop2 = vi.fn().mockResolvedValue(undefined);

      const channel1: ChannelPlugin = {
        name: 'stop-channel-1',
        version: '1.0.0',
        init: vi.fn(),
        start: vi.fn(),
        stop: stop1,
        onMessage: vi.fn(),
        sendMessage: vi.fn(),
      };

      const channel2: ChannelPlugin = {
        name: 'stop-channel-2',
        version: '1.0.0',
        init: vi.fn(),
        start: vi.fn(),
        stop: stop2,
        onMessage: vi.fn(),
        sendMessage: vi.fn(),
      };

      manager.register(channel1);
      manager.register(channel2);

      await manager.stopAll();

      expect(stop1).toHaveBeenCalled();
      expect(stop2).toHaveBeenCalled();
      // 插件仍然注册
      expect(manager.getPluginNames().length).toBe(2);
    });
  });
});

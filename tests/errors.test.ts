import { describe, it, expect } from 'vitest';
import {
  FlashClawError,
  PluginError,
  ApiError,
  ConfigError,
  ChannelError,
} from '../src/errors.js';

describe('errors', () => {
  describe('FlashClawError', () => {
    it('should create error with message and code', () => {
      const error = new FlashClawError('Test error', 'TEST_ERROR');

      expect(error.message).toBe('Test error');
      expect(error.code).toBe('TEST_ERROR');
      expect(error.name).toBe('FlashClawError');
      expect(error.recoverable).toBe(false);
    });

    it('should support recoverable flag', () => {
      const recoverableError = new FlashClawError('Retry me', 'RETRY_ERROR', true);
      const fatalError = new FlashClawError('Fatal', 'FATAL_ERROR', false);

      expect(recoverableError.recoverable).toBe(true);
      expect(fatalError.recoverable).toBe(false);
    });

    it('should be instanceof Error', () => {
      const error = new FlashClawError('Test', 'TEST');

      expect(error instanceof Error).toBe(true);
      expect(error instanceof FlashClawError).toBe(true);
    });
  });

  describe('PluginError', () => {
    it('should create plugin error with plugin name', () => {
      const error = new PluginError('Plugin failed', 'my-plugin');

      expect(error.message).toBe('Plugin failed');
      expect(error.pluginName).toBe('my-plugin');
      expect(error.code).toBe('PLUGIN_ERROR');
      expect(error.name).toBe('PluginError');
      expect(error.recoverable).toBe(false);
    });

    it('should be instanceof FlashClawError', () => {
      const error = new PluginError('Test', 'plugin');

      expect(error instanceof Error).toBe(true);
      expect(error instanceof FlashClawError).toBe(true);
      expect(error instanceof PluginError).toBe(true);
    });
  });

  describe('ApiError', () => {
    it('should create API error with status code', () => {
      const error = new ApiError('Rate limited', 429);

      expect(error.message).toBe('Rate limited');
      expect(error.statusCode).toBe(429);
      expect(error.code).toBe('API_ERROR');
      expect(error.name).toBe('ApiError');
      expect(error.recoverable).toBe(true); // API errors are recoverable by default
    });

    it('should work without status code', () => {
      const error = new ApiError('Network error');

      expect(error.message).toBe('Network error');
      expect(error.statusCode).toBeUndefined();
    });
  });

  describe('ConfigError', () => {
    it('should create config error with key', () => {
      const error = new ConfigError('Invalid config', 'apiKey');

      expect(error.message).toBe('Invalid config');
      expect(error.key).toBe('apiKey');
      expect(error.code).toBe('CONFIG_ERROR');
      expect(error.name).toBe('ConfigError');
      expect(error.recoverable).toBe(false);
    });

    it('should work without key', () => {
      const error = new ConfigError('Config file missing');

      expect(error.message).toBe('Config file missing');
      expect(error.key).toBeUndefined();
    });
  });

  describe('ChannelError', () => {
    it('should create channel error with channel name', () => {
      const error = new ChannelError('Connection failed', 'feishu');

      expect(error.message).toBe('Connection failed');
      expect(error.channel).toBe('feishu');
      expect(error.code).toBe('CHANNEL_ERROR');
      expect(error.name).toBe('ChannelError');
      expect(error.recoverable).toBe(true); // Channel errors are recoverable
    });
  });

  describe('error handling patterns', () => {
    it('should support catch by type', () => {
      const throwPluginError = () => {
        throw new PluginError('Plugin crashed', 'test-plugin');
      };

      try {
        throwPluginError();
      } catch (err) {
        if (err instanceof PluginError) {
          expect(err.pluginName).toBe('test-plugin');
        } else {
          throw new Error('Should have caught PluginError');
        }
      }
    });

    it('should support error code check', () => {
      const errors: FlashClawError[] = [
        new PluginError('Plugin error', 'p1'),
        new ApiError('API error', 500),
        new ConfigError('Config error'),
      ];

      const pluginErrors = errors.filter(e => e.code === 'PLUGIN_ERROR');
      const recoverableErrors = errors.filter(e => e.recoverable);

      expect(pluginErrors.length).toBe(1);
      expect(recoverableErrors.length).toBe(1);
    });
  });
});

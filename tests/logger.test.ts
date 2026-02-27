import { describe, it, expect } from 'vitest';
import { logger, createLogger } from '../src/logger.js';

describe('logger', () => {
  describe('default logger', () => {
    it('should export default logger', () => {
      expect(logger).toBeDefined();
      expect(typeof logger.info).toBe('function');
      expect(typeof logger.error).toBe('function');
      expect(typeof logger.warn).toBe('function');
      expect(typeof logger.debug).toBe('function');
    });

    it('should have level property', () => {
      expect(logger.level).toBeDefined();
      // 默认应该是 info
      expect(['info', 'debug', 'warn', 'error', 'trace', 'fatal']).toContain(logger.level);
    });
  });

  describe('createLogger', () => {
    it('should create child logger with module name', () => {
      const childLogger = createLogger('TestModule');

      expect(childLogger).toBeDefined();
      expect(typeof childLogger.info).toBe('function');
    });

    it('should create different loggers for different modules', () => {
      const logger1 = createLogger('Module1');
      const logger2 = createLogger('Module2');

      // 它们是不同的实例
      expect(logger1).not.toBe(logger2);
    });

    it('should inherit parent level', () => {
      const childLogger = createLogger('Child');

      // 子 logger 应该继承父级的 level
      expect(childLogger.level).toBe(logger.level);
    });
  });

  describe('logging methods', () => {
    it('should have all standard log levels', () => {
      const testLogger = createLogger('Test');

      // 所有标准方法都应该存在
      expect(typeof testLogger.trace).toBe('function');
      expect(typeof testLogger.debug).toBe('function');
      expect(typeof testLogger.info).toBe('function');
      expect(typeof testLogger.warn).toBe('function');
      expect(typeof testLogger.error).toBe('function');
      expect(typeof testLogger.fatal).toBe('function');
    });

    it('should support object logging', () => {
      const testLogger = createLogger('ObjectTest');

      // 不应该抛出错误
      expect(() => {
        testLogger.info({ key: 'value', count: 42 }, 'Test message');
      }).not.toThrow();
    });

    it('should support error logging', () => {
      const testLogger = createLogger('ErrorTest');
      const error = new Error('Test error');

      // 不应该抛出错误
      expect(() => {
        testLogger.error({ err: error }, 'Error occurred');
      }).not.toThrow();
    });
  });

  describe('child logger behavior', () => {
    it('should be able to create nested children', () => {
      const parent = createLogger('Parent');
      const child = parent.child({ subModule: 'Child' });

      expect(child).toBeDefined();
      expect(typeof child.info).toBe('function');
    });

    it('should support bindings', () => {
      const testLogger = createLogger('Bindings');
      const boundLogger = testLogger.child({ requestId: '123' });

      expect(boundLogger).toBeDefined();
      // 不应该抛出错误
      expect(() => {
        boundLogger.info('Bound message');
      }).not.toThrow();
    });
  });
});

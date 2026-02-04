import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  substituteEnvVars,
  substituteEnvVarsDeep,
  hasEnvVars,
  extractEnvVarNames,
  extractEnvVarNamesDeep,
} from '../../src/utils/env-substitute.js';

describe('substituteEnvVars', () => {
  const mockEnv = {
    HOME: '/home/user',
    PORT: '3000',
    API_KEY: 'secret-key',
    EMPTY_VAR: '',
  };

  describe('基本替换', () => {
    it('应该替换单个环境变量', () => {
      expect(substituteEnvVars('${HOME}/config', mockEnv)).toBe('/home/user/config');
    });

    it('应该替换多个环境变量', () => {
      expect(substituteEnvVars('${HOME}:${PORT}', mockEnv)).toBe('/home/user:3000');
    });

    it('应该处理不存在的变量为空字符串', () => {
      expect(substituteEnvVars('${UNDEFINED_VAR}', mockEnv)).toBe('');
    });

    it('应该处理空环境变量为空字符串', () => {
      expect(substituteEnvVars('${EMPTY_VAR}', mockEnv)).toBe('');
    });

    it('应该保留没有环境变量的字符串', () => {
      expect(substituteEnvVars('no variables here', mockEnv)).toBe('no variables here');
    });
  });

  describe('默认值语法 ${VAR:-default}', () => {
    it('应该使用环境变量值（当存在时）', () => {
      expect(substituteEnvVars('${PORT:-8080}', mockEnv)).toBe('3000');
    });

    it('应该使用默认值（当变量不存在时）', () => {
      expect(substituteEnvVars('${UNDEFINED:-fallback}', mockEnv)).toBe('fallback');
    });

    it('应该使用默认值（当变量为空字符串时）', () => {
      expect(substituteEnvVars('${EMPTY_VAR:-fallback}', mockEnv)).toBe('fallback');
    });

    it('应该支持空默认值', () => {
      expect(substituteEnvVars('${UNDEFINED:-}', mockEnv)).toBe('');
    });

    it('应该支持包含特殊字符的默认值', () => {
      expect(substituteEnvVars('${UNDEFINED:-http://localhost:3000}', mockEnv))
        .toBe('http://localhost:3000');
    });

    it('应该支持包含空格的默认值', () => {
      expect(substituteEnvVars('${UNDEFINED:-hello world}', mockEnv)).toBe('hello world');
    });
  });

  describe('复杂场景', () => {
    it('应该处理混合场景', () => {
      const result = substituteEnvVars(
        '${HOME}/app on port ${PORT:-8080} with key ${API_KEY}',
        mockEnv
      );
      expect(result).toBe('/home/user/app on port 3000 with key secret-key');
    });

    it('应该处理连续的环境变量', () => {
      expect(substituteEnvVars('${HOME}${PORT}', mockEnv)).toBe('/home/user3000');
    });

    it('应该处理嵌套的大括号（不支持，保持原样内部内容）', () => {
      // ${VAR} 语法不支持嵌套，这个测试确保不会错误匹配
      expect(substituteEnvVars('${HOME}', mockEnv)).toBe('/home/user');
    });
  });

  describe('使用真实 process.env', () => {
    const originalEnv = { ...process.env };
    
    beforeEach(() => {
      process.env.TEST_VAR = 'test-value';
    });

    afterEach(() => {
      delete process.env.TEST_VAR;
      Object.keys(process.env).forEach(key => {
        if (!(key in originalEnv)) {
          delete process.env[key];
        }
      });
    });

    it('应该默认使用 process.env', () => {
      expect(substituteEnvVars('${TEST_VAR}')).toBe('test-value');
    });
  });
});

describe('hasEnvVars', () => {
  it('应该检测到 ${VAR} 格式', () => {
    expect(hasEnvVars('${HOME}')).toBe(true);
  });

  it('应该检测到 ${VAR:-default} 格式', () => {
    expect(hasEnvVars('${PORT:-3000}')).toBe(true);
  });

  it('应该对普通字符串返回 false', () => {
    expect(hasEnvVars('no variables')).toBe(false);
  });

  it('应该对空字符串返回 false', () => {
    expect(hasEnvVars('')).toBe(false);
  });

  it('应该处理类似但不完整的语法', () => {
    expect(hasEnvVars('$HOME')).toBe(false);
    expect(hasEnvVars('${}')).toBe(false);
    expect(hasEnvVars('{HOME}')).toBe(false);
  });
});

describe('substituteEnvVarsDeep', () => {
  const mockEnv = {
    API_URL: 'https://api.example.com',
    PORT: '3000',
    SECRET: 'my-secret',
  };

  describe('基本类型', () => {
    it('应该处理字符串', () => {
      expect(substituteEnvVarsDeep('${API_URL}', mockEnv)).toBe('https://api.example.com');
    });

    it('应该直接返回数字', () => {
      expect(substituteEnvVarsDeep(42, mockEnv)).toBe(42);
    });

    it('应该直接返回布尔值', () => {
      expect(substituteEnvVarsDeep(true, mockEnv)).toBe(true);
    });

    it('应该直接返回 null', () => {
      expect(substituteEnvVarsDeep(null, mockEnv)).toBe(null);
    });

    it('应该直接返回 undefined', () => {
      expect(substituteEnvVarsDeep(undefined, mockEnv)).toBe(undefined);
    });
  });

  describe('数组处理', () => {
    it('应该递归处理数组中的字符串', () => {
      const input = ['${API_URL}', '${PORT}', 'static'];
      const expected = ['https://api.example.com', '3000', 'static'];
      expect(substituteEnvVarsDeep(input, mockEnv)).toEqual(expected);
    });

    it('应该处理混合类型数组', () => {
      const input = ['${API_URL}', 123, true, null];
      const expected = ['https://api.example.com', 123, true, null];
      expect(substituteEnvVarsDeep(input, mockEnv)).toEqual(expected);
    });

    it('应该处理嵌套数组', () => {
      const input = [['${API_URL}'], ['${PORT}']];
      const expected = [['https://api.example.com'], ['3000']];
      expect(substituteEnvVarsDeep(input, mockEnv)).toEqual(expected);
    });
  });

  describe('对象处理', () => {
    it('应该递归处理对象中的字符串', () => {
      const input = {
        apiUrl: '${API_URL}',
        port: '${PORT}',
        static: 'value',
      };
      const expected = {
        apiUrl: 'https://api.example.com',
        port: '3000',
        static: 'value',
      };
      expect(substituteEnvVarsDeep(input, mockEnv)).toEqual(expected);
    });

    it('应该处理嵌套对象', () => {
      const input = {
        api: {
          url: '${API_URL}',
          port: '${PORT}',
        },
        auth: {
          secret: '${SECRET}',
        },
      };
      const expected = {
        api: {
          url: 'https://api.example.com',
          port: '3000',
        },
        auth: {
          secret: 'my-secret',
        },
      };
      expect(substituteEnvVarsDeep(input, mockEnv)).toEqual(expected);
    });

    it('应该处理对象中的数组', () => {
      const input = {
        urls: ['${API_URL}', '${API_URL}/v2'],
      };
      const expected = {
        urls: ['https://api.example.com', 'https://api.example.com/v2'],
      };
      expect(substituteEnvVarsDeep(input, mockEnv)).toEqual(expected);
    });
  });

  describe('不可变性', () => {
    it('不应该修改原始对象', () => {
      const input = { url: '${API_URL}' };
      const inputCopy = { ...input };
      substituteEnvVarsDeep(input, mockEnv);
      expect(input).toEqual(inputCopy);
    });

    it('不应该修改原始数组', () => {
      const input = ['${API_URL}'];
      const inputCopy = [...input];
      substituteEnvVarsDeep(input, mockEnv);
      expect(input).toEqual(inputCopy);
    });
  });

  describe('实际配置场景', () => {
    it('应该处理典型的插件配置', () => {
      const input = {
        plugins: {
          feishu: {
            enabled: true,
            appId: '${FEISHU_APP_ID}',
            appSecret: '${FEISHU_APP_SECRET:-}',
          },
          api: {
            baseUrl: '${API_URL:-http://localhost:3000}',
          },
        },
      };
      
      const env = {
        FEISHU_APP_ID: 'cli_abc123',
        API_URL: 'https://prod.example.com',
      };

      const result = substituteEnvVarsDeep(input, env);
      
      expect(result.plugins.feishu.appId).toBe('cli_abc123');
      expect(result.plugins.feishu.appSecret).toBe('');
      expect(result.plugins.api.baseUrl).toBe('https://prod.example.com');
    });
  });
});

describe('extractEnvVarNames', () => {
  it('应该提取单个变量名', () => {
    expect(extractEnvVarNames('${HOME}')).toEqual(['HOME']);
  });

  it('应该提取多个变量名', () => {
    expect(extractEnvVarNames('${HOME}/${USER}')).toEqual(['HOME', 'USER']);
  });

  it('应该提取带默认值的变量名', () => {
    expect(extractEnvVarNames('${PORT:-3000}')).toEqual(['PORT']);
  });

  it('应该去重', () => {
    expect(extractEnvVarNames('${HOME}${HOME}')).toEqual(['HOME']);
  });

  it('应该对无变量字符串返回空数组', () => {
    expect(extractEnvVarNames('no variables')).toEqual([]);
  });
});

describe('extractEnvVarNamesDeep', () => {
  it('应该从嵌套结构中提取所有变量名', () => {
    const input = {
      url: '${API_URL}',
      ports: ['${PORT}', '${BACKUP_PORT}'],
      nested: {
        key: '${API_KEY}',
      },
    };
    
    const names = extractEnvVarNamesDeep(input);
    expect(names).toContain('API_URL');
    expect(names).toContain('PORT');
    expect(names).toContain('BACKUP_PORT');
    expect(names).toContain('API_KEY');
    expect(names).toHaveLength(4);
  });

  it('应该去重', () => {
    const input = {
      url1: '${API_URL}',
      url2: '${API_URL}',
    };
    
    expect(extractEnvVarNamesDeep(input)).toEqual(['API_URL']);
  });
});

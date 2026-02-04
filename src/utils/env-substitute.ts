/**
 * 环境变量替换工具
 * 
 * 支持语法:
 * - ${VAR} - 从环境变量获取值
 * - ${VAR:-default} - 有默认值的环境变量
 * 
 * 递归处理对象和数组中的字符串值
 */

/**
 * 环境变量替换的正则表达式
 * 匹配 ${VAR} 或 ${VAR:-default} 格式
 */
const ENV_VAR_PATTERN = /\$\{([^}:]+)(?::-([^}]*))?\}/g;

/**
 * 替换字符串中的环境变量引用
 * 
 * @param str - 包含环境变量引用的字符串
 * @param env - 环境变量对象 (默认使用 process.env)
 * @returns 替换后的字符串
 * 
 * @example
 * substituteEnvVars('${HOME}/config') // '/home/user/config'
 * substituteEnvVars('${PORT:-3000}')  // '3000' (如果 PORT 未定义)
 * substituteEnvVars('${API_KEY}')     // '' (如果未定义且无默认值)
 */
export function substituteEnvVars(
  str: string,
  env: Record<string, string | undefined> = process.env
): string {
  return str.replace(ENV_VAR_PATTERN, (match, varName, defaultValue) => {
    const value = env[varName];
    
    // 如果环境变量存在且不为空字符串，使用它
    if (value !== undefined && value !== '') {
      return value;
    }
    
    // 否则使用默认值，如果没有默认值则返回空字符串
    return defaultValue !== undefined ? defaultValue : '';
  });
}

/**
 * 检查字符串是否包含环境变量引用
 * 
 * @param str - 要检查的字符串
 * @returns 是否包含环境变量引用
 */
export function hasEnvVars(str: string): boolean {
  ENV_VAR_PATTERN.lastIndex = 0; // 重置正则状态
  return ENV_VAR_PATTERN.test(str);
}

/**
 * 递归替换对象/数组中所有字符串的环境变量
 * 
 * @param value - 要处理的值 (任意类型)
 * @param env - 环境变量对象 (默认使用 process.env)
 * @returns 处理后的新值 (不修改原对象)
 * 
 * @example
 * substituteEnvVarsDeep({
 *   apiUrl: '${API_URL:-http://localhost:3000}',
 *   keys: ['${KEY1}', '${KEY2}'],
 *   nested: { secret: '${SECRET}' }
 * })
 */
export function substituteEnvVarsDeep<T>(
  value: T,
  env: Record<string, string | undefined> = process.env
): T {
  // 处理 null 和 undefined
  if (value === null || value === undefined) {
    return value;
  }

  // 处理字符串
  if (typeof value === 'string') {
    return substituteEnvVars(value, env) as T;
  }

  // 处理数组
  if (Array.isArray(value)) {
    return value.map((item) => substituteEnvVarsDeep(item, env)) as T;
  }

  // 处理普通对象
  if (typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      result[key] = substituteEnvVarsDeep(val, env);
    }
    return result as T;
  }

  // 其他类型 (number, boolean, etc.) 直接返回
  return value;
}

/**
 * 提取字符串中引用的所有环境变量名称
 * 
 * @param str - 要分析的字符串
 * @returns 环境变量名称数组 (去重)
 * 
 * @example
 * extractEnvVarNames('${API_URL} and ${API_KEY:-default}')
 * // ['API_URL', 'API_KEY']
 */
export function extractEnvVarNames(str: string): string[] {
  const names: string[] = [];
  const regex = new RegExp(ENV_VAR_PATTERN);
  let match;

  while ((match = regex.exec(str)) !== null) {
    if (!names.includes(match[1])) {
      names.push(match[1]);
    }
  }

  return names;
}

/**
 * 递归提取对象/数组中所有引用的环境变量名称
 * 
 * @param value - 要分析的值
 * @returns 环境变量名称数组 (去重)
 */
export function extractEnvVarNamesDeep(value: unknown): string[] {
  const names: string[] = [];

  function collect(val: unknown): void {
    if (typeof val === 'string') {
      for (const name of extractEnvVarNames(val)) {
        if (!names.includes(name)) {
          names.push(name);
        }
      }
    } else if (Array.isArray(val)) {
      val.forEach(collect);
    } else if (val !== null && typeof val === 'object') {
      Object.values(val).forEach(collect);
    }
  }

  collect(value);
  return names;
}

/**
 * 工具参数后处理
 * 
 * 小模型常见的参数格式错误自动修正。
 * 原则：只修正明显的格式问题，不改变语义。
 * 修正后记录 debug 日志，方便排查。
 */

import { createLogger } from './logger.js';

const logger = createLogger('ToolParams');

// ==================== 通用修正 ====================

/**
 * 尝试将各种时间格式转为 ISO 8601
 * 支持：
 * - "2024-12-31 9:00" → "2024-12-31T09:00:00+08:00"
 * - "2024/12/31 09:00" → "2024-12-31T09:00:00+08:00"
 * - "明天 9:00" → 计算为明天的 ISO 时间
 * - "12-31 9:00" → 补全年份
 * - 已经是 ISO 格式的直接返回
 */
function tryParseToISO(value: string): string | null {
  // 已经是有效 ISO 格式
  if (/^\d{4}-\d{2}-\d{2}T/.test(value)) {
    const d = new Date(value);
    if (!isNaN(d.getTime())) return d.toISOString();
  }

  // "2024-12-31 09:00" 或 "2024-12-31 9:00:00"
  const dateTimeMatch = value.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (dateTimeMatch) {
    const [, y, m, d, h, min, sec] = dateTimeMatch;
    const dateStr = `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}T${h.padStart(2, '0')}:${min}:${sec || '00'}`;
    const parsed = new Date(dateStr);
    if (!isNaN(parsed.getTime())) return parsed.toISOString();
  }

  // "12-31 09:00" → 补全当前年份
  const shortDateMatch = value.match(/^(\d{1,2})[/-](\d{1,2})\s+(\d{1,2}):(\d{2})$/);
  if (shortDateMatch) {
    const [, m, d, h, min] = shortDateMatch;
    const year = new Date().getFullYear();
    const dateStr = `${year}-${m.padStart(2, '0')}-${d.padStart(2, '0')}T${h.padStart(2, '0')}:${min}:00`;
    const parsed = new Date(dateStr);
    if (!isNaN(parsed.getTime())) {
      // 如果已过去，可能是指明年
      if (parsed.getTime() < Date.now()) {
        const nextYear = new Date(dateStr.replace(`${year}`, `${year + 1}`));
        if (!isNaN(nextYear.getTime())) return nextYear.toISOString();
      }
      return parsed.toISOString();
    }
  }

  return null;
}

/**
 * 将中文时间间隔转为毫秒
 * "30分钟" → "1800000"
 * "2小时" → "7200000"
 * "1天" → "86400000"
 */
function tryParseIntervalToMs(value: string): string | null {
  const match = value.match(/^(\d+(?:\.\d+)?)\s*(秒|分钟?|小时?|天|s|sec|min|minute|h|hour|d|day)s?$/i);
  if (!match) return null;

  const num = parseFloat(match[1]);
  const unit = match[2].toLowerCase();

  let ms: number;
  if (['秒', 's', 'sec'].includes(unit)) {
    ms = num * 1000;
  } else if (['分', '分钟', 'min', 'minute'].includes(unit)) {
    ms = num * 60 * 1000;
  } else if (['时', '小时', 'h', 'hour'].includes(unit)) {
    ms = num * 3600 * 1000;
  } else if (['天', 'd', 'day'].includes(unit)) {
    ms = num * 86400 * 1000;
  } else {
    return null;
  }

  if (ms < 1000) return null;
  return String(Math.round(ms));
}

// ==================== 按工具名修正 ====================

type ParamRecord = Record<string, unknown>;

function normalizeScheduleTask(params: ParamRecord): ParamRecord {
  const result = { ...params };
  let changed = false;

  // 修正 schedule_type（小模型可能用 camelCase 或错误值）
  if (!result.scheduleType && result.schedule_type) {
    result.scheduleType = result.schedule_type;
    delete result.schedule_type;
    changed = true;
  }
  if (!result.scheduleValue && result.schedule_value) {
    result.scheduleValue = result.schedule_value;
    delete result.schedule_value;
    changed = true;
  }
  if (!result.contextMode && result.context_mode) {
    result.contextMode = result.context_mode;
    delete result.context_mode;
    changed = true;
  }

  // 修正 scheduleType 拼写
  const typeStr = String(result.scheduleType || '').toLowerCase().trim();
  if (['one', 'onetime', 'one_time', 'single'].includes(typeStr)) {
    result.scheduleType = 'once';
    changed = true;
  } else if (['repeat', 'every', 'periodic'].includes(typeStr)) {
    result.scheduleType = 'interval';
    changed = true;
  }

  // 修正 scheduleValue 时间格式
  if (result.scheduleType === 'once' && typeof result.scheduleValue === 'string') {
    const sv = result.scheduleValue.trim();
    // 不是有效 ISO 格式，尝试解析
    if (!/^\d{4}-\d{2}-\d{2}T/.test(sv)) {
      const iso = tryParseToISO(sv);
      if (iso) {
        result.scheduleValue = iso;
        changed = true;
      }
    }
  }

  // 修正 interval 类型：中文时间间隔或纯数字字符串
  if (result.scheduleType === 'interval' && typeof result.scheduleValue === 'string') {
    const sv = result.scheduleValue.trim();
    // 先尝试中文/英文时间单位解析
    const ms = tryParseIntervalToMs(sv);
    if (ms) {
      result.scheduleValue = ms;
      changed = true;
    } else if (/^\d+$/.test(sv)) {
      // 纯数字，但如果太小可能是秒而不是毫秒
      const num = parseInt(sv, 10);
      if (num > 0 && num < 1000) {
        // 可能是秒数，转为毫秒
        result.scheduleValue = String(num * 1000);
        changed = true;
      }
    }
  }

  // 修正 scheduleValue 为数字类型（小模型可能传数字而不是字符串）
  if (typeof result.scheduleValue === 'number') {
    result.scheduleValue = String(result.scheduleValue);
    changed = true;
  }

  if (changed) {
    logger.debug({ tool: 'schedule_task', original: params, normalized: result }, '🔧 参数已修正');
  }

  return result;
}

function normalizeMemory(params: ParamRecord): ParamRecord {
  const result = { ...params };
  let changed = false;

  // 小模型可能用 "content" 代替 "value"
  if (!result.value && result.content && typeof result.content === 'string') {
    result.value = result.content;
    delete result.content;
    changed = true;
  }

  // 小模型可能用 "text" 代替 "value"
  if (!result.value && result.text && typeof result.text === 'string') {
    result.value = result.text;
    delete result.text;
    changed = true;
  }

  // 小模型可能用 "name" 代替 "key"
  if (!result.key && result.name && typeof result.name === 'string') {
    result.key = result.name;
    delete result.name;
    changed = true;
  }

  // scope 修正：小模型可能用 "personal"/"private" 代替 "user"
  if (typeof result.scope === 'string') {
    const s = result.scope.toLowerCase().trim();
    if (['personal', 'private', 'me', 'mine'].includes(s)) {
      result.scope = 'user';
      changed = true;
    } else if (['all', 'shared', 'everyone', 'public'].includes(s)) {
      result.scope = 'global';
      changed = true;
    }
  }

  if (changed) {
    logger.debug({ tool: 'memory', original: params, normalized: result }, '🔧 参数已修正');
  }

  return result;
}

function normalizeSendMessage(params: ParamRecord): ParamRecord {
  const result = { ...params };
  let changed = false;

  // 小模型可能用 "text" 或 "message" 代替 "content"
  if (!result.content && result.text && typeof result.text === 'string') {
    result.content = result.text;
    delete result.text;
    changed = true;
  }
  if (!result.content && result.message && typeof result.message === 'string') {
    result.content = result.message;
    delete result.message;
    changed = true;
  }

  if (changed) {
    logger.debug({ tool: 'send_message', original: params, normalized: result }, '🔧 参数已修正');
  }

  return result;
}

// ==================== 公开接口 ====================

/** 工具名到修正函数的映射 */
const NORMALIZERS: Record<string, (params: ParamRecord) => ParamRecord> = {
  schedule_task: normalizeScheduleTask,
  memory: normalizeMemory,
  send_message: normalizeSendMessage,
};

/**
 * 对工具参数进行后处理修正
 * 如果工具没有对应的修正器，原样返回
 */
export function normalizeToolParams(toolName: string, params: unknown): unknown {
  if (!params || typeof params !== 'object') return params;

  const normalizer = NORMALIZERS[toolName];
  if (!normalizer) return params;

  try {
    return normalizer(params as ParamRecord);
  } catch (err) {
    logger.debug({ tool: toolName, err }, '参数修正失败，使用原始参数');
    return params;
  }
}

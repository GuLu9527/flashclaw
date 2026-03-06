/**
 * Agent 配置（群组级别，用于覆盖默认超时等）
 */
export interface AgentConfig {
  timeout?: number;  // 超时时间，默认 300000 (5 分钟)
  env?: Record<string, string>;  // 额外环境变量
}

// ==================== 多 Agent 配置 ====================

/**
 * Agent 绑定规则 — 决定哪些消息路由到此 Agent
 */
export interface AgentBinding {
  /** 渠道名（feishu / telegram / web-ui / *） */
  channel?: string;
  /** 群组名/ID（支持通配符，如 work-*） */
  group?: string;
  /** 私聊对象 ID（精确匹配） */
  peer?: string;
}

/**
 * 多 Agent 注册配置
 */
export interface MultiAgentConfig {
  /** 唯一标识 */
  id: string;
  /** 显示名称 */
  name: string;
  /** SOUL.md 文件路径（相对于 ~/.flashclaw/） */
  soul: string;
  /** AI Provider 名称（null = 使用默认） */
  model?: string | null;
  /** 工具白名单（["*"] = 全部工具） */
  tools: string[];
  /** 是否为默认 Agent */
  default?: boolean;
  /** 路由绑定规则 */
  bindings?: AgentBinding[];
  /** 提示词模式：full（完整）/ minimal（精简）/ none（极简） */
  promptMode?: 'full' | 'minimal' | 'none';
}

/**
 * 注册的群组
 */
export interface RegisteredGroup {
  name: string;
  folder: string;
  trigger: string;
  added_at: string;
  agentConfig?: AgentConfig;
}

export interface Session {
  [folder: string]: string;
}

export interface NewMessage {
  id: string;
  chat_jid: string;
  sender: string;
  sender_name: string;
  content: string;
  timestamp: string;
}

export interface ScheduledTask {
  id: string;
  group_folder: string;
  chat_jid: string;
  prompt: string;
  schedule_type: 'cron' | 'interval' | 'once';
  schedule_value: string;
  context_mode: 'group' | 'isolated';
  next_run: string | null;
  last_run: string | null;
  last_result: string | null;
  status: 'active' | 'paused' | 'completed' | 'failed';
  created_at: string;
  /** 当前重试次数 */
  retry_count: number;
  /** 最大重试次数（默认 3） */
  max_retries: number;
  /** 任务执行超时时间（毫秒，默认 300000） */
  timeout_ms?: number;
}

export interface TaskRunLog {
  task_id: string;
  run_at: string;
  duration_ms: number;
  status: 'success' | 'error';
  result: string | null;
  error: string | null;
}

/**
 * Agent 配置
 */
export interface AgentConfig {
  timeout?: number;  // 超时时间，默认 300000 (5 分钟)
  env?: Record<string, string>;  // 额外环境变量
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
  status: 'active' | 'paused' | 'completed';
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

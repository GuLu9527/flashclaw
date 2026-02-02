/**
 * Agent Runner for FlashClaw
 * 使用 Anthropic SDK 直接调用 API
 * 
 * Features:
 * - Direct Anthropic API integration
 * - IPC-based tools for messaging and task scheduling
 * - Per-group isolation via working directories
 * - 记忆系统集成
 */

import fs from 'fs';
import path from 'path';
import pino from 'pino';
import { CronExpressionParser } from 'cron-parser';
import {
  GROUPS_DIR,
  DATA_DIR,
  AGENT_TIMEOUT
} from './config.js';
import { RegisteredGroup } from './types.js';
import { ApiClient, ChatMessage, ToolSchema, createApiClient, TextBlock, ImageBlock } from './core/api-client.js';
import { currentModelSupportsVision, getCurrentModelId } from './core/model-capabilities.js';
import { MemoryManager, createMemoryManager } from './core/memory.js';

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: { target: 'pino-pretty', options: { colorize: true } }
});

/**
 * 图片附件
 */
export interface ImageAttachment {
  type: 'image';
  /** base64 data URL 或纯 base64 数据 */
  content: string;
  mimeType?: string;
}

export interface AgentInput {
  prompt: string;
  sessionId?: string;
  groupFolder: string;
  chatJid: string;
  isMain: boolean;
  isScheduledTask?: boolean;
  /** 图片附件列表 */
  attachments?: ImageAttachment[];
}

export interface AgentOutput {
  status: 'success' | 'error';
  result: string | null;
  newSessionId?: string;
  error?: string;
}

// ==================== 工具系统 ====================

/**
 * IPC 上下文
 */
interface IpcContext {
  chatJid: string;
  groupFolder: string;
  isMain: boolean;
}

/**
 * 工具执行结果
 */
interface ToolResult {
  content: string;
  isError?: boolean;
}

/**
 * 获取 IPC 目录路径
 */
function getIpcDir(groupFolder: string): string {
  return path.join(DATA_DIR, 'ipc', groupFolder);
}

/**
 * 写入 IPC 文件（原子操作）
 */
function writeIpcFile(dir: string, data: object): string {
  fs.mkdirSync(dir, { recursive: true });

  const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`;
  const filepath = path.join(dir, filename);

  // Atomic write: temp file then rename
  const tempPath = `${filepath}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(data, null, 2));
  fs.renameSync(tempPath, filepath);

  return filename;
}

/**
 * 内置工具定义
 * 这些工具用于消息发送和任务调度
 */
export function getBuiltinTools(): ToolSchema[] {
  return [
    {
      name: 'send_message',
      description: 'Send a message to the current chat. Use this to proactively share information or updates.',
      input_schema: {
        type: 'object',
        properties: {
          text: {
            type: 'string',
            description: 'The message text to send'
          }
        },
        required: ['text']
      }
    },
    {
      name: 'schedule_task',
      description: `Schedule a recurring or one-time task. The task will run as a full agent with access to all tools.

CONTEXT MODE - Choose based on task type:
• "group" (recommended for most tasks): Task runs in the group's conversation context, with access to chat history and memory.
• "isolated": Task runs in a fresh session with no conversation history.

SCHEDULE VALUE FORMAT (all times are LOCAL timezone):
• cron: Standard cron expression (e.g., "0 9 * * *" for daily at 9am)
• interval: Milliseconds between runs (e.g., "300000" for 5 minutes)
• once: Local time like "2026-02-01T15:30:00" (no Z suffix!)`,
      input_schema: {
        type: 'object',
        properties: {
          prompt: {
            type: 'string',
            description: 'What the agent should do when the task runs'
          },
          schedule_type: {
            type: 'string',
            enum: ['cron', 'interval', 'once'],
            description: 'cron=recurring at specific times, interval=recurring every N ms, once=run once'
          },
          schedule_value: {
            type: 'string',
            description: 'The schedule value based on schedule_type'
          },
          context_mode: {
            type: 'string',
            enum: ['group', 'isolated'],
            description: 'group=runs with chat history, isolated=fresh session'
          },
          target_group: {
            type: 'string',
            description: 'Target group folder (main only, defaults to current group)'
          }
        },
        required: ['prompt', 'schedule_type', 'schedule_value']
      }
    },
    {
      name: 'list_tasks',
      description: "List all scheduled tasks. From main: shows all tasks. From other groups: shows only that group's tasks.",
      input_schema: {
        type: 'object',
        properties: {}
      }
    },
    {
      name: 'pause_task',
      description: 'Pause a scheduled task. It will not run until resumed.',
      input_schema: {
        type: 'object',
        properties: {
          task_id: {
            type: 'string',
            description: 'The task ID to pause'
          }
        },
        required: ['task_id']
      }
    },
    {
      name: 'resume_task',
      description: 'Resume a paused task.',
      input_schema: {
        type: 'object',
        properties: {
          task_id: {
            type: 'string',
            description: 'The task ID to resume'
          }
        },
        required: ['task_id']
      }
    },
    {
      name: 'cancel_task',
      description: 'Cancel and delete a scheduled task.',
      input_schema: {
        type: 'object',
        properties: {
          task_id: {
            type: 'string',
            description: 'The task ID to cancel'
          }
        },
        required: ['task_id']
      }
    },
    {
      name: 'register_group',
      description: `Register a new chat group so the agent can respond to messages there. Main group only.
The folder name should be lowercase with hyphens (e.g., "family-chat").`,
      input_schema: {
        type: 'object',
        properties: {
          jid: {
            type: 'string',
            description: 'The chat ID (e.g., "oc_xxxxxxxx")'
          },
          name: {
            type: 'string',
            description: 'Display name for the group'
          },
          folder: {
            type: 'string',
            description: 'Folder name for group files'
          },
          trigger: {
            type: 'string',
            description: 'Trigger word (e.g., "@Andy")'
          }
        },
        required: ['jid', 'name', 'folder', 'trigger']
      }
    },
    {
      name: 'remember',
      description: 'Save important information to long-term memory. Use this to remember user preferences, important facts, or anything that should persist across conversations.',
      input_schema: {
        type: 'object',
        properties: {
          key: {
            type: 'string',
            description: 'A short key to identify this memory (e.g., "user_name", "preferred_language")'
          },
          value: {
            type: 'string',
            description: 'The information to remember'
          }
        },
        required: ['key', 'value']
      }
    },
    {
      name: 'recall',
      description: 'Retrieve information from long-term memory. Use this to recall previously saved information.',
      input_schema: {
        type: 'object',
        properties: {
          key: {
            type: 'string',
            description: 'The key of the memory to recall. Leave empty to get all memories.'
          }
        }
      }
    }
  ];
}

/**
 * 创建工具执行器
 */
export function createToolExecutor(ctx: IpcContext, memoryManager: MemoryManager) {
  const { chatJid, groupFolder, isMain } = ctx;
  const IPC_DIR = getIpcDir(groupFolder);
  const MESSAGES_DIR = path.join(IPC_DIR, 'messages');
  const TASKS_DIR = path.join(IPC_DIR, 'tasks');

  return async (name: string, params: unknown): Promise<ToolResult> => {
    const args = params as Record<string, unknown>;

    switch (name) {
      case 'send_message': {
        const data = {
          type: 'message',
          chatJid,
          text: args.text as string,
          groupFolder,
          timestamp: new Date().toISOString()
        };
        const filename = writeIpcFile(MESSAGES_DIR, data);
        return { content: `Message queued for delivery (${filename})` };
      }

      case 'schedule_task': {
        const scheduleType = args.schedule_type as string;
        const scheduleValue = args.schedule_value as string;

        // 验证 schedule_value
        if (scheduleType === 'cron') {
          try {
            CronExpressionParser.parse(scheduleValue);
          } catch {
            return {
              content: `Invalid cron: "${scheduleValue}". Use format like "0 9 * * *" (daily 9am).`,
              isError: true
            };
          }
        } else if (scheduleType === 'interval') {
          const ms = parseInt(scheduleValue, 10);
          if (isNaN(ms) || ms <= 0) {
            return {
              content: `Invalid interval: "${scheduleValue}". Must be positive milliseconds.`,
              isError: true
            };
          }
        } else if (scheduleType === 'once') {
          const date = new Date(scheduleValue);
          if (isNaN(date.getTime())) {
            return {
              content: `Invalid timestamp: "${scheduleValue}". Use ISO 8601 format.`,
              isError: true
            };
          }
        }

        const targetGroup = isMain && args.target_group ? args.target_group as string : groupFolder;

        const data = {
          type: 'schedule_task',
          prompt: args.prompt,
          schedule_type: scheduleType,
          schedule_value: scheduleValue,
          context_mode: args.context_mode || 'group',
          groupFolder: targetGroup,
          chatJid,
          createdBy: groupFolder,
          timestamp: new Date().toISOString()
        };

        const filename = writeIpcFile(TASKS_DIR, data);
        return { content: `Task scheduled (${filename}): ${scheduleType} - ${scheduleValue}` };
      }

      case 'list_tasks': {
        const tasksFile = path.join(IPC_DIR, 'current_tasks.json');

        try {
          if (!fs.existsSync(tasksFile)) {
            return { content: 'No scheduled tasks found.' };
          }

          const allTasks = JSON.parse(fs.readFileSync(tasksFile, 'utf-8'));
          const tasks = isMain
            ? allTasks
            : allTasks.filter((t: { groupFolder: string }) => t.groupFolder === groupFolder);

          if (tasks.length === 0) {
            return { content: 'No scheduled tasks found.' };
          }

          const formatted = tasks.map((t: {
            id: string;
            prompt: string;
            schedule_type: string;
            schedule_value: string;
            status: string;
            next_run: string;
          }) =>
            `- [${t.id}] ${t.prompt.slice(0, 50)}... (${t.schedule_type}: ${t.schedule_value}) - ${t.status}, next: ${t.next_run || 'N/A'}`
          ).join('\n');

          return { content: `Scheduled tasks:\n${formatted}` };
        } catch (err) {
          return {
            content: `Error reading tasks: ${err instanceof Error ? err.message : String(err)}`,
            isError: true
          };
        }
      }

      case 'pause_task': {
        const data = {
          type: 'pause_task',
          taskId: args.task_id,
          groupFolder,
          isMain,
          timestamp: new Date().toISOString()
        };
        writeIpcFile(TASKS_DIR, data);
        return { content: `Task ${args.task_id} pause requested.` };
      }

      case 'resume_task': {
        const data = {
          type: 'resume_task',
          taskId: args.task_id,
          groupFolder,
          isMain,
          timestamp: new Date().toISOString()
        };
        writeIpcFile(TASKS_DIR, data);
        return { content: `Task ${args.task_id} resume requested.` };
      }

      case 'cancel_task': {
        const data = {
          type: 'cancel_task',
          taskId: args.task_id,
          groupFolder,
          isMain,
          timestamp: new Date().toISOString()
        };
        writeIpcFile(TASKS_DIR, data);
        return { content: `Task ${args.task_id} cancellation requested.` };
      }

      case 'register_group': {
        if (!isMain) {
          return {
            content: 'Only the main group can register new groups.',
            isError: true
          };
        }

        const data = {
          type: 'register_group',
          jid: args.jid,
          name: args.name,
          folder: args.folder,
          trigger: args.trigger,
          timestamp: new Date().toISOString()
        };

        writeIpcFile(TASKS_DIR, data);
        return { content: `Group "${args.name}" registered. It will start receiving messages immediately.` };
      }

      case 'remember': {
        memoryManager.remember(groupFolder, args.key as string, args.value as string);
        return { content: `已记住: ${args.key} = ${args.value}` };
      }

      case 'recall': {
        const value = memoryManager.recall(groupFolder, args.key as string | undefined);
        if (!value) {
          return { content: args.key ? `没有找到关于 "${args.key}" 的记忆。` : '没有保存的记忆。' };
        }
        return { content: args.key ? `${args.key}: ${value}` : `保存的记忆:\n${value}` };
      }

      default:
        return {
          content: `Unknown tool: ${name}`,
          isError: true
        };
    }
  };
}

// ==================== 全局实例 ====================

// 全局记忆管理器实例
let globalMemoryManager: MemoryManager | null = null;

/**
 * 获取全局记忆管理器
 */
export function getMemoryManager(): MemoryManager {
  if (!globalMemoryManager) {
    globalMemoryManager = createMemoryManager(DATA_DIR);
  }
  return globalMemoryManager;
}

// 全局 API 客户端实例
let globalApiClient: ApiClient | null = null;

/**
 * 获取全局 API 客户端
 */
export function getApiClient(): ApiClient | null {
  if (!globalApiClient) {
    globalApiClient = createApiClient();
  }
  return globalApiClient;
}

// ==================== Retry Configuration ====================

interface RetryConfig {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  retryableErrors: string[];
}

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 10000,
  retryableErrors: [
    'ECONNRESET',
    'ETIMEDOUT',
    'ECONNREFUSED',
    'rate_limit',
    'overloaded',
    '529',  // Overloaded
    '503',  // Service Unavailable
    '502',  // Bad Gateway
    'socket hang up',
    'network error'
  ]
};

function isRetryableError(error: string, config: RetryConfig): boolean {
  const lowerError = error.toLowerCase();
  return config.retryableErrors.some(e => lowerError.includes(e.toLowerCase()));
}

function calculateDelay(attempt: number, config: RetryConfig): number {
  // Exponential backoff with jitter
  const exponentialDelay = config.baseDelayMs * Math.pow(2, attempt);
  const jitter = Math.random() * 0.3 * exponentialDelay;
  return Math.min(exponentialDelay + jitter, config.maxDelayMs);
}

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ==================== Agent Execution ====================

/**
 * 获取群组的系统提示词
 */
function getGroupSystemPrompt(group: RegisteredGroup, isMain: boolean, isScheduledTask?: boolean): string {
  const memoryManager = getMemoryManager();
  
  // 读取群组的 CLAUDE.md 文件（如果存在）
  const groupDir = path.join(GROUPS_DIR, group.folder);
  const claudeMdPath = path.join(groupDir, 'CLAUDE.md');
  let basePrompt = '';
  
  if (fs.existsSync(claudeMdPath)) {
    basePrompt = fs.readFileSync(claudeMdPath, 'utf-8');
  } else {
    // 默认系统提示词
    basePrompt = `你是 FlashClaw，一个智能助手。
    
你正在 "${group.name}" 群组中与用户交流。

你可以使用以下工具：
- send_message: 发送消息到当前聊天
- schedule_task: 安排定时任务
- list_tasks: 列出所有定时任务
- pause_task/resume_task/cancel_task: 管理定时任务
- remember: 记住重要信息（长期记忆）
- recall: 回忆之前保存的信息

请用中文回复，除非用户使用其他语言。
保持回复简洁、有帮助。`;
  }
  
  // 构建包含长期记忆的系统提示词
  let systemPrompt = memoryManager.buildSystemPrompt(group.folder, basePrompt);
  
  // 添加权限说明
  if (isMain) {
    systemPrompt += '\n\n你拥有管理员权限，可以注册新群组和管理所有任务。';
  }
  
  // 添加定时任务上下文
  if (isScheduledTask) {
    systemPrompt += '\n\n[SCHEDULED TASK - 你是自动运行的，不是响应用户消息。如需与用户沟通，请使用 send_message 工具。]';
  }
  
  return systemPrompt;
}

/**
 * 运行 Agent（带重试）
 */
export async function runAgent(
  group: RegisteredGroup,
  input: AgentInput,
  retryConfig: RetryConfig = DEFAULT_RETRY_CONFIG
): Promise<AgentOutput> {
  let lastError: string | undefined;
  
  for (let attempt = 0; attempt <= retryConfig.maxRetries; attempt++) {
    if (attempt > 0) {
      const delay = calculateDelay(attempt - 1, retryConfig);
      logger.info({ 
        group: group.name, 
        attempt, 
        delay,
        lastError 
      }, 'Retrying agent after error');
      await sleep(delay);
    }
    
    const result = await runAgentOnce(group, input, attempt);
    
    if (result.status === 'success') {
      return result;
    }
    
    // Check if error is retryable
    if (result.error && isRetryableError(result.error, retryConfig)) {
      lastError = result.error;
      continue;
    }
    
    // Non-retryable error, return immediately
    return result;
  }
  
  // All retries exhausted
  return {
    status: 'error',
    result: null,
    error: `Agent failed after ${retryConfig.maxRetries + 1} attempts. Last error: ${lastError}`
  };
}

/**
 * 单次运行 Agent
 */
async function runAgentOnce(
  group: RegisteredGroup,
  input: AgentInput,
  attempt: number = 0
): Promise<AgentOutput> {
  const startTime = Date.now();

  // 获取 API 客户端
  const apiClient = getApiClient();
  if (!apiClient) {
    return {
      status: 'error',
      result: null,
      error: 'API client not configured. Set ANTHROPIC_AUTH_TOKEN or ANTHROPIC_API_KEY environment variable.'
    };
  }

  // 获取记忆管理器
  const memoryManager = getMemoryManager();

  const groupDir = path.join(GROUPS_DIR, group.folder);
  fs.mkdirSync(groupDir, { recursive: true });

  // Setup IPC directories
  const groupIpcDir = getIpcDir(group.folder);
  fs.mkdirSync(path.join(groupIpcDir, 'messages'), { recursive: true });
  fs.mkdirSync(path.join(groupIpcDir, 'tasks'), { recursive: true });

  const timeout = group.agentConfig?.timeout || AGENT_TIMEOUT;

  logger.info({
    group: group.name,
    isMain: input.isMain,
    attempt,
    timeout
  }, 'Starting agent');

  // 创建工具执行器
  const toolExecutor = createToolExecutor(
    {
      chatJid: input.chatJid,
      groupFolder: group.folder,
      isMain: input.isMain
    },
    memoryManager
  );

  // 获取对话上下文
  const context = memoryManager.getContext(group.folder);
  
  // 检查当前模型是否支持图片输入
  const supportsVision = currentModelSupportsVision();
  const currentModel = getCurrentModelId();
  
  // 构建用户消息内容（支持图片附件）
  let userContent: ChatMessage['content'];
  
  if (input.attachments && input.attachments.length > 0 && supportsVision) {
    // 有图片附件，构建多内容块
    const contentBlocks: (TextBlock | ImageBlock)[] = [];
    
    // 添加文本
    if (input.prompt) {
      contentBlocks.push({ type: 'text', text: input.prompt });
    }
    
    // 添加图片
    for (const attachment of input.attachments) {
      if (attachment.type === 'image' && attachment.content) {
        // 从 data URL 提取 base64 数据
        let base64Data = attachment.content;
        let mimeType = attachment.mimeType || 'image/png';
        
        if (attachment.content.startsWith('data:')) {
          const match = attachment.content.match(/^data:([^;]+);base64,(.*)$/);
          if (match) {
            mimeType = match[1];
            base64Data = match[2];
          }
        }
        
        contentBlocks.push({
          type: 'image',
          source: {
            type: 'base64',
            media_type: mimeType as 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp',
            data: base64Data
          }
        });
      }
    }
    
    userContent = contentBlocks;
    logger.info({ 
      group: group.name, 
      model: currentModel,
      textBlocks: contentBlocks.filter(b => b.type === 'text').length,
      imageBlocks: contentBlocks.filter(b => b.type === 'image').length 
    }, '📷 处理图片消息');
  } else if (input.attachments && input.attachments.length > 0 && !supportsVision) {
    // 模型不支持图片，只发送文本
    userContent = input.prompt + `\n\n[用户发送了 ${input.attachments.length} 张图片，但当前模型 ${currentModel} 不支持图片输入]`;
    logger.info({ 
      group: group.name, 
      model: currentModel,
      imageCount: input.attachments.length 
    }, '⚠️ 当前模型不支持图片输入');
  } else {
    // 纯文本消息
    userContent = input.prompt;
  }
  
  // 添加当前用户消息
  const userMessage: ChatMessage = { role: 'user', content: userContent };
  memoryManager.addMessage(group.folder, { role: 'user', content: input.prompt }); // 记忆中只存文本

  // 构建消息历史
  const messages: ChatMessage[] = [...context, userMessage];

  // 获取系统提示词
  const systemPrompt = getGroupSystemPrompt(group, input.isMain, input.isScheduledTask);

  // 获取工具定义
  const tools = getBuiltinTools();

  // 创建超时 Promise
  const timeoutPromise = new Promise<AgentOutput>((resolve) => {
    setTimeout(() => {
      logger.error({ group: group.name }, 'Agent timeout');
      resolve({
        status: 'error',
        result: null,
        error: `Agent timed out after ${timeout}ms`
      });
    }, timeout);
  });

  // 创建 Agent 执行 Promise
  const agentPromise = (async (): Promise<AgentOutput> => {
    try {
      // 调用 API
      const response = await apiClient.chat(messages, {
        system: systemPrompt,
        tools,
        maxTokens: 4096
      });

      let result: string;

      // 检查是否有工具调用
      if (response.stop_reason === 'tool_use') {
        // 处理工具调用
        result = await apiClient.handleToolUse(
          response,
          messages,
          async (name, params) => {
            const toolResult = await toolExecutor(name, params);
            if (toolResult.isError) {
              throw new Error(toolResult.content);
            }
            return toolResult.content;
          },
          { system: systemPrompt, tools, maxTokens: 4096 }
        );
      } else {
        // 直接提取文本响应
        result = apiClient.extractText(response);
      }

      // 保存助手回复到记忆
      memoryManager.addMessage(group.folder, { role: 'assistant', content: result });

      // 检查是否需要压缩上下文
      if (memoryManager.needsCompaction(group.folder)) {
        logger.info({ group: group.name }, 'Compacting conversation context');
        await memoryManager.compact(group.folder, apiClient);
      }

      const duration = Date.now() - startTime;
      logger.info({
        group: group.name,
        duration,
        status: 'success',
        hasResult: !!result
      }, 'Agent completed');

      return {
        status: 'success',
        result
      };

    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      const duration = Date.now() - startTime;

      logger.error({
        group: group.name,
        duration,
        error: errorMessage
      }, 'Agent error');

      return {
        status: 'error',
        result: null,
        error: errorMessage
      };
    }
  })();

  // 竞争：Agent 执行 vs 超时
  return Promise.race([agentPromise, timeoutPromise]);
}

// ==================== Snapshot Functions ====================

export function writeTasksSnapshot(
  groupFolder: string,
  isMain: boolean,
  tasks: Array<{
    id: string;
    groupFolder: string;
    prompt: string;
    schedule_type: string;
    schedule_value: string;
    status: string;
    next_run: string | null;
  }>
): void {
  // Write filtered tasks to the group's IPC directory
  const groupIpcDir = getIpcDir(groupFolder);
  fs.mkdirSync(groupIpcDir, { recursive: true });

  // Main sees all tasks, others only see their own
  const filteredTasks = isMain
    ? tasks
    : tasks.filter(t => t.groupFolder === groupFolder);

  const tasksFile = path.join(groupIpcDir, 'current_tasks.json');
  fs.writeFileSync(tasksFile, JSON.stringify(filteredTasks, null, 2));
}

export interface AvailableGroup {
  jid: string;
  name: string;
  lastActivity: string;
  isRegistered: boolean;
}

/**
 * Write available groups snapshot for the agent to read.
 * Only main group can see all available groups (for activation).
 * Non-main groups only see their own registration status.
 */
export function writeGroupsSnapshot(
  groupFolder: string,
  isMain: boolean,
  groups: AvailableGroup[],
  registeredJids: Set<string>
): void {
  const groupIpcDir = getIpcDir(groupFolder);
  fs.mkdirSync(groupIpcDir, { recursive: true });

  // Main sees all groups; others see nothing (they can't activate groups)
  const visibleGroups = isMain ? groups : [];

  const groupsFile = path.join(groupIpcDir, 'available_groups.json');
  fs.writeFileSync(groupsFile, JSON.stringify({
    groups: visibleGroups,
    lastSync: new Date().toISOString()
  }, null, 2));
}

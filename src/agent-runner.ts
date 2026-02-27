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
import type Anthropic from '@anthropic-ai/sdk';
import {
  AGENT_TIMEOUT,
  AI_MAX_OUTPUT_TOKENS,
  TIMEZONE
} from './config.js';
import { paths } from './paths.js';
import { RegisteredGroup } from './types.js';
import { ApiClient, ChatMessage, ToolSchema, getApiClient, TextBlock, ImageBlock } from './core/api-client.js';
import { currentModelSupportsVision, getCurrentModelId, getModelContextWindow } from './core/model-capabilities.js';
import { MemoryManager, getMemoryManager as getGlobalMemoryManager } from './core/memory.js';
import { pluginManager } from './plugins/manager.js';
import { ToolContext, ToolResult as PluginToolResult } from './plugins/types.js';
import { recordTokenUsage, checkCompactThreshold } from './session-tracker.js';
import { createLogger } from './logger.js';
import { checkContextSafety } from './core/context-guard.js';

const logger = createLogger('AgentRunner');

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
  /** 用户 ID，用于用户级别记忆 */
  userId?: string;
  /** 消息来源平台（telegram / feishu 等） */
  platform?: string;
  /** 图片附件列表 */
  attachments?: ImageAttachment[];
  /** 流式输出回调（可选） */
  onToken?: (text: string) => void;
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
  userId: string;
  platform?: string;
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
  return path.join(paths.data(), 'ipc', groupFolder);
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
 * 获取所有可用工具（完全依赖插件）
 */
export function getAllTools(): ToolSchema[] {
  return pluginManager.getActiveTools();
}


/**
 * 创建工具执行器
 * 完全依赖插件工具
 */
export function createToolExecutor(ctx: IpcContext, memoryManager: MemoryManager) {
  const { chatJid, groupFolder, userId, platform } = ctx;
  const IPC_DIR = getIpcDir(groupFolder);
  const MESSAGES_DIR = path.join(IPC_DIR, 'messages');

  // 构建插件工具上下文
  const pluginContext: ToolContext = {
    chatId: chatJid,
    groupId: groupFolder,
    userId: userId,
    sendMessage: async (content: string) => {
      // 通过 IPC 发送消息到当前聊天
      const data = {
        type: 'message',
        chatJid,
        text: content,
        groupFolder,
        platform,
        timestamp: new Date().toISOString()
      };
      writeIpcFile(MESSAGES_DIR, data);
    },
    sendImage: async (imageData: string, caption?: string) => {
      // 通过 IPC 发送图片到当前聊天
      const data = {
        type: 'image',
        chatJid,
        imageData,
        caption,
        groupFolder,
        platform,
        timestamp: new Date().toISOString()
      };
      writeIpcFile(MESSAGES_DIR, data);
    }
  };

  return async (name: string, params: unknown): Promise<ToolResult> => {
    logger.info({ tool: name, params }, '⚡ 执行工具');

    // 使用插件工具
    const toolInfo = pluginManager.getTool(name);
    if (toolInfo) {
      const { plugin, isMultiTool } = toolInfo;
      try {
        // 多工具插件：execute(toolName, params, context)
        // 单工具插件：execute(params, context)
        const result = isMultiTool
          ? await plugin.execute(name, params, pluginContext)
          : await plugin.execute(params, pluginContext);
        logger.info({ tool: name, success: result.success, error: result.error }, '⚡ 插件执行结果');
        if (result.success) {
          return { 
            content: typeof result.data === 'string' 
              ? result.data 
              : JSON.stringify(result.data, null, 2) 
          };
        } else {
          return { content: result.error || 'Plugin execution failed', isError: true };
        }
      } catch (err) {
        logger.error({ tool: name, err }, 'Plugin tool execution failed');
        return { 
          content: `Plugin error: ${err instanceof Error ? err.message : String(err)}`, 
          isError: true 
        };
      }
    }

    // 插件不存在
    logger.warn({ tool: name }, '⚠️ 工具插件不存在');
    return {
      content: `Unknown tool: ${name}. Please ensure the plugin is installed.`,
      isError: true
    };
  };
}

// ==================== 全局实例 ====================

/**
 * 获取全局记忆管理器
 * 使用 memory.ts 中的全局单例
 */
export function getMemoryManager(): MemoryManager {
  return getGlobalMemoryManager();
}

// 注意：API 客户端使用 core/api-client.ts 中的全局单例
// 通过 getApiClient() 获取，确保 jiti 热加载的插件访问同一实例

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
 * 动态生成可用工具列表
 */
function getAvailableToolsList(): string {
  const tools = getAllTools();
  if (tools.length === 0) {
    return '暂无可用工具';
  }
  
  return tools.map(tool => {
    const desc = tool.description || '无描述';
    return `- ${tool.name}: ${desc}`;
  }).join('\n');
}

/**
 * 获取群组的系统提示词
 */
function getGroupSystemPrompt(group: RegisteredGroup, isMain: boolean, isScheduledTask?: boolean): string {
  const memoryManager = getMemoryManager();
  
  // 获取当前时间（用于定时任务等需要时间计算的场景）
  const now = new Date();
  const currentTimeISO = now.toISOString();
  const currentTimeLocal = now.toLocaleString('zh-CN', { timeZone: TIMEZONE });
  
  // 动态获取可用工具列表
  const toolsList = getAvailableToolsList();
  
  // 读取群组的 CLAUDE.md 文件（如果存在）
  const groupDir = path.join(paths.groups(), group.folder);
  const claudeMdPath = path.join(groupDir, 'CLAUDE.md');
  let basePrompt = '';
  
  // 读取 SOUL.md 人格设定（会话级优先于全局）
  let soulContent = '';
  const soulSessionPath = path.join(groupDir, 'SOUL.md');
  const soulGlobalPath = path.join(paths.home(), 'SOUL.md');
  
  if (fs.existsSync(soulSessionPath)) {
    try {
      soulContent = fs.readFileSync(soulSessionPath, 'utf-8').trim();
      logger.debug({ path: soulSessionPath }, '加载会话级 SOUL.md');
    } catch (err) {
      logger.debug({ path: soulSessionPath, err }, '加载会话级 SOUL.md 失败');
    }
  } else if (fs.existsSync(soulGlobalPath)) {
    try {
      soulContent = fs.readFileSync(soulGlobalPath, 'utf-8').trim();
      logger.debug({ path: soulGlobalPath }, '加载全局 SOUL.md');
    } catch (err) {
      logger.debug({ path: soulGlobalPath, err }, '加载全局 SOUL.md 失败');
    }
  }
  
  // 预计算时间示例，帮助 AI 正确理解 ISO 时间
  const in10Seconds = new Date(now.getTime() + 10000).toISOString();
  const in30Seconds = new Date(now.getTime() + 30000).toISOString();
  const in1Minute = new Date(now.getTime() + 60000).toISOString();
  const in5Minutes = new Date(now.getTime() + 300000).toISOString();
  
  // 注入 SOUL.md 人格设定（注入到系统提示词最前面）
  let soulPrefix = '';
  if (soulContent) {
    soulPrefix = `\n\n## 人格设定\n\n请完全按照以下人格设定来回复：\n\n${soulContent}\n\n`;
  }
  
  if (fs.existsSync(claudeMdPath)) {
    // 用户自定义提示词，追加时间和工具信息
    basePrompt = fs.readFileSync(claudeMdPath, 'utf-8');
    basePrompt += `\n\n---\n当前时间: ${currentTimeLocal}\n当前 ISO 时间: ${currentTimeISO}\n时区: ${TIMEZONE}`;
  } else {
    // 默认系统提示词
    basePrompt = `你是 FlashClaw，一个智能助手。
    
你正在 "${group.name}" 群组中与用户交流。

## 当前时间
- 本地时间: ${currentTimeLocal}
- ISO 时间: ${currentTimeISO}
- 时区: ${TIMEZONE}

## 可用工具
${toolsList}

## 发送截图（重要！）
截图后必须使用 send_message 工具发送给用户：
\`\`\`
send_message({ image: "latest_screenshot", caption: "可选的说明文字" })
\`\`\`
- 先用 browser_action screenshot 截图
- 然后用 send_message image="latest_screenshot" 发送
- 不要只描述截图，要实际发送！

## schedule_task 时间计算（重要！）
创建一次性任务时，scheduleValue 必须使用 ISO 8601 格式。
**请直接使用下面预计算好的 ISO 时间，不要自己转换：**
- 10秒后 = ${in10Seconds}
- 30秒后 = ${in30Seconds}
- 1分钟后 = ${in1Minute}
- 5分钟后 = ${in5Minutes}

对于其他时间，按比例估算即可。例如20秒后约在10秒和30秒之间。

请用中文回复，除非用户使用其他语言。
保持回复简洁、有帮助。`;
  }
  
  // 将 SOUL.md 人格设定注入到 basePrompt 最前面
  if (soulPrefix) {
    basePrompt = soulPrefix + basePrompt;
  }
  
  // 构建包含长期记忆的系统提示词
  let systemPrompt = memoryManager.buildSystemPrompt(group.folder, basePrompt);
  
  // 添加权限说明
  if (isMain) {
    systemPrompt += '\n\n你拥有管理员权限，可以注册新群组和管理所有任务。';
  }
  
  // 添加定时任务上下文
  if (isScheduledTask) {
    systemPrompt += `

## ⚠️ 这是定时任务执行
你现在是被定时任务自动触发的，不是在回复用户消息。
**重要：你的文字回复用户看不到！必须使用 send_message 工具才能向用户发送消息。**

执行步骤：
1. 根据任务内容（下面的用户消息）准备提醒内容
2. 调用 send_message 工具发送提醒给用户
3. 不要只是回复文字，那样用户收不到`;
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

  const groupDir = path.join(paths.groups(), group.folder);
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
      isMain: input.isMain,
      userId: input.userId || input.chatJid,  // 使用 userId，如果没有则使用 chatJid
      platform: input.platform
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

  // 获取工具定义（插件工具 + 内置后备工具）
  const tools = getAllTools();
  
  // 调试：打印可用工具
  logger.info({ 
    group: group.name, 
    toolCount: tools.length,
    toolNames: tools.map(t => t.name)
  }, '⚡ 可用工具列表');

  // ==================== 上下文窗口保护 ====================
  const modelContextWindow = getModelContextWindow(currentModel);
  // 估算系统提示词 token（中英混合，保守按 1 字符 ≈ 0.5 token）
  const systemTokensEstimate = Math.ceil(systemPrompt.length / 2);
  const messagesTokensEstimate = memoryManager.estimateTokens(messages);
  const usedTokens = systemTokensEstimate + messagesTokensEstimate;

  const ctxCheck = checkContextSafety({
    usedTokens,
    maxTokens: modelContextWindow,
    model: currentModel,
  });

  if (!ctxCheck.safe) {
    // 剩余空间严重不足（低于 CONTEXT_MIN_TOKENS），直接返回错误
    logger.error({
      group: group.name,
      usedTokens,
      modelContextWindow,
      error: ctxCheck.error,
    }, '🛡️ 上下文窗口空间不足，拒绝请求');

    return {
      status: 'error',
      result: null,
      error: ctxCheck.error || '上下文窗口空间不足，请执行 /compact 压缩对话后重试。',
    };
  }

  if (ctxCheck.shouldCompact) {
    // 空间紧张（低于 CONTEXT_WARN_TOKENS），自动触发压缩后继续
    logger.warn({
      group: group.name,
      usedTokens,
      modelContextWindow,
      warning: ctxCheck.warning,
    }, '🛡️ 上下文窗口空间紧张，触发自动压缩');

    await memoryManager.compact(group.folder, apiClient);

    // 压缩后重新获取上下文和消息
    const compactedContext = memoryManager.getContext(group.folder);
    const compactedMessages: ChatMessage[] = [...compactedContext, userMessage];
    // 用压缩后的消息替换原消息列表
    messages.length = 0;
    messages.push(...compactedMessages);

    const newTokensEstimate = memoryManager.estimateTokens(messages) + systemTokensEstimate;
    logger.info({
      group: group.name,
      beforeTokens: usedTokens,
      afterTokens: newTokensEstimate,
      saved: usedTokens - newTokensEstimate,
    }, '🛡️ 上下文压缩完成');
  }

  // 活动超时机制：有数据流动时自动延长超时
  let activityTimer: NodeJS.Timeout | null = null;
  let isTimedOut = false;
  
  const resetActivityTimeout = () => {
    if (activityTimer) {
      clearTimeout(activityTimer);
    }
    activityTimer = setTimeout(() => {
      isTimedOut = true;
      logger.error({ group: group.name }, 'Agent timeout (no activity)');
    }, timeout);
  };
  
  const clearActivityTimeout = () => {
    if (activityTimer) {
      clearTimeout(activityTimer);
      activityTimer = null;
    }
  };

  // 开始计时
  resetActivityTimeout();

  try {
    // 使用流式 API 获取响应（避免长时间等待导致超时）
    let responseText = '';
    let finalResponse: Anthropic.Message | null = null;
    
    logger.info({ group: group.name }, '⚡ 开始流式请求');
    
    for await (const event of apiClient.chatStream(messages, {
      system: systemPrompt,
      tools,
      maxTokens: AI_MAX_OUTPUT_TOKENS
    })) {
      // 每收到数据就重置超时计时器
      resetActivityTimeout();
      
      if (isTimedOut) {
        throw new Error(`Agent timed out after ${timeout}ms of inactivity`);
      }
      
      if (event.type === 'text') {
        responseText += event.text;
        input.onToken?.(event.text);
      } else if (event.type === 'done') {
        finalResponse = event.message;
      }
    }
    
    clearActivityTimeout();
    
    if (!finalResponse) {
      throw new Error('No response received from API');
    }
    
    // 调试：打印 API 响应
    logger.info({ 
      group: group.name,
      stopReason: finalResponse.stop_reason,
      contentTypes: finalResponse.content.map((c) => c.type)
    }, '⚡ API 响应');
    
    // 记录 token 使用
    if (finalResponse.usage) {
      const session = recordTokenUsage(input.chatJid, {
        inputTokens: finalResponse.usage.input_tokens || 0,
        outputTokens: finalResponse.usage.output_tokens || 0
      }, getCurrentModelId());
      
      logger.info({
        chatId: input.chatJid,
        inputTokens: finalResponse.usage.input_tokens,
        outputTokens: finalResponse.usage.output_tokens,
        totalTokens: session.totalTokens
      }, '📊 Token 统计');
    }

    let result: string;

    // 检查是否有工具调用
    if (finalResponse.stop_reason === 'tool_use') {
      // 处理工具调用（使用活动超时 + 心跳）
      resetActivityTimeout();
      
      result = await apiClient.handleToolUse(
        finalResponse,
        messages,
        async (name, params) => {
          resetActivityTimeout(); // 工具执行时也重置超时
          const toolResult = await toolExecutor(name, params);
          if (toolResult.isError) {
            throw new Error(toolResult.content);
          }
          return toolResult.content;
        },
        { system: systemPrompt, tools, maxTokens: AI_MAX_OUTPUT_TOKENS },
        // 心跳回调：工具链内每收到流式数据或执行工具时重置超时
        () => resetActivityTimeout()
      );
      
      clearActivityTimeout();
    } else {
      // 使用流式收集的文本，或从响应中提取
      result = responseText || apiClient.extractText(finalResponse);
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
    clearActivityTimeout();
    
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

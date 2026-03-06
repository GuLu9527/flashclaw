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
  BOT_NAME,
  TIMEZONE
} from './config.js';
import { paths } from './paths.js';
import { RegisteredGroup } from './types.js';
import { ChatMessage, ToolSchema, TextBlock, ImageBlock } from './core/api-client.js';
import { pluginManager } from './plugins/manager.js';
import { currentModelSupportsVision, getCurrentModelId, getModelContextWindow } from './core/model-capabilities.js';
import { MemoryManager, getMemoryManager as getGlobalMemoryManager } from './core/memory.js';
import { ToolContext, ToolResult as PluginToolResult } from './plugins/types.js';
import { recordTokenUsage, checkCompactThreshold } from './session-tracker.js';
import { createLogger } from './logger.js';
import { checkContextSafety } from './core/context-guard.js';
import { normalizeToolParams } from './tool-params.js';
import type { MultiAgentConfig } from './types.js';

const logger = createLogger('AgentRunner');

// ==================== 实时 Agent 状态（供 SSE 看板读取） ====================
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const agentLiveState = ((globalThis as any).__flashclaw_agent_live_state ??= {
  state: 'idle' as string,
  detail: '' as string,
  group: '' as string,
  updatedAt: 0,
}) as { state: string; detail: string; group: string; updatedAt: number };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).__flashclaw_agent_live_state = agentLiveState;

function setLiveState(state: string, detail: string, group: string) {
  agentLiveState.state = state;
  agentLiveState.detail = detail;
  agentLiveState.group = group;
  agentLiveState.updatedAt = Date.now();
}

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
  /** 工具调用回调（可选） */
  onToolUse?: (toolName: string, input: unknown) => void;
  /** 思考过程回调（可选，用于展示模型推理过程） */
  onThinking?: (text: string) => void;
}

export interface AgentUsageMetrics {
  inputTokens: number;
  outputTokens: number;
}

export interface AgentRunMetrics {
  durationMs: number;
  model: string;
  usage?: AgentUsageMetrics;
}

export interface AgentOutput {
  status: 'success' | 'error';
  result: string | null;
  newSessionId?: string;
  error?: string;
  metrics?: AgentRunMetrics;
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

// ==================== 意图路由 ====================

/**
 * 意图路由规则
 * pattern: 用户消息匹配的正则（高置信度关键词）
 * tools: 匹配时保留的工具名列表
 */
interface IntentRoute {
  pattern: RegExp;
  tools: string[];
  label: string;
}

// 通用工具：任何意图都可能需要的工具
const ALWAYS_INCLUDE_TOOLS = ['send_message'];

const INTENT_ROUTES: IntentRoute[] = [
  {
    label: 'memory-remember',
    pattern: /(?:记住|记下|remember|保存|存一下)(?!.*(?:提醒|闹钟|定时|每天|每周|每月|cron))/i,
    tools: ['memory', 'memory_search'],
  },
  {
    label: 'memory-log',
    pattern: /(?:记录|日志|笔记|log|note)(?!.*(?:提醒|闹钟|定时|每天|每周|每月|cron))/i,
    tools: ['memory', 'memory_search'],
  },
  {
    label: 'memory-recall',
    pattern: /(?:我是谁|我叫什么|我喜欢|你还记得|回忆|recall|之前说过|知道我|认识我)/i,
    tools: ['memory_search'],
  },
  {
    label: 'schedule',
    pattern: /(?:提醒|闹钟|定时|每天|每周|每月|每隔|cron|schedule|remind|timer|(\d+)\s*(?:秒|分钟|小时|天)后)/i,
    tools: ['schedule_task', 'reminder', 'list_tasks', 'cancel_task', 'pause_task', 'resume_task'],
  },
  {
    label: 'tasks',
    pattern: /(?:任务|tasks|有哪些任务|任务列表|查看任务)/i,
    tools: ['list_tasks', 'cancel_task', 'pause_task', 'resume_task', 'schedule_task'],
  },
  {
    label: 'search',
    pattern: /(?:搜索|搜一下|查一下|查询|search|google|百度|查找信息|最新.*消息|新闻)/i,
    tools: ['web_search', 'web_fetch'],
  },
  {
    label: 'web',
    pattern: /(?:抓取|网页|网站|链接|fetch|http|www\.|\.com|\.cn|\.org|浏览器|截图|打开.*网)/i,
    tools: ['web_fetch', 'web_search', 'browser_launch', 'browser_snapshot', 'browser_action', 'browser_tabs', 'browser_storage'],
  },
  {
    label: 'file',
    pattern: /(?:读取文件|查看文件|打开文件|文件内容|read.*file|cat\s|看看.*文件|列出.*目录|目录.*列表)/i,
    tools: ['local_file_read', 'local_list_dir'],
  },
  {
    label: 'group',
    pattern: /(?:注册群|添加群|register.*group|群组管理)/i,
    tools: ['register_group'],
  },
];

interface IntentRouteResult {
  tools: ToolSchema[];
  intent: string | null;
}

/**
 * 根据用户消息意图过滤工具列表
 * 高置信度匹配时只返回相关工具 + 通用工具
 * 无匹配时返回全部工具（零误判回退）
 */
function filterToolsByIntent(prompt: string, allTools: ToolSchema[]): IntentRouteResult {
  // 定时任务执行时不做过滤（任务内容可能需要任何工具）
  if (!prompt || prompt.length > 500) {
    return { tools: allTools, intent: null };
  }

  // 匹配意图
  for (const route of INTENT_ROUTES) {
    if (route.pattern.test(prompt)) {
      const allowedNames = new Set([...route.tools, ...ALWAYS_INCLUDE_TOOLS]);
      const filtered = allTools.filter(t => allowedNames.has(t.name));
      
      // 如果过滤后没有匹配的工具（工具未安装），回退到全部
      if (filtered.length <= ALWAYS_INCLUDE_TOOLS.length) {
        return { tools: allTools, intent: null };
      }
      
      logger.debug({ intent: route.label, filtered: filtered.length, total: allTools.length }, '🎯 意图路由命中');
      return { tools: filtered, intent: route.label };
    }
  }

  // 无匹配：返回全部工具
  return { tools: allTools, intent: null };
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
    // 工具参数后处理：自动修正小模型常见的格式错误
    const normalizedParams = normalizeToolParams(name, params);
    logger.info({ tool: name, params: normalizedParams }, '⚡ 执行工具');

    // 使用插件工具
    const toolInfo = pluginManager.getTool(name);
    if (toolInfo) {
      const { plugin, isMultiTool } = toolInfo;
      try {
        // 多工具插件：execute(toolName, params, context)
        // 单工具插件：execute(params, context)
        const result = isMultiTool
          ? await plugin.execute(name, normalizedParams, pluginContext)
          : await plugin.execute(normalizedParams, pluginContext);
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

// 注意：API Provider 使用 pluginManager.getProvider() 获取
// 如果没有配置 provider 插件，默认使用内置的 anthropic-provider

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
function getGroupSystemPrompt(group: RegisteredGroup, userId: string, isMain: boolean, isScheduledTask?: boolean, intent?: string | null, agentName?: string, agentSoul?: string): string {
  const memoryManager = getMemoryManager();
  
  // 获取当前时间（用于定时任务等需要时间计算的场景）
  const now = new Date();
  const currentTimeISO = now.toISOString();
  const currentTimeLocal = now.toLocaleString('zh-CN', { timeZone: TIMEZONE });
  
  // 读取群组的 CLAUDE.md 文件（如果存在）
  const groupDir = path.join(paths.groups(), group.folder);
  const claudeMdPath = path.join(groupDir, 'CLAUDE.md');
  let basePrompt = '';
  
  // 读取 SOUL.md 人格设定（优先级：Agent 配置 → 会话级 → 全局）
  let soulContent = '';
  const soulSessionPath = path.join(groupDir, 'SOUL.md');
  const soulGlobalPath = path.join(paths.home(), 'SOUL.md');
  
  // 优先从 agent-manager 路由结果的 soul 路径加载（如 "souls/serious.md"）
  if (agentSoul) {
    const soulPaths = [
      path.join(paths.home(), agentSoul),     // ~/.flashclaw/souls/serious.md
      path.join(paths.souls(), path.basename(agentSoul)), // ~/.flashclaw/souls/serious.md (basename)
    ];
    for (const sp of soulPaths) {
      if (fs.existsSync(sp)) {
        try {
          soulContent = fs.readFileSync(sp, 'utf-8').trim();
          logger.debug({ path: sp, agentSoul }, '加载 Agent 配置的 SOUL');
          break;
        } catch (err) {
          logger.debug({ path: sp, err }, '加载 Agent SOUL 失败');
        }
      }
    }
  }
  
  // 回退：会话级 SOUL.md
  if (!soulContent && fs.existsSync(soulSessionPath)) {
    try {
      soulContent = fs.readFileSync(soulSessionPath, 'utf-8').trim();
      logger.debug({ path: soulSessionPath }, '加载会话级 SOUL.md');
    } catch (err) {
      logger.debug({ path: soulSessionPath, err }, '加载会话级 SOUL.md 失败');
    }
  }
  
  // 回退：全局 SOUL.md
  if (!soulContent && fs.existsSync(soulGlobalPath)) {
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
  
  // 读取 USER.md 用户自我介绍（全局）
  let userMdContent = '';
  const userMdPath = path.join(paths.home(), 'USER.md');
  if (fs.existsSync(userMdPath)) {
    try {
      userMdContent = fs.readFileSync(userMdPath, 'utf-8').trim();
    } catch (err) {
      logger.debug({ path: userMdPath, err }, '加载 USER.md 失败');
    }
  }
  
  if (fs.existsSync(claudeMdPath)) {
    // 用户自定义提示词，追加时间和工具信息
    basePrompt = fs.readFileSync(claudeMdPath, 'utf-8');
    basePrompt += `\n\n---\n当前时间: ${currentTimeLocal}\n当前 ISO 时间: ${currentTimeISO}\n时区: ${TIMEZONE}`;
  } else {
    // 默认系统提示词（按意图动态裁剪，减少小模型上下文占用）
    const needsScheduleHint = !intent || intent === 'schedule';
    const needsScreenshotHint = !intent || intent === 'web';
    
    const displayName = agentName || BOT_NAME;
    // 如果有 SOUL.md，身份由 SOUL.md 定义，不再注入默认身份声明
    const identityLine = soulContent
      ? ''
      : `你是 ${displayName}，一个智能助手。\n\n`;

    let promptSections = `${identityLine}你正在 "${group.name}" 群组中与用户交流。

## 当前时间
- 本地时间: ${currentTimeLocal}
- ISO 时间: ${currentTimeISO}
- 时区: ${TIMEZONE}

## 工具使用原则
- 优先直接回答用户问题。
- 只有在需要外部操作时才调用工具。`;

    if (needsScreenshotHint) {
      promptSections += `

## 发送截图（重要！）
截图后必须使用 send_message 工具发送给用户：
\`\`\`
send_message({ image: "latest_screenshot", caption: "可选的说明文字" })
\`\`\`
- 先用 browser_action screenshot 截图
- 然后用 send_message image="latest_screenshot" 发送
- 不要只描述截图，要实际发送！`;
    }

    if (needsScheduleHint) {
      promptSections += `

## schedule_task 时间计算（重要！）
创建一次性任务时，scheduleValue 必须使用 ISO 8601 格式。
**请直接使用下面预计算好的 ISO 时间，不要自己转换：**
- 10秒后 = ${in10Seconds}
- 30秒后 = ${in30Seconds}
- 1分钟后 = ${in1Minute}
- 5分钟后 = ${in5Minutes}

对于其他时间，按比例估算即可。例如20秒后约在10秒和30秒之间。`;
    }

    promptSections += `

请用中文回复，除非用户使用其他语言。
保持回复简洁、有帮助。`;

    basePrompt = promptSections;
    
    if (intent) {
      logger.debug({ intent, needsScheduleHint, needsScreenshotHint }, '🎯 系统提示词按意图裁剪');
    }
  }
  
  // 将 SOUL.md 人格设定注入到 basePrompt 最前面
  if (soulPrefix) {
    basePrompt = soulPrefix + basePrompt;
  }
  
  // 注入 USER.md 用户自我介绍（在 SOUL 之后、记忆之前）
  if (userMdContent) {
    basePrompt += `\n\n## 用户信息\n\n${userMdContent}`;
  }
  
  // 构建包含长期记忆的系统提示词
  let systemPrompt = memoryManager.buildSystemPrompt(group.folder, userId, basePrompt);
  
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
        group: group.folder, 
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

  // 从 pluginManager 获取 AI Provider
  const apiProvider = pluginManager.getProvider();
  if (!apiProvider) {
    return {
      status: 'error',
      result: null,
      error: 'AI Provider not configured. Please install and configure a provider plugin.'
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
    group: group.folder,
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
      group: group.folder, 
      model: currentModel,
      textBlocks: contentBlocks.filter(b => b.type === 'text').length,
      imageBlocks: contentBlocks.filter(b => b.type === 'image').length 
    }, '📷 处理图片消息');
  } else if (input.attachments && input.attachments.length > 0 && !supportsVision) {
    // 模型不支持图片，只发送文本
    userContent = input.prompt + `\n\n[用户发送了 ${input.attachments.length} 张图片，但当前模型 ${currentModel} 不支持图片输入]`;
    logger.info({ 
      group: group.folder, 
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

  // 获取工具定义（插件工具 + 内置后备工具）
  let allTools = getAllTools();

  // ==================== Agent 路由 + 工具白名单（可选，由 agent-manager 插件提供） ====================
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const agentRegistry = (globalThis as any).__flashclaw_agent_registry as {
    resolveAgent: (ctx: { channel?: string; group?: string; peer?: string }) => MultiAgentConfig;
    getAgentById: (id: string) => MultiAgentConfig | undefined;
    filterToolsByAgent: <T extends { name: string }>(config: MultiAgentConfig, tools: T[]) => T[];
  } | undefined;

  let resolvedAgentName: string | undefined;
  let resolvedAgentSoul: string | undefined;

  if (agentRegistry) {
    let agentConfig: MultiAgentConfig;

    // agent-internal 平台：从 group 名称中提取目标 Agent ID（格式: agent-{id}-{timestamp}）
    if (input.platform === 'agent-internal' && group.folder.startsWith('agent-')) {
      const targetId = group.folder.replace(/^agent-/, '').replace(/-\d+$/, '');
      const target = agentRegistry.getAgentById?.(targetId);
      agentConfig = target || agentRegistry.resolveAgent({ channel: input.platform, group: group.folder, peer: input.userId });
    } else {
      agentConfig = agentRegistry.resolveAgent({
        channel: input.platform,
        group: group.folder,
        peer: input.userId,
      });
    }

    logger.debug({
      agentId: agentConfig.id,
      agentName: agentConfig.name,
      agentSoul: agentConfig.soul,
    }, '🎯 Agent 路由结果');
    resolvedAgentName = agentConfig.name;
    resolvedAgentSoul = agentConfig.soul;
    allTools = agentRegistry.filterToolsByAgent(agentConfig, allTools);
  }
  
  // ==================== 意图路由 + 工具过滤 ====================
  // 根据用户消息关键词预筛选工具，减少小模型的选择负担
  // 只在高置信度时过滤，无匹配时传全部工具（零误判回退）
  // 意图检测必须在系统提示词构建之前，以便按意图裁剪提示词
  let tools: ToolSchema[];
  let systemPromptExtra = '';
  let detectedIntent: string | null = null;

  if (process.env.TOOL_ROUTING === 'off') {
    tools = allTools;
  } else {
    const routeResult = filterToolsByIntent(input.prompt, allTools);
    tools = routeResult.tools;
    detectedIntent = routeResult.intent;

    // 对于 recall 类意图，代码层面直接调用 memory_search，注入结果到提示词
    // 不依赖小模型主动调用工具
    if (routeResult.intent === 'memory-recall') {
      const searchTool = pluginManager.getTool('memory_search');
      if (searchTool) {
        try {
          const searchResult = await searchTool.plugin.execute(
            { query: input.prompt, maxResults: 5 },
            {
              chatId: input.chatJid,
              groupId: group.folder,
              userId: input.userId || input.chatJid,
              sendMessage: async () => {},
              sendImage: async () => {},
            }
          );
          if (searchResult.success && searchResult.data) {
            const data = searchResult.data as { results?: Array<{ content: string; source: string }> };
            if (data.results && data.results.length > 0) {
              const memoryContext = data.results.map(r => `- ${r.content}`).join('\n');
              systemPromptExtra = `\n\n## 相关记忆（自动检索）\n以下是与用户问题相关的记忆，请基于这些信息回答：\n${memoryContext}`;
              // recall 意图已预处理，不需要传工具给模型
              tools = allTools.filter(t => t.name === 'send_message');
              logger.debug({ results: data.results.length }, '🎯 recall 意图：已自动检索记忆');
            }
          }
        } catch (err) {
          logger.debug({ err }, '🎯 recall 意图：自动检索失败，回退到模型决策');
        }
      }
    }
  }
  
  logger.debug({ 
    group: group.folder, 
    allTools: allTools.length,
    filtered: tools.length,
    toolNames: tools.map(t => t.name)
  }, '⚡ 工具列表');

  // 获取系统提示词（在意图检测之后，以便按意图裁剪提示词内容）
  const systemPrompt = getGroupSystemPrompt(
    group,
    input.userId || input.chatJid,
    input.isMain,
    input.isScheduledTask,
    detectedIntent,
    resolvedAgentName,
    resolvedAgentSoul
  ) + systemPromptExtra;

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
      group: group.folder,
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
      group: group.folder,
      usedTokens,
      modelContextWindow,
      warning: ctxCheck.warning,
    }, '🛡️ 上下文窗口空间紧张，触发自动压缩');

    await memoryManager.compact(group.folder, apiProvider);

    // 压缩后重新获取上下文和消息
    const compactedContext = memoryManager.getContext(group.folder);
    const compactedMessages: ChatMessage[] = [...compactedContext, userMessage];
    // 用压缩后的消息替换原消息列表
    messages.length = 0;
    messages.push(...compactedMessages);

    const newTokensEstimate = memoryManager.estimateTokens(messages) + systemTokensEstimate;
    logger.info({
      group: group.folder,
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
      logger.error({ group: group.folder }, 'Agent timeout (no activity)');
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
    let stopReason: string | null = null;
    let usage: { input_tokens: number; output_tokens: number } | null = null;
    // 保存流式收集的完整消息对象（用于工具调用，避免重复 API 请求）
    let streamedMessage: unknown = null;

    logger.info({ group: group.folder }, '⚡ 开始流式请求');
    setLiveState('thinking', '正在思考...', group.folder);

    const finalSystemPrompt = systemPromptExtra ? systemPrompt + systemPromptExtra : systemPrompt;

    for await (const event of apiProvider.chatStream(messages, {
      system: finalSystemPrompt,
      tools,
      maxTokens: AI_MAX_OUTPUT_TOKENS
    })) {
      // 每收到数据就重置超时计时器
      resetActivityTimeout();

      if (isTimedOut) {
        throw new Error(`Agent timed out after ${timeout}ms of inactivity`);
      }

      if (event.type === 'thinking') {
        input.onThinking?.(event.text);
        setLiveState('thinking', '正在思考...', group.folder);
      } else if (event.type === 'text') {
        responseText += event.text;
        input.onToken?.(event.text);
        setLiveState('responding', '正在回复...', group.folder);
      } else if (event.type === 'tool_use') {
        // 通知工具调用（用于 CLI/Web UI 显示）
        // 确保 input 是 parsed object（OpenAI provider 流式可能发送 raw string）
        let parsedInput = event.input;
        if (typeof parsedInput === 'string') {
          try { parsedInput = JSON.parse(parsedInput); } catch { /* keep as string */ }
        }
        if (event.name) {
          input.onToolUse?.(event.name, parsedInput);
          setLiveState('tool_use', `正在使用 ${event.name}`, group.folder);
        }
      } else if (event.type === 'done') {
        // 保存完整消息对象（包含 tool_use blocks），用于后续 handleToolUse
        streamedMessage = event.message;
        const msg = event.message as Anthropic.Message;
        stopReason = msg.stop_reason || null;
        usage = msg.usage || null;
      }
    }

    clearActivityTimeout();

    if (!stopReason) {
      throw new Error('No response received from API');
    }

    // 调试：打印 API 响应
    logger.info({
      group: group.folder,
      stopReason,
    }, '⚡ API 响应');

    // 记录 token 使用
    if (usage) {
      const session = recordTokenUsage(input.chatJid, {
        inputTokens: usage.input_tokens || 0,
        outputTokens: usage.output_tokens || 0
      }, getCurrentModelId());
      
      logger.info({
        chatId: input.chatJid,
        inputTokens: usage?.input_tokens,
        outputTokens: usage?.output_tokens,
        totalTokens: session.totalTokens
      }, '📊 Token 统计');
    }

    let result: string;

    // 检查是否有工具调用
    // 兼容不同 provider 的 stop_reason：Anthropic 用 'tool_use'，OpenAI/Ollama 用 'tool_calls'
    if (stopReason === 'tool_use' || stopReason === 'tool_calls') {
      // 直接使用流式收集的完整消息对象，不再重复发送 API 请求
      resetActivityTimeout();

      result = await apiProvider.handleToolUse(
        streamedMessage,
        messages,
        async (name, params) => {
          resetActivityTimeout(); // 工具执行时也重置超时
          input.onToolUse?.(name, params);
          const toolResult = await toolExecutor(name, params);
          if (toolResult.isError) {
            throw new Error(toolResult.content);
          }
          return toolResult.content;
        },
        { system: finalSystemPrompt, tools, maxTokens: AI_MAX_OUTPUT_TOKENS },
        // 心跳回调：工具链内每收到流式数据或执行工具时重置超时
        () => resetActivityTimeout()
      );

      // 工具调用后的最终文本通过 onToken 发送给 CLI（handleToolUse 内部的流式输出不经过 onToken）
      if (result && input.onToken) {
        input.onToken(result);
      }

      clearActivityTimeout();
    } else {
      // 使用流式收集的文本
      result = responseText;
    }

    // 保存助手回复到记忆
    memoryManager.addMessage(group.folder, { role: 'assistant', content: result });

    // 检查是否需要压缩上下文
    if (memoryManager.needsCompaction(group.folder)) {
      logger.info({ group: group.folder }, 'Compacting conversation context');
      await memoryManager.compact(group.folder, apiProvider);
    }

    const duration = Date.now() - startTime;
    logger.info({
      group: group.folder,
      duration,
      status: 'success',
      hasResult: !!result
    }, 'Agent completed');
    setLiveState('idle', '', group.folder);

    return {
      status: 'success',
      result,
      metrics: {
        durationMs: duration,
        model: getCurrentModelId(),
        usage: usage
          ? {
              inputTokens: usage.input_tokens || 0,
              outputTokens: usage.output_tokens || 0,
            }
          : undefined,
      },
    };

  } catch (err) {
    clearActivityTimeout();
    
    const errorMessage = err instanceof Error ? err.message : String(err);
    const duration = Date.now() - startTime;

    logger.error({
      group: group.folder,
      duration,
      error: errorMessage
    }, 'Agent error');
    setLiveState('error', errorMessage, group.folder);

    return {
      status: 'error',
      result: null,
      error: errorMessage,
      metrics: {
        durationMs: duration,
        model: getCurrentModelId(),
      },
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

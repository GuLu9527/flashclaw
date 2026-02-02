/**
 * FlashClaw 主入口
 * ⚡ 闪电龙虾 - 快如闪电的 AI 助手
 */

import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import pino from 'pino';

import { pluginManager } from './plugins/manager.js';
import { loadFromDir, watchPlugins } from './plugins/loader.js';
import { ChannelPlugin, Message, MessageHandler, SendMessageResult } from './plugins/types.js';
import { ApiClient, createApiClient } from './core/api-client.js';
import { MemoryManager } from './core/memory.js';
import {
  BOT_NAME,
  DATA_DIR,
  MAIN_GROUP_FOLDER,
  IPC_POLL_INTERVAL,
  TIMEZONE
} from './config.js';
import { RegisteredGroup, Session } from './types.js';
import {
  initDatabase,
  storeMessage,
  storeChatMetadata,
  getMessagesSince,
  getChatHistory,
  messageExists,
  getAllTasks,
  getAllChats
} from './db.js';
import { startSchedulerLoop } from './task-scheduler.js';
import { runAgent, writeTasksSnapshot, writeGroupsSnapshot, AvailableGroup } from './agent-runner.js';
import { loadJson, saveJson } from './utils.js';
import { MessageQueue, QueuedMessage } from './message-queue.js';

// ⚡ FlashClaw Logger
const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: { target: 'pino-pretty', options: { colorize: true } }
});

// ==================== 渠道管理 ====================
/**
 * 渠道管理器 - 管理所有已启用的通讯渠道插件
 */
class ChannelManager {
  private channels: ChannelPlugin[] = [];
  private enabledPlatforms: string[] = [];
  
  async initialize(): Promise<void> {
    this.channels = pluginManager.getActiveChannels();
    this.enabledPlatforms = this.channels.map(c => c.name);
    
    if (this.channels.length === 0) {
      throw new Error('没有启用任何通讯渠道');
    }
  }
  
  async start(onMessage: MessageHandler): Promise<void> {
    for (const channel of this.channels) {
      channel.onMessage(onMessage);
      await channel.start();
      logger.info({ channel: channel.name }, '⚡ 渠道已启动');
    }
  }
  
  async sendMessage(chatId: string, content: string, platform?: string): Promise<SendMessageResult> {
    // 如果指定了平台，使用指定的渠道
    if (platform) {
      const channel = this.channels.find(c => c.name === platform);
      if (channel) {
        return await channel.sendMessage(chatId, content);
      }
    }
    // 否则尝试所有渠道
    for (const channel of this.channels) {
      try {
        return await channel.sendMessage(chatId, content);
      } catch {
        continue;
      }
    }
    return { success: false, error: `无法发送消息到 ${chatId}` };
  }
  
  async updateMessage(messageId: string, content: string, platform?: string): Promise<void> {
    // 如果指定了平台，使用指定的渠道
    if (platform) {
      const channel = this.channels.find(c => c.name === platform);
      if (channel?.updateMessage) {
        await channel.updateMessage(messageId, content);
        return;
      }
    }
    // 尝试所有支持更新的渠道
    for (const channel of this.channels) {
      if (channel.updateMessage) {
        try {
          await channel.updateMessage(messageId, content);
          return;
        } catch {
          continue;
        }
      }
    }
  }
  
  async deleteMessage(messageId: string, platform?: string): Promise<void> {
    if (platform) {
      const channel = this.channels.find(c => c.name === platform);
      if (channel?.deleteMessage) {
        await channel.deleteMessage(messageId);
        return;
      }
    }
    for (const channel of this.channels) {
      if (channel.deleteMessage) {
        try {
          await channel.deleteMessage(messageId);
          return;
        } catch {
          continue;
        }
      }
    }
  }
  
  getEnabledPlatforms(): string[] {
    return this.enabledPlatforms;
  }
  
  getPlatformDisplayName(platform: string): string {
    const names: Record<string, string> = {
      'feishu': '飞书',
      'dingtalk': '钉钉',
    };
    return names[platform] || platform;
  }
  
  shouldRespondInGroup(msg: Message): boolean {
    // 检查是否被 @ 或提到机器人名称
    const botName = process.env.BOT_NAME || 'FlashClaw';
    return msg.content.includes(`@${botName}`) || 
           msg.content.toLowerCase().includes(botName.toLowerCase());
  }
}

// ==================== 全局状态 ====================
let channelManager: ChannelManager;
let apiClient: ApiClient | null;
let memoryManager: MemoryManager;
let sessions: Session = {};
let registeredGroups: Record<string, RegisteredGroup> = {};
let lastAgentTimestamp: Record<string, string> = {};
let messageQueue: MessageQueue<Message>;

// 消息历史上下文配置
const HISTORY_CONTEXT_LIMIT = 20;

// "正在思考..." 提示配置
const THINKING_THRESHOLD_MS = Number(process.env.THINKING_THRESHOLD_MS ?? 2500);

// ==================== 状态管理 ====================

// 默认的 main 群组配置模板（用于自动注册新会话）
const DEFAULT_MAIN_GROUP: RegisteredGroup = {
  name: 'main',
  folder: MAIN_GROUP_FOLDER,
  trigger: '@',  // 默认 @ 触发
  added_at: new Date().toISOString()
};

function loadState(): void {
  const statePath = path.join(DATA_DIR, 'router_state.json');
  const state = loadJson<{ last_timestamp?: string; last_agent_timestamp?: Record<string, string> }>(statePath, {});
  lastAgentTimestamp = state.last_agent_timestamp || {};
  sessions = loadJson(path.join(DATA_DIR, 'sessions.json'), {});
  registeredGroups = loadJson(path.join(DATA_DIR, 'registered_groups.json'), {});
  
  // 确保有 main 群组配置模板（用于自动注册）
  const hasMainGroup = Object.values(registeredGroups).some(g => g.folder === MAIN_GROUP_FOLDER);
  if (!hasMainGroup) {
    // 用占位符 ID 注册 main 模板，实际会话会在收到消息时动态注册
    registeredGroups['__main_template__'] = DEFAULT_MAIN_GROUP;
    logger.info('⚡ 已初始化 main 群组模板');
  }
  
  logger.info({ groupCount: Object.keys(registeredGroups).length }, '⚡ 状态已加载');
}

function saveState(): void {
  saveJson(path.join(DATA_DIR, 'router_state.json'), { last_agent_timestamp: lastAgentTimestamp });
  saveJson(path.join(DATA_DIR, 'sessions.json'), sessions);
}

function registerGroup(chatId: string, group: RegisteredGroup): void {
  registeredGroups[chatId] = group;
  saveJson(path.join(DATA_DIR, 'registered_groups.json'), registeredGroups);

  // 创建群组文件夹
  const groupDir = path.join(DATA_DIR, '..', 'groups', group.folder);
  fs.mkdirSync(path.join(groupDir, 'logs'), { recursive: true });

  logger.info({ chatId, name: group.name, folder: group.folder }, '⚡ 群组已注册');
}

/**
 * 获取可用群组列表
 */
function getAvailableGroups(): AvailableGroup[] {
  const chats = getAllChats();
  const registeredIds = new Set(Object.keys(registeredGroups));

  return chats
    .filter(c => c.jid !== '__group_sync__')
    .map(c => ({
      jid: c.jid,
      name: c.name,
      lastActivity: c.last_message_time,
      isRegistered: registeredIds.has(c.jid)
    }));
}

// ==================== 消息处理 ====================
/**
 * 判断是否应该触发 Agent
 */
function shouldTriggerAgent(msg: Message, group: RegisteredGroup): boolean {
  const isMainGroup = group.folder === MAIN_GROUP_FOLDER;

  // 主群组响应所有消息
  if (isMainGroup) {
    return true;
  }

  // 私聊始终响应
  if (msg.chatType === 'p2p') {
    return true;
  }

  // 群聊使用智能检测
  if (channelManager.shouldRespondInGroup(msg)) {
    return true;
  }

  return false;
}

/**
 * 处理队列中的消息
 */
async function processQueuedMessage(queuedMsg: QueuedMessage<Message>): Promise<void> {
  const msg = queuedMsg.data;
  const chatId = msg.chatId;
  const group = registeredGroups[chatId];

  logger.info({ chatId, msgId: msg.id }, '>>> 开始处理队列消息');

  if (!group) {
    logger.info({ chatId }, '群组未注册，跳过');
    return;
  }

  // 获取自上次交互以来的消息
  const sinceTimestamp = lastAgentTimestamp[chatId] || '';
  logger.info({ chatId, sinceTimestamp }, '>>> 查询新消息');
  
  const missedMessages = getMessagesSince(chatId, sinceTimestamp, BOT_NAME);
  logger.info({ chatId, count: missedMessages.length }, '>>> 获取到消息数量');

  if (missedMessages.length === 0) {
    logger.info({ chatId, sinceTimestamp }, '无新消息，可能时间戳问题');
    return;
  }

  // 获取历史上下文
  const historyMessages = getChatHistory(chatId, HISTORY_CONTEXT_LIMIT, sinceTimestamp);
  
  const escapeXml = (s: string) => s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

  // 构建带历史上下文的 prompt
  let prompt = '';
  
  if (historyMessages.length > 0) {
    const historyLines = historyMessages.map(m => 
      `<message sender="${escapeXml(m.sender_name)}" time="${m.timestamp}">${escapeXml(m.content)}</message>`
    );
    prompt += `<history_context>\n${historyLines.join('\n')}\n</history_context>\n\n`;
  }

  const newLines = missedMessages.map(m => 
    `<message sender="${escapeXml(m.sender_name)}" time="${m.timestamp}">${escapeXml(m.content)}</message>`
  );
  prompt += `<new_messages>\n${newLines.join('\n')}\n</new_messages>`;

  // 提取图片附件（只处理当前消息的附件）
  const imageAttachments = msg.attachments
    ?.filter(a => a.type === 'image' && a.content)
    .map(a => ({
      type: 'image' as const,
      content: a.content!,
      mimeType: a.mimeType
    })) || [];

  logger.info({ 
    group: group.name, 
    newMessages: missedMessages.length, 
    historyContext: historyMessages.length,
    platform: msg.platform,
    imageCount: imageAttachments.length
  }, '⚡ 处理消息');

  // "正在思考..." 提示功能
  let placeholderMessageId: string | undefined;
  let thinkingDone = false;
  
  // 设置定时器，超过阈值时发送"正在思考..."
  const thinkingTimer = THINKING_THRESHOLD_MS > 0 ? setTimeout(async () => {
    if (thinkingDone) return;
    try {
      const result = await channelManager.sendMessage(chatId, `${BOT_NAME}: 正在思考...`, msg.platform);
      if (result.success && result.messageId) {
        placeholderMessageId = result.messageId;
        logger.debug({ chatId, messageId: placeholderMessageId }, '已发送思考提示');
      }
    } catch {
      // 忽略错误
    }
  }, THINKING_THRESHOLD_MS) : null;

  try {
    const response = await executeAgent(group, prompt, chatId, {
      attachments: imageAttachments.length > 0 ? imageAttachments : undefined
    });
    thinkingDone = true;
    
    if (thinkingTimer) {
      clearTimeout(thinkingTimer);
    }

    if (response) {
      lastAgentTimestamp[chatId] = msg.timestamp;
      saveState();
      
      const finalText = `${BOT_NAME}: ${response}`;
      
      // 如果有占位消息，更新它；否则发送新消息
      if (placeholderMessageId) {
        try {
          await channelManager.updateMessage(placeholderMessageId, finalText, msg.platform);
          logger.info({ chatId, messageId: placeholderMessageId }, '⚡ 消息已更新');
        } catch {
          // 更新失败，尝试删除并发送新消息
          try {
            await channelManager.deleteMessage(placeholderMessageId, msg.platform);
          } catch {}
          await sendMessage(chatId, finalText, msg.platform);
        }
      } else {
        await sendMessage(chatId, finalText, msg.platform);
      }
    } else if (placeholderMessageId) {
      // 没有响应，删除占位消息
      try {
        await channelManager.deleteMessage(placeholderMessageId, msg.platform);
      } catch {}
    }
  } catch (err) {
    thinkingDone = true;
    if (thinkingTimer) {
      clearTimeout(thinkingTimer);
    }
    
    // 删除占位消息
    if (placeholderMessageId) {
      try {
        await channelManager.deleteMessage(placeholderMessageId, msg.platform);
      } catch {}
    }
    
    throw err;
  }
}

/**
 * 处理传入消息
 */
async function handleIncomingMessage(msg: Message): Promise<void> {
  const chatId = msg.chatId;

  // 存储聊天元数据
  storeChatMetadata(chatId, msg.timestamp);

  // 获取群组配置
  let group = registeredGroups[chatId];
  
  // 自动注册新会话（参考 openclaw 的动态 session key 设计）
  if (!group) {
    // 查找 main 群组配置作为模板
    const mainGroup = Object.values(registeredGroups).find(g => g.folder === MAIN_GROUP_FOLDER);
    if (mainGroup) {
      group = mainGroup;
      
      // 根据聊天类型生成名称
      const chatName = msg.chatType === 'p2p' 
        ? `私聊-${msg.senderName || chatId.slice(-8)}`
        : `群聊-${chatId.slice(-8)}`;
      
      // 动态注册此会话
      registerGroup(chatId, {
        ...mainGroup,
        name: chatName,
        added_at: new Date().toISOString()
      });
      
      logger.info({ 
        chatId, 
        chatType: msg.chatType,
        name: chatName 
      }, '⚡ 会话已自动注册');
    }
  }
  
  if (!group) {
    logger.debug({ chatId, platform: msg.platform, chatType: msg.chatType }, '未注册的聊天，忽略');
    return;
  }

  // 去重检查
  if (messageExists(msg.id, chatId)) {
    logger.debug({ chatId, messageId: msg.id }, '重复消息，忽略');
    return;
  }

  // 存储消息
  storeMessage({
    id: msg.id,
    chatId: chatId,
    senderId: msg.senderId,
    senderName: msg.senderName,
    content: msg.content,
    timestamp: msg.timestamp,
    isFromMe: false
  });

  // 检查触发条件
  const shouldTrigger = shouldTriggerAgent(msg, group);
  logger.info({ chatId, shouldTrigger, chatType: msg.chatType }, '>>> 触发检查');
  
  if (!shouldTrigger) {
    return;
  }

  // 添加到消息队列
  logger.info({ chatId, msgId: msg.id }, '>>> 加入消息队列');
  await messageQueue.enqueue(chatId, msg.id, msg);
}

// ==================== Agent 执行 ====================
interface ExecuteAgentOptions {
  attachments?: { type: 'image'; content: string; mimeType?: string }[];
}

async function executeAgent(group: RegisteredGroup, prompt: string, chatId: string, options?: ExecuteAgentOptions): Promise<string | null> {
  const isMain = group.folder === MAIN_GROUP_FOLDER;
  const sessionId = sessions[group.folder];

  // 更新任务快照
  const tasks = getAllTasks();
  writeTasksSnapshot(group.folder, isMain, tasks.map(t => ({
    id: t.id,
    groupFolder: t.group_folder,
    prompt: t.prompt,
    schedule_type: t.schedule_type,
    schedule_value: t.schedule_value,
    status: t.status,
    next_run: t.next_run
  })));

  // 更新可用群组快照
  const availableGroups = getAvailableGroups();
  writeGroupsSnapshot(group.folder, isMain, availableGroups, new Set(Object.keys(registeredGroups)));

  try {
    const output = await runAgent(group, {
      prompt,
      sessionId,
      groupFolder: group.folder,
      chatJid: chatId,
      isMain,
      attachments: options?.attachments
    });

    if (output.newSessionId) {
      sessions[group.folder] = output.newSessionId;
      saveJson(path.join(DATA_DIR, 'sessions.json'), sessions);
    }

    if (output.status === 'error') {
      logger.error({ group: group.name, error: output.error }, 'Agent 错误');
      return null;
    }

    return output.result;
  } catch (err) {
    logger.error({ group: group.name, err }, 'Agent 执行失败');
    return null;
  }
}

// ==================== 消息发送 ====================
async function sendMessage(chatId: string, text: string, platform?: string): Promise<void> {
  try {
    await channelManager.sendMessage(chatId, text, platform);
    logger.info({ chatId, length: text.length, platform }, '⚡ 消息已发送');
  } catch (err) {
    logger.error({ chatId, err, platform }, '发送消息失败');
  }
}

// ==================== IPC 处理 ====================
function startIpcWatcher(): void {
  const ipcBaseDir = path.join(DATA_DIR, 'ipc');
  fs.mkdirSync(ipcBaseDir, { recursive: true });

  const processIpcFiles = async () => {
    let groupFolders: string[];
    try {
      groupFolders = fs.readdirSync(ipcBaseDir).filter(f => {
        const stat = fs.statSync(path.join(ipcBaseDir, f));
        return stat.isDirectory() && f !== 'errors';
      });
    } catch (err) {
      logger.error({ err }, '读取 IPC 目录失败');
      setTimeout(processIpcFiles, IPC_POLL_INTERVAL);
      return;
    }

    for (const sourceGroup of groupFolders) {
      const isMain = sourceGroup === MAIN_GROUP_FOLDER;
      const messagesDir = path.join(ipcBaseDir, sourceGroup, 'messages');
      const tasksDir = path.join(ipcBaseDir, sourceGroup, 'tasks');

      // 处理消息
      try {
        if (fs.existsSync(messagesDir)) {
          const messageFiles = fs.readdirSync(messagesDir).filter(f => f.endsWith('.json'));
          for (const file of messageFiles) {
            const filePath = path.join(messagesDir, file);
            try {
              const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
              if (data.type === 'message' && data.chatJid && data.text) {
                const targetGroup = registeredGroups[data.chatJid];
                if (isMain || (targetGroup && targetGroup.folder === sourceGroup)) {
                  await sendMessage(data.chatJid, `${BOT_NAME}: ${data.text}`);
                  logger.info({ chatId: data.chatJid, sourceGroup }, 'IPC 消息已发送');
                } else {
                  logger.warn({ chatId: data.chatJid, sourceGroup }, '未授权的 IPC 消息被阻止');
                }
              }
              fs.unlinkSync(filePath);
            } catch (err) {
              logger.error({ file, sourceGroup, err }, '处理 IPC 消息失败');
              const errorDir = path.join(ipcBaseDir, 'errors');
              fs.mkdirSync(errorDir, { recursive: true });
              fs.renameSync(filePath, path.join(errorDir, `${sourceGroup}-${file}`));
            }
          }
        }
      } catch (err) {
        logger.error({ err, sourceGroup }, '读取 IPC 消息目录失败');
      }

      // 处理任务
      try {
        if (fs.existsSync(tasksDir)) {
          const taskFiles = fs.readdirSync(tasksDir).filter(f => f.endsWith('.json'));
          for (const file of taskFiles) {
            const filePath = path.join(tasksDir, file);
            try {
              const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
              await processTaskIpc(data, sourceGroup, isMain);
              fs.unlinkSync(filePath);
            } catch (err) {
              logger.error({ file, sourceGroup, err }, '处理 IPC 任务失败');
              const errorDir = path.join(ipcBaseDir, 'errors');
              fs.mkdirSync(errorDir, { recursive: true });
              fs.renameSync(filePath, path.join(errorDir, `${sourceGroup}-${file}`));
            }
          }
        }
      } catch (err) {
        logger.error({ err, sourceGroup }, '读取 IPC 任务目录失败');
      }
    }

    setTimeout(processIpcFiles, IPC_POLL_INTERVAL);
  };

  processIpcFiles();
  logger.info('⚡ IPC 监听已启动');
}

async function processTaskIpc(
  data: {
    type: string;
    taskId?: string;
    prompt?: string;
    schedule_type?: string;
    schedule_value?: string;
    context_mode?: string;
    groupFolder?: string;
    chatJid?: string;
    jid?: string;
    name?: string;
    folder?: string;
    trigger?: string;
    agentConfig?: RegisteredGroup['agentConfig'];
  },
  sourceGroup: string,
  isMain: boolean
): Promise<void> {
  const { createTask, updateTask, deleteTask, getTaskById: getTask } = await import('./db.js');
  const { CronExpressionParser } = await import('cron-parser');

  switch (data.type) {
    case 'schedule_task':
      if (data.prompt && data.schedule_type && data.schedule_value && data.groupFolder) {
        const targetGroup = data.groupFolder;
        if (!isMain && targetGroup !== sourceGroup) {
          logger.warn({ sourceGroup, targetGroup }, '未授权的 schedule_task 被阻止');
          break;
        }

        const targetChatId = Object.entries(registeredGroups).find(
          ([, group]) => group.folder === targetGroup
        )?.[0];

        if (!targetChatId) {
          logger.warn({ targetGroup }, '无法创建任务：目标群组未注册');
          break;
        }

        const scheduleType = data.schedule_type as 'cron' | 'interval' | 'once';

        let nextRun: string | null = null;
        if (scheduleType === 'cron') {
          try {
            const interval = CronExpressionParser.parse(data.schedule_value, { tz: TIMEZONE });
            nextRun = interval.next().toISOString();
          } catch {
            logger.warn({ scheduleValue: data.schedule_value }, '无效的 cron 表达式');
            break;
          }
        } else if (scheduleType === 'interval') {
          const ms = parseInt(data.schedule_value, 10);
          if (isNaN(ms) || ms <= 0) {
            logger.warn({ scheduleValue: data.schedule_value }, '无效的间隔值');
            break;
          }
          nextRun = new Date(Date.now() + ms).toISOString();
        } else if (scheduleType === 'once') {
          const scheduled = new Date(data.schedule_value);
          if (isNaN(scheduled.getTime())) {
            logger.warn({ scheduleValue: data.schedule_value }, '无效的时间戳');
            break;
          }
          nextRun = scheduled.toISOString();
        }

        const taskId = `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const contextMode = (data.context_mode === 'group' || data.context_mode === 'isolated')
          ? data.context_mode
          : 'isolated';
        createTask({
          id: taskId,
          group_folder: targetGroup,
          chat_jid: targetChatId,
          prompt: data.prompt,
          schedule_type: scheduleType,
          schedule_value: data.schedule_value,
          context_mode: contextMode,
          next_run: nextRun,
          status: 'active',
          created_at: new Date().toISOString()
        });
        logger.info({ taskId, sourceGroup, targetGroup, contextMode }, '⚡ 任务已创建');
      }
      break;

    case 'pause_task':
      if (data.taskId) {
        const task = getTask(data.taskId);
        if (task && (isMain || task.group_folder === sourceGroup)) {
          updateTask(data.taskId, { status: 'paused' });
          logger.info({ taskId: data.taskId, sourceGroup }, '任务已暂停');
        } else {
          logger.warn({ taskId: data.taskId, sourceGroup }, '未授权的任务暂停操作');
        }
      }
      break;

    case 'resume_task':
      if (data.taskId) {
        const task = getTask(data.taskId);
        if (task && (isMain || task.group_folder === sourceGroup)) {
          updateTask(data.taskId, { status: 'active' });
          logger.info({ taskId: data.taskId, sourceGroup }, '任务已恢复');
        } else {
          logger.warn({ taskId: data.taskId, sourceGroup }, '未授权的任务恢复操作');
        }
      }
      break;

    case 'cancel_task':
      if (data.taskId) {
        const task = getTask(data.taskId);
        if (task && (isMain || task.group_folder === sourceGroup)) {
          deleteTask(data.taskId);
          logger.info({ taskId: data.taskId, sourceGroup }, '任务已取消');
        } else {
          logger.warn({ taskId: data.taskId, sourceGroup }, '未授权的任务取消操作');
        }
      }
      break;

    case 'register_group':
      if (!isMain) {
        logger.warn({ sourceGroup }, '未授权的 register_group 被阻止');
        break;
      }
      if (data.jid && data.name && data.folder && data.trigger) {
        registerGroup(data.jid, {
          name: data.name,
          folder: data.folder,
          trigger: data.trigger,
          added_at: new Date().toISOString(),
          agentConfig: data.agentConfig
        });
      } else {
        logger.warn({ data }, '无效的 register_group 请求');
      }
      break;

    default:
      logger.warn({ type: data.type }, '未知的 IPC 任务类型');
  }
}

// ==================== 启动横幅 ====================
function displayBanner(enabledPlatforms: string[], groupCount: number): void {
  const platformsDisplay = enabledPlatforms.map(p => channelManager.getPlatformDisplayName(p)).join(' | ');
  
  const banner = `
\x1b[33m
  ███████╗██╗      █████╗ ███████╗██╗  ██╗ ██████╗██╗      █████╗ ██╗    ██╗
  ██╔════╝██║     ██╔══██╗██╔════╝██║  ██║██╔════╝██║     ██╔══██╗██║    ██║
  █████╗  ██║     ███████║███████╗███████║██║     ██║     ███████║██║ █╗ ██║
  ██╔══╝  ██║     ██╔══██║╚════██║██╔══██║██║     ██║     ██╔══██║██║███╗██║
  ██║     ███████╗██║  ██║███████║██║  ██║╚██████╗███████╗██║  ██║╚███╔███╔╝
  ╚═╝     ╚══════╝╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝ ╚═════╝╚══════╝╚═╝  ╚═╝ ╚══╝╚══╝ 
\x1b[0m
\x1b[36m  ⚡ 闪电龙虾 - 快如闪电的 AI 助手\x1b[0m

  ┌─────────────────────────────────────────────────────────────────────────┐
  │                                                                         │
  │  \x1b[32m✓\x1b[0m 状态: \x1b[32m运行中\x1b[0m                                                        │
  │  \x1b[32m✓\x1b[0m 模式: \x1b[33mDirect (Claude API)\x1b[0m                                           │
  │  \x1b[32m✓\x1b[0m 平台: \x1b[36m${platformsDisplay.padEnd(55)}\x1b[0m│
  │  \x1b[32m✓\x1b[0m 群组: \x1b[33m${String(groupCount).padEnd(55)}\x1b[0m│
  │                                                                         │
  │  \x1b[90m所有平台使用 WebSocket 长连接，无需公网服务器\x1b[0m                        │
  │                                                                         │
  └─────────────────────────────────────────────────────────────────────────┘

  \x1b[90m按 Ctrl+C 停止服务\x1b[0m
`;

  console.log(banner);
}

// ==================== 主函数 ====================
export async function main(): Promise<void> {
  // 初始化 API 客户端
  apiClient = createApiClient();
  
  // 初始化记忆管理器
  memoryManager = new MemoryManager();
  
  // 加载插件
  const pluginsDir = path.join(process.cwd(), 'plugins');
  await loadFromDir(pluginsDir);
  
  // 启用热重载 - 工具插件会自动重载，渠道插件会忽略重载信号
  watchPlugins(pluginsDir, (event, name) => {
    logger.info({ event, plugin: name }, '⚡ 插件变化');
  });

  // 初始化渠道管理器
  channelManager = new ChannelManager();
  try {
    await channelManager.initialize();
  } catch (err) {
    console.error(`
\x1b[31m
  ███████╗██████╗ ██████╗  ██████╗ ██████╗ 
  ██╔════╝██╔══██╗██╔══██╗██╔═══██╗██╔══██╗
  █████╗  ██████╔╝██████╔╝██║   ██║██████╔╝
  ██╔══╝  ██╔══██╗██╔══██╗██║   ██║██╔══██╗
  ███████╗██║  ██║██║  ██║╚██████╔╝██║  ██║
  ╚══════╝╚═╝  ╚═╝╚═╝  ╚═╝ ╚═════╝ ╚═╝  ╚═╝
\x1b[0m
  \x1b[31m✗ 缺少消息平台配置\x1b[0m

  请在 \x1b[33m.env\x1b[0m 中配置至少一个平台:

  \x1b[36m飞书:\x1b[0m
    FEISHU_APP_ID=cli_xxxxx
    FEISHU_APP_SECRET=xxxxx

  \x1b[36m钉钉:\x1b[0m
    DINGTALK_APP_KEY=xxxxx
    DINGTALK_APP_SECRET=xxxxx

  详见 \x1b[33m.env.example\x1b[0m
`);
    process.exit(1);
  }

  const enabledPlatforms = channelManager.getEnabledPlatforms();
  logger.info({ platforms: enabledPlatforms }, '⚡ 渠道管理器已初始化');

  // 初始化数据库
  initDatabase();
  logger.info('⚡ 数据库已初始化');

  // 加载状态
  loadState();

  // 初始化消息队列
  messageQueue = new MessageQueue<Message>(processQueuedMessage, {
    maxQueueSize: 100,
    maxConcurrent: 3,
    processingTimeout: 300000,
    maxRetries: 2
  });
  messageQueue.start();
  logger.info('⚡ 消息队列已初始化');

  // 启动任务调度器
  startSchedulerLoop({
    sendMessage: (chatId, text) => sendMessage(chatId, text),
    registeredGroups: () => registeredGroups,
    getSessions: () => sessions
  });

  // 启动 IPC 监听
  startIpcWatcher();

  // 启动所有渠道插件
  await channelManager.start(handleIncomingMessage);

  // 显示启动横幅
  const groupCount = Object.keys(registeredGroups).length;
  displayBanner(enabledPlatforms, groupCount);

  logger.info({ 
    mode: 'direct',
    platforms: enabledPlatforms,
    groups: groupCount
  }, '⚡ FlashClaw 已启动');
}

// 直接运行时启动
main().catch(err => {
  logger.error({ err }, '⚡ FlashClaw 启动失败');
  process.exit(1);
});

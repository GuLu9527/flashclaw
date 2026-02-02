/**
 * FlashClaw - Personal AI Assistant
 * Main entry point - Multi-platform messaging with AI agents
 */

import fs from 'fs';
import path from 'path';
import pino from 'pino';

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
import { createClientManager, ClientManager, Message } from './clients/index.js';
import { MessageQueue, QueuedMessage } from './message-queue.js';

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: { target: 'pino-pretty', options: { colorize: true } }
});

// Global state
let clientManager: ClientManager;
let sessions: Session = {};
let registeredGroups: Record<string, RegisteredGroup> = {};
let lastAgentTimestamp: Record<string, string> = {};
let messageQueue: MessageQueue<Message>;

// 消息历史上下文配置
const HISTORY_CONTEXT_LIMIT = 20; // 包含最近 20 条消息作为上下文

function loadState(): void {
  const statePath = path.join(DATA_DIR, 'router_state.json');
  const state = loadJson<{ last_timestamp?: string; last_agent_timestamp?: Record<string, string> }>(statePath, {});
  lastAgentTimestamp = state.last_agent_timestamp || {};
  sessions = loadJson(path.join(DATA_DIR, 'sessions.json'), {});
  registeredGroups = loadJson(path.join(DATA_DIR, 'registered_groups.json'), {});
  logger.info({ groupCount: Object.keys(registeredGroups).length }, 'State loaded');
}

function saveState(): void {
  saveJson(path.join(DATA_DIR, 'router_state.json'), { last_agent_timestamp: lastAgentTimestamp });
  saveJson(path.join(DATA_DIR, 'sessions.json'), sessions);
}

function registerGroup(chatId: string, group: RegisteredGroup): void {
  registeredGroups[chatId] = group;
  saveJson(path.join(DATA_DIR, 'registered_groups.json'), registeredGroups);

  // Create group folder
  const groupDir = path.join(DATA_DIR, '..', 'groups', group.folder);
  fs.mkdirSync(path.join(groupDir, 'logs'), { recursive: true });

  logger.info({ chatId, name: group.name, folder: group.folder }, 'Group registered');
}

/**
 * Get available groups list for the agent.
 * Returns groups ordered by most recent activity.
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

/**
 * Check if the message should trigger the agent
 */
function shouldTriggerAgent(msg: Message, group: RegisteredGroup): boolean {
  const isMainGroup = group.folder === MAIN_GROUP_FOLDER;

  // Main group responds to all messages
  if (isMainGroup) {
    return true;
  }

  // For other groups:
  // 1. In private chat (p2p), always respond
  if (msg.chatType === 'p2p') {
    return true;
  }

  // 2. In group chat, use smart detection
  if (clientManager.shouldRespondInGroup(msg)) {
    return true;
  }

  return false;
}

/**
 * Process a message from any platform (called by message queue)
 */
async function processQueuedMessage(queuedMsg: QueuedMessage<Message>): Promise<void> {
  const msg = queuedMsg.data;
  const chatId = msg.chatId;
  const group = registeredGroups[chatId];

  if (!group) {
    logger.debug({ chatId }, 'Group no longer registered, skipping');
    return;
  }

  // Get messages since last agent interaction
  const sinceTimestamp = lastAgentTimestamp[chatId] || '';
  const missedMessages = getMessagesSince(chatId, sinceTimestamp, BOT_NAME);

  if (missedMessages.length === 0) {
    logger.debug({ chatId }, 'No new messages to process');
    return;
  }

  // 获取历史上下文（最近的消息，用于提供上下文）
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

  logger.info({ 
    group: group.name, 
    newMessages: missedMessages.length, 
    historyContext: historyMessages.length,
    platform: msg.platform 
  }, 'Processing message');

  const response = await executeAgent(group, prompt, chatId);

  if (response) {
    lastAgentTimestamp[chatId] = msg.timestamp;
    saveState();
    await sendMessage(chatId, `${BOT_NAME}: ${response}`, msg.platform);
  }
}

/**
 * Handle incoming message from any platform
 */
async function handleIncomingMessage(msg: Message): Promise<void> {
  const chatId = msg.chatId;

  // Store chat metadata for discovery
  storeChatMetadata(chatId, msg.timestamp);

  // Check if this chat is registered
  const group = registeredGroups[chatId];
  if (!group) {
    logger.debug({ chatId, platform: msg.platform }, 'Message from unregistered chat, ignoring');
    return;
  }

  // 去重检查：检查消息是否已存在于数据库
  if (messageExists(msg.id, chatId)) {
    logger.debug({ chatId, messageId: msg.id }, 'Duplicate message detected, ignoring');
    return;
  }

  // Store the message
  storeMessage({
    id: msg.id,
    chatId: chatId,
    senderId: msg.senderId,
    senderName: msg.senderName,
    content: msg.content,
    timestamp: msg.timestamp,
    isFromMe: false
  });

  // Check trigger conditions
  if (!shouldTriggerAgent(msg, group)) {
    return;
  }

  // 添加到消息队列处理
  await messageQueue.enqueue(chatId, msg.id, msg);
}

async function executeAgent(group: RegisteredGroup, prompt: string, chatId: string): Promise<string | null> {
  const isMain = group.folder === MAIN_GROUP_FOLDER;
  const sessionId = sessions[group.folder];

  // Update tasks snapshot for agent to read (filtered by group)
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

  // Update available groups snapshot (main group only can see all groups)
  const availableGroups = getAvailableGroups();
  writeGroupsSnapshot(group.folder, isMain, availableGroups, new Set(Object.keys(registeredGroups)));

  try {
    const output = await runAgent(group, {
      prompt,
      sessionId,
      groupFolder: group.folder,
      chatJid: chatId,
      isMain
    });

    if (output.newSessionId) {
      sessions[group.folder] = output.newSessionId;
      saveJson(path.join(DATA_DIR, 'sessions.json'), sessions);
    }

    if (output.status === 'error') {
      logger.error({ group: group.name, error: output.error }, 'Agent error');
      return null;
    }

    return output.result;
  } catch (err) {
    logger.error({ group: group.name, err }, 'Agent error');
    return null;
  }
}

async function sendMessage(chatId: string, text: string, platform?: string): Promise<void> {
  try {
    await clientManager.sendMessage(chatId, text, platform);
    logger.info({ chatId, length: text.length, platform }, 'Message sent');
  } catch (err) {
    logger.error({ chatId, err, platform }, 'Failed to send message');
  }
}

function startIpcWatcher(): void {
  const ipcBaseDir = path.join(DATA_DIR, 'ipc');
  fs.mkdirSync(ipcBaseDir, { recursive: true });

  const processIpcFiles = async () => {
    // Scan all group IPC directories (identity determined by directory)
    let groupFolders: string[];
    try {
      groupFolders = fs.readdirSync(ipcBaseDir).filter(f => {
        const stat = fs.statSync(path.join(ipcBaseDir, f));
        return stat.isDirectory() && f !== 'errors';
      });
    } catch (err) {
      logger.error({ err }, 'Error reading IPC base directory');
      setTimeout(processIpcFiles, IPC_POLL_INTERVAL);
      return;
    }

    for (const sourceGroup of groupFolders) {
      const isMain = sourceGroup === MAIN_GROUP_FOLDER;
      const messagesDir = path.join(ipcBaseDir, sourceGroup, 'messages');
      const tasksDir = path.join(ipcBaseDir, sourceGroup, 'tasks');

      // Process messages from this group's IPC directory
      try {
        if (fs.existsSync(messagesDir)) {
          const messageFiles = fs.readdirSync(messagesDir).filter(f => f.endsWith('.json'));
          for (const file of messageFiles) {
            const filePath = path.join(messagesDir, file);
            try {
              const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
              if (data.type === 'message' && data.chatJid && data.text) {
                // Authorization: verify this group can send to this chatId
                const targetGroup = registeredGroups[data.chatJid];
                if (isMain || (targetGroup && targetGroup.folder === sourceGroup)) {
                  await sendMessage(data.chatJid, `${BOT_NAME}: ${data.text}`);
                  logger.info({ chatId: data.chatJid, sourceGroup }, 'IPC message sent');
                } else {
                  logger.warn({ chatId: data.chatJid, sourceGroup }, 'Unauthorized IPC message attempt blocked');
                }
              }
              fs.unlinkSync(filePath);
            } catch (err) {
              logger.error({ file, sourceGroup, err }, 'Error processing IPC message');
              const errorDir = path.join(ipcBaseDir, 'errors');
              fs.mkdirSync(errorDir, { recursive: true });
              fs.renameSync(filePath, path.join(errorDir, `${sourceGroup}-${file}`));
            }
          }
        }
      } catch (err) {
        logger.error({ err, sourceGroup }, 'Error reading IPC messages directory');
      }

      // Process tasks from this group's IPC directory
      try {
        if (fs.existsSync(tasksDir)) {
          const taskFiles = fs.readdirSync(tasksDir).filter(f => f.endsWith('.json'));
          for (const file of taskFiles) {
            const filePath = path.join(tasksDir, file);
            try {
              const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
              // Pass source group identity to processTaskIpc for authorization
              await processTaskIpc(data, sourceGroup, isMain);
              fs.unlinkSync(filePath);
            } catch (err) {
              logger.error({ file, sourceGroup, err }, 'Error processing IPC task');
              const errorDir = path.join(ipcBaseDir, 'errors');
              fs.mkdirSync(errorDir, { recursive: true });
              fs.renameSync(filePath, path.join(errorDir, `${sourceGroup}-${file}`));
            }
          }
        }
      } catch (err) {
        logger.error({ err, sourceGroup }, 'Error reading IPC tasks directory');
      }
    }

    setTimeout(processIpcFiles, IPC_POLL_INTERVAL);
  };

  processIpcFiles();
  logger.info('IPC watcher started (per-group namespaces)');
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
    // For register_group
    jid?: string;
    name?: string;
    folder?: string;
    trigger?: string;
    agentConfig?: RegisteredGroup['agentConfig'];
  },
  sourceGroup: string,
  isMain: boolean
): Promise<void> {
  // Import db functions dynamically to avoid circular deps
  const { createTask, updateTask, deleteTask, getTaskById: getTask } = await import('./db.js');
  const { CronExpressionParser } = await import('cron-parser');

  switch (data.type) {
    case 'schedule_task':
      if (data.prompt && data.schedule_type && data.schedule_value && data.groupFolder) {
        // Authorization: non-main groups can only schedule for themselves
        const targetGroup = data.groupFolder;
        if (!isMain && targetGroup !== sourceGroup) {
          logger.warn({ sourceGroup, targetGroup }, 'Unauthorized schedule_task attempt blocked');
          break;
        }

        // Resolve the correct chat ID for the target group (don't trust IPC payload)
        const targetChatId = Object.entries(registeredGroups).find(
          ([, group]) => group.folder === targetGroup
        )?.[0];

        if (!targetChatId) {
          logger.warn({ targetGroup }, 'Cannot schedule task: target group not registered');
          break;
        }

        const scheduleType = data.schedule_type as 'cron' | 'interval' | 'once';

        let nextRun: string | null = null;
        if (scheduleType === 'cron') {
          try {
            const interval = CronExpressionParser.parse(data.schedule_value, { tz: TIMEZONE });
            nextRun = interval.next().toISOString();
          } catch {
            logger.warn({ scheduleValue: data.schedule_value }, 'Invalid cron expression');
            break;
          }
        } else if (scheduleType === 'interval') {
          const ms = parseInt(data.schedule_value, 10);
          if (isNaN(ms) || ms <= 0) {
            logger.warn({ scheduleValue: data.schedule_value }, 'Invalid interval');
            break;
          }
          nextRun = new Date(Date.now() + ms).toISOString();
        } else if (scheduleType === 'once') {
          const scheduled = new Date(data.schedule_value);
          if (isNaN(scheduled.getTime())) {
            logger.warn({ scheduleValue: data.schedule_value }, 'Invalid timestamp');
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
        logger.info({ taskId, sourceGroup, targetGroup, contextMode }, 'Task created via IPC');
      }
      break;

    case 'pause_task':
      if (data.taskId) {
        const task = getTask(data.taskId);
        if (task && (isMain || task.group_folder === sourceGroup)) {
          updateTask(data.taskId, { status: 'paused' });
          logger.info({ taskId: data.taskId, sourceGroup }, 'Task paused via IPC');
        } else {
          logger.warn({ taskId: data.taskId, sourceGroup }, 'Unauthorized task pause attempt');
        }
      }
      break;

    case 'resume_task':
      if (data.taskId) {
        const task = getTask(data.taskId);
        if (task && (isMain || task.group_folder === sourceGroup)) {
          updateTask(data.taskId, { status: 'active' });
          logger.info({ taskId: data.taskId, sourceGroup }, 'Task resumed via IPC');
        } else {
          logger.warn({ taskId: data.taskId, sourceGroup }, 'Unauthorized task resume attempt');
        }
      }
      break;

    case 'cancel_task':
      if (data.taskId) {
        const task = getTask(data.taskId);
        if (task && (isMain || task.group_folder === sourceGroup)) {
          deleteTask(data.taskId);
          logger.info({ taskId: data.taskId, sourceGroup }, 'Task cancelled via IPC');
        } else {
          logger.warn({ taskId: data.taskId, sourceGroup }, 'Unauthorized task cancel attempt');
        }
      }
      break;

    case 'register_group':
      // Only main group can register new groups
      if (!isMain) {
        logger.warn({ sourceGroup }, 'Unauthorized register_group attempt blocked');
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
        logger.warn({ data }, 'Invalid register_group request - missing required fields');
      }
      break;

    default:
      logger.warn({ type: data.type }, 'Unknown IPC task type');
  }
}

async function main(): Promise<void> {
  // Initialize message clients (will throw if no platform configured)
  try {
    clientManager = createClientManager();
  } catch (err) {
    console.error('\n╔════════════════════════════════════════════════════════════════╗');
    console.error('║  Missing message platform configuration                        ║');
    console.error('╠════════════════════════════════════════════════════════════════╣');
    console.error('║  Please configure at least one platform in .env:               ║');
    console.error('║                                                                ║');
    console.error('║  Feishu:                                                       ║');
    console.error('║    FEISHU_APP_ID=cli_xxxxx                                     ║');
    console.error('║    FEISHU_APP_SECRET=xxxxx                                     ║');
    console.error('║                                                                ║');
    console.error('║  DingTalk (coming soon):                                       ║');
    console.error('║    DINGTALK_APP_KEY=xxxxx                                      ║');
    console.error('║    DINGTALK_APP_SECRET=xxxxx                                   ║');
    console.error('║                                                                ║');
    console.error('║  See .env.example for reference.                               ║');
    console.error('╚════════════════════════════════════════════════════════════════╝\n');
    process.exit(1);
  }

  const enabledPlatforms = clientManager.getEnabledPlatforms();
  logger.info({ platforms: enabledPlatforms }, 'Message clients initialized');

  // Initialize database
  initDatabase();
  logger.info('Database initialized');

  // Load state
  loadState();

  // Initialize message queue
  messageQueue = new MessageQueue<Message>(processQueuedMessage, {
    maxQueueSize: 100,
    maxConcurrent: 3,
    processingTimeout: 300000,  // 5 minutes
    maxRetries: 2
  });
  messageQueue.start();
  logger.info('Message queue initialized');

  // Start task scheduler
  startSchedulerLoop({
    sendMessage: (chatId, text) => sendMessage(chatId, text),
    registeredGroups: () => registeredGroups,
    getSessions: () => sessions
  });

  // Start IPC watcher
  startIpcWatcher();

  // Start all message clients
  clientManager.start(handleIncomingMessage);

  // Display startup info
  const platformsDisplay = enabledPlatforms.map(p => clientManager.getPlatformDisplayName(p)).join(', ');
  console.log(`
╔════════════════════════════════════════════════════════════════╗
║  FlashClaw Started                                             ║
╠════════════════════════════════════════════════════════════════╣
║                                                                ║
║  Enabled Platforms: ${platformsDisplay.padEnd(42)}║
║  Agent Mode: Direct (Claude Agent SDK)                         ║
║                                                                ║
║  All platforms use WebSocket/long connection                   ║
║  No public server / domain / ngrok needed!                     ║
║                                                                ║
╚════════════════════════════════════════════════════════════════╝
`);

  logger.info({ 
    mode: 'direct',
    platforms: enabledPlatforms 
  }, 'FlashClaw started');
}

main().catch(err => {
  logger.error({ err }, 'Failed to start FlashClaw');
  process.exit(1);
});

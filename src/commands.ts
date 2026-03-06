/**
 * Chat Commands Module
 * 
 * 处理用户在聊天中发送的斜杠命令
 * 如 /status, /new, /help 等
 */

import pino from 'pino';
import { listSouls, useSoul, resetSoul, getSoulSummary } from './soul-manager.js';

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: { target: 'pino-pretty', options: { colorize: true } }
});

/**
 * 命令执行上下文
 */
export interface CommandContext {
  chatId: string;
  userId: string;
  userName: string;
  platform: string;
  /** 群组文件夹名（用于 /soul 等需要群组上下文的命令） */
  groupFolder?: string;
  /** 获取会话统计 */
  getSessionStats?: () => SessionStats | null;
  /** 重置会话 */
  resetSession?: () => void;
  /** 压缩会话（返回 Promise，压缩完成后回调） */
  compactSession?: () => Promise<string | null>;
  /** 获取任务列表 */
  getTasks?: () => TaskInfo[];
}

export interface SessionStats {
  messageCount: number;
  tokenCount?: number;
  maxTokens?: number;
  model?: string;
  startedAt?: string;
}

export interface TaskInfo {
  id: string;
  prompt: string;
  scheduleType: string;
  nextRun?: string;
  status: string;
}

/**
 * 命令执行结果
 */
export interface CommandResult {
  /** 是否是命令（用于判断是否需要继续处理为普通消息） */
  isCommand: boolean;
  /** 返回给用户的消息 */
  response?: string;
  /** 是否需要发送响应 */
  shouldRespond?: boolean;
}

/**
 * 检查消息是否是命令
 */
export function isCommand(content: string): boolean {
  return content.trim().startsWith('/');
}

/**
 * 解析命令
 */
function parseCommand(content: string): { command: string; args: string[] } {
  const trimmed = content.trim();
  const parts = trimmed.slice(1).split(/\s+/);
  return {
    command: parts[0]?.toLowerCase() || '',
    args: parts.slice(1)
  };
}

/**
 * 处理命令
 */
export function handleCommand(content: string, context: CommandContext): CommandResult {
  if (!isCommand(content)) {
    return { isCommand: false };
  }

  const { command, args } = parseCommand(content);
  logger.info({ command, args, chatId: context.chatId }, '⚡ 收到命令');

  switch (command) {
    case 'help':
    case 'h':
    case '帮助':
      return handleHelp();

    case 'status':
    case 's':
    case '状态':
      return handleStatus(context);

    case 'new':
    case 'reset':
    case '重置':
      return handleReset(context);

    case 'tasks':
    case '任务':
      return handleTasks(context);

    case 'ping':
      return handlePing();

    case 'compact':
    case '压缩':
      return handleCompact(context, args);

    case 'soul':
    case '人格':
      return handleSoul(context, args);

    default:
      return {
        isCommand: true,
        shouldRespond: true,
        response: `❌ 未知命令: /${command}\n\n使用 /help 查看可用命令`
      };
  }
}

/**
 * /help - 显示帮助
 */
function handleHelp(): CommandResult {
  const helpText = `⚡ **FlashClaw 命令**

📋 **基础命令**
\`/help\` - 显示此帮助
\`/status\` - 查看会话状态
\`/new\` - 重置当前会话
\`/compact\` - 压缩会话上下文
\`/soul\` - 查看/切换人格
\`/tasks\` - 查看定时任务
\`/ping\` - 测试机器人响应

💡 **提示**
• 私聊直接发消息即可对话
• 群聊需要 @机器人 触发响应
• 使用 "记住..." 保存长期记忆
• 上下文达到 70% 时会自动提示压缩`;

  return {
    isCommand: true,
    shouldRespond: true,
    response: helpText
  };
}

/**
 * 简单哈希函数，用于脱敏显示
 */
function hashId(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    const char = id.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16).slice(0, 8);
}

/**
 * /status - 显示会话状态
 */
function handleStatus(context: CommandContext): CommandResult {
  const stats = context.getSessionStats?.();
  
  // 脱敏处理：用户 ID 和会话 ID 都用哈希显示
  const maskedChatId = hashId(context.chatId);
  const maskedUserId = hashId(context.userId);
  
  // 如果用户名看起来像 ID（ou_ 开头或很长的字符串），则使用脱敏后的 ID
  const displayName = (context.userName && 
    !context.userName.startsWith('ou_') && 
    context.userName.length < 20) 
    ? context.userName 
    : `用户#${maskedUserId}`;
  
  let statusText = `⚡ **会话状态**\n\n`;
  statusText += `📍 **会话**: \`#${maskedChatId}\`\n`;
  statusText += `👤 **用户**: ${displayName}\n`;
  statusText += `📱 **平台**: ${context.platform}\n`;
  
  if (stats) {
    statusText += `\n📊 **统计**\n`;
    statusText += `• 消息数: ${stats.messageCount}\n`;
    if (stats.tokenCount !== undefined && stats.tokenCount > 0) {
      const usagePercent = stats.maxTokens 
        ? Math.round((stats.tokenCount / stats.maxTokens) * 100) 
        : 0;
      statusText += `• Token: ${stats.tokenCount.toLocaleString()}`;
      if (stats.maxTokens) {
        statusText += ` / ${stats.maxTokens.toLocaleString()} (${usagePercent}%)`;
      }
      statusText += `\n`;
    } else {
      statusText += `• Token: _统计中..._\n`;
    }
    if (stats.model) {
      statusText += `• 模型: ${stats.model}\n`;
    }
    if (stats.startedAt) {
      statusText += `• 开始于: ${new Date(stats.startedAt).toLocaleString('zh-CN')}\n`;
    }
  } else {
    statusText += `\n_会话统计暂不可用_`;
  }

  return {
    isCommand: true,
    shouldRespond: true,
    response: statusText
  };
}

/**
 * /new - 重置会话
 */
function handleReset(context: CommandContext): CommandResult {
  if (context.resetSession) {
    context.resetSession();
    logger.info({ chatId: context.chatId }, '⚡ 会话已重置');
    return {
      isCommand: true,
      shouldRespond: true,
      response: `✅ **会话已重置**\n\n新的对话已开始，之前的上下文已清除。`
    };
  }

  return {
    isCommand: true,
    shouldRespond: true,
    response: `⚠️ 会话重置功能暂不可用`
  };
}

/**
 * /tasks - 显示定时任务
 */
function handleTasks(context: CommandContext): CommandResult {
  const tasks = context.getTasks?.() || [];
  
  if (tasks.length === 0) {
    return {
      isCommand: true,
      shouldRespond: true,
      response: `📋 **定时任务**\n\n_当前没有定时任务_\n\n使用自然语言创建任务，如：\n"每天早上9点提醒我喝水"`
    };
  }

  let tasksText = `📋 **定时任务** (${tasks.length}个)\n\n`;
  
  for (const task of tasks) {
    const statusIcon = task.status === 'active' ? '🟢' : 
                       task.status === 'paused' ? '⏸️' : 
                       task.status === 'failed' ? '❌' : '⚪';
    tasksText += `${statusIcon} **${task.id.slice(-6)}**\n`;
    tasksText += `   ${task.prompt.slice(0, 50)}${task.prompt.length > 50 ? '...' : ''}\n`;
    if (task.nextRun) {
      tasksText += `   ⏰ 下次: ${new Date(task.nextRun).toLocaleString('zh-CN')}\n`;
    }
    tasksText += `\n`;
  }

  return {
    isCommand: true,
    shouldRespond: true,
    response: tasksText
  };
}

/**
 * /ping - 测试响应
 */
function handlePing(): CommandResult {
  return {
    isCommand: true,
    shouldRespond: true,
    response: `🏓 Pong! FlashClaw 运行正常`
  };
}

/**
 * /soul - 人格管理
 */
function handleSoul(context: CommandContext, args: string[]): CommandResult {
  const subCommand = args[0]?.toLowerCase() || 'show';
  const groupFolder = context.groupFolder;

  if (!groupFolder) {
    return {
      isCommand: true,
      shouldRespond: true,
      response: `⚠️ 人格命令需要在会话中使用`
    };
  }

  switch (subCommand) {
    case 'list':
    case 'ls': {
      const souls = listSouls();
      if (souls.length === 0) {
        return {
          isCommand: true,
          shouldRespond: true,
          response: `🎭 **可用人格**\n\n_暂无预置人格，请在 ~/.flashclaw/souls/ 中添加 .md 文件_`
        };
      }
      let text = `🎭 **可用人格** (${souls.length}个)\n\n`;
      for (const soul of souls) {
        const builtinTag = soul.isBuiltin ? ' 📦' : '';
        text += `• **${soul.name}** — ${soul.title}${builtinTag}\n`;
      }
      text += `\n使用 \`/soul use <name>\` 切换人格`;
      return { isCommand: true, shouldRespond: true, response: text };
    }

    case 'use':
    case 'switch': {
      const soulName = args[1];
      if (!soulName) {
        return {
          isCommand: true,
          shouldRespond: true,
          response: `⚠️ 请指定人格名称\n\n使用 \`/soul list\` 查看可用人格`
        };
      }
      const success = useSoul(groupFolder, soulName);
      if (success) {
        return {
          isCommand: true,
          shouldRespond: true,
          response: `✅ **人格已切换为 "${soulName}"**\n\n新人格将从下一条消息开始生效。`
        };
      }
      return {
        isCommand: true,
        shouldRespond: true,
        response: `❌ 未找到人格 "${soulName}"\n\n使用 \`/soul list\` 查看可用人格`
      };
    }

    case 'reset': {
      resetSoul(groupFolder);
      return {
        isCommand: true,
        shouldRespond: true,
        response: `✅ **会话人格已重置**\n\n已恢复为全局人格设定。`
      };
    }

    case 'show':
    default: {
      const summary = getSoulSummary(groupFolder);
      return {
        isCommand: true,
        shouldRespond: true,
        response: `🎭 **当前人格**\n\n${summary}`
      };
    }
  }
}

/**
 * /compact - 压缩会话上下文
 * /compact fast - 规则摘要模式（不调用 AI，适合小模型）
 */
function handleCompact(context: CommandContext, args: string[]): CommandResult {
  if (!context.compactSession) {
    return {
      isCommand: true,
      shouldRespond: true,
      response: `⚠️ 会话压缩功能暂不可用`
    };
  }

  const isFastMode = args.length > 0 && ['fast', 'quick', 'rule', '快速'].includes(args[0].toLowerCase());

  if (isFastMode) {
    return {
      isCommand: true,
      shouldRespond: true,
      response: `⏳ **快速压缩中...**（规则模式，不调用 AI）`
    };
  }

  return {
    isCommand: true,
    shouldRespond: true,
    response: `⏳ **正在压缩会话...**\n\n这可能需要几秒钟，压缩完成后会通知你。`
  };
}

/**
 * 检查是否需要提示用户压缩会话
 * @param tokenCount 当前 token 数
 * @param maxTokens 最大 token 数
 * @param threshold 阈值（默认 0.7 = 70%）
 */
export function shouldSuggestCompact(
  tokenCount: number,
  maxTokens: number,
  threshold: number = 0.7
): boolean {
  if (!tokenCount || !maxTokens) return false;
  return tokenCount / maxTokens >= threshold;
}

/**
 * 生成压缩提示消息
 */
export function getCompactSuggestion(tokenCount: number, maxTokens: number): string {
  const percentage = Math.round((tokenCount / maxTokens) * 100);
  return `⚠️ **上下文使用率 ${percentage}%**\n\n` +
    `当前会话已使用 ${tokenCount.toLocaleString()} / ${maxTokens.toLocaleString()} tokens。\n\n` +
    `建议操作：\n` +
    `• 发送 \`/compact\` 压缩上下文（保留摘要）\n` +
    `• 发送 \`/new\` 重置会话（清除所有）`;
}

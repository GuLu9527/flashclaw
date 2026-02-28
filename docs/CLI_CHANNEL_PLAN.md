# CLI 渠道插件实施文档

> 创建日期: 2026-02-27
> 状态: 已实现 (整合到 src/cli.ts)
> 版本: v1.0.0

---

## 1. 项目概述

### 1.1 目标

为 FlashClaw 添加内置 CLI 终端渠道，确保：
- 默认安装后用户可以直接进行对话
- 无需配置第三方渠道（飞书/Telegram）
- 提供开发调试能力

### 1.2 背景

- 飞书插件已移至 `community-plugins/`，默认安装没有可用渠道
- 需要一种默认的交互方式
- CLI 作为 fallback 和开发调试工具

### 1.3 架构定位

```
FlashClaw 插件架构

┌─────────────────────────────────────────────┐
│           CLI 渠道 (内置 fallback)          │
├─────────────────────────────────────────────┤
│         社区插件 (可选)                       │
│    feishu | telegram | browser-control...    │
├─────────────────────────────────────────────┤
│      内置工具插件 (核心能力)                   │
│   schedule-task | memory | send-message...   │
└─────────────────────────────────────────────┘
```

---

## 2. 功能需求

### 2.1 使用场景

| 场景 | 描述 |
|------|------|
| 默认交互 | 首次安装，无渠道配置时直接可用 |
| 开发调试 | 开发时快速测试 prompt 和工具 |
| CLI 用户 | 偏好终端操作的用户 |
| 管道输入 | 配合 shell 脚本使用 |

### 2.2 启动方式

```bash
# 交互式 REPL（默认）
flashclaw repl
flashclaw repl --group <group-folder>

# 管道输入模式
echo "你好" | flashclaw repl

# 单次问答（非交互）
flashclaw repl --ask "你好" --group my-group

# 哑终端模式（无彩色输出，适合脚本）
flashclaw repl --batch
```

### 2.3 REPL 内置命令

| 命令 | 简写 | 说明 |
|------|------|------|
| `/new` | `/n` | 新建会话（清除上下文） |
| `/compact` | `/c` | 压缩上下文 |
| `/status` | `/s` | 查看状态（Token、模型等） |
| `/history [n]` | `/h [n]` | 查看最近 n 条消息 |
| `/quit` | `/q` | 退出程序 |
| `/clear` | | 清除终端显示 |
| `/help` | `/?` | 显示帮助 |

### 2.4 输出效果

```bash
⚡ FlashClaw CLI v1.5.0
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
输入 /help 查看可用命令

> 你好，帮我查一下今天天气

🤖 (正在思考... )
今天天气晴朗，气温20-28°C，适合外出。

> 帮我设置一个明天上午9点的会议提醒
✅ 已创建定时任务：明天上午9点会议提醒

> /status
┌─────────────────────────────────────┐
│ 当前模型: claude-sonnet-4-20250514  │
│ 使用 Token: 1,234 / 100,000         │
│ 消息数: 5                           │
│ 群组: default                       │
└──────────────────────────────────────┘
```

---

## 3. 技术方案

### 3.1 文件结构

```
src/cli.ts             # CLI 命令入口 + REPL 实现
```

> 注意：CLI REPL 已整合到 `src/cli.ts` 中，作为 FlashClaw CLI 命令的一部分。
> 不再使用独立的 plugins/cli/ 插件方式。

### 3.2 核心接口

```typescript
// ==================== 类型定义 ====================

/**
 * CLI 渠道选项
 */
export interface CLIChannelOptions {
  /** 群组文件夹名称 */
  group?: string;
  /** 是否启用流式输出 */
  streaming?: boolean;
  /** 是否哑终端模式（无彩色） */
  batch?: boolean;
}

/**
 * CLI 消息
 */
export interface CLIMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

/**
 * CLI 状态
 */
export interface CLIState {
  group: string;
  model: string;
  messageCount: number;
  inputTokens: number;
  outputTokens: number;
}
```

### 3.3 插件结构

```typescript
import type { ChannelPlugin, MessageHandler } from '../../src/plugins/types.js';

const plugin: ChannelPlugin = {
  name: 'cli',
  version: '1.0.0',
  description: '终端交互渠道 - REPL 模式对话',

  async init(config?: CLIChannelOptions) {
    this.config = config ?? {};
  },

  onMessage(handler: MessageHandler) {
    // CLI 是主动模式，不需要接收外部消息
    // 但保留接口兼容
  },

  async start() {
    // 启动 REPL
    await this.startRepl();
  },

  async stop() {
    // 清理资源
    this.rl?.close();
  },

  async sendMessage(chatId: string, content: string) {
    // 输出消息到终端
    this.writer.print(content);
  }
};

export default plugin;
```

### 3.4 REPL 流程图

```
┌──────────────────────────────────────────────────────────┐
│                      CLI REPL 主流程                       │
└──────────────────────────────────────────────────────────┘

  1. 初始化
     │
     ▼
  2. 创建 readline 接口
     │
     ▼
  3. 打印欢迎信息
     │
     ▼
  ┌───────────────────────────────────────┐
  │           REPL 循环                    │
  │ 4. 等待用户输入                        │
  │    │                                  │
  │    ▼                                  │
  │ 5. 解析命令 (/new, /status, /quit)   │
  │    │                                  │
  │    ├── 命令 ──► 执行内置功能            │
  │    │       │                          │
  │    │       ▼                          │
  │    │    返回 REPL 循环                 │
  │    │                                  │
  │    └── 消息 ──► 调用 Agent            │
  │        │                              │
  │        ▼                              │
  │    流式响应处理                        │
  │        │                              │
  │        ▼                              │
  │    工具调用处理                        │
  │        │                              │
  │        ▼                              │
  │    显示最终回复                        │
  │        │                              │
  │        ▼                              │
  └───────返回 REPL 循环                   │
           │
           ▼
  6. 用户退出 (/quit, Ctrl+C)
           │
           ▼
  7. 清理资源，退出程序
```

### 3.5 核心实现

#### 3.5.1 REPL 主循环

```typescript
// plugins/cli/repl.ts

import readline from 'readline';
import { runAgent, AgentInput } from '../../src/agent-runner.js';

export class REPL {
  private rl: readline.Interface;
  private group: string;
  private batch: boolean;

  constructor(options: CLIChannelOptions) {
    this.group = options.group ?? 'default';
    this.batch = options.batch ?? false;

    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: !this.batch,
      prompt: '> '
    });
  }

  async start(): Promise<void> {
    this.printWelcome();

    // 设置 Ctrl+C 处理
    process.on('SIGINT', () => this.handleInterrupt());

    // 开始 REPL 循环
    for await (const line of this.rl) {
      await this.handleInput(line.trim());
    }
  }

  private async handleInput(input: string): Promise<void> {
    if (!input) return;

    // 检查内置命令
    if (input.startsWith('/')) {
      await this.handleCommand(input);
      return;
    }

    // 调用 Agent
    await this.callAgent(input);
  }

  private async callAgent(prompt: string): Promise<void> {
    const input: AgentInput = {
      prompt,
      groupFolder: this.group,
      chatJid: 'cli-session',
      isMain: true,
    };

    // 流式调用
    const result = await runAgent(group, input);

    if (result.status === 'success') {
      console.log('\n🤖 ' + result.result);
    } else {
      console.error('\n❌ 错误:', result.error);
    }
  }
}
```

#### 3.5.2 命令解析

```typescript
// plugins/cli/commands.ts

interface CLICommand {
  name: string;
  aliases: string[];
  description: string;
  execute: (args: string) => Promise<void> | void;
}

const commands: CLICommand[] = [
  {
    name: 'new',
    aliases: ['n'],
    description: '新建会话',
    execute: async () => {
      // 清除当前上下文
      memoryManager.clearContext(group);
      console.log('✅ 已新建会话');
    }
  },
  {
    name: 'compact',
    aliases: ['c'],
    description: '压缩上下文',
    execute: async () => {
      // 调用压缩
      await memoryManager.compact(group, apiClient);
      console.log('✅ 上下文已压缩');
    }
  },
  {
    name: 'status',
    aliases: ['s'],
    description: '查看状态',
    execute: async () => {
      const stats = getSessionStats(group);
      console.table(stats);
    }
  },
  {
    name: 'quit',
    aliases: ['q', 'exit'],
    description: '退出',
    execute: () => {
      process.exit(0);
    }
  }
];

export function parseCommand(input: string): { cmd: string; args: string } | null {
  if (!input.startsWith('/')) return null;

  const parts = input.slice(1).split(/\s+/);
  return { cmd: parts[0], args: parts.slice(1).join(' ') };
}
```

---

## 4. 与现有系统集成

### 4.1 复用 agent-runner

CLI 渠道直接调用现有的 `agent-runner`：

```typescript
import { runAgent, getMemoryManager } from '../../src/agent-runner.js';
import { getApiClient } from '../../src/core/api-client.js';

// 获取必要组件
const apiClient = getApiClient();
const memoryManager = getMemoryManager();

// 构建 Agent 输入
const input = {
  prompt: userInput,
  groupFolder: this.group,
  chatJid: 'cli-session',
  isMain: true,
};

// 调用
const result = await runAgent(group, input);
```

### 4.2 群组管理

CLI 使用虚拟群组：

| 群组 | 说明 |
|------|------|
| `default` | 默认会话 |
| 用户指定 | `flashclaw repl --group my-project` |

CLI 不需要注册到数据库，作为纯内存会话。

---

## 5. CLI 命令注册

### 5.1 命令入口

在 `src/commands/` 中添加：

```typescript
// src/commands/repl.ts

import { Command } from 'commander';
import { CLIChannel } from '../plugins/cli/index.js';

export const replCommand = new Command('repl')
  .description('启动交互式终端对话')
  .option('-g, --group <name>', '指定群组文件夹')
  .option('-a, --ask <text>', '单次问答模式')
  .option('-b, --batch', '哑终端模式（无彩色输出）')
  .action(async (options) => {
    const cli = new CLIChannel({
      group: options.group,
      batch: options.batch,
    });

    if (options.ask) {
      // 单次问答模式
      await cli.ask(options.ask);
    } else {
      // REPL 模式
      await cli.startRepl();
    }
  });
```

### 5.2 注册到 CLI

```typescript
// src/commands.ts

import { replCommand } from './commands/repl.js';

export function registerCommands(program: Command) {
  // ... 其他命令
  program.addCommand(replCommand);
}
```

---

## 6. 测试计划

### 6.1 单元测试

| 测试项 | 描述 |
|--------|------|
| 命令解析 | `/new`, `/status`, `/quit` 等 |
| 输入验证 | 空输入、超长输入 |
| 状态管理 | 群组切换、Token 计数 |

### 6.2 集成测试

| 测试项 | 描述 |
|--------|------|
| Agent 对话 | 发送消息，获取回复 |
| 工具调用 | memory, schedule-task |
| 流式输出 | 实时显示响应 |

### 6.3 E2E 测试

| 测试项 | 描述 |
|--------|------|
| 完整会话 | 新建 → 对话 → 退出 |
| 管道输入 | `echo "hi" \| flashclaw repl` |

---

## 7. 依赖

### 7.1 Node.js 内置

| 模块 | 用途 |
|------|------|
| `readline` | 终端输入处理 |
| `process` | 信号处理、退出 |

### 7.2 项目内复用

| 模块 | 用途 |
|------|------|
| `agent-runner` | AI 对话 |
| `memory` | 上下文管理 |
| `api-client` | API 调用 |

### 7.3 可选增强

```bash
# 如需更好体验，可添加
npm install chalk     # 彩色输出
npm install inquirer  # 交互式选择
```

---

## 8. 实施步骤

### Phase 1: 基础骨架

- [ ] 创建 `plugins/cli/` 目录
- [ ] 创建 `plugin.json`
- [ ] 实现最小可运行版本

### Phase 2: REPL 核心

- [ ] 实现 REPL 循环
- [ ] 添加内置命令
- [ ] 流式输出支持

### Phase 3: 集成

- [ ] 集成 agent-runner
- [ ] 添加 CLI 命令
- [ ] 测试调试

### Phase 4: 完善

- [ ] 管道输入模式
- [ ] 单次问答模式
- [ ] 完善文档

---

## 9. 注意事项

### 9.1 终端兼容性

- 哑终端模式 (`--batch`) 不使用 ANSI 转义
- 支持基本 ANSI 颜色代码
- 处理终端宽度自适应

### 9.2 资源管理

- REPL 退出时清理 readline
- 处理 Ctrl+C 优雅退出
- 避免内存泄漏

### 9.3 错误处理

- API 错误提示
- 网络超时处理
- 工具调用失败处理

---

## 10. 后续扩展

### 优先级降低

- [ ] 历史记录（上下键导航）
- [ ] 自动补全（Tab 键）
- [ ] 配置文件 (`~/.flashclaw/cli.json`)
- [ ] 主题支持（深色/浅色）

### 可选功能

- [ ] 多语言支持
- [ ] 插件化命令（如接入外部工具）
- [ ] 会话保存/恢复

---

## 11. 成熟案例参考

### 11.1 项目内部参考

| 模块 | 位置 | 用途 |
|------|------|------|
| Agent 流式输出 | `src/agent-runner.ts` | 直接复用 `runAgent()` |
| 记忆系统 | `src/core/memory.ts` | 上下文管理 |
| 插件接口 | `src/plugins/types.ts` | 实现 `ChannelPlugin` |
| 飞书渠道 | `community-plugins/feishu/` | 渠道实现参考 |
| Telegram 渠道 | `community-plugins/telegram/` | 另一个渠道参考 |

### 11.2 飞书插件重点参考

飞书插件是最佳的内部参考，因为它已经实现了：

```typescript
// community-plugins/feishu/index.ts

// 1. 消息发送（复用）
async sendMessage(chatId: string, content: string): Promise<SendMessageResult> {
  // 发送富文本消息
}

// 2. 思考提示（可借鉴）
// 使用 setTimeout 显示 "正在思考..."

// 3. 流式输出（可借鉴）
// 打字机效果
```

### 11.3 外部参考项目

| 项目 | GitHub | 特点 |
|------|--------|------|
| **ChatGPT Desktop** | [lencx/ChatGPT](https://github.com/lencx/ChatGPT) | 跨平台桌面端 |
| **ChuanhuChatbot** | [GaiZhenbiao/ChuanhuChatbot](https://github.com/GaiZhenbiao/ChuanhuChatbot) | 中文友好，功能丰富 |
| **Chatbot UI** | [mckaywrigley/chatbot-ui](https://github.com/mckaywrigley/chatbot-ui) | 开源 UI 模板 |
| **Inquirer.js** | [SBoudrias/Inquirer.js](https://github.com/SBoudrias/Inquirer.js) | 交互式 CLI 组件 |
| **Chalk** | [chalk/chalk](https://github.com/chalk/chalk) | 终端彩色输出 |

### 11.4 Node.js 官方 API

| API | 用途 |
|-----|------|
| [readline](https://nodejs.org/api/readline.html) | 终端输入处理 |
| [readline.createInterface()](https://nodejs.org/api/readline.html#readlinecreateinterfaceoptions) | 创建 REPL |
| [process.stdin](https://nodejs.org/api/process.html#processstdin) | 标准输入 |
| [process.stdout](https://nodejs.org/api/process.html#processstdout) | 标准输出 |
| [readline.emitKeypressEvents()](https://nodejs.org/api/readline.html#readlineemitkeypresseventsstream-interface) | 键盘事件 |

---

## 附录

### A. 相关文件参考

| 文件 | 用途 |
|------|------|
| `src/agent-runner.ts` | Agent 运行器 |
| `src/plugins/types.ts` | 插件类型定义 |
| `community-plugins/feishu/` | 渠道参考 |
| `community-plugins/telegram/` | 另一个渠道参考 |

### B. 参考项目

- [Node.js REPL](https://nodejs.org/api/repl.html) - 内置 REPL 文档
- [Inquirer.js](https://github.com/SBoudrias/Inquirer.js) - 交互式 CLI
- [Chalk](https://github.com/chalk/chalk) - 终端彩色输出

### 11.5 最小实现示例

基于现有代码风格，CLI 渠道最小实现：

```typescript
// plugins/cli/index.ts

import readline from 'readline';
import { ChannelPlugin, MessageHandler, SendMessageResult } from '../../src/plugins/types.js';
import { runAgent } from '../../src/agent-runner.js';
import { getMemoryManager } from '../../src/core/memory.js';

const plugin: ChannelPlugin = {
  name: 'cli',
  version: '1.0.0',
  description: '终端交互渠道',

  onMessage(_handler: MessageHandler) {
    // CLI 主动模式，不需要接收外部消息
  },

  async start() {
    await this.startRepl();
  },

  async stop() {
    this.rl?.close();
  },

  async sendMessage(_chatId: string, content: string): Promise<SendMessageResult> {
    // 输出到终端
    console.log(content);
    return { success: true };
  },

  private async startRepl() {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: '> '
    });

    this.rl = rl;

    rl.prompt();

    rl.on('line', async (line) => {
      const input = line.trim();
      if (!input) {
        rl.prompt();
        return;
      }

      // 调用 Agent
      const result = await this.callAgent(input);

      if (result.success) {
        console.log('\n🤖 ' + result.result);
      } else {
        console.error('\n❌ ' + result.error);
      }

      rl.prompt();
    });
  },

  private async callAgent(prompt: string) {
    const memoryManager = getMemoryManager();
    const group = 'cli-default';

    // 复用 agent-runner
    const result = await runAgent(
      { name: group, folder: group, agentConfig: {} },
      { prompt, groupFolder: group, chatJid: 'cli', isMain: true }
    );

    return {
      success: result.status === 'success',
      result: result.result ?? '',
      error: result.error
    };
  }
};

export default plugin;
```

这个最小实现只有约 60 行代码，可以直接运行！

---

## 版本历史

| 版本 | 日期 | 变更 |
|------|------|------|
| v1.0.0 | 2026-02-27 | 初始版本 |

# FlashClaw

多平台个人 AI 助手。详见 [README.md](README.md) 了解理念和安装，详见 [docs/REQUIREMENTS.md](docs/REQUIREMENTS.md) 了解架构决策。

## 项目概述

单进程 Node.js 应用，连接多个消息平台（飞书、钉钉），将消息路由到 AI Agent。每个群组有独立的文件系统和记忆。AI Agent 直接在本机运行，拥有完整的文件和命令访问权限。

## 核心文件

| 文件 | 用途 |
|------|------|
| `src/index.ts` | 主程序：消息路由、IPC |
| `src/clients/index.ts` | ClientManager：管理所有平台客户端 |
| `src/clients/types.ts` | MessageClient 接口定义 |
| `src/clients/feishu.ts` | 飞书客户端（WebSocket） |
| `src/clients/dingtalk.ts` | 钉钉客户端（Stream API） |
| `src/config.ts` | 平台检测、路径配置 |
| `src/agent-runner.ts` | AI Agent 运行器 |
| `src/task-scheduler.ts` | 定时任务调度 |
| `src/db.ts` | SQLite 数据库操作 |
| `groups/{name}/CLAUDE.md` | 各群组的记忆文件（隔离） |

## 配置

环境变量（在 `.env` 文件中设置）：

| 变量 | 说明 |
|------|------|
| `FEISHU_APP_ID` | 飞书应用 ID（如果用钉钉可不填） |
| `FEISHU_APP_SECRET` | 飞书应用密钥 |
| `DINGTALK_APP_KEY` | 钉钉应用 Key（如果用飞书可不填） |
| `DINGTALK_APP_SECRET` | 钉钉应用密钥 |
| `BOT_NAME` | 机器人显示名称（默认：FlashClaw） |

**注意**：所有平台都使用 WebSocket/长连接，无需公网服务器！

## 技能

| 技能 | 使用场景 |
|------|----------|
| `/setup` | 首次安装、平台配置、服务启动 |
| `/customize` | 添加集成、修改行为、**添加新消息平台** |
| `/debug` | 日志查看、故障排查 |
| `/rebuild` | 重建 MCP 工具、主程序 |
| `/add-dingtalk` | 添加钉钉平台支持 |

## 开发命令

直接执行命令，不要让用户自己执行。

```bash
npm run dev          # 开发模式运行（热重载）
npm run build        # 编译 TypeScript
```

后台运行（使用 PM2）：

```bash
npm install -g pm2
pm2 start dist/index.js --name flashclaw
pm2 logs flashclaw
pm2 stop flashclaw
```

## 添加新消息平台

这是核心扩展点。所有平台都需要实现 `MessageClient` 接口。

### 步骤 1：创建客户端文件

创建 `src/clients/{platform}.ts`，实现 `MessageClient` 接口：

```typescript
import { MessageClient, Message, MessageHandler } from './types.js';

export class {Platform}Client implements MessageClient {
  readonly platform = '{platform}';
  readonly displayName = '平台名称';

  start(handler: MessageHandler): void { /* 启动消息监听 */ }
  stop(): void { /* 停止 */ }
  async sendTextMessage(chatId: string, text: string): Promise<void> { /* 发送消息 */ }
  shouldRespondInGroup(message: Message): boolean { /* 群聊触发判断 */ }
  isBotMentioned(message: Message): boolean { /* @提及检测 */ }
}

export function create{Platform}Client(): {Platform}Client | null {
  const key = process.env.{PLATFORM}_API_KEY;
  if (!key) return null;
  return new {Platform}Client({ key });
}
```

### 步骤 2：注册到 ClientManager

编辑 `src/clients/index.ts`：

```typescript
// 添加导入
import { create{Platform}Client } from './{platform}.js';

// 在 initialize() 中添加
const client = create{Platform}Client();
if (client) {
  this.clients.push(client);
  logger.info({ platform: '{platform}' }, '客户端已初始化');
}

// 在 getClientForChat() 中添加 chatId 格式识别
if (chatId.startsWith('{prefix}')) {
  return this.clients.find(c => c.platform === '{platform}') || null;
}
```

### 步骤 3：更新配置

在 `.env.example` 中添加：
```bash
# {PLATFORM}_API_KEY=xxxxx
```

### 步骤 4：创建技能（可选）

创建 `.claude/skills/add-{platform}/SKILL.md` 提供配置指南。

## 代码规范

### 文件组织
```
src/
├── index.ts           # 主入口（< 200 行）
├── config.ts          # 配置常量
├── types.ts           # 类型定义
├── clients/           # 消息平台客户端
│   ├── index.ts       # ClientManager
│   ├── types.ts       # MessageClient 接口
│   ├── feishu.ts      # 飞书实现
│   └── dingtalk.ts    # 钉钉实现
├── agent-runner.ts    # AI Agent 运行器
├── task-scheduler.ts
└── db.ts
```

### 命名规范
| 类型 | 规范 | 示例 |
|------|------|------|
| 文件名 | kebab-case | `agent-runner.ts` |
| 类名 | PascalCase | `FeishuClient` |
| 函数名 | camelCase | `createClient()` |
| 常量 | UPPER_SNAKE | `BOT_NAME` |
| 接口 | PascalCase | `MessageClient` |

### 设计原则
- 保持单进程架构
- 每个模块一个文件（< 500 行）
- 避免过度抽象
- 配置通过环境变量，不要配置文件地狱

## 平台支持

| 平台 | 备注 |
|------|------|
| Windows | 原生运行 |
| Linux | 原生运行 |
| macOS | 原生运行 |

## 消息平台

| 平台 | 状态 | 聊天 ID 格式 |
|------|------|-------------|
| 飞书 | 已支持 | `oc_xxx`, `ou_xxx` |
| 钉钉 | 已支持 | `cidxxx`, 纯数字 |
| Telegram | 计划中 | - |
| Slack | 计划中 | - |

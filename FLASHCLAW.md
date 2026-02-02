# FlashClaw 开发指南

> ⚡ 闪电龙虾 - 快如闪电的 AI 助手

## 核心理念

- **乐高式架构** - 一切皆插件，可自由拼装
- **热加载** - 运行时加载/卸载插件，无需重启
- **极简核心** - 核心引擎保持精简
- **快速响应** - 直接 API 调用，2-5 秒响应

## 项目结构

```
flashclaw/
├── src/
│   ├── index.ts           # 主入口、消息路由
│   ├── cli.ts             # CLI 命令行工具
│   ├── agent-runner.ts    # AI Agent 运行器
│   ├── config.ts          # 配置常量
│   ├── types.ts           # 核心类型定义
│   ├── db.ts              # SQLite 数据库
│   ├── message-queue.ts   # 消息队列
│   ├── task-scheduler.ts  # 定时任务调度
│   ├── utils.ts           # 工具函数
│   │
│   ├── core/              # 核心模块
│   │   ├── api-client.ts  # AI API 客户端
│   │   ├── memory.ts      # 记忆管理
│   │   └── model-capabilities.ts  # 模型能力检测
│   │
│   └── plugins/           # 插件系统
│       ├── index.ts       # 插件系统入口
│       ├── manager.ts     # 插件管理器
│       ├── loader.ts      # 插件加载器
│       └── types.ts       # 插件类型定义
│
├── plugins/               # 插件目录（热加载）
│   ├── feishu/           # 飞书渠道插件
│   ├── dingtalk/         # 钉钉渠道插件
│   ├── send-message/     # 发送消息工具
│   ├── schedule-task/    # 创建定时任务
│   ├── list-tasks/       # 列出定时任务
│   └── cancel-task/      # 取消定时任务
│
├── groups/                # 群组记忆
├── data/                  # 运行时数据
└── store/                 # 持久化存储
```

---

## 插件开发

### 创建新插件

1. 在 `plugins/` 目录创建文件夹
2. 添加 `plugin.json` 清单文件
3. 添加 `index.ts` 入口文件
4. 运行 `flashclaw plugins reload` 或重启服务

### plugin.json 格式

```json
{
  "name": "my-plugin",
  "version": "1.0.0",
  "type": "tool",
  "description": "插件描述",
  "main": "index.ts"
}
```

### 插件类型

| 类型 | 说明 | 生命周期 |
|------|------|----------|
| `channel` | 消息渠道插件 | init → start → onMessage → stop |
| `tool` | AI 工具插件 | 按需调用 execute |

---

## 工具插件开发

工具插件为 AI 提供额外能力，如发送消息、创建任务等。

### 基本结构

```typescript
// plugins/my-tool/index.ts
import { ToolPlugin, ToolContext } from '../../src/plugins/types.js';

const plugin: ToolPlugin = {
  name: 'my_tool',
  description: '我的工具描述',
  
  // Anthropic tool_use 格式的参数定义
  schema: {
    type: 'object',
    properties: {
      param1: {
        type: 'string',
        description: '参数1描述'
      },
      param2: {
        type: 'number',
        description: '参数2描述'
      }
    },
    required: ['param1']
  },
  
  // 工具执行逻辑
  async execute(params: Record<string, unknown>, context: ToolContext): Promise<string> {
    const { param1, param2 } = params;
    
    // 访问上下文
    const { chatId, groupFolder, isMain } = context;
    
    // 执行逻辑...
    
    return '执行结果';
  }
};

export default plugin;
```

### ToolContext 上下文

```typescript
interface ToolContext {
  chatId: string;        // 当前聊天 ID
  groupFolder: string;   // 群组文件夹名
  isMain: boolean;       // 是否主群组（有额外权限）
  sendMessage: (chatId: string, text: string) => Promise<void>;
}
```

### 示例：发送消息工具

```typescript
const plugin: ToolPlugin = {
  name: 'send_message',
  description: '发送消息到指定聊天',
  schema: {
    type: 'object',
    properties: {
      chat_id: { type: 'string', description: '目标聊天 ID' },
      text: { type: 'string', description: '消息内容' }
    },
    required: ['text']
  },
  
  async execute(params, context) {
    const chatId = params.chat_id as string || context.chatId;
    const text = params.text as string;
    
    // 非主群组只能发送到当前聊天
    if (!context.isMain && chatId !== context.chatId) {
      return '错误：只能发送到当前聊天';
    }
    
    await context.sendMessage(chatId, text);
    return `已发送消息到 ${chatId}`;
  }
};
```

---

## 渠道插件开发

渠道插件连接外部消息平台（飞书、钉钉等）。

### 基本结构

```typescript
// plugins/my-channel/index.ts
import { ChannelPlugin, Message, SendMessageResult } from '../../src/plugins/types.js';

const plugin: ChannelPlugin = {
  name: 'my_channel',
  platform: 'my-platform',
  
  // 初始化（连接配置等）
  async init(config: Record<string, string>): Promise<void> {
    // 从环境变量获取配置
    const apiKey = config.MY_API_KEY;
    if (!apiKey) {
      throw new Error('缺少 MY_API_KEY 配置');
    }
    // 初始化客户端...
  },
  
  // 启动消息监听
  async start(): Promise<void> {
    // 启动 WebSocket / 轮询等
  },
  
  // 停止
  async stop(): Promise<void> {
    // 断开连接
  },
  
  // 注册消息处理器
  onMessage(handler: (msg: Message) => void): void {
    this.messageHandler = handler;
  },
  
  // 发送消息
  async sendMessage(chatId: string, content: string): Promise<SendMessageResult> {
    // 调用平台 API 发送消息
    return { success: true, messageId: 'xxx' };
  },
  
  // 可选：更新消息
  async updateMessage(messageId: string, content: string): Promise<void> {
    // 更新已发送的消息
  },
  
  // 可选：删除消息
  async deleteMessage(messageId: string): Promise<void> {
    // 删除消息
  },
  
  // 可选：热重载
  async reload(): Promise<void> {
    await this.stop();
    await this.init(process.env as any);
    await this.start();
  }
};

export default plugin;
```

### Message 接口

```typescript
interface Message {
  id: string;                    // 消息唯一 ID
  chatId: string;                // 聊天 ID
  chatType: 'p2p' | 'group';     // 聊天类型
  senderId: string;              // 发送者 ID
  senderName: string;            // 发送者名称
  content: string;               // 消息内容
  timestamp: string;             // ISO 时间戳
  platform: string;              // 平台标识
  
  // 可选字段
  attachments?: Attachment[];    // 附件（图片、文件等）
  mentions?: string[];           // @提及的用户
  replyToMessageId?: string;     // 回复的消息 ID
  raw?: unknown;                 // 原始消息数据
}

interface Attachment {
  type: 'image' | 'video' | 'audio' | 'file';
  content?: string;              // Base64 内容
  mimeType?: string;             // MIME 类型
  fileName?: string;             // 文件名
  fileKey?: string;              // 平台文件 Key
}
```

### 群聊响应判断

渠道插件应实现 `shouldRespondInGroup` 方法来判断是否响应群聊消息：

```typescript
shouldRespondInGroup(msg: Message): boolean {
  // 检查是否 @机器人
  if (msg.mentions?.includes(this.botUserId)) {
    return true;
  }
  
  // 检查消息内容是否包含机器人名称
  const botName = process.env.BOT_NAME || 'FlashClaw';
  if (msg.content.includes(`@${botName}`)) {
    return true;
  }
  
  return false;
}
```

---

## 代码风格

- TypeScript 严格模式
- 单文件不超过 500 行
- 函数不超过 50 行
- 中文注释
- 保持简单，拒绝过度抽象

### 命名规范

| 类型 | 规范 | 示例 |
|------|------|------|
| 文件名 | kebab-case | `agent-runner.ts` |
| 类名 | PascalCase | `FeishuPlugin` |
| 函数名 | camelCase | `sendMessage()` |
| 常量 | UPPER_SNAKE | `BOT_NAME` |
| 接口 | PascalCase | `ToolPlugin` |
| 工具名 | snake_case | `send_message` |

---

## 命令参考

```bash
# 开发
npm run dev          # 开发模式（tsx 热重载）
npm run build        # 编译 TypeScript
npm run typecheck    # 类型检查

# CLI
flashclaw init          # 初始化配置
flashclaw start         # 启动服务
flashclaw start -d      # 后台启动
flashclaw stop          # 停止服务
flashclaw restart       # 重启服务
flashclaw status        # 查看状态
flashclaw plugins list  # 列出插件
flashclaw plugins reload # 热重载插件
flashclaw config list   # 列出配置
flashclaw logs          # 查看日志
flashclaw logs -f       # 实时日志
```

---

## 调试技巧

### 启用调试日志

```bash
LOG_LEVEL=debug npm run dev
```

### 查看实时日志

```bash
flashclaw logs -f
```

### 常见问题

| 问题 | 原因 | 解决方案 |
|------|------|----------|
| 插件加载失败 | 语法错误 | 检查 TypeScript 编译错误 |
| 消息无响应 | 未注册群组 | 发消息后会自动注册 |
| 图片不支持 | 模型限制 | 检查 AI_MODEL 是否支持图片 |
| 热重载无效 | 渠道插件 | 渠道插件会完整重启连接 |

# FlashClaw API 文档

本文档描述 FlashClaw 的内部 API 和扩展接口。

## 目录

- [消息客户端接口](#消息客户端接口)
- [Agent Runner API](#agent-runner-api)
- [数据库 API](#数据库-api)
- [IPC MCP 工具](#ipc-mcp-工具)
- [消息队列 API](#消息队列-api)

---

## 消息客户端接口

所有消息平台都需要实现 `MessageClient` 接口。

### MessageClient 接口

```typescript
// src/clients/types.ts

interface MessageClient {
  /** 平台标识符 (如 'feishu', 'dingtalk') */
  readonly platform: string;
  
  /** 平台显示名称 (如 '飞书', '钉钉') */
  readonly displayName: string;
  
  /** 启动消息监听 */
  start(handler: MessageHandler): void;
  
  /** 停止消息监听 */
  stop(): void;
  
  /** 发送文本消息 */
  sendTextMessage(chatId: string, text: string): Promise<void>;
  
  /** 判断群聊中是否应该响应 (如 @提及检测) */
  shouldRespondInGroup(message: Message): boolean;
  
  /** 检测是否 @机器人 */
  isBotMentioned(message: Message): boolean;
}
```

### Message 类型

```typescript
interface Message {
  id: string;           // 消息唯一 ID
  chatId: string;       // 聊天 ID
  chatType: 'p2p' | 'group';  // 聊天类型
  senderId: string;     // 发送者 ID
  senderName: string;   // 发送者名称
  content: string;      // 消息内容
  timestamp: string;    // ISO 时间戳
  platform: string;     // 平台标识
  raw?: unknown;        // 原始消息数据
}
```

### 添加新平台

1. 创建 `src/clients/{platform}.ts`
2. 实现 `MessageClient` 接口
3. 导出 `create{Platform}Client()` 工厂函数
4. 在 `src/clients/index.ts` 中注册

---

## Agent Runner API

Agent Runner 负责执行 AI Agent。

### runAgent 函数

```typescript
// src/agent-runner.ts

async function runAgent(
  group: RegisteredGroup,
  input: AgentInput,
  retryConfig?: RetryConfig
): Promise<AgentOutput>
```

#### AgentInput

```typescript
interface AgentInput {
  prompt: string;         // 用户消息/任务描述
  sessionId?: string;     // 会话 ID (用于上下文连续)
  groupFolder: string;    // 群组文件夹名
  chatJid: string;        // 聊天 ID
  isMain: boolean;        // 是否主群组
  isScheduledTask?: boolean;  // 是否定时任务
}
```

#### AgentOutput

```typescript
interface AgentOutput {
  status: 'success' | 'error';
  result: string | null;    // Agent 返回的结果
  newSessionId?: string;    // 新会话 ID
  error?: string;           // 错误信息
}
```

#### RetryConfig

```typescript
interface RetryConfig {
  maxRetries: number;       // 最大重试次数 (默认 3)
  baseDelayMs: number;      // 基础延迟 (默认 1000ms)
  maxDelayMs: number;       // 最大延迟 (默认 10000ms)
  retryableErrors: string[];  // 可重试的错误关键词
}
```

---

## 数据库 API

FlashClaw 使用 SQLite 存储消息和任务。

### 消息相关

```typescript
// 存储消息
storeMessage(msg: MessageInput): void

// 获取指定时间后的消息
getMessagesSince(chatJid: string, sinceTimestamp: string, botPrefix: string): NewMessage[]

// 获取聊天历史 (用于上下文)
getChatHistory(chatJid: string, limit?: number, beforeTimestamp?: string): NewMessage[]

// 检查消息是否存在 (去重)
messageExists(messageId: string, chatJid: string): boolean

// 获取消息统计
getMessageStats(chatJid: string): { totalMessages: number; firstMessage: string | null; lastMessage: string | null }
```

### 任务相关

```typescript
// 创建任务
createTask(task: Omit<ScheduledTask, 'last_run' | 'last_result'>): void

// 获取任务
getTask(taskId: string): ScheduledTask | null

// 获取所有任务
getAllTasks(): ScheduledTask[]

// 更新任务
updateTask(taskId: string, updates: Partial<ScheduledTask>): void

// 删除任务
deleteTask(taskId: string): void

// 获取待执行任务
getDueTasks(): ScheduledTask[]
```

---

## IPC MCP 工具

Agent 可以通过 MCP 工具与主进程通信。

### send_message

发送消息到当前聊天。

```typescript
mcp__flashclaw__send_message({
  text: string  // 要发送的消息
})
```

### schedule_task

创建定时任务。

```typescript
mcp__flashclaw__schedule_task({
  prompt: string,           // 任务描述
  schedule_type: 'cron' | 'interval' | 'once',
  schedule_value: string,   // cron 表达式 / 毫秒数 / 时间戳
  context_mode?: 'group' | 'isolated',  // 上下文模式
  target_group?: string     // 目标群组 (仅主群组可用)
})
```

### list_tasks

列出所有定时任务。

```typescript
mcp__flashclaw__list_tasks()
```

### pause_task / resume_task / cancel_task

管理任务状态。

```typescript
mcp__flashclaw__pause_task({ task_id: string })
mcp__flashclaw__resume_task({ task_id: string })
mcp__flashclaw__cancel_task({ task_id: string })
```

### register_group

注册新群组 (仅主群组可用)。

```typescript
mcp__flashclaw__register_group({
  jid: string,      // 聊天 ID
  name: string,     // 显示名称
  folder: string,   // 文件夹名
  trigger: string   // 触发词
})
```

---

## 消息队列 API

消息队列用于处理高并发消息。

### MessageQueue 类

```typescript
// src/message-queue.ts

class MessageQueue<T> {
  constructor(
    processor: (message: QueuedMessage<T>) => Promise<void>,
    config?: Partial<QueueConfig>
  )
  
  // 启动队列
  start(): void
  
  // 停止队列
  stop(): void
  
  // 添加消息到队列
  enqueue(chatId: string, messageId: string, data: T): Promise<boolean>
  
  // 获取统计信息
  getStats(): QueueStats
}
```

### QueueConfig

```typescript
interface QueueConfig {
  maxQueueSize: number;       // 每个聊天的最大队列长度 (默认 100)
  maxConcurrent: number;      // 最大并发处理数 (默认 5)
  processingTimeout: number;  // 处理超时时间 (默认 5 分钟)
  maxRetries: number;         // 最大重试次数 (默认 2)
}
```

### 特性

- **自动去重**：相同消息 ID 在 10 分钟内不会重复处理
- **队列隔离**：每个聊天有独立队列，互不影响
- **自动重试**：处理失败会自动重试
- **超时保护**：单条消息处理超时会被跳过

---

## 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `LOG_LEVEL` | 日志级别 | `info` |
| `BOT_NAME` | 机器人名称 | `FlashClaw` |
| `DATA_DIR` | 数据目录 | `./data` |
| `AGENT_TIMEOUT` | Agent 超时(ms) | `300000` |
| `FEISHU_APP_ID` | 飞书应用 ID | - |
| `FEISHU_APP_SECRET` | 飞书应用密钥 | - |
| `DINGTALK_APP_KEY` | 钉钉应用 Key | - |
| `DINGTALK_APP_SECRET` | 钉钉应用密钥 | - |

---

## 错误处理

### 可重试错误

以下错误会自动重试：
- `ECONNRESET` - 连接重置
- `ETIMEDOUT` - 连接超时
- `ECONNREFUSED` - 连接被拒绝
- `rate_limit` - 速率限制
- `overloaded` - 服务过载
- `503` / `502` / `529` - 服务不可用

### 重试策略

- 指数退避：每次重试延迟翻倍
- 随机抖动：避免重试风暴
- 最大 3 次重试
- 最大延迟 10 秒

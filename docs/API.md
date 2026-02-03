# FlashClaw API 文档

本文档描述 FlashClaw 的内部 API 和扩展接口。

## 目录

- [插件系统 API](#插件系统-api)
- [Agent Runner API](#agent-runner-api)
- [数据库 API](#数据库-api)
- [消息队列 API](#消息队列-api)
- [AI API 客户端](#ai-api-客户端)
- [模型能力检测](#模型能力检测)

---

## 插件系统 API

FlashClaw 使用乐高式插件架构，所有扩展通过插件实现。

### 插件类型

```typescript
// src/plugins/types.ts

type PluginType = 'channel' | 'tool';

interface PluginManifest {
  name: string;
  version: string;
  type: PluginType;
  description?: string;
  main: string;
}
```

### 工具插件接口

```typescript
interface ToolPlugin {
  name: string;
  description: string;
  
  // Anthropic tool_use 格式的参数定义
  schema: {
    type: 'object';
    properties: Record<string, {
      type: string;
      description: string;
      enum?: string[];
    }>;
    required?: string[];
  };
  
  // 执行函数
  execute(
    params: unknown,
    context: ToolContext
  ): Promise<ToolResult>;
}

interface ToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
  
  // 可选：热重载
  reload?(): Promise<void>;
}

interface ToolContext {
  chatId: string;        // 当前聊天 ID
  groupId: string;       // 群组文件夹名
  sendMessage: (content: string) => Promise<void>;  // 发送消息到当前聊天
}
```

### 渠道插件接口

```typescript
interface ChannelPlugin {
  name: string;
  platform: string;
  
  // 生命周期
  init(config: Record<string, string>): Promise<void>;
  start(): Promise<void>;
  stop(): Promise<void>;
  
  // 消息处理
  onMessage(handler: (msg: Message) => void): void;
  
  // 发送消息
  sendMessage(
    chatId: string,
    content: string,
    options?: SendMessageOptions
  ): Promise<SendMessageResult>;
  
  // 可选方法
  updateMessage?(messageId: string, content: string): Promise<void>;
  deleteMessage?(messageId: string): Promise<void>;
  sendImage?(chatId: string, imageData: string | Buffer, caption?: string): Promise<SendMessageResult>;
  sendFile?(chatId: string, filePath: string, fileName?: string): Promise<SendMessageResult>;
  shouldRespondInGroup?(msg: Message): boolean;
  reload?(): Promise<void>;
}

interface SendMessageOptions {
  placeholderMessageId?: string;
  attachments?: Attachment[];
}

interface SendMessageResult {
  messageId?: string;
  success: boolean;
  error?: string;
}
```

### Message 类型

```typescript
interface Message {
  id: string;
  chatId: string;
  chatType: 'p2p' | 'group';
  senderId: string;
  senderName: string;
  content: string;
  timestamp: string;
  platform: string;
  
  // 可选
  attachments?: Attachment[];
  mentions?: string[];
  replyToMessageId?: string;
  raw?: unknown;
}

interface Attachment {
  type: 'image' | 'video' | 'audio' | 'file';
  content?: string;       // Base64 内容
  mimeType?: string;
  fileName?: string;
  fileKey?: string;       // 平台文件 Key
}
```

### 插件管理器 API

```typescript
// src/plugins/manager.ts

class PluginManager {
  // 注册插件
  registerChannel(plugin: ChannelPlugin): void;
  registerTool(plugin: ToolPlugin): void;
  
  // 注销插件
  unregisterChannel(name: string): void;
  unregisterTool(name: string): void;
  
  // 获取插件
  getChannel(name: string): ChannelPlugin | undefined;
  getTool(name: string): ToolPlugin | undefined;
  getAllChannels(): ChannelPlugin[];
  getAllTools(): ToolPlugin[];
}
```

### 插件加载器 API

```typescript
// src/plugins/loader.ts

// 初始化插件系统
function initPlugins(): Promise<void>;

// 加载单个插件
function loadPlugin(pluginDir: string): Promise<void>;

// 重载插件
function reloadPlugin(name: string): Promise<boolean>;

// 监听插件变化（热加载）
function watchPlugins(
  pluginsDir: string,
  onChange?: (event: string, name: string) => void
): void;
```

---

## Agent Runner API

Agent Runner 负责执行 AI Agent。

### runAgent 函数

```typescript
// src/agent-runner.ts

async function runAgent(
  group: RegisteredGroup,
  input: AgentInput
): Promise<string | null>
```

#### AgentInput

```typescript
interface AgentInput {
  prompt: string;
  sessionId?: string;
  groupFolder: string;
  chatJid: string;
  isMain: boolean;
  attachments?: ImageAttachment[];
}

interface ImageAttachment {
  type: 'image';
  content: string;      // Base64 编码
  mimeType?: string;    // 如 'image/png'
}
```

### 工具上下文写入

```typescript
// 写入任务快照供 Agent 读取
function writeTasksSnapshot(
  groupFolder: string,
  isMain: boolean,
  tasks: TaskSnapshot[]
): void;

// 写入群组快照供 Agent 读取
function writeGroupsSnapshot(
  groupFolder: string,
  isMain: boolean,
  groups: AvailableGroup[],
  registeredIds: Set<string>
): void;
```

---

## 数据库 API

FlashClaw 使用 SQLite 存储消息和任务。

### 消息相关

```typescript
// src/db.ts

// 存储消息
function storeMessage(msg: MessageInput): void;

// 获取聊天历史
function getChatHistory(
  chatJid: string,
  limit?: number,
  beforeTimestamp?: string
): StoredMessage[];

// 检查消息是否存在（去重）
function messageExists(messageId: string, chatJid: string): boolean;

// 存储聊天元数据
function storeChatMetadata(chatJid: string, lastMessageTime: string): void;

// 获取所有聊天
function getAllChats(): ChatMetadata[];
```

### 任务相关

```typescript
// 创建任务
function createTask(task: Omit<ScheduledTask, 'last_run' | 'last_result'>): void;

// 获取任务
function getTaskById(taskId: string): ScheduledTask | null;

// 获取所有任务
function getAllTasks(): ScheduledTask[];

// 获取群组任务
function getTasksByGroup(groupFolder: string): ScheduledTask[];

// 获取待执行任务
function getDueTasks(): ScheduledTask[];

// 更新任务执行状态
function updateTaskAfterRun(taskId: string, result: string, nextRun: string | null): void;

// 记录任务运行
function logTaskRun(taskId: string, result: string, durationMs: number): void;

// 删除任务
function deleteTask(taskId: string): void;

// 暂停/恢复任务
function pauseTask(taskId: string): void;
function resumeTask(taskId: string): void;
```

### ScheduledTask 类型

```typescript
interface ScheduledTask {
  id: string;
  group_folder: string;
  chat_jid: string;
  prompt: string;
  schedule_type: 'cron' | 'interval' | 'once';
  schedule_value: string;
  context_mode: 'group' | 'isolated';
  status: 'active' | 'paused' | 'completed';
  next_run: string | null;        // ISO 时间戳
  last_run: string | null;
  last_result: string | null;
  created_at: string;
  
  // 重试和超时配置
  retry_count: number;            // 当前重试次数
  max_retries: number;            // 最大重试次数（默认 3）
  timeout_ms?: number;            // 任务执行超时时间（毫秒，默认 300000）
}
```

### 任务调度新增函数

```typescript
// 获取下一个将要执行的任务时间（用于精确定时器）
function getNextWakeTime(): number | null;

// 获取所有活跃任务
function getActiveTasks(): ScheduledTask[];

// 更新任务重试信息
function updateTaskRetry(taskId: string, retryCount: number, nextRun: string | null): void;

// 重置任务重试计数（成功执行后调用）
function resetTaskRetry(taskId: string): void;
```

---

## 任务调度器 API

任务调度器负责定时任务的执行，采用精确定时器机制。

### 调度器函数

```typescript
// src/task-scheduler.ts

// 启动调度器
function startScheduler(deps: SchedulerDependencies): void;

// 停止调度器
function stopScheduler(): void;

// 立即唤醒调度器（用于创建新任务后立即检查）
function wake(): void;

// 获取调度器状态
function getSchedulerStatus(): {
  running: boolean;
  nextWakeTime: number | null;
  activeTasks: number;
};

interface SchedulerDependencies {
  sendMessage: (jid: string, text: string) => Promise<void>;
  registeredGroups: () => Record<string, RegisteredGroup>;
  getSessions: () => Record<string, string>;
}
```

### 调度器特性

| 特性 | 说明 |
|------|------|
| **精确定时器** | 按需唤醒，而非固定轮询，计算精确的下次执行时间 |
| **并发控制** | 最多同时执行 3 个任务（可配置） |
| **超时保护** | 默认 5 分钟超时，防止任务卡死阻塞调度 |
| **自动重试** | 失败任务自动重试，使用指数退避策略 |

### 重试机制

```typescript
// 重试延迟计算（指数退避）
const retryDelay = Math.min(
  RETRY_BASE_DELAY_MS * Math.pow(2, retryCount - 1),  // 1分钟 * 2^n
  MAX_RETRY_DELAY_MS                                    // 最大 1 小时
);
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
  );
  
  // 启动队列
  start(): void;
  
  // 停止队列
  stop(): void;
  
  // 添加消息到队列
  enqueue(chatId: string, messageId: string, data: T): Promise<boolean>;
  
  // 获取统计信息
  getStats(): QueueStats;
}

interface QueueConfig {
  maxQueueSize: number;       // 每个聊天的最大队列长度 (默认 100)
  maxConcurrent: number;      // 最大并发处理数 (默认 5)
  processingTimeout: number;  // 处理超时时间 (默认 5 分钟)
  maxRetries: number;         // 最大重试次数 (默认 2)
}

interface QueuedMessage<T> {
  chatId: string;
  messageId: string;
  data: T;
  retryCount: number;
}
```

### 特性

- **自动去重**：相同消息 ID 在 10 分钟内不会重复处理
- **队列隔离**：每个聊天有独立队列，互不影响
- **自动重试**：处理失败会自动重试
- **超时保护**：单条消息处理超时会被跳过

---

## AI API 客户端

### ApiClient 类

```typescript
// src/core/api-client.ts

class ApiClient {
  constructor(config: ApiClientConfig);
  
  // 发送聊天请求
  async chat(
    messages: ChatMessage[],
    tools?: ToolDefinition[],
    systemPrompt?: string
  ): Promise<ChatResponse>;
}

interface ApiClientConfig {
  baseUrl: string;
  authToken: string;
  model: string;
}

interface ChatMessage {
  role: 'user' | 'assistant';
  content: MessageContent;
}

// 支持多模态内容
type MessageContent = string | (TextBlock | ImageBlock)[];

interface TextBlock {
  type: 'text';
  text: string;
}

interface ImageBlock {
  type: 'image';
  source: {
    type: 'base64';
    media_type: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp';
    data: string;
  };
}
```

---

## 模型能力检测

### 能力检测 API

```typescript
// src/core/model-capabilities.ts

interface ModelCapabilities {
  pattern: RegExp;
  provider: string;
  input: ('text' | 'image' | 'audio' | 'video')[];
  contextWindow: number;
  reasoning?: boolean;
}

// 查找模型能力
function findModelCapabilities(modelId: string): ModelCapabilities | null;

// 检查模型是否支持图片输入
function modelSupportsVision(modelId: string): boolean;

// 检查当前配置的模型是否支持图片输入
function currentModelSupportsVision(): boolean;

// 获取当前配置的模型 ID
function getCurrentModelId(): string;
```

### 支持的模型

| 提供商 | 模型模式 | 图片支持 |
|--------|----------|----------|
| Anthropic | claude-* | ✅ |
| OpenAI | gpt-4o*, gpt-4-turbo* | ✅ |
| OpenAI | gpt-4, gpt-3.5* | ❌ |
| Google | gemini-* | ✅ |
| MiniMax | MiniMax-* | ❌ |
| 智谱 | glm-4v* | ✅ |
| 智谱 | glm-4, glm-3* | ❌ |
| 阿里 | qwen-vl* | ✅ |
| 阿里 | qwen-* | ❌ |
| DeepSeek | deepseek-* | ❌ |
| Moonshot | moonshot-* | ❌ |

---

## 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `LOG_LEVEL` | 日志级别 | `info` |
| `BOT_NAME` | 机器人名称 | `FlashClaw` |
| `TIMEZONE` | 时区 | `Asia/Shanghai` |
| `AGENT_TIMEOUT` | Agent 超时(ms) | `300000` |
| `AI_MODEL` | AI 模型 | `claude-sonnet-4-20250514` |
| `ANTHROPIC_BASE_URL` | API 地址 | `https://api.anthropic.com` |
| `ANTHROPIC_AUTH_TOKEN` | API Token | - |
| `ANTHROPIC_API_KEY` | API Key | - |
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

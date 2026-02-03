# FlashClaw 技术规格

一个可通过消息平台访问的个人 AI 助手，具有持久记忆和定时任务功能。

---

## 目录

1. [架构](#架构)
2. [文件夹结构](#文件夹结构)
3. [配置](#配置)
4. [插件系统](#插件系统)
5. [记忆系统](#记忆系统)
6. [消息流程](#消息流程)
7. [定时任务](#定时任务)
8. [CLI](#cli)
9. [部署](#部署)
10. [安全考虑](#安全考虑)

---

## 架构

```
┌─────────────────────────────────────────────────────────────────────┐
│                        宿主机（Windows/Linux/macOS）                 │
│                       （单 Node.js 进程）                            │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌──────────────────┐                                               │
│  │   CLI 入口        │                                               │
│  │   (cli.ts)        │                                               │
│  └────────┬─────────┘                                               │
│           │                                                          │
│           ▼                                                          │
│  ┌──────────────────┐    ┌──────────────────┐                       │
│  │   主入口          │    │   SQLite 数据库   │                       │
│  │   (index.ts)      │◀──▶│   (messages.db)   │                       │
│  └────────┬─────────┘    └──────────────────┘                       │
│           │                                                          │
│           ▼                                                          │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │                      插件系统                                │    │
│  │  ┌─────────────────┐  ┌─────────────────────────────────┐   │    │
│  │  │  渠道插件        │  │  工具插件                        │   │    │
│  │  │  ├─ feishu      │  │  ├─ send-message                │   │    │
│  │  │  └─ dingtalk    │  │  ├─ schedule-task               │   │    │
│  │  │                 │  │  ├─ list-tasks                  │   │    │
│  │  │                 │  │  ├─ cancel-task                 │   │    │
│  │  │                 │  │  ├─ pause-task                  │   │    │
│  │  │                 │  │  ├─ resume-task                 │   │    │
│  │  │                 │  │  ├─ memory                      │   │    │
│  │  │                 │  │  └─ register-group              │   │    │
│  │  └─────────────────┘  └─────────────────────────────────┘   │    │
│  └─────────────────────────────────────────────────────────────┘    │
│                                                                      │
│  ┌──────────────────┐    ┌──────────────────┐    ┌───────────────┐  │
│  │  消息队列         │    │  调度器循环       │    │  Agent 运行器  │  │
│  │  (处理消息)       │    │  (检查任务)       │    │  (AI API)      │  │
│  └────────┬─────────┘    └────────┬─────────┘    └───────────────┘  │
│           │                       │                                  │
│           └───────────┬───────────┘                                  │
│                       │ 触发代理                                     │
│                       ▼                                              │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │                    AI API 调用                                │   │
│  │                                                                │   │
│  │  工作目录: groups/{群组名}/                                    │   │
│  │                                                                │   │
│  │  工具:                                                         │   │
│  │    • send_message    - 发送消息                               │   │
│  │    • schedule_task   - 创建定时任务                           │   │
│  │    • list_tasks      - 列出任务                               │   │
│  │    • cancel_task     - 取消任务                               │   │
│  │    • pause_task      - 暂停任务                               │   │
│  │    • resume_task     - 恢复任务                               │   │
│  │    • remember/recall - 长期记忆                               │   │
│  │                                                                │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

### 技术栈

| 组件 | 技术 | 用途 |
|------|------|------|
| 消息连接 | 飞书 SDK / 钉钉 SDK | 连接消息平台，发送/接收消息 |
| 消息存储 | SQLite (better-sqlite3) | 存储消息用于处理 |
| AI 调用 | 直接 API 调用 | 支持 Anthropic 及兼容 API |
| 运行时 | Node.js 20+ | 主进程，路由、调度、代理执行 |
| CLI | Commander.js | 命令行工具 |

---

## 文件夹结构

```
flashclaw/
├── CLAUDE.md                      # Claude Code 的项目上下文
├── FLASHCLAW.md                   # 开发指南
├── README.md                      # 用户文档
├── CONTRIBUTING.md                # 贡献指南
├── package.json                   # Node.js 依赖
├── tsconfig.json                  # TypeScript 配置
├── .gitignore
│
├── docs/
│   ├── SPEC.md                    # 本规格文档
│   ├── REQUIREMENTS.md            # 架构决策
│   ├── API.md                     # API 文档
│   └── SECURITY.md                # 安全模型
│
├── src/
│   ├── index.ts                   # 主入口、消息路由
│   ├── cli.ts                     # CLI 命令行工具
│   ├── agent-runner.ts            # AI Agent 运行器
│   ├── config.ts                  # 配置常量
│   ├── types.ts                   # 核心类型定义
│   ├── db.ts                      # 数据库操作
│   ├── message-queue.ts           # 消息队列
│   ├── task-scheduler.ts          # 定时任务调度
│   ├── utils.ts                   # 工具函数
│   │
│   ├── core/                      # 核心模块
│   │   ├── api-client.ts          # AI API 客户端
│   │   ├── memory.ts              # 记忆管理
│   │   └── model-capabilities.ts  # 模型能力检测
│   │
│   └── plugins/                   # 插件系统
│       ├── index.ts               # 插件系统入口
│       ├── manager.ts             # 插件管理器
│       ├── loader.ts              # 插件加载器
│       └── types.ts               # 插件类型定义
│
├── plugins/                       # 插件目录（热加载）
│   ├── feishu/                    # 飞书渠道插件
│   │   ├── plugin.json
│   │   └── index.ts
│   ├── dingtalk/                  # 钉钉渠道插件
│   │   ├── plugin.json
│   │   └── index.ts
│   ├── send-message/              # 发送消息工具
│   │   ├── plugin.json
│   │   └── index.ts
│   ├── schedule-task/             # 创建定时任务
│   │   ├── plugin.json
│   │   └── index.ts
│   ├── list-tasks/                # 列出定时任务
│   │   ├── plugin.json
│   │   └── index.ts
│   ├── cancel-task/               # 取消定时任务
│   │   ├── plugin.json
│   │   └── index.ts
│   ├── pause-task/                # 暂停定时任务
│   │   ├── plugin.json
│   │   └── index.ts
│   ├── resume-task/               # 恢复定时任务
│   │   ├── plugin.json
│   │   └── index.ts
│   ├── memory/                    # 长期记忆
│   │   ├── plugin.json
│   │   └── index.ts
│   └── register-group/            # 注册群组
│       ├── plugin.json
│       └── index.ts
│
├── groups/                        # 群组记忆
│   ├── global/
│   │   └── CLAUDE.md              # 全局记忆（所有群组读取）
│   └── main/                      # 主群组
│       ├── CLAUDE.md              # 主群组记忆
│       └── logs/                  # 任务执行日志
│
├── data/                          # 运行时数据
│   ├── messages.db                # SQLite 数据库
│   ├── sessions.json              # 会话状态
│   ├── registered_groups.json     # 已注册群组（自动生成）
│   ├── router_state.json          # 路由器状态
│   ├── flashclaw.pid              # 进程 PID
│   └── flashclaw.log              # 后台运行日志
│
└── dist/                          # 编译的 JavaScript
```

---

## 配置

配置常量在 `src/config.ts`：

```typescript
export const BOT_NAME = process.env.BOT_NAME || 'FlashClaw';
export const TIMEZONE = process.env.TIMEZONE || 'Asia/Shanghai';
export const AGENT_TIMEOUT = parseInt(process.env.AGENT_TIMEOUT || '300000', 10);

// 任务调度器配置（精确定时器，不再使用轮询）
export const MAX_CONCURRENT_TASKS = 3;              // 最大并发任务数
export const DEFAULT_TASK_TIMEOUT_MS = 300000;      // 默认任务超时（5分钟）
export const RETRY_BASE_DELAY_MS = 60000;           // 重试基础延迟（1分钟）
export const MAX_RETRY_DELAY_MS = 3600000;          // 最大重试延迟（1小时）

const PROJECT_ROOT = process.cwd();
export const STORE_DIR = path.resolve(PROJECT_ROOT, 'store');
export const GROUPS_DIR = path.resolve(PROJECT_ROOT, 'groups');
export const DATA_DIR = path.resolve(PROJECT_ROOT, 'data');
export const MAIN_GROUP_FOLDER = 'main';
```

### AI 认证

在项目根目录的 `.env` 文件中配置：

**Anthropic 官方 API：**
```bash
ANTHROPIC_API_KEY=sk-ant-api03-xxx
```

**API 代理（如 MiniMax）：**
```bash
ANTHROPIC_BASE_URL=https://api.minimaxi.com/anthropic
ANTHROPIC_AUTH_TOKEN=your-token
AI_MODEL=MiniMax-M2.1
```

---

## 插件系统

FlashClaw 采用乐高式插件架构，所有渠道和工具都是插件。

### 插件类型

| 类型 | 说明 | 生命周期 |
|------|------|----------|
| `channel` | 消息渠道 | init → start → onMessage → stop |
| `tool` | AI 工具 | 按需调用 execute |

### 插件加载流程

1. 启动时扫描 `plugins/` 目录
2. 读取每个子目录的 `plugin.json`
3. 使用 jiti 动态加载 `index.ts`
4. 根据类型注册到插件管理器
5. 渠道插件调用 `init()` 和 `start()`

### 热加载

- 监听 `plugins/` 目录变化
- 渠道插件：完整重启（stop → init → start）
- 工具插件：卸载旧版本，加载新版本

### 内置插件

| 插件 | 类型 | 说明 |
|------|------|------|
| feishu | channel | 飞书 WebSocket 长连接 |
| dingtalk | channel | 钉钉 Stream API |
| send-message | tool | 发送消息到聊天 |
| schedule-task | tool | 创建定时任务 |
| list-tasks | tool | 列出定时任务 |
| cancel-task | tool | 取消定时任务 |

---

## 记忆系统

FlashClaw 使用基于 CLAUDE.md 文件的层次记忆系统。

### 记忆层次

| 级别 | 位置 | 谁读取 | 用途 |
|------|------|--------|------|
| **全局** | `groups/global/CLAUDE.md` | 所有群组 | 跨所有对话共享的偏好、事实 |
| **群组** | `groups/{name}/CLAUDE.md` | 该群组 | 群组特定上下文 |
| **短期** | 消息历史 | 该群组 | 最近对话上下文 |

### MemoryManager

```typescript
class MemoryManager {
  // 添加消息到短期记忆
  addMessage(groupFolder: string, message: ChatMessage): void;
  
  // 获取最近消息
  getRecentMessages(groupFolder: string, limit?: number): ChatMessage[];
  
  // 获取格式化的上下文
  getContextForPrompt(groupFolder: string): string;
  
  // 清除短期记忆
  clearShortTerm(groupFolder: string): void;
}
```

---

## 消息流程

### 入站消息流程

```
1. 用户发送消息
   │
   ▼
2. 渠道插件通过 WebSocket/Stream 接收消息
   │
   ▼
3. 消息存储到 SQLite
   │
   ▼
4. 消息加入处理队列
   │
   ▼
5. 队列处理器检查：
   ├── 消息是否重复？ → 是：忽略
   ├── 会话是否已注册？ → 否：自动注册
   └── 是否应该响应？
       ├── 私聊 → 是
       └── 群聊 → 是否 @机器人？
   │
   ▼
6. 构建 AI 提示：
   ├── 系统提示
   ├── 记忆上下文
   ├── 消息历史
   └── 当前消息（可能含图片）
   │
   ▼
7. 发送"正在思考..."占位消息（如果响应慢）
   │
   ▼
8. 调用 AI API：
   ├── 可能调用工具（send_message、schedule_task 等）
   └── 返回响应文本
   │
   ▼
9. 更新/替换占位消息，发送最终响应
   │
   ▼
10. 更新会话状态和记忆
```

### 自动会话注册

新的私聊或群聊会自动注册，无需手动配置：

```typescript
// 自动注册逻辑
if (!group) {
  const mainGroup = Object.values(registeredGroups).find(g => g.folder === MAIN_GROUP_FOLDER);
  if (mainGroup) {
    const chatName = msg.chatType === 'p2p' 
      ? `私聊-${msg.senderName || chatId.slice(-8)}`
      : `群聊-${chatId.slice(-8)}`;
    
    registerGroup(chatId, {
      ...mainGroup,
      name: chatName,
      added_at: new Date().toISOString()
    });
  }
}
```

---

## 定时任务

FlashClaw 有一个内置调度器，在群组上下文中作为完整代理运行任务。

### 调度类型

| 类型 | 值格式 | 示例 |
|------|--------|------|
| `cron` | Cron 表达式 | `0 9 * * 1`（每周一早上 9 点） |
| `interval` | 毫秒 | `3600000`（每小时） |
| `once` | ISO 时间戳 | `2024-12-25T09:00:00Z` |

### 任务工具

| 工具 | 说明 |
|------|------|
| `schedule_task` | 创建定时任务（支持 maxRetries、timeoutMs 参数） |
| `list_tasks` | 列出所有任务 |
| `cancel_task` | 取消任务 |
| `pause_task` | 暂停任务 |
| `resume_task` | 恢复任务 |

### 调度器特性

| 特性 | 说明 |
|------|------|
| **精确定时器** | 按需唤醒，计算精确的下次执行时间，不再固定轮询 |
| **并发控制** | 最多同时执行 3 个任务，使用 p-limit 控制 |
| **超时保护** | 默认 5 分钟超时，可通过 timeoutMs 参数配置 |
| **自动重试** | 失败任务自动重试，指数退避策略（1分钟→2分钟→4分钟...） |

### 任务执行流程

```
1. 精确定时器在任务到期时唤醒
   │
   ▼
2. 获取所有到期任务（next_run <= 当前时间）
   │
   ▼
3. 使用并发池执行任务（最多 3 个并发）
   │
   ├── 超时保护：每个任务有独立超时时间
   │
   ▼
4. 在任务的群组上下文中运行 AI Agent
   │
   ▼
5. 执行结果处理：
   ├── 成功：重置重试计数，计算下次执行时间
   └── 失败：检查重试次数
       ├── 未达上限：指数退避后重试
       └── 已达上限：标记失败，恢复正常调度
   │
   ▼
6. 记录执行日志，重新计算定时器
```

### 重试机制

```typescript
// 指数退避计算
retryDelay = min(
  RETRY_BASE_DELAY_MS * 2^(retryCount - 1),  // 1分钟 * 2^n
  MAX_RETRY_DELAY_MS                           // 最大 1 小时
)

// 示例：
// 第1次重试：1 分钟后
// 第2次重试：2 分钟后
// 第3次重试：4 分钟后（达到默认上限，任务失败）
```

---

## CLI

FlashClaw 提供完整的 CLI 工具。

### 命令结构

```
flashclaw
├── init           # 交互式初始化配置
├── start          # 启动服务
│   └── -d         # 后台守护进程
├── stop           # 停止服务
├── restart        # 重启服务
├── status         # 查看状态
├── plugins
│   ├── list       # 列出插件
│   └── reload     # 热重载插件
├── config
│   ├── list       # 列出配置
│   ├── get        # 获取配置
│   └── set        # 设置配置
└── logs           # 查看日志
    └── -f         # 实时跟踪
```

### CLI 特性

- **交互式初始化**：引导配置消息平台
- **后台运行**：支持守护进程模式
- **热重载**：运行时重载插件
- **配置管理**：敏感信息自动脱敏
- **日志查看**：支持实时跟踪

---

## 部署

FlashClaw 作为单进程运行。

### 启动方式

**前台运行（开发）：**
```bash
npm run dev
# 或
flashclaw start
```

**后台运行（生产）：**
```bash
flashclaw start -d
```

**使用 PM2（推荐）：**
```bash
pm2 start dist/index.js --name flashclaw
pm2 save
pm2 startup
```

### 服务管理

**查看状态：**
```bash
flashclaw status
```

**查看日志：**
```bash
flashclaw logs -f
```

**重启服务：**
```bash
flashclaw restart
```

---

## 安全考虑

### 直接执行模式

FlashClaw 设计为个人助手，AI 代理直接在宿主机上运行：
- **文件访问**：代理可以读写本机文件
- **网络访问**：代理可以访问互联网

### 信任模型

这是一个 **个人工具**，设计基于以下假设：
- 你是唯一的用户
- 你信任 AI 在你的机器上操作
- 消息平台上的群组成员是你信任的人

### 安全措施

- **自动注册**：新会话自动注册，使用默认权限
- **群聊过滤**：群聊只响应 @提及
- **消息去重**：避免重复处理

### 建议

- 只在可信环境运行
- 定期检查定时任务
- 监控日志查找异常活动

---

## 故障排查

### 常见问题

| 问题 | 原因 | 解决方案 |
|------|------|----------|
| 消息无响应 | 服务未运行 | `flashclaw status` 检查 |
| 图片不支持 | 模型限制 | 检查 AI_MODEL 是否支持图片 |
| 插件加载失败 | 语法错误 | `npm run typecheck` 检查 |
| 热重载无效 | 渠道插件 | 渠道插件会完整重启连接 |

### 日志位置

- `data/flashclaw.log` - 后台运行日志
- 终端输出 - 前台运行日志

### 调试模式

```bash
LOG_LEVEL=debug npm run dev
```

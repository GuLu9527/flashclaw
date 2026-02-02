# FlashClaw 技术规格

一个可通过消息平台访问的个人 AI 助手，具有持久记忆和定时任务功能。

---

## 目录

1. [架构](#架构)
2. [文件夹结构](#文件夹结构)
3. [配置](#配置)
4. [记忆系统](#记忆系统)
5. [会话管理](#会话管理)
6. [消息流程](#消息流程)
7. [定时任务](#定时任务)
8. [MCP 服务器](#mcp-服务器)
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
│  ┌──────────────┐                     ┌────────────────────┐        │
│  │ ClientManager │────────────────────▶│   SQLite 数据库    │        │
│  │ (多平台消息)   │◀────────────────────│   (messages.db)    │        │
│  └──────────────┘   存储/发送          └─────────┬──────────┘        │
│                                                  │                   │
│         ┌────────────────────────────────────────┘                   │
│         │                                                            │
│         ▼                                                            │
│  ┌──────────────────┐    ┌──────────────────┐    ┌───────────────┐  │
│  │  消息循环         │    │  调度器循环       │    │  代理运行器    │  │
│  │  (处理消息)       │    │  (检查任务)       │    │  (Claude SDK)  │  │
│  └────────┬─────────┘    └────────┬─────────┘    └───────────────┘  │
│           │                       │                                  │
│           └───────────┬───────────┘                                  │
│                       │ 触发代理                                     │
│                       ▼                                              │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │                    Claude Agent SDK                           │   │
│  │                                                                │   │
│  │  工作目录: groups/{群组名}/                                    │   │
│  │                                                                │   │
│  │  工具:                                                         │   │
│  │    • Bash（直接在宿主机执行）                                  │   │
│  │    • Read, Write, Edit, Glob, Grep（文件操作）                 │   │
│  │    • WebSearch, WebFetch（互联网访问）                         │   │
│  │    • mcp__flashclaw__*（调度工具）                             │   │
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
| 代理 | @anthropic-ai/claude-agent-sdk | 运行带工具和 MCP 服务器的 Claude |
| 运行时 | Node.js 20+ | 主进程，路由、调度、代理执行 |

---

## 文件夹结构

```
flashclaw/
├── CLAUDE.md                      # Claude Code 的项目上下文
├── docs/
│   ├── SPEC.md                    # 本规格文档
│   ├── REQUIREMENTS.md            # 架构决策
│   └── SECURITY.md                # 安全模型
├── README.md                      # 用户文档
├── package.json                   # Node.js 依赖
├── tsconfig.json                  # TypeScript 配置
├── .gitignore
│
├── src/
│   ├── index.ts                   # 主应用（消息路由、代理调用）
│   ├── clients/                   # 消息平台客户端
│   │   ├── index.ts               # ClientManager
│   │   ├── types.ts               # MessageClient 接口
│   │   ├── feishu.ts              # 飞书客户端
│   │   └── dingtalk.ts            # 钉钉客户端
│   ├── config.ts                  # 配置常量
│   ├── types.ts                   # TypeScript 接口
│   ├── utils.ts                   # 通用工具函数
│   ├── db.ts                      # 数据库初始化和查询
│   └── task-scheduler.ts          # 到期时运行定时任务
│
├── dist/                          # 编译的 JavaScript（gitignored）
│
├── .claude/
│   └── skills/
│       ├── setup/
│       │   └── SKILL.md           # /setup 技能
│       ├── customize/
│       │   └── SKILL.md           # /customize 技能
│       ├── debug/
│       │   └── SKILL.md           # /debug 技能
│       └── add-dingtalk/
│           └── SKILL.md           # /add-dingtalk 技能
│
├── groups/
│   ├── global/
│   │   └── CLAUDE.md              # 全局记忆（所有群组读取）
│   ├── main/                      # 自聊天（主控制频道）
│   │   ├── CLAUDE.md              # 主频道记忆
│   │   └── logs/                  # 任务执行日志
│   └── {群组名}/                   # 每群组文件夹（注册时创建）
│       ├── CLAUDE.md              # 群组特定记忆
│       ├── logs/                  # 该群组的任务日志
│       └── *.md                   # 代理创建的文件
│
├── store/                         # 本地数据（gitignored）
│   └── messages.db                # SQLite 数据库
│
├── data/                          # 应用状态（gitignored）
│   ├── sessions.json              # 每群组的活动会话 ID
│   ├── registered_groups.json     # 群组 ID → 文件夹映射
│   └── router_state.json          # 最后处理的时间戳
│
├── logs/                          # 运行时日志（gitignored）
│   ├── flashclaw.log              # stdout
│   └── flashclaw.error.log        # stderr
│
├── launchd/
│   └── com.flashclaw.plist        # macOS 服务配置
└── systemd/
    └── flashclaw.service          # Linux/WSL2 服务配置
```

---

## 配置

配置常量在 `src/config.ts`：

```typescript
import path from 'path';

export const BOT_NAME = process.env.BOT_NAME || 'FlashClaw';
export const SCHEDULER_POLL_INTERVAL = 60000;

// 路径是绝对的
const PROJECT_ROOT = process.cwd();
export const STORE_DIR = path.resolve(PROJECT_ROOT, 'store');
export const GROUPS_DIR = path.resolve(PROJECT_ROOT, 'groups');
export const DATA_DIR = path.resolve(PROJECT_ROOT, 'data');
```

### Claude 认证

在项目根目录的 `.env` 文件中配置认证。两个选项：

**选项 1：Claude 订阅（OAuth 令牌）**
```bash
CLAUDE_CODE_OAUTH_TOKEN=sk-ant-oat01-...
```

**选项 2：按使用付费 API Key**
```bash
ANTHROPIC_API_KEY=sk-ant-api03-...
```

**选项 3：API 代理（如 MiniMax）**
```bash
ANTHROPIC_AUTH_TOKEN=your-token
ANTHROPIC_API_KEY=your-token
ANTHROPIC_BASE_URL=https://api.minimaxi.com/anthropic
ANTHROPIC_MODEL=MiniMax-M2.1
```

---

## 记忆系统

FlashClaw 使用基于 CLAUDE.md 文件的层次记忆系统。

### 记忆层次

| 级别 | 位置 | 谁读取 | 谁写入 | 用途 |
|------|------|--------|--------|------|
| **全局** | `groups/global/CLAUDE.md` | 所有群组 | 仅主频道 | 跨所有对话共享的偏好、事实、上下文 |
| **群组** | `groups/{name}/CLAUDE.md` | 该群组 | 该群组 | 群组特定上下文、对话记忆 |
| **文件** | `groups/{name}/*.md` | 该群组 | 该群组 | 对话中创建的笔记、研究、文档 |

### 记忆如何工作

1. **代理上下文加载**
   - 代理以 `cwd` 设为 `groups/{群组名}/` 运行
   - Claude Agent SDK 配合 `settingSources: ['project']` 自动加载：
     - `../CLAUDE.md`（父目录 = 全局记忆）
     - `./CLAUDE.md`（当前目录 = 群组记忆）

2. **写入记忆**
   - 用户说"记住这个"，代理写入 `./CLAUDE.md`
   - 用户说"全局记住这个"（仅主频道），代理写入 `../CLAUDE.md`
   - 代理可以在群组文件夹中创建文件如 `notes.md`、`research.md`

3. **主频道权限**
   - 只有"main"群组（自聊天）可以写入全局记忆
   - Main 可以管理已注册群组和为任何群组安排任务

---

## 会话管理

会话启用对话连续性 - Claude 记住你谈论了什么。

### 会话如何工作

1. 每个群组在 `data/sessions.json` 中有一个会话 ID
2. 会话 ID 传递给 Claude Agent SDK 的 `resume` 选项
3. Claude 继续对话，保持完整上下文

**data/sessions.json:**
```json
{
  "main": "session-abc123",
  "team-chat": "session-def456"
}
```

---

## 消息流程

### 入站消息流程

```
1. 用户发送消息
   │
   ▼
2. 平台 SDK 通过 WebSocket/Stream 接收消息
   │
   ▼
3. 消息存储到 SQLite (store/messages.db)
   │
   ▼
4. ClientManager 处理消息事件
   │
   ▼
5. 路由器检查：
   ├── chat_id 是否在 registered_groups.json？ → 否：忽略
   └── 是否应该触发？（@提及/问句/请求动词） → 否：忽略
   │
   ▼
6. 路由器追赶对话：
   ├── 获取自上次代理交互以来的所有消息
   ├── 格式化时间戳和发送者名称
   └── 用完整对话上下文构建提示
   │
   ▼
7. 路由器调用代理：
   ├── cwd: groups/{群组名}/
   ├── prompt: 对话历史 + 当前消息
   ├── resume: session_id（用于连续性）
   └── mcpServers: flashclaw（调度器）
   │
   ▼
8. Claude 处理消息：
   ├── 读取 CLAUDE.md 文件获取上下文
   └── 按需使用工具（搜索、文件等）
   │
   ▼
9. 路由器在响应前加上助手名称并通过平台发送
   │
   ▼
10. 路由器更新最后代理时间戳并保存会话 ID
```

### 触发检测

智能触发，不需要特定前缀：
- `@提及机器人` → ✅ 触发
- `这个怎么做？` → ✅ 触发（问句）
- `帮我查一下` → ✅ 触发（请求动词）
- 普通聊天消息 → ❌ 忽略

### 对话追赶

当触发消息到达时，代理接收该聊天中自上次交互以来的所有消息。每条消息格式化包含时间戳和发送者名称，允许代理理解对话上下文。

---

## 定时任务

FlashClaw 有一个内置调度器，在群组上下文中作为完整代理运行任务。

### 调度如何工作

1. **群组上下文**：在群组中创建的任务以该群组的工作目录和记忆运行
2. **完整代理能力**：定时任务可以访问所有工具（WebSearch、文件操作等）
3. **可选消息发送**：任务可以使用 `send_message` 工具向群组发送消息，或静默完成
4. **主频道权限**：主频道可以为任何群组安排任务并查看所有任务

### 调度类型

| 类型 | 值格式 | 示例 |
|------|--------|------|
| `cron` | Cron 表达式 | `0 9 * * 1`（每周一早上 9 点） |
| `interval` | 毫秒 | `3600000`（每小时） |
| `once` | ISO 时间戳 | `2024-12-25T09:00:00Z` |

### 创建任务

```
用户：每周一早上 9 点提醒我查看周报

Claude：[调用 mcp__flashclaw__schedule_task]
        {
          "prompt": "发送提醒查看周报。语气要鼓励！",
          "schedule_type": "cron",
          "schedule_value": "0 9 * * 1"
        }

Claude：好的！我会每周一早上 9 点提醒你。
```

### 管理任务

从任何群组：
- 列出我的定时任务
- 暂停任务 [id]
- 恢复任务 [id]
- 取消任务 [id]

从主频道：
- 列出所有任务 - 查看所有群组的任务
- 为"团队群"安排任务 - 为其他群组安排

---

## MCP 服务器

### FlashClaw MCP（内置）

`flashclaw` MCP 服务器为每次代理调用动态创建，带有当前群组的上下文。

**可用工具：**
| 工具 | 用途 |
|------|------|
| `schedule_task` | 安排重复或一次性任务 |
| `list_tasks` | 显示任务（群组任务，或全部如果是主频道） |
| `get_task` | 获取任务详情和运行历史 |
| `pause_task` | 暂停任务 |
| `resume_task` | 恢复暂停的任务 |
| `cancel_task` | 删除任务 |
| `send_message` | 发送消息到聊天 |
| `register_group` | 注册新群组（仅主频道） |

---

## 部署

FlashClaw 作为单进程运行，由 systemd（Linux/WSL2）、launchd（macOS）或 PM2（Windows）管理。

### 启动序列

FlashClaw 启动时：
1. 初始化消息客户端（自动启动已配置的平台）
2. 初始化 SQLite 数据库
3. 加载状态（已注册群组、会话、路由器状态）
4. 启动消息监听
5. 启动调度器循环

### 服务管理

**macOS (launchd)**:
```bash
launchctl load ~/Library/LaunchAgents/com.flashclaw.plist
launchctl unload ~/Library/LaunchAgents/com.flashclaw.plist
launchctl list | grep flashclaw
```

**Linux/WSL2 (systemd)**:
```bash
sudo systemctl start flashclaw
sudo systemctl stop flashclaw
sudo systemctl status flashclaw
journalctl -u flashclaw -f
```

**Windows (PM2)**:
```bash
pm2 start dist/index.js --name flashclaw
pm2 stop flashclaw
pm2 logs flashclaw
```

---

## 安全考虑

### 直接执行模式

FlashClaw 设计为个人助手，AI 代理直接在宿主机上运行：
- **Bash 访问**：代理可以执行任意命令
- **文件访问**：代理可以读写本机文件
- **网络访问**：代理可以访问互联网

### 信任模型

这是一个 **个人工具**，设计基于以下假设：
- 你是唯一的用户
- 你信任 Claude 在你的机器上操作
- 消息平台上的群组成员是你信任的人

### 提示注入风险

消息可能包含恶意指令试图操纵 Claude 的行为。

**缓解措施：**
- 只处理已注册群组
- 智能触发减少意外处理
- Claude 内置安全训练

**建议：**
- 只注册可信群组
- 定期审查定时任务
- 监控日志查找异常活动
- 不要在不信任的群组中启用机器人

---

## 故障排查

### 常见问题

| 问题 | 原因 | 解决方案 |
|------|------|----------|
| 消息无响应 | 服务未运行 | 检查服务状态 |
| 代理执行失败 | 认证问题 | 检查 `.env` 中的 Claude 凭证 |
| 会话不连续 | 会话 ID 未保存 | 检查 `data/sessions.json` |
| "No message clients configured" | 未配置平台 | 在 `.env` 中添加飞书或钉钉凭证 |

### 日志位置

- `logs/flashclaw.log` - stdout
- `logs/flashclaw.error.log` - stderr
- `groups/{folder}/logs/*.log` - 任务执行日志

### 调试模式

手动运行获取详细输出：
```bash
npm run dev
# 或
LOG_LEVEL=debug npm run dev
```

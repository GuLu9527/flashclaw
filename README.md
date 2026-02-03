# ⚡ FlashClaw

> 闪电龙虾 - 快如闪电的 AI 助手

<p align="center">
  <img src="assets/flashclaw-logo.png" alt="FlashClaw" width="400">
</p>

## 特点

- ⚡ **快速响应** - 直接 API 调用，2-5 秒响应
- 🧱 **乐高式架构** - 通讯渠道和工具都是可插拔的插件
- 🔥 **热加载** - 运行时加载插件，无需重启
- 🇨🇳 **中国本土** - 飞书、钉钉原生支持
- 🤖 **智能响应** - 群聊 @提及、私聊自动回复
- 📅 **定时任务** - 支持 cron、间隔、一次性任务，具备精确定时、并发控制、超时保护和自动重试

## 安装

```bash
npm install -g flashclaw
```

## 快速开始

```bash
# 初始化配置（交互式引导）
flashclaw init

# 启动服务
flashclaw start

# 后台运行
flashclaw start -d
```

## CLI 命令

| 命令 | 说明 |
|------|------|
| `flashclaw init` | 交互式初始化配置 |
| `flashclaw start` | 启动服务 |
| `flashclaw start -d` | 后台守护进程启动 |
| `flashclaw stop` | 停止服务 |
| `flashclaw restart` | 重启服务 |
| `flashclaw status` | 查看运行状态 |
| `flashclaw plugins list` | 列出所有插件 |
| `flashclaw plugins reload` | 热重载插件 |
| `flashclaw config list` | 列出所有配置 |
| `flashclaw config get <key>` | 获取配置值 |
| `flashclaw config set <key> <value>` | 设置配置值 |
| `flashclaw logs` | 查看日志 |
| `flashclaw logs -f` | 实时日志跟踪 |

## 插件系统

FlashClaw 采用乐高式插件架构，添加功能就像放 Minecraft Mod 一样简单：

```
plugins/
├── feishu/          # 飞书渠道插件
├── dingtalk/        # 钉钉渠道插件
├── send-message/    # 发送消息工具
├── schedule-task/   # 创建定时任务
├── list-tasks/      # 列出定时任务
├── cancel-task/     # 取消定时任务
├── pause-task/      # 暂停定时任务
├── resume-task/     # 恢复定时任务
├── memory/          # 长期记忆（remember/recall）
├── register-group/  # 注册群组
└── my-plugin/       # 你的自定义插件
```

### 插件类型

| 类型 | 说明 | 示例 |
|------|------|------|
| `channel` | 消息渠道插件 | 飞书、钉钉、Telegram |
| `tool` | AI 工具插件 | 发送消息、定时任务 |

### 创建插件

1. 在 `plugins/` 创建文件夹
2. 添加 `plugin.json` 和 `index.ts`
3. 运行 `flashclaw plugins reload`

详见 [FLASHCLAW.md](FLASHCLAW.md)

## 配置

编辑 `.env` 文件：

```bash
# AI API 配置（三选一）
# 方式1：Anthropic 官方 API
ANTHROPIC_API_KEY=sk-ant-xxx

# 方式2：API 代理（如 MiniMax）
ANTHROPIC_BASE_URL=https://api.minimaxi.com/anthropic
ANTHROPIC_AUTH_TOKEN=your-token
AI_MODEL=MiniMax-M2.1

# 飞书配置
FEISHU_APP_ID=cli_xxx
FEISHU_APP_SECRET=xxx

# 钉钉配置（可选）
DINGTALK_APP_KEY=xxx
DINGTALK_APP_SECRET=xxx

# 其他配置
BOT_NAME=FlashClaw
LOG_LEVEL=info
TIMEZONE=Asia/Shanghai
```

## 架构

```
flashclaw/
├── src/                      # 核心源码
│   ├── index.ts             # 主入口、消息路由
│   ├── cli.ts               # 命令行接口
│   ├── agent-runner.ts      # AI Agent 运行器
│   ├── config.ts            # 配置常量
│   ├── db.ts                # SQLite 数据库
│   ├── message-queue.ts     # 消息队列
│   ├── task-scheduler.ts    # 定时任务调度
│   ├── core/                # 核心模块
│   │   ├── api-client.ts    # AI API 客户端
│   │   ├── memory.ts        # 记忆管理
│   │   └── model-capabilities.ts  # 模型能力检测
│   └── plugins/             # 插件系统
│       ├── manager.ts       # 插件管理器
│       ├── loader.ts        # 插件加载器
│       └── types.ts         # 插件类型定义
│
├── plugins/                  # 插件目录（热加载）
│   ├── feishu/              # 飞书渠道
│   ├── dingtalk/            # 钉钉渠道
│   ├── send-message/        # 发消息工具
│   ├── schedule-task/       # 定时任务工具
│   ├── list-tasks/          # 列出任务工具
│   ├── cancel-task/         # 取消任务工具
│   ├── pause-task/          # 暂停任务工具
│   ├── resume-task/         # 恢复任务工具
│   ├── memory/              # 长期记忆工具
│   └── register-group/      # 注册群组工具
│
├── groups/                   # 群组记忆
│   ├── global/CLAUDE.md     # 全局记忆
│   └── main/CLAUDE.md       # 主群组记忆
│
├── data/                     # 运行时数据
│   ├── messages.db          # SQLite 数据库
│   ├── sessions.json        # 会话状态
│   └── registered_groups.json  # 已注册群组
│
└── store/                    # 持久化存储
```

## 功能特性

### 智能响应

- **私聊**：直接回复，无需触发词
- **群聊**：@机器人 触发响应
- **自动注册**：新会话自动注册，无需手动配置

### 多模态支持

- **文本消息**：完整支持
- **图片消息**：自动检测模型能力，不支持时提示用户
- **文件消息**：识别文件名和类型
- **富文本**：支持飞书富文本消息解析

### 定时任务

支持三种调度方式：
- **cron** - 使用 cron 表达式（如 `0 9 * * *` 每天 9 点）
- **interval** - 固定间隔执行（毫秒数）
- **once** - 一次性任务（ISO 时间字符串）

**核心特性：**
- **精确定时器** - 按需唤醒，而非固定轮询，资源占用极低
- **并发控制** - 最多同时执行 3 个任务，避免资源耗尽
- **超时保护** - 默认 5 分钟超时，防止任务卡死
- **自动重试** - 失败任务自动重试，使用指数退避策略（默认最多 3 次）

```
用户：每天早上9点提醒我喝水
AI：好的，已创建定时任务（任务ID: task_xxx，下次执行: 2024-02-04 09:00:00）

用户：创建一个每30分钟检查一次的任务，最多重试5次
AI：已创建任务，配置：间隔 30 分钟，最大重试 5 次

用户：我有哪些任务？
AI：你有以下定时任务：
    1. 每日喝水提醒 (cron: 0 9 * * *, 下次: 2024-02-04 09:00:00)

用户：取消任务1
AI：已取消任务
```

### 记忆系统

- **全局记忆**：`groups/global/CLAUDE.md` - 所有会话共享
- **群组记忆**：`groups/{name}/CLAUDE.md` - 会话专属
- **文件存储**：AI 可在群组目录创建文件

## 平台支持

| 平台 | 状态 |
|------|------|
| Windows | ✅ 原生运行 |
| Linux | ✅ 原生运行 |
| macOS | ✅ 原生运行 |

## 消息平台

| 平台 | 状态 | 连接方式 |
|------|------|----------|
| 飞书 | ✅ 完整支持 | WebSocket 长连接 |
| 钉钉 | ✅ 支持 | Stream API |
| Telegram | 📋 计划中 | - |
| Slack | 📋 计划中 | - |

**注意**：所有平台都使用长连接，**无需公网服务器**！

## 安全说明

FlashClaw 的 AI Agent 直接在本机运行，**可以访问所有文件和执行命令**。这是为个人助手设计的，请确保：

- 只在可信环境运行
- 只添加可信的群组
- 定期检查 AI 的操作日志

## 文档

- [开发规则](FLASHCLAW.md) - 插件开发指南
- [设计要求](docs/REQUIREMENTS.md) - 架构决策
- [API 文档](docs/API.md) - 内部 API
- [技术规格](docs/SPEC.md) - 详细规格
- [安全模型](docs/SECURITY.md) - 安全说明
- [贡献指南](CONTRIBUTING.md) - 如何贡献

## 许可证

MIT

# ⚡ FlashClaw

> 闪电龙虾 - 快如闪电的 AI 助手

<p align="center">
  <img src="assets/flashclaw-logo.png" alt="FlashClaw" width="400">
</p>

## 特点

- ⚡ **快速响应** - 直接 API 调用，2-5 秒响应
- 🧱 **乐高式架构** - 通讯渠道和工具都是可插拔的插件
- 🔥 **热加载** - 运行时加载插件，无需重启
- 🇨🇳 **中国本土** - 飞书原生支持
- 🌍 **全球通讯** - Telegram 原生支持（长轮询，无需公网服务器）
- 🤖 **智能响应** - 群聊 @提及、私聊自动回复
- 📅 **定时任务** - 支持 cron、间隔、一次性任务，具备精确定时、并发控制、超时保护和自动重试

## 安装

```bash
npm install -g flashclaw
```

## 快速开始

```bash
# 首次配置（交互式向导）
flashclaw init

# 启动服务
flashclaw start

# 检查运行环境
flashclaw doctor
```

## 更新日志

- [CHANGELOG.md](CHANGELOG.md)
- GitHub Releases: https://github.com/GuLu9527/flashclaw/releases

## CLI 命令

| 命令 | 说明 |
|------|------|
| `flashclaw` | 启动服务（默认） |
| `flashclaw start` | 启动服务 |
| `flashclaw init` | 交互式初始化配置 |
| `flashclaw doctor` | 检查运行环境 |
| `flashclaw version` | 显示版本 |
| `flashclaw -v` / `flashclaw --version` | 显示版本（快捷方式） |
| `flashclaw help` | 显示帮助 |
| `flashclaw -h` / `flashclaw --help` | 显示帮助（快捷方式） |
| `flashclaw plugins list` | 列出已安装插件 |
| `flashclaw plugins list --available` | 列出可安装插件 |
| `flashclaw plugins install <name>` | 安装插件 |
| `flashclaw plugins uninstall <name>` | 卸载插件 |
| `flashclaw plugins update <name>` | 更新插件 |
| `flashclaw plugins update --all` | 更新所有插件 |
| `flashclaw config list-backups` | 列出配置备份 |
| `flashclaw config restore [n]` | 恢复配置备份（n=1-5） |

**安装插件示例：**

```bash
# 从官方仓库安装
flashclaw plugins install telegram
flashclaw plugins install web-fetch
flashclaw plugins install hello-world
```

## 插件系统

FlashClaw 采用乐高式插件架构，添加功能就像放 Minecraft Mod 一样简单：

```
plugins/
├── feishu/          # 飞书渠道插件（内置）
├── send-message/    # 发送消息工具

community-plugins/
├── telegram/        # Telegram 渠道插件（社区）
├── hello-world/     # 示例插件
├── web-fetch/       # 网页抓取工具
├── web-ui/          # Web 管理界面
└── browser-control/ # 浏览器控制工具

~/.flashclaw/plugins/  # 用户安装的插件目录
├── telegram/        # flashclaw plugins install telegram
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
| `channel` | 消息渠道插件 | 飞书、Telegram、Slack |
| `tool` | AI 工具插件 | 发送消息、定时任务 |

### 创建插件

1. 在 `~/.flashclaw/plugins/` 创建文件夹
2. 添加 `plugin.json` 和 `index.ts`
3. 重启服务（开发模式下会自动热加载）

详见 [FLASHCLAW.md](FLASHCLAW.md)

## 配置

推荐使用 `flashclaw init` 交互式向导完成首次配置，也可以手动编辑配置文件 `~/.flashclaw/.env`（首次运行自动创建）。

**特性：**
- 支持环境变量替换：`${VAR}` 或 `${VAR:-default}`
- 自动备份：每次修改前自动保存备份（最多 5 个）
- 使用 `flashclaw config restore` 恢复误操作

```bash
# AI API 配置（三选一）
# 方式1：Anthropic 官方 API（两者任选其一）
ANTHROPIC_AUTH_TOKEN=sk-ant-xxx
ANTHROPIC_API_KEY=sk-ant-xxx

# 方式2：API 代理（如 MiniMax）
ANTHROPIC_BASE_URL=https://api.minimaxi.com/anthropic
ANTHROPIC_AUTH_TOKEN=your-token
AI_MODEL=MiniMax-M2.1
ANTHROPIC_MODEL=claude-4-5-sonnet-20250929

# 飞书配置
FEISHU_APP_ID=cli_xxx
FEISHU_APP_SECRET=xxx

# Telegram 配置
TELEGRAM_BOT_TOKEN=xxx          # 从 @BotFather 获取
# TELEGRAM_PROXY=http://127.0.0.1:7890  # 可选，HTTP 代理
# TELEGRAM_ALLOWED_USERS=123456789      # 可选，用户白名单

# 其他配置
BOT_NAME=FlashClaw
LOG_LEVEL=info
TIMEZONE=Asia/Shanghai
```

## 架构

### 用户数据目录

安装后，FlashClaw 在用户主目录创建配置文件夹：

```
~/.flashclaw/                 # Windows: C:\Users\用户名\.flashclaw\
├── .env                     # API 密钥和配置
├── config/
│   └── plugins.json         # 插件启用/禁用配置
├── data/
│   ├── flashclaw.db         # SQLite 数据库
│   └── flashclaw.pid        # 进程 PID
├── logs/
│   └── flashclaw.log        # 运行日志
├── plugins/                 # 用户自定义插件
└── groups/                  # 群组记忆
```

### 项目结构

```
flashclaw/
├── src/                      # 核心源码
│   ├── index.ts             # 主入口、消息路由
│   ├── cli.ts               # 命令行接口
│   ├── commands/            # CLI 子命令
│   │   ├── init.ts          # 交互式初始化向导
│   │   └── doctor.ts        # 环境诊断
│   ├── commands.ts          # 聊天命令处理
│   ├── session-tracker.ts   # Token 用量追踪
│   ├── paths.ts             # 路径管理
│   ├── agent-runner.ts      # AI Agent 运行器
│   ├── db.ts                # SQLite 数据库
│   ├── task-scheduler.ts    # 定时任务调度
│   ├── core/                # 核心模块
│   │   ├── api-client.ts    # AI API 客户端
│   │   ├── memory.ts        # 记忆管理
│   │   └── model-capabilities.ts  # 模型能力检测
│   └── plugins/             # 插件系统
│       ├── manager.ts       # 插件管理器
│       ├── loader.ts        # 插件加载器
│       ├── installer.ts     # 插件安装器
│       └── types.ts         # 插件类型定义
│
├── plugins/                  # 内置插件（9个）
│   ├── feishu/              # 飞书渠道
│   ├── memory/              # 长期记忆
│   ├── schedule-task/       # 定时任务
│   ├── list-tasks/          # 列出任务
│   ├── cancel-task/         # 取消任务
│   ├── pause-task/          # 暂停任务
│   ├── resume-task/         # 恢复任务
│   ├── send-message/        # 发送消息
│   └── register-group/      # 注册群组
│
└── community-plugins/        # 社区/官方扩展插件
    ├── hello-world/         # 测试插件
    ├── web-fetch/           # 网页内容获取
    ├── browser-control/     # 浏览器自动化控制
    └── web-ui/              # Web 管理界面
```

> community-plugins 作为扩展插件库示例，默认不随 npm 包发布，可通过插件安装命令单独获取。

### 社区插件说明

| 插件 | 说明 |
|------|------|
| hello-world | 测试插件，用于验证插件系统 |
| web-fetch | 网页内容获取，支持抓取网页并转为文本 |
| browser-control | 浏览器自动化控制（基于 Playwright） |
| web-ui | Web 管理界面，实时监控与管理（端口 3000）|

## 功能特性

### 智能响应

- **私聊**：直接回复，无需触发词
- **群聊**：@机器人 触发响应
- **自动注册**：新会话自动注册，无需手动配置

### 聊天命令

在对话中使用斜杠命令快速操作：

| 命令 | 说明 |
|------|------|
| `/help` | 显示帮助信息 |
| `/status` | 查看会话状态和 Token 用量 |
| `/new` | 重置当前会话 |
| `/compact` | 压缩上下文（生成摘要） |
| `/tasks` | 查看定时任务 |
| `/ping` | 测试机器人响应 |

**上下文管理：**
- 系统会实时统计 Token 使用量
- 达到 70% (140k tokens) 时自动提示
- 使用 `/compact` 可手动压缩，保留摘要继续对话
- 使用 `/new` 完全重置会话

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

FlashClaw 支持多层级记忆：

| 层级 | 存储位置 | 作用域 |
|------|----------|--------|
| **用户记忆** | `~/.flashclaw/data/memory/users/{userId}.md` | 跨会话共享，同一用户在私聊和群聊中记忆互通 |
| **会话记忆** | `~/.flashclaw/data/memory/{chatId}.md` | 单个会话内有效 |
| **全局记忆** | `~/.flashclaw/groups/global/CLAUDE.md` | 所有会话共享的系统提示 |

```
用户（私聊）：记住我喜欢吃苹果
AI：好的，已记住

用户（群聊）：我喜欢吃什么？
AI：你喜欢吃苹果  ← 跨会话记忆生效
```

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
| Telegram | 📋 计划中 | - |
| Slack | 📋 计划中 | - |
| Discord | 📋 计划中 | - |

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

## 贡献者

感谢以下贡献者让 FlashClaw 变得更好：

<table>
  <tr>
    <td align="center">
      <a href="https://github.com/GuLu9527">
        <img src="https://avatars.githubusercontent.com/u/109549160?v=4" width="80px;" alt="GuLu9527"/>
        <br />
        <sub><b>GuLu9527</b></sub>
      </a>
      <br />
      <sub>创建者 & 维护者</sub>
    </td>
    <td align="center">
      <a href="https://github.com/Eternity714">
        <img src="https://avatars.githubusercontent.com/u/10277887?v=4" width="80px;" alt="Eternity714"/>
        <br />
        <sub><b>Eternity714</b></sub>
      </a>
      <br />
      <sub>Windows 中文支持 & 错误处理优化</sub>
    </td>
  </tr>
</table>

想要贡献？查看 [贡献指南](CONTRIBUTING.md)！

## 许可证

MIT

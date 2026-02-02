<p align="center">
  <img src="assets/flashclaw-logo.png" alt="FlashClaw" width="400">
</p>

<p align="center">
  多平台个人 AI 助手。快速、强大，直接运行在本机。<br>
  支持飞书、钉钉，可扩展更多平台。
</p>

---

## 快速开始

### 环境要求

- Node.js 20+
- 飞书或钉钉账号（用于创建机器人应用）
- Claude Code（用于配置）

### 安装

```bash
git clone https://github.com/your-repo/flashclaw.git
cd flashclaw
npm install
npm run build
```

用 Claude Code 打开项目，输入：

```
/setup
```

**跟随 AI 指引完成配置。** 就这么简单。

---

## 简介

FlashClaw 是一个轻量级的个人 AI 助手：

- **记忆系统** - AI 记得你说过的每一句话
- **定时任务** - 可以主动给你发消息
- **完整能力** - AI 可访问本机文件系统和命令行
- **多平台** - 飞书、钉钉可同时运行

## 设计理念

**代码简洁，一目了然。** 单进程，几个源文件。没有微服务，没有消息队列。

**AI 能力完整释放。** AI Agent 直接在本机运行，可以访问文件系统、执行命令、调用各种工具。

**AI 原生开发。** 用 `/setup` 安装，用 `/debug` 排查问题，用 `/customize` 添加功能。

---

## Claude Code 技能

| 命令 | 功能 |
|------|------|
| `/setup` | **首次安装**：配置平台、注册主频道、启动服务 |
| `/customize` | 自定义：添加渠道、新平台、新功能 |
| `/debug` | 调试：查日志、排查问题 |
| `/rebuild` | 重建：MCP 工具、主程序 |
| `/add-dingtalk` | 添加钉钉平台 |

---

## 使用示例

在飞书/钉钉中给机器人发消息：

```
帮我查一下明天的天气
总结一下这周的工作进展
每周一早上 9 点给我发一份 AI 行业动态简报
```

---

## 核心功能

### 多平台消息

支持飞书、钉钉，无需公网服务器（WebSocket 长连接）。

### 记忆系统

每个群组有独立的 `CLAUDE.md` 记忆文件，AI 会记住你说过的话。

### 定时任务

```
每天早上 8 点给我发天气预报
每周五下午提醒我写周报
```

### 文件和命令访问

AI 可以直接访问本机文件系统和执行命令，完成各种任务。

---

## AI Agent 内置工具

| 工具 | 功能 |
|------|------|
| `Bash` | 执行命令 |
| `Read/Write/Edit` | 文件读写 |
| `WebSearch` | 网络搜索 |
| `WebFetch` | 抓取网页 |
| `send_message` | 发送消息 |
| `schedule_task` | 创建定时任务 |
| `register_group` | 注册新群组（仅主频道） |

---

## 项目结构

```
flashclaw/
├── src/                      # 主程序
│   ├── index.ts             # 入口
│   ├── clients/             # 消息平台客户端
│   ├── agent-runner.ts      # AI Agent 运行器
│   └── db.ts                # 数据库
│
├── groups/                   # 群组记忆
│   ├── global/CLAUDE.md
│   └── main/CLAUDE.md
│
├── .claude/skills/           # Claude Code 技能
│   ├── setup/
│   ├── customize/
│   ├── debug/
│   └── rebuild/
│
└── docs/                     # 技术文档
```

---

## 扩展

### 添加新消息平台

使用 `/customize` 命令，或参考 `src/clients/feishu.ts` 实现 `MessageClient` 接口。

### 添加 AI Agent 工具

编辑 `src/agent-runner.ts` 中的 MCP 工具定义，然后 `/rebuild MCP`。

### 添加 Claude Code 命令

创建 `.claude/skills/你的命令/SKILL.md`。

---

## 平台支持

| 平台 | 备注 |
|------|------|
| Windows | 原生运行 |
| Linux | 原生运行 |
| macOS | 原生运行 |

---

## 安全说明

FlashClaw 的 AI Agent 直接在本机运行，**可以访问所有文件和执行命令**。这意味着：

- AI 拥有你的用户权限
- AI 可以读写任何你能访问的文件
- AI 可以执行任何你能执行的命令

**请确保你信任 AI 的能力，并在需要时检查其操作。**

---

## 文档

| 文件 | 用途 |
|------|------|
| `CLAUDE.md` | Claude Code 项目上下文 |
| `groups/*/CLAUDE.md` | AI Agent 记忆文件 |
| `.claude/skills/*.md` | Claude Code 技能 |
| `docs/SPEC.md` | 技术规格 |
| `docs/SECURITY.md` | 安全模型 |

---

## 常见问题

**为什么用 Claude Code 安装？**

AI 原生。比任何安装脚本都智能，出问题时能立刻帮你解决。

**可以同时用飞书和钉钉吗？**

可以。两个都配置，会自动识别和路由。

**AI 的权限范围？**

AI 直接在本机运行，拥有和你相同的用户权限。这是设计选择——完整的能力带来最佳体验。

---

## 开源协议

MIT

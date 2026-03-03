# 更新日志

本项目的所有重要变更都会记录在此文件。
格式参考 [Keep a Changelog](https://keepachangelog.com/en/1.0.0/)，
并遵循 [语义化版本](https://semver.org/spec/v2.0.0.html)。

## [Unreleased]

### 新增
- **意图路由** — 根据用户消息关键词预筛选工具列表（记忆/定时/网页/群组等 7 类意图），小模型工具选择更精准；无匹配时回退全部工具（零误判）
- **recall 自动检索** — "知道我是谁吗"等回忆类问题，代码层面自动调用 `memory_search` 并将结果注入系统提示词，不依赖模型主动调用工具

### 修复
- **handleToolUse 后续文本回传** — 工具调用后模型的后续回复现在正确通过 `onToken` 发送给 CLI，不再丢失
- **工具调用参数显示** — OpenAI provider 流式 `tool_use` 事件改为流结束后发送完整 arguments（修复 CLI 显示逐字索引的问题）
- **handleToolUse 内工具调用事件** — 工具链内的工具执行也触发 `onToolUse` 回调，CLI 可显示

## [1.8.0] - 2026-03-03

### 新增
- **核心 API 层** (`src/core-api.ts`) — 所有渠道（CLI、飞书、Telegram、Web UI）的统一入口，提供 `chat()`、`getStatus()`、`compactSession()` 等接口
- **CLI 渠道独立 HTTP 服务** — `cli-channel` 从空壳改为真正的渠道插件（端口 3001），通过核心 API 层处理消息，不再依赖 web-ui
- **CLI Ink 终端 UI** (`src/cli-ink.tsx`) — 使用 React + Ink 重写终端界面，像素风吉祥物、流式输出、上下文用量进度条
- **压缩前记忆 Flush** — 压缩对话上下文前自动让 AI 提取重要信息（用户偏好、关键事实）写入长期记忆，避免压缩时丢失重要信息（参考 OpenClaw memoryFlush）
- **每日日志** — memory 插件新增 `log` action，支持追加式每日日志（`data/memory/daily/YYYY-MM-DD.md`），启动时自动加载今天和昨天的日志到系统提示词
- **语义记忆搜索** — 新增 `memory-vector` 社区插件，基于 Ollama embedding 的模糊召回，支持自然语言搜索长期记忆和每日日志

### 改进
- **渠道架构解耦** — 渠道插件统一通过核心 API 层通信，不互相依赖（Phase 1-2 完成）
- **小模型友好** — 新增核心设计原则，工具 schema 优化使用场景示例，帮助 4B 小模型正确选择工具
- **启动日志精简** — 插件注册/加载/初始化等日志降为 debug，正常启动只显示横幅 + 一行总结；dotenv tip 静默；未配置插件不再报 ERROR
- **启动横幅增强** — 显示模型、插件统计（已加载/跳过）、CLI 端口、Web UI 端口
- **API Key 检查修复** — 根据 `AI_PROVIDER` 配置检查对应的 Key（之前硬编码检查 Anthropic）

### 修复
- **P0: 工具调用重复 API 请求** — `agent-runner.ts` 流式检测到 `tool_use` 后不再重复发送 `chat()` 请求，直接复用流式收集的完整消息对象，工具调用场景响应时间减半
- **P1: openai-provider 工具链改用流式** — `handleToolUse` 后续调用从非流式 `chat()` 改为流式 `chatStream()`，本地模型（Ollama）可边生成边返回
- **openai-provider 流式 tool_calls 数据完整性** — `chatStream` 正确收集流式 delta 中的 tool_calls 数据（逐步拼装 name + arguments），`done` 事件包含完整工具调用信息

## [1.7.1] - 2026-03-03

### 改进
- CLI `/status` 与对话输出新增运行时指标：模型、耗时、真实输入/输出 Token、TPS（优先使用 provider 返回的 usage）
- Web UI 状态接口 `/api/status` 新增 `provider` 与 `model` 字段，便于前端和 CLI 展示当前模型信息
- OpenAI/Ollama 兼容流式路径补充 usage 采集与透传，支持基于真实 token 的 TPS 统计

### 修复
- 上下文窗口保护默认警告阈值调整：`CONTEXT_WARN_TOKENS` 默认值由 `32000` 下调为 `16000`，避免过早触发压缩
- 统一关键日志中的群组标识为 `group.folder`，修复 CLI 场景下群组显示不一致问题

## [1.7.0] - 2026-03-01

### 新增
- **AI Provider 插件化** - 将 AI 客户端从内置改为可插拔的插件架构
  - 新增 `AIProviderPlugin` 接口 (`src/plugins/types.ts`)
  - 新增 `pluginManager.getProviderByName()` / `getAllProviders()` 方法
  - 支持通过环境变量 `AI_PROVIDER` 切换 AI Provider
- **内置 Anthropic Provider** (`plugins/anthropic-provider`) - 默认 AI Provider，支持 Claude 模型
- **社区 OpenAI Provider** (`community-plugins/openai-provider`) - 可选插件，支持 OpenAI、Ollama、LocalAI 等兼容服务

### 改进
- 插件系统支持 provider 类型
- 配置系统新增 `OPENAI_API_KEY` / `OPENAI_BASE_URL` 环境变量支持

### 文档
- CLAUDE.md 新增 Agent Team 工作流程说明

## [1.6.0] - 2026-02-28

### 新增
- **CLI 渠道插件** (`plugins/cli-channel`)：新增终端交互渠道，支持从任意终端连接到运行中的服务
  - HTTP API 客户端模式（类似 web-ui）
  - 命令支持：`/status` 查看状态、`/history` 查看历史、`/new` 新建会话、`/clear` 清屏
  - 上下键浏览历史记录，Tab 键自动补全命令
  - 实时显示 AI 工具调用（黄色高亮 `[TOOL:{...}]` 格式）
- Agent 支持 `onToolUse` 回调，追踪工具调用事件

### 改进
- 移除未使用的 repl 相关代码，简化代码结构
- web-ui 工具调用事件流式输出格式优化

### 修复
- 修复 TypeScript read-only 属性访问问题（`rl.line` / `rl.cursor`）
- 修复 `rl.completer` 类型定义问题

## [1.5.1] - 2026-02-08

### 修复
- **P0: 双重重试放大** — 移除 `ApiClient.chat()` 的内部重试逻辑，统一由 `agent-runner` 管理，避免 3×3=9 次重复请求
- **P0: `/compact` 命令无 await** — 压缩失败时错误被吞掉，现在正确 await 并向用户反馈错误
- **P1: 浏览器长工具链超时** — `handleToolUseInternal` 后续请求改为流式，新增心跳回调机制（`HeartbeatCallback`），防止活动超时误杀长工具链
- `catch (err: any)` 修正为 `catch (err: unknown)`，符合 TypeScript strict 模式

### 改进
- **拆分 index.ts（减少约 250 行）**：抽取 `ChannelManager` 到 `src/channel-manager.ts`，抽取网络工具函数到 `src/utils/network.ts`
- `maxTokens: 4096` 硬编码提取为 `AI_MAX_OUTPUT_TOKENS` 配置常量（支持环境变量覆盖）
- `browser_snapshot` 默认限制 8000 字符，防止大页面撑爆上下文窗口

## [1.5.0] - 2026-02-07

### 新增
- `flashclaw security` 安全审计命令（检查 API Key、.env 文件、数据目录、代理、日志、插件等 7 类安全项）
- `flashclaw daemon` 后台服务管理命令（install/uninstall/status/start/stop，Windows 计划任务实现开机自启）
- SOUL.md 人格设定系统（全局 `~/.flashclaw/SOUL.md` + 会话级覆盖，`flashclaw init` 支持交互式设置）
- 上下文窗口保护（`context-guard.ts`）：自动检测 token 使用量，空间紧张时自动压缩，空间不足时拒绝请求
- 环境变量 `CONTEXT_WINDOW_SIZE` 覆盖模型上下文窗口大小（适配未知模型）
- 环境变量 `CONTEXT_MIN_TOKENS` / `CONTEXT_WARN_TOKENS` 调整保护阈值
### 改进
- api-client: 工具结果超过 4000 字符自动截断，节省 token
- api-client: 超过 2 轮工具调用时，旧轮次自动压缩为摘要（保留最近 2 轮完整）
- model-capabilities: MiniMax 系列上下文窗口更新为 200K
- model-capabilities: 未知模型默认上下文窗口改为 200K（原 32K）
- init 命令新增人格设定步骤（Step 6）

## [1.4.0] - 2026-02-07

### 新增
- Telegram 渠道插件（community-plugins/telegram）
  - 长轮询模式，无需公网服务器
  - 私聊 + 群聊（@提及 / 回复触发）
  - 图片收发（下载→base64，发送 base64/Buffer）
  - 消息编辑/删除（"正在思考..." 更新）
  - HTTP 代理支持（Bot API + 文件下载统一走代理）
  - 用户白名单（TELEGRAM_ALLOWED_USERS）
- 插件安装器自动安装插件的 npm 依赖（package.json dependencies）
- 插件安装后自动提示需要配置的环境变量
- doctor 命令通用检查用户已安装插件的环境变量配置
- 插件加载器支持用户目录 src 链接（社区插件引用核心模块）
- 插件加载器支持插件自有 node_modules 模块解析

### 修复
- 修复代理上传图片崩溃：Node.js 22 要求 duplex: 'half'
- 修复 IPC 工具调用缺少 platform 路由，导致工具发消息到错误渠道
- send_message 工具兼容 AI 传 screenshot 文件名（而非 latest_screenshot）

## [1.3.0] - 2026-02-06

### 修复
- memory.ts: 修复并发压缩竞态条件，添加 compactingGroups 锁
- memory.ts: 修复 addMessage O(n^2) 性能问题，改为增量 token 计算
- memory.ts: 添加缓存上限清理 (MAX_CACHE_ENTRIES=200)，防止 Map 无限增长
- db.ts: 为 createTask/deleteTask 添加事务保护
- db.ts: 改进数据库迁移错误处理，区分"列已存在"和真正的错误
- api-client.ts: 为工具调用递归添加深度限制 (MAX_TOOL_CALL_DEPTH=20)
- index.ts: IPC 轮询添加并发保护，防止处理时间超过间隔导致重复执行
- message-queue.ts: 修复 processNext 竞态条件，processing.add 提前到 await 之前
- message-queue.ts: 添加 seenMessages 硬上限 (10k)，防止高负载下无限增长
- session-tracker.ts: 修复 cleanupTimer 在关闭时未清理的内存泄漏
- 统一所有文件中默认模型名称为 claude-sonnet-4-20250514（消除 6 处不一致）
- index.ts: 使用 DEFAULT_AI_MODEL 常量替代硬编码模型名

### 改进
- 统一日志: agent-runner/message-queue/session-tracker 改用 createLogger() 工厂
- 插件管理器: unregister()/clear() 现在正确调用工具插件的 cleanup() 钩子
- session-tracker: 新增 shutdownSessionTracker() 用于优雅关闭
- package.json: playwright-core/cheerio/html-to-text/turndown 移至 optionalDependencies

## [1.2.0] - 2026-02-06

### 新增
- `flashclaw init` 交互式初始化向导（支持交互式和非交互式模式）
- `flashclaw doctor` 环境诊断命令（检查 10 个维度）
- 启动时 API Key 配置校验和友好提示
- 首次安装后 postinstall 引导信息
- 新增 `@clack/prompts` 依赖

### 修复
- api-client: 修复 chatStream 双倍 API 调用问题（节省 50% API 费用）
- api-client: 修复 handleToolUse 递归调用破坏消息结构
- api-client: 修复 SDK 与手动双重重试（最多 9 次降为 3 次）
- message-queue: 修复超时 Promise 泄漏导致 unhandledRejection
- rate-limiter: 修复 refillRate=0 时无限循环
- session-tracker: 修复损坏时间戳导致会话永不清理
- metrics: 修复 label 匹配依赖 JSON 序列化顺序问题
- memory: 修复 generateSummary 对数组内容输出 [object Object]
- hello-world: 完全重写使其符合 ToolPlugin 接口规范
- memory 插件: 修复 scope 默认值与文档矛盾（改为 group）
- 三个 plugin.json name 字段与目录名不一致（改为 kebab-case）

### 安全
- web-ui: 修复 openBrowser 命令注入漏洞（exec 改为 spawn）
- web-ui: Token 认证改用 crypto.timingSafeEqual 防御时序攻击
- web-ui: Cookie 添加 Secure 标志和 encodeURIComponent
- web-ui: cleanup() 等待 server.close() 完成
- web-fetch: 移除 allowPrivate 参数防止 AI 绕过 SSRF 防护
- web-ui: savePluginsConfig 添加 mkdirSync 防止 ENOENT

## [1.1.0] - 2026-02-05

### 新增
- **图片发送功能**：AI 可通过 `send_message` 工具发送图片到飞书
- `ToolContext` 新增 `sendImage` 方法，工具插件可主动发送图片
- `browser-control` 截图支持通过 `send_message({ image: "latest_screenshot" })` 发送
- `ChannelManager` 新增 `sendImage` 方法，支持图片消息路由

### 变更
- `browser_screenshot` 不再直接返回完整 base64，改为存储到临时文件并返回提示
- 优化截图在 Agent 上下文中的占用，避免 token 浪费

### 注意
- 飞书发送图片需要开通 `im:resource:upload` 或 `im:resource` 权限

## [1.0.0] - 2026-02-04

### 新增
- 核心 Agent 运行时（Claude API 接入与 Token 统计）
- CLI 启动与插件管理命令
- 插件系统（热加载与安装/更新）
- 飞书渠道集成
- 定时任务工具（创建/查询/暂停/恢复/取消）
- 记忆工具（remember/recall，支持用户/会话级）
- 网页抓取工具
- 社区插件示例（hello-world、web-fetch、browser-control）

### 安全
- Web 抓取的输入校验与 SSRF 防护
- 插件与配置路径的安全处理


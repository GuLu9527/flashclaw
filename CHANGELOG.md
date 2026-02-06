# 更新日志

本项目的所有重要变更都会记录在此文件。
格式参考 [Keep a Changelog](https://keepachangelog.com/en/1.0.0/)，
并遵循 [语义化版本](https://semver.org/spec/v2.0.0.html)。

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


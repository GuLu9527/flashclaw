# FlashClaw 开发路线图

> 当前版本: v1.7.1
> 更新时间: 2026-03-03

---

## P0 - 核心功能 (2026-03 重点)

### 0. 记忆系统增强（参考 OpenClaw / Mem0）
- [x] **压缩前记忆 Flush** — 压缩前 AI 自动提取重要信息写入长期记忆（参考 OpenClaw memoryFlush）
- [x] **语义搜索** — 社区插件 `memory-vector`，基于 Ollama embedding 的模糊召回
- [x] **每日日志** — memory 插件新增 `log` action，支持 `data/memory/daily/YYYY-MM-DD.md`，启动时自动加载今天+昨天日志
- [ ] **自动记忆提取** — 暂缓（P0 Flush 已覆盖压缩时提取，每次对话后提取对小模型成本太高）

### 0.5 渠道架构解耦（重新设计）

当前问题：CLI 渠道通过 web-ui 的 HTTP API 与核心通信，导致渠道之间存在耦合。

**目标架构：**
```
┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│   CLI 渠道    │  │  飞书渠道    │  │ Telegram 渠道 │
└───────┬──────┘  └───────┬──────┘  └───────┬──────┘
        │                │                │
        └────────┬───────┘                │
                │                        │
        ┌───────┴────────────────┴───────┐
        │     核心 API 层（新增）            │
        │  handleCommand() / runAgent()  │
        │  消息队列 / 记忆 / 压缩        │
        └──────────────────────────────┘
```

**执行计划：**

**Phase 1：抽取核心 API 层（已完成）**
- [x] 新增 `src/core-api.ts` — 统一接口：`chat()` / `getStatus()` / `getHistory()` / `clearSession()` / `compactSession()` 等
- [x] 修改 `src/index.ts` — 启动时初始化 core-api，注入依赖，暴露 `global.__flashclaw_core_api`

**Phase 2：改造 CLI（已完成）**
- [x] 改造 `plugins/cli-channel/index.ts` — 从空壳改为真正的 HTTP 渠道插件（端口 3001），通过 core-api 处理消息
- [x] 修改 `src/cli.ts` — CLI 客户端默认连接 cli-channel（端口 3001），不再依赖 web-ui
- [x] 新增 `src/cli-ink.tsx` — 使用 React + Ink 重写终端 UI

**Phase 3：改造 web-ui（消除 global 依赖）**
- [ ] 修改 `web-ui/server/services/chat.ts` — 从直接读 `global.__flashclaw_run_agent` 改为调用 core-api
- [ ] 修改 `web-ui/server/services/status.ts` — 从直接读 global 改为调用 core-api

**Phase 4：清理**
- [ ] 减少 `global.__flashclaw_*` 变量 — 只保留 `global.__flashclaw_core_api`，其他通过它访问

### 1. AI Provider 插件化完善
- [x] ollama-provider - 本地 Ollama 支持 (通过 openai-provider 配置 OPENAI_BASE_URL=http://localhost:11434/v1)
- [x] deepseek-provider - DeepSeek API 支持 (通过 openai-provider 配置 OPENAI_BASE_URL=https://api.deepseek.com/v1)
- [x] siliconflow-provider - 硅基流动 API 支持 (通过 openai-provider 配置 OPENAI_BASE_URL=https://api.siliconflow.cn/v1)
- [x] qianwen-provider - 通义千问 API 支持 (通过 openai-provider 配置 OPENAI_BASE_URL 需使用 DashScope)

### 2. 小模型友好优化 — 不依赖模型能力

**目标**：4B 小模型也能正确使用所有功能，代码层面保证行为正确。

- [x] **意图路由 + 工具过滤** — 根据用户消息关键词预筛选工具列表（7 类意图），recall 意图自动调用 memory_search 注入结果
- [ ] **按需注入提示词** — 系统提示词按意图动态裁剪，不把所有工具说明都塞进去
- [ ] **工具参数后处理** — 工具执行前自动修正常见格式错误（如时间格式 `2024-12-31 9:00` → ISO 8601）
- [ ] **基于规则的摘要** — `/compact` 支持不调用 AI 的规则摘要模式（提取最近 N 轮 key messages）

### 3. 轻量 ReAct 自主循环
- [ ] 核心增加 ReAct 循环逻辑（maxReactRounds: 3）
- [ ] web_search 工具（简单搜索）
- [ ] local_file_read 工具（本地文件读取）
- [ ] reminder 工具（简单提醒）

---

## P1 - 重要功能

### 3. 记忆可视化 & 自动摘要
- [ ] Web UI 新增 /memory 时间线页面
- [ ] 长对话自动摘要写入 long_term_memory
- [ ] 记忆卡片组件

### 4. 人格快照 & 实时切换
- [ ] souls/ 目录管理
- [ ] soul-manager.ts 管理器
- [ ] flashclaw soul CLI 命令

---

## P2 - 完善功能

### 5. CLI REPL 增强
- [x] 上下箭头历史浏览（cli-ink.tsx React + Ink）
- [x] Tab 命令补全（cli-ink.tsx）
- [x] Markdown 渲染（cli-ink.tsx）
- [x] 模型思考过程显示（Ctrl+T 折叠/展开）
- [ ] 语音输入（macOS say）

### 6. 每日/每周报告
- [ ] daily-report 工具插件
- [ ] 报告模板
- [ ] 定时推送功能

---

## P3 - 扩展功能

### 7. 本地工具包
- [ ] file-chat 工具（拖拽文件聊天）
- [ ] calculator 工具（计算器）
- [ ] folder-manager 工具（文件夹管理）

### 8. 跨平台部署
- [ ] flashclaw export/import config
- [ ] Windows .exe 打包
- [ ] macOS .app 打包

### 9. 插件市场模板
- [ ] flashclaw plugin new 命令
- [ ] 模板生成（tool/channel/provider）

### 10. 性能仪表盘
- [ ] /dashboard 页面
- [ ] 内存/CPU 监控
- [ ] Token 消耗图表
- [ ] 自动备份状态

---

## P4 - 进阶功能

### 11. 屏幕视觉上下文
- [ ] screen-snapshot 插件（系统截图转 base64）

### 12. 原生语音交互
- [ ] speech-recognition 插件（Web Speech API STT）
- [ ] text-to-speech 插件（TTS）
- [ ] 唤醒词支持

### 13. 工具沙盒隔离
- [ ] sandbox-wrapper 插件（child_process 权限限制）
- [ ] 容器化支持（可选）

### 14. 单二进制部署
- [ ] build-binary 脚本
- [ ] 打包成 .exe / .app

### 15. 个人知识图谱 / 长时 RAG
- [ ] memory 插件向量索引
- [ ] Ollama embed 集成
- [ ] SQLite 向量存储

### 16. PWA 移动端
- [ ] Web UI manifest.json
- [ ] service worker 离线支持
- [ ] 跨设备配置同步

---

## 代码审查摘要 (2026-02-04)

最近一次代码审查发现以下主要问题：

| 优先级 | 问题 | 位置 | 状态 |
|--------|------|------|------|
| ✅ | 配置路径不一致 | `config.ts` vs `paths.ts` | 已修复 |
| ✅ | IPC 输入验证不足 | `index.ts` processTaskIpc 已添加 Zod schema | 已修复 |
| ✅ | 定时任务状态语义 | 已添加 `failed` 状态区分失败任务 | 已修复 |
| ✅ | TypeScript 类型安全 | 飞书插件移除 `as any` 断言 | 已修复 |
| ✅ | Token 估算精度 | `memory.ts` 中英分段估算 | 已修复 |
| ✅ | 飞书 WebSocket 未正确关闭 | `feishu/index.ts` stop() 已完善 | 已修复 |
| ✅ | index.ts 空 catch 块 | 已添加 debug 日志记录 | 已修复 |
| ✅ | 路径定义重复 | `config.ts` 标记 deprecated，统一使用 `paths.ts` | 已修复 |
| ✅ | 核心模块缺少测试 | 已新增 `agent-runner.test.ts` 与 `index.test.ts` | 已修复 |
| 🟢 低 | 全局状态管理过多 | 多处 `global.__flashclaw_*` | 可重构 |
| ✅ | 健康检查未集成 | 已在 main() 中启动，支持 HEALTH_PORT 配置 | 已修复 |

## 代码审查摘要 (2026-02-27)

新增发现的问题：

| 优先级 | 问题 | 位置 | 状态 |
|--------|------|------|------|
| ✅ 已修复 | 空 catch 块 - 完全吞掉错误 | `plugins/loader.ts:444` | 已修复 |
| ✅ 已修复 | 空 catch 块 - SOUL.md 读取错误静默忽略 | `agent-runner.ts:303,308` | 已修复 |
| ✅ 已修复 | MockClient 缺少 heartbeat 参数 | `api-client.ts:778` | 已修复 |
| ✅ 已修复 | 双重类型断言 `as unknown as` | `api-client.ts:163` | 已修复 |
| ✅ 已修复 | interval 未正确清理 - `unref()` 后可能泄漏 | `message-queue.ts:64` | 已修复 |
| ✅ 已优化 | 同步文件读取 - 已有缓存机制 | `memory.ts` loadLongTermMemory | 已优化 |

详见下方「待优化项」章节。

## 代码审查摘要 (2026-03-03)

### 🔴 P0 — Bug / 潜在运行时错误

| 优先级 | 问题 | 位置 | 状态 |
|--------|------|------|------|
| P0 | 工具调用重复 API 请求 — 流式检测到 `tool_use` 后又发一次 `chat()` 非流式请求，浪费 token | `agent-runner.ts:720-731` | ✅ 已修复 |
| P0 | 默认模型 ID 不一致 — `getCurrentModelId()` 默认 `claude-4-5-sonnet-20250929`，`config.ts` 默认 `claude-sonnet-4-20250514` | `model-capabilities.ts:128` vs `config.ts:24` | 待修复 |
| P0 | 上下文阈值无效 — `CONTEXT_MIN_TOKENS` 和 `CONTEXT_WARN_TOKENS` 默认都是 16000，warning 永远不会单独触发 | `context-guard.ts:17-19` | 待修复 |
| P0 | 任务超时 Promise 泄漏 — `setTimeout` ID 未保存，任务正常完成后定时器仍存在 | `task-scheduler.ts:236-239` | 待修复 |

### 🟡 P1 — 设计 / 性能 / 安全

| 优先级 | 问题 | 位置 | 状态 |
|--------|------|------|------|
| P1 | `api-client.ts` 与 `anthropic-provider` 代码大量重复（chatStream/handleToolUse/compressToolHistory） | `api-client.ts` (875行) vs `anthropic-provider/index.ts` (462行) | 待重构 |
| P1 | `index.ts` 过大（1438行）— IPC 处理、消息路由应继续拆分 | `src/index.ts` | 待重构 |
| P1 | `loadPluginsConfig()` 每次调用都重新读文件 — 加载 20+ 插件时读磁盘 20+ 次 | `plugins/loader.ts:55-66` | 待优化 |
| P1 | 全局变量过多 — 6+ 个 `global.__flashclaw_*`，应统一到一个命名空间对象 | 多处 | 待重构 |
| P1 | `send-message` 插件文件路径读取安全隐患 — AI 可传入任意路径读取系统文件 | `send-message/index.ts:106-117` | 待修复 |
| P1 | openai-provider `handleToolUse` 后续调用使用非流式 `chat()`，本地模型更慢 | `openai-provider/index.ts:325` | ✅ 已修复 |

### 🟢 P2 — 建议改进

| 优先级 | 问题 | 位置 | 状态 |
|--------|------|------|------|
| P2 | 类型守卫误判风险 — `isToolPlugin`/`isChannelPlugin` 基于鸭子类型，建议添加 `__type` 标识 | `plugins/types.ts:249-255` | 建议 |
| P2 | `getPlatformDisplayName` 硬编码不完整 — 只有飞书有中文名 | `channel-manager.ts:128-133` | 建议 |
| P2 | `errors.ts` 自定义错误类未被充分使用 — 核心代码几乎全用 `new Error()` | 多处 | 建议 |
| P2 | 测试补充 — anthropic-provider mock 测试、channel-manager 多渠道回退、IPC Schema 边界测试 | `tests/` | 建议 |

### ✅ 亮点

- 插件架构设计清晰，类型安全且可扩展
- 拓扑排序加载处理了插件依赖顺序
- IPC 安全完善（文件大小/chatId 长度限制、错误文件隔离）
- 上下文保护（自动压缩 + 拒绝超限请求）
- 优雅关闭（10 步有序清理）
- 工具结果截断 + 历史压缩有效控制 token 用量
- 消息队列（去重、并发控制、超时、重试）

---

## 待优化项

### 🔴 高优先级

**架构问题：**
- [x] 配置路径不一致 - `config.ts` 已统一使用 `paths.ts` 管理
- [x] 路径定义重复 - `config.ts` 中的变量已标记 `@deprecated`，统一使用 `paths.ts`
- [x] IPC 输入验证不足 - `processTaskIpc` 已添加完整的 Zod schema 验证
- [x] 定时任务状态语义 - 已添加 `failed` 状态，区分成功完成和失败的 once 任务

**测试覆盖：**
- [x] 更多单元测试覆盖 - 已新增 `agent-runner.test.ts` 与 `index.test.ts`
- [x] E2E 测试 - 已新增 `tests/e2e.test.ts` 端到端用例
- [x] 插件系统集成测试（安装/更新/卸载/回滚）- 新增 `installer.integration.test.ts`

**文档：**
- [x] 文档完善 - 已更新 `docs/API.md`（插件/Agent/DB/ApiClient/环境变量）
- [x] 插件开发文档完善 - 已更新 `FLASHCLAW.md` 的 ToolContext 和 send_message 示例

### 🟡 中优先级

**代码质量：**
- [x] TypeScript 类型安全 - 飞书插件已移除 `as any` 断言，使用更安全的响应解析
- [x] TypeScript 类型安全 - `agent-runner.ts` 已将 `finalResponse` 改为 `Anthropic.Message`
- [x] 飞书 WebSocket 未正确关闭 - `feishu/index.ts` 的 `stop()` 已完善：释放 wsClient/client 引用，清理 seenMessages
- [x] Token 估算精度 - 改为中英分段估算（CJK 1 字符/token，英文 4 字符/token）
- [x] 错误处理完善 - `index.ts` 空 catch 块已添加 debug 日志（ChannelManager 方法、思考提示、占位消息）
- [x] 配置集中管理 - 调度器/队列/IPC/抓取等配置已集中到 `config.ts`

**文档同步：**
- [x] `ChannelPlugin.onMessage` 类型说明与实现不一致（已同步 `docs/API.md` / `FLASHCLAW.md`）
- [x] `ToolContext.sendMessage` 签名在 `docs/API.md` / `CONTRIBUTING.md` 已同步
- [x] `Message.raw` 字段文档与 `src/plugins/types.ts` 已一致
- [x] Mock API 文档补充 `FLASHCLAW_MOCK_FORCE_TOOL` 与工具输入说明

**功能增强：**
- [ ] 国际化 (i18n) - 英文界面支持
- [ ] 更多 AI 模型支持 (OpenAI, 国产模型)
- [ ] 消息模板 - 可自定义回复格式
- [x] 插件变更日志与版本发布说明 - 新增 `docs/PLUGINS_CHANGELOG.md` 并更新 `RELEASE.md`

### 🟢 低优先级

**架构重构：**
- [ ] 全局状态管理 - 多个 `global.__flashclaw_*` 变量，考虑依赖注入重构
- [ ] IPC 通信效率 - 文件轮询（1秒）在高频场景可能成为瓶颈，考虑 Unix socket
- [x] 健康检查已集成 - `main()` 中启动 `startHealthServer()`，支持 `HEALTH_PORT` 环境变量（默认 9090，设为 0 禁用）

**安全增强：**
- [ ] DNS Rebinding 防护 - `isBlockedHostname` 检查可能被绕过
- [ ] 数据库连接安全 - 进程异常退出时 SQLite WAL 模式可能丢数据

**性能/稳定性：**
- [x] Token 估算性能 - `memory.ts` 改为流式计数，避免大数组
- [x] 空 catch 块问题 - `plugins/loader.ts:444` 全空 catch 完全吞掉错误，已添加注释说明
- [x] 空 catch 块问题 - `agent-runner.ts` 静默忽略 SOUL.md 读取错误，已添加 debug 日志
- [x] MockClient 实现 - `api-client.ts:778` 缺少 heartbeat 参数传递，已添加参数
- [x] 类型安全 - `api-client.ts:163` 双重类型断言 `as unknown as` 已重构
- [x] 资源清理 - `message-queue.ts:64` `unref()` 后 interval 已在 stop() 中显式清理
- [x] 性能优化 - `memory.ts` 长期记忆已有缓存机制，无需额外优化

**系统服务：**
- [ ] Windows 服务 - 作为系统服务运行
- [ ] macOS LaunchAgent - 开机自启
- [ ] Linux systemd - 系统服务配置

---

## v1.1 核心精简改进

> 原则：核心做调度，功能靠插件

### 核心系统（保持精简）
- [x] 环境变量替换 - 配置中支持 `${VAR}` 和 `${VAR:-default}` 语法
- [x] 配置备份 - 写入前自动备份（最多 5 个）+ `flashclaw config restore` 恢复
- [x] Token 估算精度 - 已改为中英分段估算（CJK 1 字符/token，英文 4 字符/token）
- [x] 路径管理统一 - 已统一使用 `paths.ts`，`config.ts` 中的路径变量标记为 `@deprecated`

### 插件扩展（按需安装）
- [ ] wecom - 企业微信渠道（用户需求驱动）
- [x] telegram - Telegram 渠道
- [x] browser-control - 浏览器自动化 (Playwright) - 已实现
- [ ] memory-vector - 向量记忆（语义搜索）
- [x] security-audit - 安全审计工具 (v1.5.0)

---

## Phase 1: 插件生态

- [x] `flashclaw plugins install <name>` - 从官方仓库安装插件
- [x] `flashclaw plugins uninstall <name>` - 卸载插件
- [x] `flashclaw plugins update <name>` - 更新插件（支持备份和回滚）
- [x] `flashclaw plugins list --available` - 列出可安装插件
- [x] 插件仓库索引 - GitHub API 动态获取 `community-plugins`
- [x] `community-plugins/` 官方插件目录
- [x] 代理支持 (自动检测 HTTP_PROXY/HTTPS_PROXY)
- [x] hello-world 测试插件
- [ ] `flashclaw plugins create <name>` - 生成插件脚手架模板
- [x] 插件开发文档完善（`FLASHCLAW.md` 已更新）

### 计划中的插件

**工具类插件：**
- [x] web-fetch - 网页内容获取（SSRF 防护、代理支持、内容提取）
- [x] browser-control - 浏览器自动化 (Playwright) - 已实现完整功能
- [ ] file-manager - 文件操作
- [ ] code-executor - 代码执行沙箱
- [ ] image-gen - AI 图像生成

**系统类插件：**
- [x] web-ui - Web 管理界面（配置、监控、日志）- 已实现
- [ ] api-server - REST API 服务端点
- [ ] webhook - Webhook 接收处理

---

## Phase 2: 更多渠道

- [ ] 企业微信 (wecom) - 高优先级
- [x] Telegram - 已完成 (v1.4.0)
- [ ] Slack - 中优先级
- [ ] Discord - 低优先级
- [x] CLI 终端交互 - 无需外部平台 (已完成: flashclaw cli)

---

## Phase 3: 功能增强

- [ ] 多 Agent - 支持多个独立 Agent 实例
- [ ] 工作流 (Workflow) - 复杂任务编排
- [ ] RAG - 文档/知识库检索增强
- [ ] 语音消息 - 语音转文字处理
- [ ] 会话管理 - 会话历史导出/导入
- [ ] 多模型支持 - OpenAI/国产模型切换

---

## Phase 4: 运维能力

- [ ] Docker 镜像 - 一键部署
- [ ] docker-compose 配置
- [ ] Kubernetes Helm Chart
- [ ] 自动更新检查
- [ ] 使用量报告

---

## 贡献指南

欢迎提交 PR！

### 如何贡献插件

1. Fork 本仓库
2. 在 `~/.flashclaw/plugins/` 目录创建新插件
3. 编写 `plugin.json` 和 `index.ts`
4. 测试功能
5. 提交 PR 到主仓库 `plugins/` 目录

### 插件结构示例

```
my-plugin/
├── plugin.json    # 插件清单
├── index.ts       # 插件入口
└── README.md      # 插件说明
```

---

## 已完成 (v1.0.0)

### 核心功能
- [x] 核心 Agent 功能 (Claude API)
- [x] 飞书渠道插件 (WebSocket 长连接)
- [x] 长期记忆系统 (remember/recall)
- [x] 用户级别记忆 (跨会话记忆)
- [x] 定时任务调度 (cron/interval/once)
- [x] 图片理解 (多模态支持)

### 插件系统
- [x] 插件热加载
- [x] 内置插件 + 用户插件双目录支持
- [x] 9 个内置插件 (feishu, memory, task 等)
- [x] 4 个社区插件 (hello-world, web-fetch, browser-control, web-ui)
- [ ] 插件启用/禁用 CLI 命令

### CLI 工具
- [x] `flashclaw start` - 启动服务
- [x] `flashclaw version` - 显示版本
- [x] `flashclaw help` - 显示帮助
- [x] `flashclaw plugins list` - 列出已安装插件
- [x] `flashclaw plugins list --available` - 列出可安装插件
- [x] `flashclaw plugins install/uninstall/update` - 插件管理
- [x] `flashclaw config list-backups` - 列出配置备份
- [x] `flashclaw config restore` - 恢复配置备份
- [x] 全局配置目录 (~/.flashclaw)
- [x] `flashclaw init` - 交互式初始化
- [ ] `flashclaw stop/restart` - 服务停止/重启
- [ ] `flashclaw config get/set/list/delete` - 配置读写

### 聊天命令
- [x] `/help` - 显示帮助
- [x] `/status` - 会话状态和 Token 统计
- [x] `/new` - 重置会话
- [x] `/compact` - 压缩上下文
- [x] `/tasks` - 查看定时任务
- [x] `/ping` - 测试响应

### 系统优化
- [x] 统一错误处理 (FlashClawError)
- [x] 配置校验 (Zod schema)
- [x] API 重试机制 (指数退避)
- [x] 优雅关闭 (SIGTERM/SIGINT)
- [x] 健康检查端点 (/health, /ready)
- [x] 日志轮转 (自动清理)
- [x] 速率限制 (令牌桶算法)
- [x] 指标收集 (Prometheus 格式)
- [x] 单元测试框架 (Vitest)
- [x] Token 实时统计 (session-tracker)
- [x] 70% 上下文提示
- [x] 基于 Token 的记忆管理

### 安全
- [x] 用户 ID 脱敏显示
- [x] 会话 ID 哈希处理

### 稳定性与质量
- [x] npm 打包配置修复 - `files` 字段添加 `scripts` 目录，修复 postinstall 脚本缺失导致安装失败
- [x] 插件安装/解压命令安全化（避免命令注入）
- [x] 插件名称与路径校验（防路径穿越）
- [x] 官方插件更新：临时目录验证后原子替换
- [x] 插件卸载等待 stop 完成，避免资源泄露
- [x] Session 统计持久化 + 除零保护
- [x] 记忆系统：超限时保留最新消息
- [x] 新增核心单测（installer/session-tracker/memory/task-scheduler/api-client 等）
- [x] SSRF 防护（直接抓取 + web-fetch 插件）
- [x] IPC 消息/文件大小限制 + 隔离
- [x] 图片附件大小限制（10MB）
- [x] XML 转义增强（单引号）
- [x] 插件入口路径安全验证
- [x] 分支名参数验证（防命令注入）
- [x] 会话缓存文件大小限制
- [x] 重定向 URL 安全验证

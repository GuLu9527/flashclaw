# FlashClaw 开发路线图

> 当前版本: v1.7.1
> 更新时间: 2026-03-04

---

## P0 - 核心功能 (2026-03 重点)

### 0. 记忆系统增强（参考 OpenClaw / Mem0）
- [x] **压缩前记忆 Flush** — 压缩前 AI 自动提取重要信息写入长期记忆（参考 OpenClaw memoryFlush）
- [x] **语义搜索** — 社区插件 `memory-vector`，基于 Ollama embedding 的模糊召回
- [x] **每日日志** — memory 插件新增 `log` action，支持 `data/memory/daily/YYYY-MM-DD.md`，启动时自动加载今天+昨天日志
- [x] **长期记忆全局化（跨渠道共享）** — 长期记忆默认改为 global，不再按 group 切分；短期上下文仍按会话隔离
- [ ] **自动记忆提取** — 暂缓（P0 Flush 已覆盖压缩时提取，每次对话后提取对小模型成本太高）

### 0.5 渠道架构解耦（重新设计）

当前问题：旧终端渠道曾通过 web-ui 的 HTTP API 与核心通信，导致渠道之间存在耦合。

**目标架构：**
```
┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│  终端渠道(旧)  │  │  飞书渠道    │  │ Telegram 渠道 │
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

**Phase 2：改造 CLI（已取消，已移除）**
- [x] 已移除独立 HTTP CLI 渠道 — 不再维护单独的终端通信插件
- [x] 已移除旧 CLI 对话命令入口 — 终端对话渠道不再作为产品能力提供
- [x] 已删除独立终端 UI — React + Ink 方案已下线

**Phase 3：改造 web-ui（消除 global 依赖）**
- [x] 修改 `web-ui/server/services/chat.ts` — 从直接读 `global.__flashclaw_run_agent` 改为调用 core-api（新增 onThinking 回调）
- [x] 修改 `web-ui/server/services/status.ts` — 从直接读 global 改为调用 core-api
- [x] 修改 `web-ui/server/routes/api.ts` — 流式路由增加 onThinking 透传
- [ ] 修改 `web-ui/server/services/tasks.ts` — 仍用 global DB（需 core-api 扩展 pause/resume/delete）
- [ ] 修改 `web-ui/server/services/plugins.ts` — 仍用 global + 文件系统（低优先）

**Phase 4：清理**
- [ ] 减少 `global.__flashclaw_*` 变量 — 只保留 `global.__flashclaw_core_api`，其他通过它访问

**Phase 5：Web UI 状态看板深化（参考 Star Office UI / Pixel Agents / AgentOffice）**

> 前端已迁移到 React + Vite + Tailwind（`community-plugins/web-ui/frontend/`）

**5.1 像素办公室增强（需要素材）**
- [ ] 龙虾精灵帧动画 — 替换 emoji，用精灵图实现 idle/work/think/error 帧动画
- [ ] 办公室场景背景 — 替换网格背景，用像素画俯视办公室（800×400px 或 32×32 瓷砖拼图）
- [ ] 家具装饰 — 桌子、电脑、书架、咖啡机、服务器等场景元素
- [ ] 区域地图 — 5 个功能区域（休息/思考/工作/Bug/会议）有明确视觉边界

**5.2 实时状态系统（纯代码）**
- [ ] SSE 实时推送 — 新增 `/sse/agent-state` 端点，替换轮询，状态变化即时推送
- [ ] 状态机扩展 — 精确追踪 agent 生命周期: idle→thinking→tool_use→responding→error
- [ ] 气泡实时更新 — 显示当前正在处理的消息内容/使用的工具名称
- [ ] 位置平滑移动 — CSS transition + 缓动函数，龙虾在区域间移动

**5.3 每日小记 & 记忆（纯代码）**
- [ ] 今日/昨日小记 — 从 memory 插件 `data/memory/daily/` 读取展示
- [ ] 记忆时间线 — 展示最近保存的长期记忆条目
- [ ] 对话统计 — 今日对话数、token 消耗、工具调用次数

**5.4 渠道状态可视化（纯代码）**
- [ ] 渠道连接状态 — 飞书 ✅ / Telegram ❌ / Web UI ✅
- [ ] 渠道图标/角色 — 每个渠道一个小角色在办公室场景中（可选素材或 emoji）
- [ ] 最近消息来源 — 显示最后一条消息来自哪个渠道

**5.5 多 Agent 协作（参考 OpenClaw 架构）**

> OpenClaw 模式：Coordinator（任务分解） → 专业 Agent（执行） → 消息总线通信

- [ ] **Agent 注册表** — `agents/` 目录管理，每个 Agent 有独立配置（id/name/role/model/tools/systemPrompt）
- [ ] **Coordinator Agent** — 主 Agent 负责理解用户需求、分解任务、分发到专业 Agent
- [ ] **消息总线** — Agent 之间通过 `agent_send` 工具通信（publish/subscribe + 超时等待）
- [ ] **Agent 生命周期** — 启动/停止/状态查询，每个 Agent 独立的上下文和记忆
- [ ] **工具白名单** — 每个 Agent 只能使用指定的工具子集，减少 token 消耗
- [ ] **可视化看板** — 办公室场景中每个 Agent 是一个独立角色，实时显示状态/任务/气泡
- [ ] **任务看板** — Trello 风格的任务卡片流转（待办→进行中→完成）
- [ ] **协作动画** — Agent 之间传递任务的视觉效果（连线/箭头/消息飞行）

**5.6 活动时间线（纯代码）**
- [ ] 实时活动流 — 消息收发、工具调用、任务执行、Agent 通信的时间线
- [ ] 活动图标 — 不同类型活动用不同图标/颜色
- [ ] 可点击详情 — 点击活动条目展开详细信息

**5.7 Agent 进阶（参考 Claw-Empire / AgentOffice）**
- [ ] **Agent 性格系统** — 每个 Agent 有独立 SOUL.md 人格文件，影响气泡对话和行为风格
- [ ] **动态招聘** — Coordinator Agent 根据任务需要自动创建新的专业 Agent（`hire_agent` 工具）
- [ ] **经验值 & 等级** — Agent 完成任务获得经验，升级后解锁更多工具/能力（持久化到 DB）
- [ ] **Agent 聚焦模式** — 点击角色后镜头跟随，显示详细信息面板（工具调用历史、记忆、统计）
- [ ] **Agent 之间对话气泡** — Agent 通信时在场景中实时显示消息气泡动画
- [ ] **会议系统** — Agent 之间开会讨论任务分配，生成会议纪要保存到记忆
- [ ] **技能库** — 可浏览和分配 Agent 技能（对应 FlashClaw 的工具插件白名单）

**5.8 场景 & 主题（需要素材 + 部分代码）**
- [ ] **Office Pack 模板** — 不同工作模式（开发/研究/写作）自动切换场景布局和 Agent 配置
- [ ] **AI 生成背景** — 接入生图 API，用户可自定义/生成办公室背景
- [ ] **暗色/亮色主题** — 深色像素风 vs 浅色像素风切换
- [ ] **区域自定义** — 用户可编辑办公室区域划分和名称

**5.9 通用增强**
- [ ] **多语言 i18n** — CN/EN 界面语言切换
- [ ] **移动端适配** — 响应式布局，手机端可查看状态看板
- [ ] **CEO 指令系统** — `$` 前缀命令直接对 Agent 下达高优先级指令
- [ ] **报告生成** — Agent 完成任务后可生成可视化报告（Markdown/HTML）
- [ ] **Kanban 拖拽** — 任务看板支持拖拽排序和状态变更

**素材收集清单：**

| 素材 | 规格 | 帧数 | 说明 |
|------|------|------|------|
| 龙虾 idle | 32×32 px/帧 | 4帧 | 待命，轻微呼吸动画 |
| 龙虾 working | 32×32 px/帧 | 4帧 | 工作，敲键盘 |
| 龙虾 thinking | 32×32 px/帧 | 4帧 | 思考，挠头/看书 |
| 龙虾 running | 32×32 px/帧 | 6帧 | 移动，走路 |
| 龙虾 error | 32×32 px/帧 | 4帧 | 异常，冒烟/晕 |
| 龙虾 celebrating | 32×32 px/帧 | 4帧 | 成功，举手/闪光 |
| 办公室全景 | 800×400 px | 1张 | 俯视像素办公室含5区域 |
| 电脑桌 | 48×48 px | 1张 | 工作区 |
| 咖啡机 | 32×32 px | 1张 | 休息区 |
| 书架 | 32×48 px | 1张 | 思考区 |
| 服务器 | 32×48 px | 1张 | 工具区 |
| 警示牌 | 32×32 px | 1张 | Bug 区 |
| 渠道角色 (飞书/TG/Web) | 24×24 px | 各1张 | 渠道小角色 |
| Agent 角色 (多色) | 32×32 px/帧 | 4帧×N色 | 不同 Agent 不同颜色的龙虾 |

> 精灵图格式：横排帧（如 idle 4帧 = 128×32 px），透明背景 PNG

**执行优先级：** 5.2 (实时状态) → 5.3 (每日小记) → 5.6 (活动时间线) → 5.4 (渠道状态) → 5.5 (多Agent) → 5.1 (等素材后替换)

### 1. AI Provider 插件化完善
- [x] ollama-provider - 本地 Ollama 支持 (通过 openai-provider 配置 OPENAI_BASE_URL=http://localhost:11434/v1)
- [x] deepseek-provider - DeepSeek API 支持 (通过 openai-provider 配置 OPENAI_BASE_URL=https://api.deepseek.com/v1)
- [x] siliconflow-provider - 硅基流动 API 支持 (通过 openai-provider 配置 OPENAI_BASE_URL=https://api.siliconflow.cn/v1)
- [x] qianwen-provider - 通义千问 API 支持 (通过 openai-provider 配置 OPENAI_BASE_URL 需使用 DashScope)
- [x] mlx-openai-server - Apple MLX 支持 (通过 openai-provider 配置 OPENAI_BASE_URL=http://localhost:8000/v1，增加 `<tool_call>` 标签解析 + `<think>` 流式拦截)

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
- [x] 已取消：CLI REPL 已整体移除，不再继续增强

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
| P0 | 默认模型 ID 不一致 — `getCurrentModelId()` 默认 `claude-4-5-sonnet-20250929`，`config.ts` 默认 `claude-sonnet-4-20250514` | `model-capabilities.ts:128` vs `config.ts:24` | ✅ 已修复 |
| P0 | 上下文阈值无效 — `CONTEXT_MIN_TOKENS` 和 `CONTEXT_WARN_TOKENS` 默认都是 16000，warning 永远不会单独触发 | `context-guard.ts:17-19` | ✅ 已修复 |
| P0 | 任务超时 Promise 泄漏 — `setTimeout` ID 未保存，任务正常完成后定时器仍存在 | `task-scheduler.ts:236-239` | ✅ 已修复 |

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

## 代码审查摘要 (2026-03-04)

### 🔴 P0 — 运行时消息路由风险

| 优先级 | 问题 | 位置 | 状态 |
|--------|------|------|------|
| P0 | 多渠道回退可能吞消息 — 指定 `platform` 未命中时会回退到“任意渠道”；无实际投递的渠道如果误报 success，可能导致消息被错误判定为已发送（定时任务/IPC 无平台时风险更高） | `src/channel-manager.ts:33-45`, `src/index.ts:1356`, `src/task-scheduler.ts:49` | ✅ 已修复 |

### 🟡 P1 — 测试回归 / 契约不一致

| 优先级 | 问题 | 位置 | 状态 |
|--------|------|------|------|
| P1 | E2E 用例超时 — 测试插件上报 `platform: "e2e"`，但插件名是 `e2e-channel`，导致回复路由不稳定并触发超时 | `tests/e2e.test.ts:127`, `tests/e2e.test.ts:226-233` | ✅ 已修复 |
| P1 | browser-control 截图返回契约与测试不一致 — 插件不再返回 `base64` 字段，但测试仍强依赖 `result.data.base64` | `community-plugins/browser-control/index.ts:546-554`, `tests/plugins/browser-control.test.ts:247` | ✅ 已修复 |
| P1 | `send-message` 仍可读取任意本地路径作为图片输入，存在文件泄露风险 | `plugins/send-message/index.ts:106-110` | ✅ 已修复 |

### 🟢 P2 — 本次复查项（已全部修复）

| 优先级 | 问题 | 位置 | 状态 |
|--------|------|------|------|
| P2 | 任务超时 Promise 泄漏 — `setTimeout` ID 未保存，任务正常完成后定时器仍会触发 | `src/task-scheduler.ts:236-239` | ✅ 已修复 |
| P2 | 默认模型 ID 不一致 — `model-capabilities` 与 `config` 默认模型不同 | `src/core/model-capabilities.ts:128`, `src/config.ts:24` | ✅ 已修复 |
| P2 | 上下文 warning 阈值与拒绝阈值相同，warning 分支无法单独生效 | `src/core/context-guard.ts:17-19` | ✅ 已修复 |

## 代码审查摘要 (2026-03-05)

### 🔴 P0 — 运行正确性风险

| 优先级 | 问题 | 位置 | 状态 |
|--------|------|------|------|
| P0 | 队列时间戳推进错误：批处理后仅推进到当前 `msg.timestamp`，可能重复处理同一批消息并重复回复 | `src/index.ts:324-328`, `src/index.ts:348-351`, `src/index.ts:411` | 待修复 |
| P0 | `/new` 在未注册 group 场景可能“看起来成功但未真正清会话” | `src/core-api.ts:156-165`, `src/core-api.ts:289-298` | 待修复 |
| P0 | `/compact` 在未注册 group 场景会“假成功”（`summary=null` 仍返回 success） | `src/core-api.ts:180-184` | 待修复 |

### 🟡 P1 — 稳定性 / 契约一致性

| 优先级 | 问题 | 位置 | 状态 |
|--------|------|------|------|
| P1 | 任务超时后未取消原任务，可能出现“超时重试 + 原任务晚到副作用”双执行 | `src/task-scheduler.ts:245-247`, `src/task-scheduler.ts:319-362` | 待修复 |
| P1 | Feishu `sendImage()` 失败路径未清理临时文件，可能累积到 `/tmp` | `community-plugins/feishu/index.ts:414-417`, `community-plugins/feishu/index.ts:426-428`, `community-plugins/feishu/index.ts:467-470` | 待修复 |
| P1 | Web UI 聊天历史参数错位：`getChatHistory(50)` 把 `50` 当 group 使用 | `community-plugins/web-ui/server/routes/pages.ts:124`, `community-plugins/web-ui/server/services/chat.ts:75` | ✅ 已修复 |
| P1 | Web UI 流式协议与渲染契约不一致：工具/指标事件与 assistant 文本混流 | `community-plugins/web-ui/server/routes/api.ts:223-232`, `community-plugins/web-ui/server/routes/pages.ts:275-314` | ✅ 已修复 |
| P1 | 记忆插件默认 scope 仍偏向分组语义，不符合“跨渠道同一 FlashClaw”预期 | `plugins/memory/index.ts`, `src/core/memory.ts` | ✅ 已修复 |
| P1 | memory/memory-vector 插件通过类型断言访问私有配置（`mm as unknown as { config }`） | `plugins/memory/index.ts`, `community-plugins/memory-vector/index.ts` | ✅ 已修复 |
| P2 | 记忆文件写入缺少原子写，异常中断时可能导致文件不完整 | `src/core/memory.ts` | ✅ 已修复 |
| P2 | 记忆解析会跳过以 `#`/`>` 开头的正文行，存在内容丢失风险 | `src/core/memory.ts` | ✅ 已修复 |
| P2 | 每次构建系统提示都同步读取近期日志，存在可避免的 IO 开销 | `src/core/memory.ts` | ✅ 已修复 |

### 🟢 P2 — 建议改进

| 优先级 | 问题 | 位置 | 状态 |
|--------|------|------|------|
| P2 | Web UI 日志监听在异常路径可能泄漏文件描述符（`openSync/readSync` 非 finally 关闭） | `community-plugins/web-ui/server/services/logs.ts:177-180`, `community-plugins/web-ui/server/services/logs.ts:190-192` | 待修复 |
| P2 | `session-tracker` 与 `model-capabilities` 的上下文窗口映射不一致，导致 `/status` 与压缩提示可能失真 | `src/session-tracker.ts:173-196`, `src/core/model-capabilities.ts:28-58`, `src/core/model-capabilities.ts:105-123` | 待修复 |

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
- [x] CLI 终端交互 - 已下线，不再维护独立 CLI 渠道

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

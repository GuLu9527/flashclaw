# FlashClaw 开发路线图

> 当前版本: v1.8.0
> 更新时间: 2026-03-06

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

**Phase 5：Web UI 增强**

**5.2 实时状态系统（纯代码）**
- [x] SSE 实时推送 — 新增 `/sse/agent-state` 端点，替换轮询，状态变化即时推送
- [x] 状态机扩展 — 精确追踪 agent 生命周期: idle→thinking→tool_use→responding→error
- [x] 气泡实时更新 — 显示当前正在处理的消息内容/使用的工具名称
- [x] 位置平滑移动 — 活跃角色移动到区域中心，CSS transition 1s ease-in-out 平滑动画

**5.3 每日小记 & 记忆（纯代码）**
- [x] 今日/昨日小记 — 从 memory 插件 `data/memory/daily/` 读取展示（`/api/daily-note` API + DailyNote 组件）
- [x] 记忆时间线 — 展示全局+用户记忆条目（`/api/memories` API + MemoryTimeline 组件）
- [x] 对话统计 — 今日消息数、今日会话数（`/api/stats/today` API）

**5.4 渠道状态可视化（纯代码）**
- [x] 渠道状态卡（第一版）— Web UI 可访问 + 渠道插件启用态展示（避免误报在线状态）
- [ ] 渠道连接状态 — 飞书 ✅ / Telegram ❌ / Web UI ✅
- [ ] 最近消息来源 — 显示最后一条消息来自哪个渠道

**5.5 多 Agent 协作可视化**

> 后端多 Agent 基础设施详见 P1 第 4 节（人格系统 & 多 Agent）。
> 本节仅涉及 Web UI 前端可视化部分。

- [x] 实时状态同步 — agent-runner 通过 global live state 实时推送 thinking/responding/tool_use 状态到 SSE
- [ ] **Agent 聊天分配** — 对话框直接对接该 Agent 的聊天 API（`/api/chat/stream?group={agentId}`），每个 Agent 独立会话
- [ ] **任务看板** — Trello 风格的任务卡片流转（待办→进行中→完成）

**5.6 活动时间线（纯代码）**
- [x] 实时活动流（第一版）— 解析 `/api/activity` HTML，失败时回退到 status 推导事件
- [x] 活动图标 — 不同类型活动用不同图标/颜色
- [x] 可点击详情 — 点击活动条目展开详细信息（发送者、完整内容）

**5.7 Agent 可视化进阶（纯前端，后端见 P1 第 4 节）**
- [x] Agent 详情卡（第一版）— 点击角色查看状态、区域与全局服务统计
- [ ] **Agent 聚焦模式** — 点击角色后镜头跟随，显示详细信息面板（工具调用历史、记忆、统计）
- [ ] **Agent 之间对话气泡** — Agent 通信时在场景中实时显示消息气泡动画
- [ ] **经验值 & 等级 UI** — Agent 等级/经验条可视化（数据来源待后端支持）
- [ ] **技能库面板** — 可浏览和分配 Agent 技能的 UI（对应工具白名单配置）

**5.8 通用增强**
- [x] **macOS 26 液态玻璃 UI 重构** — 全面重写 CSS：毛玻璃效果、SF Pro 字体、spring 缓动、药丸按钮、暗/亮双主题
- [x] **SVG 图标精细化** — 导航图标重绘为 Lucide 风格（圆角线条、统一 stroke）
- [x] **聊天滚动优化** — 智能自动滚动 + 平滑 scrollTo + 发送时强制跳底
- [x] **Hono 模板 SyntaxError 修复** — renderSessionList 改 DOM API、恢复双反斜杠转义
- [ ] **多语言 i18n** — CN/EN 界面语言切换
- [ ] **移动端适配** — 响应式布局，手机端可查看状态看板
- [ ] **CEO 指令系统** — `$` 前缀命令直接对 Agent 下达高优先级指令
- [ ] **报告生成** — Agent 完成任务后可生成可视化报告（Markdown/HTML）
- [ ] **Kanban 拖拽** — 任务看板支持拖拽排序和状态变更


### 1. AI Provider 插件化完善
- [x] ollama-provider - 本地 Ollama 支持 (通过 openai-provider 配置 OPENAI_BASE_URL=http://localhost:11434/v1)
- [x] deepseek-provider - DeepSeek API 支持 (通过 openai-provider 配置 OPENAI_BASE_URL=https://api.deepseek.com/v1)
- [x] siliconflow-provider - 硅基流动 API 支持 (通过 openai-provider 配置 OPENAI_BASE_URL=https://api.siliconflow.cn/v1)
- [x] qianwen-provider - 通义千问 API 支持 (通过 openai-provider 配置 OPENAI_BASE_URL 需使用 DashScope)
- [x] mlx-openai-server - Apple MLX 支持 (通过 openai-provider 配置 OPENAI_BASE_URL=http://localhost:8000/v1，增加 `<tool_call>` 标签解析 + `<think>` 流式拦截)

### 2. 小模型友好优化 — 不依赖模型能力

**目标**：4B 小模型也能正确使用所有功能，代码层面保证行为正确。

- [x] **意图路由 + 工具过滤** — 根据用户消息关键词预筛选工具列表（7 类意图），recall 意图自动调用 memory_search 注入结果
- [x] **按需注入提示词** — 系统提示词按意图动态裁剪（schedule/web/memory 等意图只注入对应段落），减少小模型上下文占用
- [x] **工具参数后处理** — 工具执行前自动修正常见格式错误（时间格式→ISO、中文间隔→ms、字段名 snake_case→camelCase、scope/action 别名）
- [x] **基于规则的摘要** — `/compact fast` 支持不调用 AI 的规则摘要模式（提取最近 3 条用户消息 + 2 条 AI 回复要点）

### 3. 轻量 ReAct 自主循环
- [x] 核心增加 ReAct 循环配置（`REACT_MAX_ROUNDS` 环境变量，默认 10）
- [x] web_search 工具（DuckDuckGo 搜索，自动代理支持）
- [x] local_file_read 工具（本地文件读取 + 目录列表，安全白名单）
- [x] reminder 工具（简化版定时提醒，只需 message + time 两个参数，小模型友好）

---

## P1 - 重要功能

### 3. 记忆可视化 & 自动摘要
- [ ] Web UI 新增 /memory 时间线页面
- [ ] 长对话自动摘要写入 long_term_memory
- [ ] 记忆卡片组件

### 4. 人格系统 & 多 Agent（参考 OpenClaw）

> **调研来源**（2026-03-06 深度调研）：
> - OpenClaw SOUL.md 四段式结构（Core Truths / Boundaries / Vibe / Continuity）
> - OpenClaw 多 Agent 路由（8 级匹配：peer → parentPeer → guildId+roles → ... → default）
> - OpenClaw Session Tools（sessions_list / sessions_history / sessions_send / sessions_spawn）
> - OpenClaw Workspace Bootstrap（AGENTS.md / SOUL.md / USER.md / TOOLS.md / IDENTITY.md / MEMORY.md）
> - OpenClaw Prompt Modes（full / minimal / none）— 子 Agent 用精简提示词
> - soul.md 开源标准（composable, forkable, evolvable — 跨平台人格定义）
> - AgentOffice（Phaser + React 像素办公室、Agent 自动招聘、sessions_send 通信）

**当前 FlashClaw 现状：**
- ✅ 全局 SOUL.md（`~/.flashclaw/SOUL.md`）+ 会话级 SOUL.md（`data/groups/{folder}/SOUL.md`）
- ✅ init 向导支持自由文本人格输入
- ✅ 会话级优先于全局（`agent-runner.ts:390-403`）
- ❌ SOUL.md 无结构化模板，用户不知道该写什么
- ❌ 无人格切换命令（`/soul`）、无预置人格库
- ❌ 单 Agent 架构：所有渠道/群组共用同一个 Agent 人格和工具集
- ❌ 无 Agent 间通信、无工具白名单、无子 Agent 派生

---

**Phase 1：SOUL.md 增强（短期，不改架构）**

1.1 ✅ **结构化 SOUL.md 模板**
- 提供默认四段式模板文件 `souls/default.md`
- 格式参考 OpenClaw，适配 FlashClaw 场景：
  ```markdown
  # FlashClaw SOUL

  ## 核心身份
  你是 FlashClaw ⚡🦞，一只闪电龙虾。
  你快如闪电，说话简洁有力。

  ## 边界
  - 不编造事实，不确定时说"我不确定"
  - 尊重用户隐私，不主动询问私人信息
  - 群聊中保持克制，不要喧宾夺主
  - 有外部操作（发消息、操作浏览器）时先确认

  ## 风格
  - 简洁直接，不说废话（不要"好的！""当然可以！"）
  - 适度幽默，偶尔用海洋/闪电比喻
  - 有自己的观点，不做应声虫
  - 用 emoji 但不过度

  ## 记忆与成长
  - 记住用户的名字和偏好
  - 跨会话保持一致的性格
  - 每天做简短日志，记录有趣的对话
  ```

1.2 ✅ **预置人格库 `souls/` 目录**
- `souls/default.md` — 默认闪电龙虾人格
- `souls/serious.md` — 严肃专业助手（适合工作场景）
- `souls/casual.md` — 轻松幽默伙伴（适合日常聊天）
- `souls/minimal.md` — 极简助手（最少 token 占用，适合小模型）
- 目录位置：`~/.flashclaw/souls/` 或项目内 `data/souls/`

1.3 ✅ **`/soul` 聊天命令**
- `/soul` 或 `/soul show` — 显示当前人格名称和内容摘要
- `/soul list` — 列出所有可用人格（`souls/` 目录下的 `.md` 文件）
- `/soul use <name>` — 切换到指定人格（复制到当前会话的 SOUL.md）
- `/soul reset` — 恢复为默认人格
- 实现位置：`src/commands.ts` 新增 case，读写 SOUL.md 文件

1.4 ✅ **USER.md 支持（参考 OpenClaw）**
- 新增 `~/.flashclaw/USER.md` 文件，存放用户自我介绍
- 格式：
  ```markdown
  # 关于我
  - 名字：张三
  - 语言偏好：中文
  - 常用场景：工作沟通、技术问答
  - 备注：喜欢简洁回复，不喜欢废话
  ```
- 在 `agent-runner.ts` 的 `getGroupSystemPrompt` 中注入（在 SOUL.md 之后、工具说明之前）
- 与长期记忆互补：USER.md 是用户主动编辑的静态信息，长期记忆是 AI 观察到的动态信息

1.5 **init 向导增强**
- 人格配置改为模板选择（而不是自由输入）：
  ```
  ? 选择 AI 人格
  ○ 默认闪电龙虾 — 简洁有力，偶尔幽默
  ○ 严肃助手 — 专业正式，适合工作
  ○ 轻松伙伴 — 活泼有趣，适合日常
  ○ 极简模式 — 最少 token，适合小模型
  ○ 自定义 — 手动输入人格描述
  ```

---

**Phase 2：多 Agent 基础设施（中期，架构级变更）**

> 核心思路：参考 OpenClaw 的 "Agent = 独立人格 + 独立工具集 + 独立会话" 模型，
> 但简化路由规则（OpenClaw 8 级太复杂），FlashClaw 只做 "按渠道/群组绑定"。

2.1 ✅ **Agent 注册表**
- 配置文件：`~/.flashclaw/agents.json`（或 `config.json` 的 `agents` 字段）
- 格式：
  ```json
  {
    "agents": [
      {
        "id": "main",
        "name": "FlashClaw",
        "soul": "souls/default.md",
        "model": null,
        "tools": ["*"],
        "default": true
      },
      {
        "id": "work",
        "name": "工作助手",
        "soul": "souls/serious.md",
        "model": "openai-provider",
        "tools": ["schedule_task", "list_tasks", "memory", "web_fetch", "send_message"],
        "bindings": [
          { "channel": "feishu", "group": "work-*" }
        ]
      },
      {
        "id": "life",
        "name": "生活伙伴",
        "soul": "souls/casual.md",
        "model": null,
        "tools": ["memory", "send_message", "schedule_task"],
        "bindings": [
          { "channel": "telegram" }
        ]
      }
    ]
  }
  ```
- 核心类型：
  ```typescript
  interface AgentConfig {
    id: string;              // 唯一标识
    name: string;            // 显示名称
    soul: string;            // SOUL.md 文件路径（相对于 ~/.flashclaw/）
    model?: string | null;   // AI Provider 名称（null = 使用默认）
    tools: string[];         // 工具白名单（["*"] = 全部）
    default?: boolean;       // 是否为默认 Agent
    bindings?: AgentBinding[];
  }
  interface AgentBinding {
    channel?: string;        // 渠道名（feishu / telegram / web-ui / *）
    group?: string;          // 群组名/ID（支持通配符 work-*）
    peer?: string;           // 私聊对象 ID
  }
  ```

2.2 ✅ **消息路由改造**
- 当前：消息 → `handleIncomingMessage` → 注册群组 → 触发 Agent（同一个）
- 改造后：消息 → `handleIncomingMessage` → **resolveAgent(msg)** → 注册群组 → 触发 **指定** Agent
- 路由匹配规则（3 级，比 OpenClaw 简化）：
  1. `peer` 精确匹配（特定私聊用户绑定到特定 Agent）
  2. `channel + group` 匹配（特定渠道的特定群组）
  3. `channel` 匹配（整个渠道）
  4. 回退到 `default: true` 的 Agent
- 路由结果影响：
  - 使用该 Agent 的 SOUL.md（人格）
  - 使用该 Agent 的 model（AI Provider）
  - 使用该 Agent 的 tools 白名单过滤工具列表
  - 会话仍按 chatId 隔离（不变）

2.3 ✅ **Agent 间通信（`agent_send` 工具）**
- 参考 OpenClaw 的 `sessions_send`，但简化：
  ```json
  {
    "name": "agent_send",
    "description": "向另一个 Agent 发送消息并等待回复",
    "input_schema": {
      "type": "object",
      "properties": {
        "agentId": { "type": "string", "description": "目标 Agent ID" },
        "message": { "type": "string", "description": "要发送的消息" },
        "timeoutSeconds": { "type": "number", "description": "等待超时（秒），0=不等待" }
      },
      "required": ["agentId", "message"]
    }
  }
  ```
- 执行流程：
  1. 创建临时会话 → 调用目标 Agent 的 `runAgent`
  2. 如果 `timeoutSeconds > 0`：等待结果返回
  3. 如果 `timeoutSeconds = 0`：异步执行，返回 `{ status: "accepted", runId }`
- 安全：只能调用已注册的 Agent，不能自己调用自己

2.4 ✅ **工具白名单**
- 已有基础：意图路由 `filterToolsByIntent` 可以过滤工具
- 扩展：在意图过滤之前，先按 Agent 配置的 `tools` 字段过滤
  ```typescript
  // agent-runner.ts runAgentOnce 中
  let allTools = getAllTools();
  if (agentConfig.tools[0] !== '*') {
    const allowed = new Set(agentConfig.tools);
    allTools = allTools.filter(t => allowed.has(t.name));
  }
  // 然后再走意图路由 filterToolsByIntent
  ```

2.5 **Prompt Mode（提示词分级）**
- 参考 OpenClaw 的 full / minimal / none：
  - `full`（默认）：完整系统提示词 + SOUL + USER + 记忆 + 工具说明
  - `minimal`（子 Agent / agent_send 调用）：只有身份声明 + 工具说明 + 当前时间
  - `none`（极简）：只有一行身份声明
- 在 `getGroupSystemPrompt` 中根据 `promptMode` 参数裁剪

2.6 **子 Agent 派生（`agent_spawn`）**
- 参考 OpenClaw 的 `sessions_spawn`，但简化：
  - 主 Agent 可以派生临时子 Agent 执行特定任务
  - 子 Agent 使用 `minimal` 提示词模式
  - 子 Agent 不能再派生子 Agent（防止无限递归）
  - 完成后自动归档

---

**Phase 3：多 Agent 可视化（长期，依赖 Phase 2）**

- 实时显示每个 Agent 的状态（idle/thinking/tool_use/responding/error）
- 点击 Agent 查看人格、工具列表、会话统计
- Agent 间通信显示为气泡动画
- 任务看板（Trello 风格）显示各 Agent 的任务流转

---

**执行优先级建议：**
- Phase 1.1 + 1.2（SOUL 模板 + 预置人格库）→ 最小改动，最大用户感知
- Phase 1.3（/soul 命令）→ 用户体验闭环
- Phase 1.4（USER.md）→ 进一步个性化
- Phase 2.1 + 2.4（Agent 注册表 + 工具白名单）→ 架构核心
- Phase 2.2（消息路由改造）→ 多 Agent 生效
- Phase 2.3（Agent 间通信）→ 协作能力
- Phase 3（可视化）→ 前端 agent 负责

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
| P0 | 队列时间戳推进错误：批处理后仅推进到当前 `msg.timestamp`，可能重复处理同一批消息并重复回复 | `src/index.ts:411` | ✅ 已修复 |
| P0 | `/new` 在未注册 group 场景可能"看起来成功但未真正清会话" | `src/core-api.ts:156-177` | ✅ 已修复 |
| P0 | `/compact` 在未注册 group 场景会"假成功"（`summary=null` 仍返回 success） | `src/core-api.ts:183-191` | ✅ 已修复 |

### 🟡 P1 — 稳定性 / 契约一致性

| 优先级 | 问题 | 位置 | 状态 |
|--------|------|------|------|
| P1 | 任务超时后未取消原任务，可能出现"超时重试 + 原任务晚到副作用"双执行 | `src/task-scheduler.ts:195-236` | ✅ 已修复 |
| P1 | Feishu `sendImage()` 失败路径未清理临时文件，可能累积到 `/tmp` | `community-plugins/feishu/index.ts:396-470` | ✅ 已修复 |
| P1 | Web UI SSR fallback 聊天历史参数错位：`getChatHistory(50)` 把 `50` 当 group 使用 | `community-plugins/web-ui/server/routes/pages.ts:124` | ✅ 已修复 |
| P1 | Web UI SSR fallback 流式渲染仍会把 tool 事件混入 assistant 文本 | `community-plugins/web-ui/server/routes/pages.ts:302-308` | ✅ 已修复 |
| P1 | Web UI React 日志页 SSE 清理失效：`useEffect` 未返回 `EventSource.close()` | `community-plugins/web-ui/frontend/src/pages/Logs.tsx:23-54` | ✅ 已修复 |
| P1 | 记忆插件默认 scope 仍偏向分组语义，不符合"跨渠道同一 FlashClaw"预期 | `plugins/memory/index.ts`, `src/core/memory.ts` | ✅ 已修复 |
| P1 | memory/memory-vector 插件通过类型断言访问私有配置（`mm as unknown as { config }`） | `plugins/memory/index.ts`, `community-plugins/memory-vector/index.ts` | ✅ 已修复 |
| P2 | 记忆文件写入缺少原子写，异常中断时可能导致文件不完整 | `src/core/memory.ts` | ✅ 已修复 |
| P2 | 记忆解析会跳过以 `#`/`>` 开头的正文行，存在内容丢失风险 | `src/core/memory.ts` | ✅ 已修复 |
| P2 | 每次构建系统提示都同步读取近期日志，存在可避免的 IO 开销 | `src/core/memory.ts` | ✅ 已修复 |

### ✅ 亮点

- 插件架构设计清晰，类型安全且可扩展
- 拓扑排序加载处理了插件依赖顺序
- IPC 安全完善（文件大小/chatId 长度限制、错误文件隔离）
- 上下文保护（自动压缩 + 拒绝超限请求）
- 优雅关闭（10 步有序清理）
- 工具结果截断 + 历史压缩有效控制 token 用量
- 消息队列（去重、并发控制、超时、重试）

## 代码审查摘要 (2026-03-06)

> 审查范围：commit `47681f3` — 移除 CLI 渠道、anthropic-provider mock 模式、web-ui core-api 迁移

### 🔴 P0 — 运行时 Bug

| 优先级 | 问题 | 位置 | 状态 |
|--------|------|------|------|
| P0 | Logs.tsx SSE 永不清理 — `fetchLogs` 是 async 函数，`return () => evtSource.close()` 在 Promise 内部，useEffect 无法拿到 cleanup；页面切换后 EventSource 连接泄漏 | `community-plugins/web-ui/frontend/src/pages/Logs.tsx:23-54` | ✅ 已修复 |
| P0 | SSR fallback 聊天历史参数类型错误 — `getChatHistory(50)` 把数字 50 传给 `group: string`，实际查询 `50-chat`，永远返回空 | `community-plugins/web-ui/server/routes/pages.ts:124` | ✅ 已修复 |

### 🟡 P1 — 稳定性 / 安全

| 优先级 | 问题 | 位置 | 状态 |
|--------|------|------|------|
| P1 | Cookie `Secure` flag 在 HTTP 下失效 — 本地 HTTP 访问时带 `Secure` 的 cookie 不被浏览器接受，登录后 cookie 丢失。建议按协议动态设置 | `community-plugins/web-ui/server/app.ts:88` | ✅ 已修复 |
| P1 | chat.ts DB 写入失败完全静默 — `saveMessageToDb` 的 catch 块为空，数据丢失时无任何日志 | `community-plugins/web-ui/server/services/chat.ts:65-67` | ✅ 已修复 |
| P1 | Banner 硬编码 Web UI URL — 即使 web-ui 插件未加载，也显示 `http://127.0.0.1:3000 ← Web UI`，误导用户 | `src/index.ts:1146` | ✅ 已修复 |
| P1 | Chat.tsx 死代码 — `assistantIdx` 变量声明后从未使用，引用闭包中可能过期的 `messages.length` | `community-plugins/web-ui/frontend/src/pages/Chat.tsx:54` | 建议 |
| P1 | status.ts 活动数据源硬编码 — `getRecentActivity` 只查 `main-chat`，其他渠道/群组活动不可见 | `community-plugins/web-ui/server/services/status.ts:75-103` | ✅ 已修复 |

### ✅ 亮点

- CLI 渠道清理彻底 — `cli-channel/`、`cli-ink.tsx`、package.json 依赖全部移除，无残留引用
- anthropic-provider Mock 模式完整 — `chat`/`chatStream`/`handleToolUse` 三条路径均覆盖
- web-ui services 完成 core-api 迁移 — `chat.ts`/`status.ts` 统一走 `core-api`
- NDJSON 流式协议 — 用 `\n` 分隔完整 JSON，避免 SSE/chunk 边界截断问题

---

## 待优化项

### 🔴 高优先级

**架构解耦（核心极简化）：**
- [ ] `index.ts` IPC 任务处理外移 — `processTaskIpc` 内嵌了 `schedule_task`/`pause_task`/`resume_task`/`cancel_task`/`register_group` 五种处理逻辑（含 Zod schema、cron 解析、DB 操作），应改为插件可注册的 IPC handler 机制
- [ ] `task-scheduler.ts` 插件化 — 整个文件 430+ 行是定时任务调度逻辑，`index.ts` 直接 import `startSchedulerLoop`/`wake`，应改为由 schedule-task 插件自行管理生命周期
- [ ] `tool-params.ts` 硬编码工具名 — `NORMALIZERS` 映射表直接引用 `schedule_task`（已不是核心插件），应改为插件可注册参数修正器
- [ ] `agent-runner.ts` 意图路由硬编码 — `INTENT_ROUTES` 数组硬编码了 `schedule_task`/`list_tasks`/`register_group` 等工具名，应改为插件可注册意图规则
- [ ] `agent-runner.ts` 系统提示词耦合 — `getGroupSystemPrompt` 中硬编码了 `## schedule_task 时间计算` 使用说明，应改为插件可注入提示词片段
- [ ] `db.ts` 任务 schema 解耦 — `createTask`/`getAllTasks` 等 ScheduledTask 专用函数让核心 DB 层与定时任务强耦合，考虑改为通用 KV 存储 + 插件自建表
- [ ] `core-api.ts` 任务接口解耦 — `getTasks()` 函数直接暴露任务查询，应通过插件注册 API 扩展点

**已完成：**
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

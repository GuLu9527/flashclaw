# StatusBoard 深化方案 — 方案 A 细化

> 目标：将 658 行的单文件 StatusBoard.tsx 拆分为独立组件，新增"角色聚焦"、"活动时间线"、"渠道状态卡"三大交互，为后续接入 SSE 实时数据打好基础。
>
> 约束：纯前端改动，不改后端。数据暂用轮询 `/api/status` + 前端 fallback 占位。

---

## 一、调研参考

| 项目 | 亮点 | FlashClaw 可借鉴 |
|------|------|-------------------|
| **Star-Office-UI** (ringhyacinth) | 6 种状态映射到办公室区域；昨日小记卡片；多 Agent join key；中英日三语 | 区域映射逻辑、小记卡片布局、状态→区域→动画的三层映射 |
| **AgentOffice** (harishkotra) | Phaser 像素渲染 + React UI overlay；Colyseus 实时状态同步；点击角色 Focus Mode 镜头跟随；Agent 自动招聘；活动日志面板 | **Focus Mode 交互模式**（点击角色→右侧面板）、活动日志时间线、React overlay 分层思路 |
| **pixel-agents** (VS Code) | Claude Code agent 团队可视化；子 agent 委派追踪；精灵帧动画 | 多 agent 并行状态展示、任务委派连线 |
| **pixel-office** (r266-tech) | Boss 巡逻检查 worker；AI 生成背景；agent 之间对话气泡；区域高亮 | 气泡系统、区域 hover 高亮 |

### 关键设计模式总结

1. **场景层 + UI 层分离** — AgentOffice 用 Phaser 做场景 + React 做 overlay；我们用纯 React + SVG/CSS 做场景，交互面板用 React 组件覆盖在场景外
2. **状态→区域→动画 三层映射** — Star-Office-UI 的核心：`state → zone → animation`，FlashClaw 已有 `STATE_MAP` + `ROLE_MAP` + `ROOM_ZONE_META`，结构一致
3. **Focus Mode** — AgentOffice 的亮点：点击角色后镜头 lerp 跟随 + 右侧 Inspector 面板展开。FlashClaw 简化为：点击角色 → 高亮 + 右侧详情面板
4. **活动时间线** — AgentOffice 的 SystemLog + Star-Office 的小记，合并为一个统一的 ActivityTimeline 组件

---

## 二、组件拆分方案

### 目标文件结构

```
frontend/src/
├── pages/
│   └── StatusBoard.tsx          # 瘦页面：组合各组件 + 管理全局状态
├── components/
│   └── status-board/
│       ├── RoomScene.tsx         # 办公室场景（区域 + 家具 + 角色精灵）
│       ├── LobsterAvatar.tsx     # 龙虾角色 SVG 组件（从 StatusBoard 提取）
│       ├── AgentDetailCard.tsx   # 角色聚焦详情面板
│       ├── ActivityTimeline.tsx  # 活动时间线
│       ├── ChannelStatusCard.tsx # 渠道状态卡片
│       ├── DailyNote.tsx        # 今日小记（已有，提取出来）
│       ├── constants.ts         # STATE_MAP / ROLE_MAP / ROOM_ZONE_META 等常量
│       └── types.ts             # 共享类型定义
```

### 各组件职责

#### 1. `constants.ts` — 提取常量

从 StatusBoard.tsx 提取以下到独立文件：
- `STATE_MAP` (AgentState → StateConfig)
- `ROLE_MAP` (AgentRole → RoleConfig)
- `ROOM_ZONE_META` (RoomZone → 区域位置)
- `ROOM_IDLE_NOTES`
- 类型：`AgentState`, `AgentRole`, `RoomZone`, `StateConfig`, `RoleConfig`, `RoomAgent`

#### 2. `types.ts` — 共享类型

```typescript
export interface ServiceStatus {
  running: boolean;
  pid: number | null;
  uptime: string | null;
  messageCount: number;
  activeSessions: number;
  activeTaskCount: number;
  totalTaskCount: number;
  provider: string | null;
  model: string | null;
}

export interface ActivityItem {
  id: string;
  time: string;
  type: 'message' | 'tool_use' | 'task' | 'system';
  icon: string;        // emoji 或 lucide icon name
  title: string;
  detail?: string;
  agent?: AgentRole;
}

export interface ChannelInfo {
  name: string;
  displayName: string;
  connected: boolean;
  lastMessage?: string;
  icon: string;         // emoji 占位
}
```

#### 3. `LobsterAvatar.tsx` — 龙虾角色 SVG

从 StatusBoard.tsx 提取 `LightningLobsterAvatar` 及其依赖的 `renderStateEffect`、`renderRolePattern`、`renderRoleAccessory` 函数。

**接口不变**：`{ role, state, animated, size }`

#### 4. `RoomScene.tsx` — 办公室场景

从 StatusBoard.tsx 提取 `RoomZones`、`RoomFurniture`、`RoomAgentSprite`，组合为一个完整的场景组件。

**Props**：
```typescript
interface RoomSceneProps {
  agents: RoomAgent[];
  activeRole: AgentRole;
  onAgentClick: (role: AgentRole) => void;  // 新增：点击角色回调
  status: ServiceStatus | null;
}
```

**新增交互**：
- 角色 sprite 可点击（`cursor-pointer`）
- 点击后触发 `onAgentClick`，由父组件控制哪个角色被聚焦
- 被聚焦的角色有额外视觉效果（放大 + 光晕 ring）
- 区域 hover 时显示半透明高亮 + tooltip 标签

#### 5. `AgentDetailCard.tsx` — 角色聚焦详情面板 ⭐ 新功能

**灵感来源**：AgentOffice 的 Inspector 面板

**触发方式**：点击 RoomScene 中的角色精灵

**展示内容**：
```
┌──────────────────────────────┐
│  [龙虾头像 64px]              │
│  Coordinator · 调度中         │
│  ─────────────────────────── │
│  📍 区域: 会议区              │
│  🔧 当前: 正在分配任务        │
│  💬 气泡: "让我协调一下..."   │
│  ─────────────────────────── │
│  📊 统计                     │
│  · 今日消息: 12              │
│  · 工具调用: 5               │
│  · 运行时间: 2h 15m          │
│  ─────────────────────────── │
│  🎯 角色说明                 │
│  负责调度、协调与对外回复。   │
│  ─────────────────────────── │
│  [关闭]                      │
└──────────────────────────────┘
```

**Props**：
```typescript
interface AgentDetailCardProps {
  role: AgentRole;
  state: AgentState;
  status: ServiceStatus | null;
  onClose: () => void;
}
```

**数据来源**：
- 角色/状态信息 → `ROLE_MAP` / `STATE_MAP` 常量
- 统计数据 → `ServiceStatus`（消息数、会话数等，暂为全局数据，后续可按 agent 拆分）
- 当前暂无按 agent 拆分的 API，统计数据先用全局值 + "仅 Main Agent 有真实数据" 提示

#### 6. `ActivityTimeline.tsx` — 活动时间线 ⭐ 新功能

**灵感来源**：AgentOffice 的 SystemLog + Star-Office 的小记

**数据来源**：
- 当前：轮询 `/api/activity`（已有接口，返回最近消息）
- 前端 fallback：首次加载时从 `/api/status` 推导系统事件（启动、状态变化等）
- 未来：接 SSE `/sse/agent-state` 实时推送

**展示形式**：竖向时间线，每条带图标 + 时间 + 描述

```
  🟢 15:30:22  系统启动
  💬 15:31:05  用户发送消息
  🔧 15:31:08  调用工具 web_fetch
  💬 15:31:15  FlashClaw 回复
  ⏰ 15:35:00  定时任务执行
```

**Props**：
```typescript
interface ActivityTimelineProps {
  maxItems?: number;     // 默认 20
  pollInterval?: number; // 默认 5000ms
}
```

**实现要点**：
- 使用 `useEffect` + `setInterval` 轮询 `/api/activity`
- 解析返回的 `{ time, sender, content, chatId }` 为 `ActivityItem`
- 根据 sender/content 推导 type 和 icon
- 新条目用 CSS `animation: fadeInUp` 滑入
- 最多保留最近 50 条，超出自动裁剪

#### 7. `ChannelStatusCard.tsx` — 渠道状态卡片 ⭐ 新功能

**展示内容**：每个渠道一个小卡片，显示连接状态

```
┌─────────┐  ┌─────────┐  ┌──────────┐
│ 🌐      │  │ 🐦      │  │ 💬       │
│ Web UI  │  │ Feishu  │  │ Telegram │
│ ✅ 在线  │  │ ❌ 离线  │  │ ❌ 离线   │
└─────────┘  └─────────┘  └──────────┘
```

**数据来源**：
- 当前无专用渠道状态 API
- 暂用硬编码 + `/api/status` 的 `running` 推导：
  - Web UI 总是 ✅（因为你能看到这个页面）
  - 其他渠道先显示为 "未知" 或用 `/api/plugins` 判断是否已加载
- 未来：后端新增 `/api/channels` 接口

**Props**：
```typescript
interface ChannelStatusCardProps {
  status: ServiceStatus | null;
}
```

#### 8. `DailyNote.tsx` — 今日小记

从 StatusBoard.tsx 提取现有的 `DailyNote` 组件。

**当前状态**：只有 UI 壳，`dailyNote` 始终为 `null`。

**本轮改动**：
- 提取为独立组件
- 尝试从 `/api/status` 或新增的 `/api/daily-note` 获取数据
- 如果后端没有此接口，保持占位状态，显示"暂无今日记录 · 等待后端接口"

---

## 三、页面布局设计

### StatusBoard.tsx 瘦页面

```
┌────────────────────────────────────────────────────┐
│ ⚡ 状态看板                                         │
├────────────────────────────────────────────────────┤
│                                                    │
│  ┌──────────────────────────────────────────────┐  │
│  │                                              │  │
│  │            RoomScene (办公室场景)              │  │
│  │     6 只龙虾 + 区域 + 家具 + 气泡             │  │
│  │     点击角色 → 触发 AgentDetailCard           │  │
│  │                                              │  │
│  └──────────────────────────────────────────────┘  │
│                                                    │
│  ┌─────────────────────┐  ┌─────────────────────┐  │
│  │                     │  │                     │  │
│  │   当前状态摘要       │  │   今日小记           │  │
│  │   (现有的状态卡)     │  │   DailyNote          │  │
│  │                     │  │                     │  │
│  └─────────────────────┘  └─────────────────────┘  │
│                                                    │
│  ┌──────────────────────────────────────────────┐  │
│  │              渠道状态                         │  │
│  │  🌐 Web UI ✅  |  🐦 Feishu ❌  |  💬 TG ❌  │  │
│  └──────────────────────────────────────────────┘  │
│                                                    │
│  ┌──────────────────────────────────────────────┐  │
│  │              活动时间线                        │  │
│  │  15:30 🟢 系统启动                            │  │
│  │  15:31 💬 用户发送消息                         │  │
│  │  15:31 🔧 调用工具 web_fetch                   │  │
│  │  15:31 💬 FlashClaw 回复                      │  │
│  └──────────────────────────────────────────────┘  │
│                                                    │
│  ┌──────────────────────────────────────────────┐  │
│  │         AgentDetailCard (点击角色时弹出)       │  │
│  │         浮层或右侧抽屉                        │  │
│  └──────────────────────────────────────────────┘  │
│                                                    │
└────────────────────────────────────────────────────┘
```

### AgentDetailCard 展示方式

**推荐：底部抽屉 / 右侧浮层**

- 点击角色 → 场景下方滑出详情面板（`transform: translateY`）
- 或者在移动端用全屏 modal
- 点击其他角色切换、点击 × 或场景空白关闭

---

## 四、数据流设计

### 状态管理

StatusBoard.tsx 作为状态容器：

```typescript
// StatusBoard.tsx（瘦页面）
const [status, setStatus] = useState<ServiceStatus | null>(null);
const [agentState, setAgentState] = useState<AgentState>('idle');
const [focusedAgent, setFocusedAgent] = useState<AgentRole | null>(null);

// 轮询 /api/status
useEffect(() => {
  const fetch = async () => { ... };
  fetch();
  const timer = setInterval(fetch, 3000);
  return () => clearInterval(timer);
}, []);

// 推导 agent 状态
const activeRole = inferActiveRole(agentState);
const roomAgents = useMemo(() => buildRoomAgents(activeRole, agentState), [activeRole, agentState]);

return (
  <div>
    <h1>状态看板</h1>
    <RoomScene
      agents={roomAgents}
      activeRole={activeRole}
      onAgentClick={setFocusedAgent}
      status={status}
    />
    <div className="grid grid-cols-2 gap-4">
      <StatusSummary status={status} state={agentState} activeRole={activeRole} />
      <DailyNote />
    </div>
    <ChannelStatusCard status={status} />
    <ActivityTimeline />
    {focusedAgent && (
      <AgentDetailCard
        role={focusedAgent}
        state={focusedAgent === activeRole ? agentState : 'idle'}
        status={status}
        onClose={() => setFocusedAgent(null)}
      />
    )}
  </div>
);
```

### API 依赖

| 组件 | API | 现有/新增 |
|------|-----|-----------|
| RoomScene | `/api/status` | 现有 |
| AgentDetailCard | `/api/status` | 现有 |
| ActivityTimeline | `/api/activity` | 现有（已在 `routes/api.ts` 中） |
| ChannelStatusCard | `/api/plugins` | 现有（判断渠道插件是否加载） |
| DailyNote | 无后端接口 | 占位 |

---

## 五、执行步骤（建议顺序）

### Step 1：提取常量和类型（~15 min）
- 创建 `components/status-board/constants.ts`
- 创建 `components/status-board/types.ts`
- 从 StatusBoard.tsx 移出所有常量和类型

### Step 2：提取 LobsterAvatar（~15 min）
- 创建 `components/status-board/LobsterAvatar.tsx`
- 移出 `LightningLobsterAvatar` + `renderStateEffect` + `renderRolePattern` + `renderRoleAccessory`

### Step 3：提取 RoomScene（~20 min）
- 创建 `components/status-board/RoomScene.tsx`
- 移出 `RoomZones` + `RoomFurniture` + `RoomAgentSprite`
- 新增 `onAgentClick` prop + 点击交互（cursor-pointer + onClick）
- 新增区域 hover 高亮效果

### Step 4：提取 DailyNote（~5 min）
- 创建 `components/status-board/DailyNote.tsx`
- 简单提取，保持原样

### Step 5：新增 AgentDetailCard（~30 min）
- 创建 `components/status-board/AgentDetailCard.tsx`
- 实现点击角色后的详情浮层
- 包含：头像 + 角色信息 + 状态 + 统计 + 角色说明
- 动画：从底部滑入（`transition-transform duration-300`）

### Step 6：新增 ActivityTimeline（~25 min）
- 创建 `components/status-board/ActivityTimeline.tsx`
- 轮询 `/api/activity`
- 解析为时间线条目
- 带 fadeIn 动画

### Step 7：新增 ChannelStatusCard（~15 min）
- 创建 `components/status-board/ChannelStatusCard.tsx`
- 从 `/api/plugins` 获取已加载的渠道插件
- Web UI 固定显示在线

### Step 8：重写 StatusBoard.tsx（~20 min）
- 瘦化为 ~80 行的组合页面
- 组合所有子组件
- 管理 focusedAgent 状态

### Step 9：修复遗留 Bug（~10 min）
- `Logs.tsx` SSE 清理：将 EventSource 提到 useEffect 顶层
- `Chat.tsx` 死代码：删除未使用的 `assistantIdx`

---

## 六、CSS 动画补充

在 `index.css` 中需要新增的动画：

```css
/* 角色点击聚焦光晕 */
.room-agent-focused {
  filter: drop-shadow(0 0 12px rgba(250, 204, 21, 0.6));
}

/* 详情面板滑入 */
.detail-slide-in {
  animation: slideUp 0.3s ease-out;
}
@keyframes slideUp {
  from { transform: translateY(100%); opacity: 0; }
  to { transform: translateY(0); opacity: 1; }
}

/* 时间线条目淡入 */
.timeline-item-enter {
  animation: fadeInUp 0.3s ease-out;
}
@keyframes fadeInUp {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}

/* 区域 hover 高亮 */
.room-zone-hover:hover {
  background-color: rgba(250, 204, 21, 0.08) !important;
  border-color: rgba(250, 204, 21, 0.3) !important;
  transition: all 0.2s ease;
}
```

---

## 七、注意事项

1. **不改后端** — 本轮纯前端改动，所有数据用现有 API + 前端 fallback
2. **保持像素风** — 使用现有的 `pixel-*` Tailwind 变量，不引入新的设计系统
3. **移动端兼容** — AgentDetailCard 在窄屏用全宽浮层，ActivityTimeline 用紧凑模式
4. **性能** — RoomScene 用 `useMemo` 缓存 agents 列表，避免每次 render 重算
5. **Logs.tsx SSE Bug** — Step 9 一并修复，把 `EventSource` 提到 `useEffect` 同步作用域
6. **Chat.tsx 死代码** — Step 9 删除 `const assistantIdx = messages.length + 1;`

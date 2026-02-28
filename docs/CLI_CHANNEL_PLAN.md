# CLI 渠道插件实施文档

> 创建日期: 2026-02-27
> 状态: 待实现 (增强版)
> 版本: v2.0.0

---

## 1. 项目概述

### 1.1 目标

为 FlashClaw 实现类似 Claude Code / Codex 的 CLI 对话功能：

- **持久会话** - 记住对话上下文，多次交互
- **工具调用** - 可以使用各种工具（browser-control、memory 等）
- **真正可用的 REPL** - 像正常聊天一样连续对话

### 1.2 对比现状

| 功能 | 当前实现 | 目标实现 |
|------|----------|----------|
| 会话持久 | ❌ 每次新建 | ✅ 记住历史 |
| 工具加载 | ❌ toolCount: 0 | ✅ 完整工具链 |
| 多轮对话 | ❌ 单次问答 | ✅ 连续对话 |
| 上下文管理 | ❌ 无 | ✅ memory 集成 |

### 1.3 架构定位

```
FlashClaw 启动流程 (CLI 模式)

┌─────────────────────────────────────────┐
│           flashclaw repl               │
└──────────────────┬──────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────┐
│         1. 初始化配置                    │
│    - 加载 .env 配置                     │
│    - 初始化数据库                       │
└──────────────────┬──────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────┐
│         2. 加载插件系统                 │
│    - 内置工具插件 (memory, schedule...)  │
│    - 社区插件 (飞书、telegram 可选)      │
│    - 注册到 pluginManager               │
└──────────────────┬──────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────┐
│         3. 初始化 Agent                 │
│    - 创建 AgentRunner 实例              │
│    - 加载 memory 上下文                 │
└──────────────────┬──────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────┐
│         4. 启动 REPL 循环               │
│    - 等待用户输入                       │
│    - 调用 Agent + 工具                  │
│    - 显示响应                           │
└─────────────────────────────────────────┘
```

---

## 2. 功能需求

### 2.1 启动方式

```bash
# 交互式 REPL（默认）
flashclaw repl
flashclaw repl --group <group-folder>

# 管道输入模式
echo "你好" | flashclaw repl

# 单次问答（非交互）
flashclaw repl --ask "你好" --group my-group

# 哑终端模式（无彩色输出，适合脚本）
flashclaw repl --batch
```

### 2.2 REPL 内置命令

| 命令 | 简写 | 说明 |
|------|------|------|
| `/new` | `/n` | 新建会话（清除上下文） |
| `/compact` | `/c` | 压缩上下文 |
| `/status` | `/s` | 查看状态（Token、模型等） |
| `/history [n]` | `/h [n]` | 查看最近 n 条消息 |
| `/quit` | `/q` | 退出程序 |
| `/clear` | | 清除终端显示 |
| `/help` | `/?` | 显示帮助 |

### 2.3 输出效果

```bash
⚡ FlashClaw CLI v1.5.0
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
输入 /help 查看可用命令

> 你好，帮我查一下今天天气

🤖 (正在思考... )
今天天气晴朗，气温20-28°C，适合外出。

> 帮我设置一个明天上午9点的会议提醒
⚡ [调用工具: schedule_task]
✅ 已创建定时任务：明天上午9点会议提醒

> /status
┌─────────────────────────────────────┐
│ 当前模型: claude-sonnet-4-20250514  │
│ 使用 Token: 1,234 / 100,000         │
│ 消息数: 5                           │
│ 群组: default                       │
└──────────────────────────────────────┘
```

---

## 3. 技术方案

### 3.1 核心改动

#### 3.1.1 初始化插件系统

当前问题：`runAgent()` 不加载工具

解决：需要先初始化完整的插件系统

```typescript
// 在 REPL 启动前初始化
async function initForRepl(): Promise<void> {
  // 1. 加载配置
  dotenv.config();

  // 2. 初始化数据库
  initDatabase();

  // 3. 加载内置插件
  const builtinPluginsDir = getBuiltinPluginsDir();
  await loadFromDir(builtinPluginsDir);

  // 4. 加载社区插件
  const communityPluginsDir = getCommunityPluginsDir();
  await loadFromDir(communityPluginsDir);
}
```

#### 3.1.2 会话持久化

使用 memory 管理对话历史：

```typescript
class CLIRepl {
  private memoryManager: MemoryManager;

  async callAgent(prompt: string): Promise<void> {
    // 1. 获取历史上下文
    const context = this.memoryManager.getContext(this.group);

    // 2. 调用 Agent（带上下文）
    const result = await runAgent(this.group, {
      prompt,
      history: context.messages,
    });

    // 3. 保存到记忆
    this.memoryManager.remember(this.group, 'user', prompt);
    this.memoryManager.remember(this.group, 'assistant', result);
  }
}
```

### 3.2 文件结构

```
src/
├── cli.ts                 # CLI 入口
├── agent-runner.ts        # Agent 运行器 (复用)
├── core/
│   ├── memory.ts          # 记忆系统 (复用)
│   └── api-client.ts      # API 客户端 (复用)
└── plugins/
    ├── loader.ts          # 插件加载器 (复用)
    └── manager.ts         # 插件管理器 (复用)
```

### 3.3 流程图

```
┌──────────────────────────────────────────────────────────┐
│                    REPL 主流程 (v2)                       │
└──────────────────────────────────────────────────────────┘

  1. initForRepl()
     │
     ▼
  2. 加载插件系统 (loadFromDir)
     │
     ▼
  3. 打印欢迎信息
     │
     ▼
  ┌───────────────────────────────────────┐
  │           REPL 循环                    │
  │ 4. 等待用户输入                        │
  │    │                                  │
  │    ▼                                  │
  │ 5. 解析命令 (/new, /status, /quit)   │
  │    │                                  │
  │    ├── 命令 ──► 执行内置功能            │
  │    │       │                          │
  │    │       ▼                          │
  │    │    返回 REPL 循环                 │
  │    │                                  │
  │    └── 消息 ──► callAgent            │
  │        │                              │
  │        ▼                              │
  │    获取 memory 上下文                 │
  │        │                              │
  │        ▼                              │
  │    runAgent (已加载工具!)             │
  │        │                              │
  │        ▼                              │
  │    工具调用处理 (browser-control 等)  │
  │        │                              │
  │        ▼                              │
  │    保存到 memory                      │
  │        │                              │
  │        ▼                              │
  │    显示最终回复                        │
  │        │                              │
  │        ▼                              │
  └───────返回 REPL 循环                   │
           │
           ▼
  6. 用户退出 (/quit, Ctrl+C)
           │
           ▼
  7. 清理资源，退出程序
```

---

## 4. 实施步骤

### Phase 1: 初始化插件系统

- [ ] 修改 `src/cli.ts`，在 REPL 启动前初始化插件系统
- [ ] 调用 `initDatabase()` 初始化数据库
- [ ] 调用 `loadFromDir()` 加载工具插件

### Phase 2: 会话持久化

- [ ] 修改 REPL，集成 memory 管理对话历史
- [ ] 实现 `/new` 命令真正清除上下文
- [ ] 实现 `/compact` 命令压缩上下文

### Phase 3: 完善命令

- [ ] 实现 `/history` 从 memory 获取真实历史
- [ ] 实现 `/status` 显示更详细的模型信息

### Phase 4: 测试

- [ ] 测试工具调用（memory, schedule-task 等）
- [ ] 测试多轮对话上下文保持
- [ ] 测试管道模式和单次问答模式

---

## 5. 依赖

### 5.1 内部模块复用

| 模块 | 用途 |
|------|------|
| `agent-runner.ts` | AI 对话（已存在） |
| `memory.ts` | 上下文管理（已存在） |
| `plugins/loader.ts` | 插件加载（已存在） |
| `db.ts` | 数据库初始化（已存在） |

### 5.2 需要传递的配置

```typescript
interface ReplInitOptions {
  group: string;
  loadPlugins?: boolean;  // 是否加载插件系统
}
```

---

## 6. 注意事项

### 6.1 性能考虑

- 插件系统初始化可能较慢，考虑添加 loading 提示
- Memory 长期累积需要压缩或清理

### 6.2 错误处理

- API 错误需要友好提示
- 工具调用失败需要显示错误信息

### 6.3 资源管理

- REPL 退出时需要清理资源
- 避免内存泄漏

---

## 7. 预期效果

### 7.1 工具加载

```
> 你好
[10:09:20.757] INFO ⚡ 可用工具列表
    toolCount: 8
    toolNames: ["memory_remember", "memory_recall", "schedule_task", "list_tasks", ...]
```

### 7.2 工具调用

```
> 帮我设置一个明天上午9点的提醒
⚡ [调用工具: schedule_task]
⚡ [工具参数: {"time": "2026-02-28T09:00:00", "content": "提醒"}]
✅ 已创建定时任务：明天上午9点提醒
```

### 7.3 会话持久

```
> 你记住我的名字了吗
我还没有记住你的名字，请告诉我。

> 我叫张三
好的，张三，我记住了！

> 我叫什么？
你叫张三！
```

---

## 版本历史

| 版本 | 日期 | 变更 |
|------|------|------|
| v2.0.0 | 2026-02-28 | 增强版：持久会话 + 工具调用 |
| v1.0.0 | 2026-02-27 | 初始版本 |

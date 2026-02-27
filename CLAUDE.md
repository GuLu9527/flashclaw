# FlashClaw 开发规则

## 核心理念

**FlashClaw = 轻量稳定的地基 + 乐高式插件扩展**

### 设计哲学

```
┌─────────────────────────────────────────┐
│           用户插件 (可选)                │
│   天气、翻译、自动化、插件仓库...        │
├─────────────────────────────────────────┤
│           官方插件                       │
│   飞书、定时任务、记忆、web-fetch...     │
├─────────────────────────────────────────┤
│           核心地基 (极简)                │
│   消息路由 | 插件加载器 | AI 客户端      │
└─────────────────────────────────────────┘
```

### 三大原则

| 原则 | 含义 | 实践 |
|------|------|------|
| **轻量** | 核心极简，功能通过插件实现 | 新功能 = 新插件，核心只做路由/加载/通信 |
| **稳定** | 地基稳固，插件可热插拔 | 插件崩溃不影响核心，稳定性优先于精简 |
| **迅速** | 响应快，加载快，开发快 | 热加载、按需加载、简单 API |

### 核心 vs 插件

**核心只做三件事：**
1. 消息路由 - 接收消息，分发到 Agent
2. 插件加载 - 发现、加载、管理插件生命周期
3. AI 客户端 - 与 AI API 通信

**其他一切都是插件：**
- 渠道插件：飞书、Telegram、企业微信...
- 工具插件：记忆、定时任务、web-fetch...
- 扩展插件：插件仓库、Web UI...（这些也是插件！）

## 插件规范

### 插件结构

```
plugins/{plugin-name}/
├── plugin.json      # 必需：元信息
└── index.ts         # 必需：入口文件
```

### plugin.json 格式

```json
{
  "name": "plugin-name",
  "version": "1.0.0",
  "type": "channel | tool",
  "description": "简短描述",
  "main": "index.ts",
  "dependencies": []
}
```

### 插件类型

| 类型 | 接口 | 用途 |
|------|------|------|
| `channel` | `ChannelPlugin` | 消息渠道（飞书、钉钉） |
| `tool` | `ToolPlugin` | AI 可调用的工具 |

> `type` 字段仅存在于 `plugin.json` 清单文件中，插件对象本身不需要 `type` 字段。

### 工具插件模板

```typescript
import type { ToolPlugin, ToolContext, ToolResult } from '../../src/plugins/types';

const plugin: ToolPlugin = {
  name: 'my-tool',
  version: '1.0.0',
  description: '工具描述',

  schema: {
    name: 'tool_name',
    description: '工具功能描述',
    input_schema: {
      type: 'object',
      properties: {
        param: { type: 'string', description: '参数说明' }
      },
      required: ['param']
    }
  },

  async execute(params: unknown, context: ToolContext): Promise<ToolResult> {
    // 实现逻辑
    return { success: true, data: {} };
  }
};

export default plugin;
```

### 渠道插件模板

```typescript
import type { ChannelPlugin, MessageHandler } from '../../src/plugins/types';

const plugin: ChannelPlugin = {
  name: 'my-channel',
  version: '1.0.0',

  async init() {
    // 初始化配置
  },

  onMessage(handler: MessageHandler): void {
    // 保存 handler，收到消息后调用
  },

  async start(): Promise<void> {
    // 启动连接
  },

  async stop(): Promise<void> {
    // 清理资源
  },

  async sendMessage(chatId: string, content: string): Promise<void> {
    // 发送消息到指定会话
  }
};

export default plugin;
```

## 开发规范

### 添加新功能 = 创建新插件

**不要修改核心代码！**

```bash
# 1. 创建插件目录
mkdir plugins/my-feature

# 2. 创建 plugin.json 和 index.ts

# 3. 重启服务，插件自动加载
npm run dev
```

### 热加载

- 开发模式下修改插件自动重载
- 生产模式需重启服务以加载新插件
- 插件崩溃自动隔离，不影响其他插件

### 文件组织

```
src/                    # 核心代码（尽量不动）
├── index.ts            # 主入口
├── commands.ts         # 聊天命令处理
├── commands/           # CLI 子命令
│   ├── init.ts         # 交互式初始化向导
│   └── doctor.ts       # 环境诊断
├── session-tracker.ts  # Token 追踪
├── message-queue.ts    # 消息队列
├── health.ts           # 健康检查
├── metrics.ts          # 运行指标
├── plugins/            # 插件系统
│   ├── loader.ts       # 插件加载器
│   ├── manager.ts      # 插件管理器
│   ├── types.ts        # 插件类型定义
│   ├── installer.ts    # 插件安装/卸载
│   └── index.ts        # 插件入口
├── core/               # 核心模块
│   ├── api-client.ts   # AI 客户端 (Anthropic)
│   ├── memory.ts       # 记忆管理 (短期+长期+压缩)
│   ├── context-guard.ts # 上下文窗口保护
│   └── model-capabilities.ts # 模型能力检测
├── utils/              # 工具模块
│   ├── log-rotate.ts
│   ├── rate-limiter.ts
│   └── retry.ts
└── ...

plugins/                # 内置插件目录
├── feishu/             # 飞书渠道
├── schedule-task/       # 定时任务工具
├── list-tasks/         # 查看任务列表
├── cancel-task/        # 取消任务
├── pause-task/         # 暂停任务
├── resume-task/        # 恢复任务
├── memory/             # 记忆工具
├── send-message/       # 发送消息工具
└── register-group/     # 注册群组

community-plugins/      # 社区/官方扩展插件
├── hello-world/        # 测试插件
├── web-fetch/          # 网页抓取插件
├── browser-control/    # 浏览器自动化控制 (Playwright)
├── web-ui/             # Web 管理界面
└── telegram/           # Telegram 渠道
```

### 命名约定

| 类型 | 约定 | 示例 |
|------|------|------|
| 插件目录 | kebab-case | `my-plugin` |
| 工具名称 | snake_case | `my_tool` |
| 类名 | PascalCase | `MyPlugin` |
| 函数名 | camelCase | `myFunction` |

## 配置系统

### 环境变量替换

配置文件支持 `${VAR}` 语法，运行时自动替换：

```json
{
  "apiUrl": "${API_URL:-http://localhost:3000}",
  "appId": "${FEISHU_APP_ID}"
}
```

- `${VAR}` - 从环境变量获取值
- `${VAR:-default}` - 有默认值

### 配置备份

每次修改配置前自动备份（最多 5 个）：
- `config.json.bak.1` - 最新备份
- `config.json.bak.5` - 最旧备份

恢复命令：`flashclaw config restore [n]`

## 环境变量

### 核心变量
```bash
BOT_NAME=FlashClaw              # 机器人名称
LOG_LEVEL=info                  # 日志级别
AGENT_TIMEOUT=300000            # Agent 超时（毫秒）
```

### AI 配置
```bash
ANTHROPIC_AUTH_TOKEN=           # API 密钥（推荐）
ANTHROPIC_API_KEY=              # API 密钥（兼容）
ANTHROPIC_BASE_URL=             # 可选：自定义 API 地址
AI_MODEL=                       # 可选：模型名称
ANTHROPIC_MODEL=                # 可选：模型名称
TIMEZONE=Asia/Shanghai          # 时区
```

### 插件配置（按需）
```bash
# 飞书
FEISHU_APP_ID=
FEISHU_APP_SECRET=
```

## CLI 命令

```bash
flashclaw start                      # 启动服务
flashclaw init                       # 交互式初始化配置
flashclaw init --non-interactive --api-key <key>  # 非交互式初始化
flashclaw doctor                     # 检查运行环境
flashclaw version                    # 显示版本
flashclaw help                       # 显示帮助
flashclaw plugins list               # 列出已安装插件
flashclaw plugins list --available   # 列出可安装插件
flashclaw plugins install <name>     # 安装插件
flashclaw plugins uninstall <name>   # 卸载插件
flashclaw plugins update <name>      # 更新插件
flashclaw plugins update --all       # 更新所有插件
flashclaw config list-backups        # 列出配置备份
flashclaw config restore [n]         # 恢复配置备份
```

## 扩展示例

### 示例：添加天气查询工具

```typescript
// plugins/weather/index.ts
import type { ToolPlugin, ToolContext, ToolResult } from '../../src/plugins/types';

const plugin: ToolPlugin = {
  name: 'weather',
  version: '1.0.0',
  description: '查询天气',

  schema: {
    name: 'get_weather',
    description: '获取指定城市的天气信息',
    input_schema: {
      type: 'object',
      properties: {
        city: { type: 'string', description: '城市名称' }
      },
      required: ['city']
    }
  },

  async execute(params: unknown, context: ToolContext): Promise<ToolResult> {
    const { city } = params as { city: string };
    // 调用天气 API
    const weather = await fetchWeather(city);
    return { success: true, data: weather };
  }
};

export default plugin;
```

### 示例：插件仓库（作为插件实现）

插件仓库本身也是一个插件！这体现了"乐高式"设计：

```typescript
// plugins/plugin-registry/index.ts
// 实现 install/remove/update 命令
// 作为可选插件，不是核心功能
```

## 注意事项

1. **核心极简** - 抵制向核心添加功能的冲动
2. **插件优先** - 新功能 = 新插件
3. **向后兼容** - 插件 API 变更需要版本号
4. **错误隔离** - 插件错误不能影响核心
5. **中文优先** - 文档和提示使用中文
6. **提交规范** - Git 提交信息使用英文前缀 + 中文描述
7. **不提交 TODO.md** - TODO.md 仅供本地参考，不提交到仓库

## 测试覆盖

项目使用 Vitest 框架，主要测试文件：

```
tests/
├── agent-runner.test.ts      # Agent 运行器测试
├── task-scheduler.test.ts    # 任务调度测试
├── index.test.ts             # 主入口测试
├── message-queue.test.ts     # 消息队列测试
├── session-tracker.test.ts   # Token 追踪测试
├── db.test.ts               # 数据库测试
├── e2e.test.ts              # 端到端测试
├── plugins/
│   ├── loader.test.ts        # 插件加载器测试
│   ├── manager.test.ts       # 插件管理器测试
│   ├── installer.test.ts     # 插件安装测试
│   └── browser-control.test.ts  # 浏览器控制插件测试
└── core/
    ├── api-client.test.ts    # API 客户端测试
    └── memory.test.ts        # 记忆系统测试
```

运行测试：`npm test`

## 版本历史

| 版本 | 日期 | 变更 |
|------|------|------|
| 1.5.0 | 2026-02-27 | 上下文保护、安全审计、后台服务、SOUL.md 人格设定 |
| 1.4.0 | 2026-02-08 | Telegram 插件支持、插件系统增强、工具调用修复 |
| 1.3.0 | 2026-02-06 | 全面代码审查修复：竞态条件、内存泄漏、类型安全、依赖瘦身 |
| 1.2.0 | 2026-02-06 | 新增 init/doctor 命令，安装流程优化，代码审查修复 |
| 1.1.0 | 2026-02-05 | 同步文档与代码，添加 browser-control、web-ui 插件 |
| 1.0.0 | 2026-02-03 | 重构为轻量地基 + 插件架构 |

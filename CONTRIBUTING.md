# 贡献指南

感谢你对 FlashClaw 的关注！欢迎提交 Issue 和 Pull Request。

## 目录

- [开发环境](#开发环境)
- [项目结构](#项目结构)
- [开发流程](#开发流程)
- [代码规范](#代码规范)
- [提交规范](#提交规范)
- [添加新功能](#添加新功能)

---

## 开发环境

### 环境要求

- Node.js 20+
- npm 或 pnpm

### 初始化

```bash
# 克隆项目
git clone https://github.com/GuLu9527/flashclaw.git
cd flashclaw

# 安装依赖
npm install

# 复制配置文件
cp .env.example .env

# 编辑 .env 添加你的配置
```

### 运行

```bash
# 开发模式（tsx 热重载）
npm run dev

# 编译
npm run build

# 类型检查
npm run typecheck

# 使用 CLI
npm run cli -- status
```

---

## 项目结构

```
flashclaw/
├── src/                       # 源代码
│   ├── index.ts              # 主入口、消息路由
│   ├── cli.ts                # CLI 命令行工具
│   ├── agent-runner.ts       # AI Agent 运行器
│   ├── config.ts             # 配置常量
│   ├── types.ts              # 核心类型定义
│   ├── db.ts                 # 数据库操作
│   ├── message-queue.ts      # 消息队列
│   ├── task-scheduler.ts     # 定时任务调度
│   ├── utils.ts              # 工具函数
│   │
│   ├── core/                 # 核心模块
│   │   ├── api-client.ts     # AI API 客户端
│   │   ├── memory.ts         # 记忆管理
│   │   └── model-capabilities.ts  # 模型能力检测
│   │
│   └── plugins/              # 插件系统
│       ├── index.ts          # 插件系统入口
│       ├── manager.ts        # 插件管理器
│       ├── loader.ts         # 插件加载器
│       └── types.ts          # 插件类型定义
│
├── plugins/                   # 插件目录
│   ├── feishu/               # 飞书渠道插件
│   ├── dingtalk/             # 钉钉渠道插件
│   ├── send-message/         # 发送消息工具
│   ├── schedule-task/        # 创建定时任务
│   ├── list-tasks/           # 列出定时任务
│   ├── cancel-task/          # 取消定时任务
│   ├── pause-task/           # 暂停定时任务
│   ├── resume-task/          # 恢复定时任务
│   ├── memory/               # 长期记忆
│   └── register-group/       # 注册群组
│
├── docs/                      # 文档
├── groups/                    # 群组记忆（模板）
└── assets/                    # 图片资源
```

---

## 开发流程

### 1. 创建分支

```bash
git checkout -b feature/your-feature-name
# 或
git checkout -b fix/your-bug-fix
```

### 2. 开发

- 修改代码
- 确保 `npm run typecheck` 通过
- 测试功能

### 3. 提交

```bash
git add .
git commit -m "feat: 添加新功能描述"
```

### 4. 推送并创建 PR

```bash
git push origin feature/your-feature-name
```

然后在 GitHub 创建 Pull Request。

---

## 代码规范

### TypeScript

- 使用 TypeScript 严格模式
- 所有公开函数需要类型注解
- 避免使用 `any`，优先使用 `unknown`

### 文件组织

| 类型 | 规范 | 示例 |
|------|------|------|
| 文件名 | kebab-case | `agent-runner.ts` |
| 类名 | PascalCase | `FeishuPlugin` |
| 函数名 | camelCase | `sendMessage()` |
| 常量 | UPPER_SNAKE | `BOT_NAME` |
| 接口 | PascalCase | `ToolPlugin` |
| 工具名 | snake_case | `send_message` |

### 文件大小

- 单个文件不超过 500 行
- 如果超过，考虑拆分

### 注释

- 公开 API 使用 JSDoc 注释
- 复杂逻辑添加行内注释
- 中文注释优先（面向中文用户）

```typescript
/**
 * 发送消息到指定聊天
 * @param chatId 聊天 ID
 * @param text 消息内容
 */
async function sendMessage(chatId: string, text: string): Promise<void> {
  // ...
}
```

---

## 提交规范

使用 [Conventional Commits](https://www.conventionalcommits.org/) 格式：

```
<type>: <description>

[optional body]
```

### Type 类型

| Type | 说明 |
|------|------|
| `feat` | 新功能 |
| `fix` | Bug 修复 |
| `docs` | 文档更新 |
| `style` | 代码格式（不影响功能） |
| `refactor` | 重构 |
| `perf` | 性能优化 |
| `test` | 测试相关 |
| `chore` | 构建/工具变更 |

### 示例

```bash
feat: 添加 Telegram 平台支持
fix: 修复消息重复发送问题
docs: 更新 API 文档
refactor: 重构消息队列实现
```

---

## 添加新功能

### 添加新消息平台（渠道插件）

1. **创建插件目录**

   ```
   plugins/telegram/
   ├── plugin.json
   └── index.ts
   ```

2. **编写 plugin.json**

   ```json
   {
     "name": "telegram",
     "version": "1.0.0",
     "type": "channel",
     "description": "Telegram 通讯渠道插件",
     "main": "index.ts"
   }
   ```

3. **实现渠道插件**

   ```typescript
   // plugins/telegram/index.ts
   import { ChannelPlugin, Message } from '../../src/plugins/types.js';

   const plugin: ChannelPlugin = {
     name: 'telegram',
     platform: 'telegram',
     
     async init(config) {
       const token = config.TELEGRAM_BOT_TOKEN;
       if (!token) {
         throw new Error('缺少 TELEGRAM_BOT_TOKEN 配置');
       }
       // 初始化客户端...
     },
     
     async start() {
       // 启动消息监听
     },
     
     async stop() {
       // 停止监听
     },
     
     onMessage(handler) {
       this.messageHandler = handler;
     },
     
     async sendMessage(chatId, content) {
       // 发送消息
       return { success: true, messageId: 'xxx' };
     },
     
     shouldRespondInGroup(msg) {
       // 检查是否应该响应群聊消息
       return msg.mentions?.includes(this.botId) || false;
     }
   };

   export default plugin;
   ```

4. **更新配置示例**

   ```bash
   # .env.example
   # TELEGRAM_BOT_TOKEN=xxxxx
   ```

### 添加新 AI 工具（工具插件）

1. **创建插件目录**

   ```
   plugins/my-tool/
   ├── plugin.json
   └── index.ts
   ```

2. **编写 plugin.json**

   ```json
   {
     "name": "my-tool",
     "version": "1.0.0",
     "type": "tool",
     "description": "我的自定义工具",
     "main": "index.ts"
   }
   ```

3. **实现工具插件**

   ```typescript
   // plugins/my-tool/index.ts
   import { ToolPlugin, ToolResult } from '../../src/plugins/types.js';

   const plugin: ToolPlugin = {
     name: 'my_tool',
     version: '1.0.0',
     description: '我的工具描述',
     
     schema: {
       name: 'my_tool',
       description: '工具功能描述（AI 可见）',
       input_schema: {
         type: 'object',
         properties: {
           param1: {
             type: 'string',
             description: '参数1'
           }
         },
         required: ['param1']
       }
     },
     
     async execute(params, context): Promise<ToolResult> {
       const { param1 } = params as { param1: string };
       // 执行逻辑...
       return {
         success: true,
         data: '执行结果'
       };
     }
   };

   export default plugin;
   ```

### 添加新模型支持

在 `src/core/model-capabilities.ts` 中添加模型配置：

```typescript
const MODEL_CAPABILITIES: ModelCapabilities[] = [
  // 添加新模型
  {
    pattern: /^my-model-/i,
    provider: 'MyProvider',
    input: ['text', 'image'],  // 支持的输入类型
    contextWindow: 128000,
    reasoning: false
  },
  // ... 其他模型
];
```

---

## 问题反馈

如果遇到问题：

1. 搜索现有 [Issues](https://github.com/GuLu9527/flashclaw/issues)
2. 创建新 Issue，包含：
   - 问题描述
   - 复现步骤
   - 环境信息（Node 版本、操作系统）
   - 相关日志

---

## 许可证

本项目采用 MIT 许可证。提交代码即表示你同意将代码以相同许可证发布。

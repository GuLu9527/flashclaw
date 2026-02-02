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
- Claude Code（可选，用于开发辅助）

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
# 开发模式（热重载）
npm run dev

# 编译
npm run build

# 生产运行
npm start
```

---

## 项目结构

```
flashclaw/
├── src/                    # 源代码
│   ├── index.ts           # 主入口
│   ├── config.ts          # 配置常量
│   ├── types.ts           # 类型定义
│   ├── clients/           # 消息平台客户端
│   │   ├── index.ts       # ClientManager
│   │   ├── types.ts       # MessageClient 接口
│   │   ├── feishu.ts      # 飞书客户端
│   │   └── dingtalk.ts    # 钉钉客户端
│   ├── agent-runner.ts    # AI Agent 运行器
│   ├── message-queue.ts   # 消息队列
│   ├── task-scheduler.ts  # 定时任务
│   ├── db.ts              # 数据库操作
│   └── utils.ts           # 工具函数
├── .claude/skills/         # Claude Code 技能
├── docs/                   # 文档
├── groups/                 # 群组记忆（模板）
└── assets/                 # 图片资源
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
- 添加测试（如果适用）
- 确保 `npm run build` 通过

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
| 类名 | PascalCase | `FeishuClient` |
| 函数名 | camelCase | `createClient()` |
| 常量 | UPPER_SNAKE | `BOT_NAME` |
| 接口 | PascalCase | `MessageClient` |

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

### 添加新消息平台

1. **创建客户端文件**

   ```typescript
   // src/clients/telegram.ts
   import { MessageClient, Message, MessageHandler } from './types.js';

   export class TelegramClient implements MessageClient {
     readonly platform = 'telegram';
     readonly displayName = 'Telegram';
     
     start(handler: MessageHandler): void { /* ... */ }
     stop(): void { /* ... */ }
     async sendTextMessage(chatId: string, text: string): Promise<void> { /* ... */ }
     shouldRespondInGroup(message: Message): boolean { /* ... */ }
     isBotMentioned(message: Message): boolean { /* ... */ }
   }

   export function createTelegramClient(): TelegramClient | null {
     const token = process.env.TELEGRAM_BOT_TOKEN;
     if (!token) return null;
     return new TelegramClient({ token });
   }
   ```

2. **注册到 ClientManager**

   ```typescript
   // src/clients/index.ts
   import { createTelegramClient } from './telegram.js';

   // 在 initialize() 中添加
   const telegramClient = createTelegramClient();
   if (telegramClient) {
     this.clients.push(telegramClient);
   }
   ```

3. **更新配置示例**

   ```bash
   # .env.example
   # TELEGRAM_BOT_TOKEN=xxxxx
   ```

4. **创建技能文档**

   ```markdown
   <!-- .claude/skills/add-telegram/SKILL.md -->
   # 添加 Telegram 支持
   ...
   ```

### 添加新 MCP 工具

1. 在 `src/agent-runner.ts` 的 `createIpcMcp()` 中添加新工具
2. 使用 Zod 定义参数 schema
3. 实现工具逻辑
4. 更新 `docs/API.md`

---

## 问题反馈

如果遇到问题：

1. 先查看 [常见问题](docs/FAQ.md)
2. 搜索现有 [Issues](https://github.com/GuLu9527/flashclaw/issues)
3. 创建新 Issue，包含：
   - 问题描述
   - 复现步骤
   - 环境信息（Node 版本、操作系统）
   - 相关日志

---

## 许可证

本项目采用 MIT 许可证。提交代码即表示你同意将代码以相同许可证发布。

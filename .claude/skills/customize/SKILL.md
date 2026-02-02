# FlashClaw 自定义

添加新功能或修改 FlashClaw 行为。用于添加消息平台（Telegram、Slack）、修改触发规则、添加集成等。

## 工作流程

1. **理解需求** - 询问澄清问题
2. **规划改动** - 确定要修改的文件
3. **实现** - 直接修改代码
4. **测试指导** - 告诉用户如何验证

## 核心文件

| 文件 | 用途 |
|------|------|
| `src/clients/types.ts` | MessageClient 接口定义 |
| `src/clients/index.ts` | ClientManager 客户端管理器 |
| `src/clients/feishu.ts` | 飞书客户端实现 |
| `src/clients/dingtalk.ts` | 钉钉客户端实现 |
| `src/index.ts` | 主程序：消息路由 |
| `src/config.ts` | 配置常量 |
| `CLAUDE.md` | 项目上下文和扩展指南 |

## 添加新消息平台

这是最常见的自定义需求。

### 步骤 1：创建客户端文件

创建 `src/clients/{platform}.ts`：

```typescript
import pino from 'pino';
import { MessageClient, Message, MessageHandler } from './types.js';

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: { target: 'pino-pretty', options: { colorize: true } }
});

export interface {Platform}Config {
  apiKey: string;
  apiSecret: string;
}

export class {Platform}Client implements MessageClient {
  readonly platform = '{platform}';
  readonly displayName = '平台显示名';

  private messageHandler: MessageHandler | null = null;
  private running = false;

  constructor(config: {Platform}Config) {
    // 初始化 SDK
  }

  start(handler: MessageHandler): void {
    if (this.running) return;
    this.messageHandler = handler;
    this.running = true;
    
    // 启动消息监听（WebSocket/Webhook/轮询等）
    // 收到消息后调用 this.handleMessage(rawMessage)
    
    logger.info({ platform: this.platform }, '客户端已启动');
  }

  stop(): void {
    this.running = false;
    this.messageHandler = null;
    logger.info({ platform: this.platform }, '客户端已停止');
  }

  private async handleMessage(rawMessage: any): Promise<void> {
    // 转换为统一 Message 格式
    const msg: Message = {
      id: rawMessage.id,
      chatId: rawMessage.chatId,
      chatType: rawMessage.isGroup ? 'group' : 'p2p',
      senderId: rawMessage.senderId,
      senderName: rawMessage.senderName,
      content: rawMessage.text,
      timestamp: new Date().toISOString(),
      platform: this.platform,
      mentions: [],
      raw: rawMessage,
    };

    if (this.messageHandler) {
      await this.messageHandler(msg);
    }
  }

  async sendTextMessage(chatId: string, text: string): Promise<void> {
    // 实现发送消息
    logger.info({ chatId, platform: this.platform }, '消息已发送');
  }

  isBotMentioned(message: Message): boolean {
    return (message.mentions?.length || 0) > 0;
  }

  shouldRespondInGroup(message: Message): boolean {
    if (this.isBotMentioned(message)) return true;
    
    const text = message.content;
    // 智能触发检测
    if (/[？?]$/.test(text)) return true;
    if (/\b(why|how|what|when|where|who|help)\b/i.test(text)) return true;
    const verbs = ['帮', '麻烦', '请', '能否', '可以', '解释', '看看', '排查', '分析', '总结', '写', '改', '修', '查', '对比', '翻译'];
    if (verbs.some(k => text.includes(k))) return true;
    
    return false;
  }
}

export function create{Platform}Client(): {Platform}Client | null {
  const apiKey = process.env.{PLATFORM}_API_KEY;
  const apiSecret = process.env.{PLATFORM}_API_SECRET;
  
  if (!apiKey || !apiSecret) {
    return null;
  }
  
  return new {Platform}Client({ apiKey, apiSecret });
}
```

### 步骤 2：注册到 ClientManager

编辑 `src/clients/index.ts`：

```typescript
// 添加导入
import { create{Platform}Client } from './{platform}.js';

// 在 initialize() 方法中添加
const {platform}Client = create{Platform}Client();
if ({platform}Client) {
  this.clients.push({platform}Client);
  logger.info({ platform: '{platform}' }, '客户端已初始化');
}

// 在 getClientForChat() 中添加 chatId 格式识别
if (chatId.startsWith('{prefix}')) {
  return this.clients.find(c => c.platform === '{platform}') || null;
}

// 在文件末尾添加导出
export { {Platform}Client, create{Platform}Client } from './{platform}.js';
```

### 步骤 3：更新配置

在 `.env.example` 中添加：
```bash
# {Platform}
# {PLATFORM}_API_KEY=xxxxx
# {PLATFORM}_API_SECRET=xxxxx
```

### 步骤 4：创建技能（可选）

创建 `.claude/skills/add-{platform}/SKILL.md` 提供配置指南。

### 步骤 5：构建并测试

```bash
npm run build
npm run dev
```

## 其他自定义

### 修改触发行为

编辑对应客户端文件中的 `shouldRespondInGroup()` 方法。

### 修改机器人名称

编辑 `.env`：
```bash
BOT_NAME=你的机器人名字
```

### 添加群组记忆

创建 `groups/{group_name}/CLAUDE.md`，写入自定义指令。

## 改动后

告诉用户：
```bash
# 重新编译并重启
npm run build

# macOS:
launchctl unload ~/Library/LaunchAgents/com.flashclaw.plist
launchctl load ~/Library/LaunchAgents/com.flashclaw.plist

# Linux/WSL2:
sudo systemctl restart flashclaw

# 或开发模式：
npm run dev
```

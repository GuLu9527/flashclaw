# FlashClaw 初始化

首次安装 FlashClaw 的完整配置流程。

## 前置检查

```bash
# 检查 Node.js 版本（需要 20+）
node --version
```

## 配置步骤

### 第 1 步：安装依赖

```bash
npm install
```

### 第 2 步：配置消息平台

FlashClaw 支持多个平台，至少配置一个：

#### 飞书配置

1. 访问 [飞书开放平台](https://open.feishu.cn/app)
2. 创建企业自建应用，添加「机器人」能力
3. 配置权限：`im:message`、`im:message.group_at_msg`、`im:message.p2p_msg`
4. 事件订阅：添加 `im.message.receive_v1`，选择「**使用长连接接收事件**」
5. 发布应用

在 `.env` 中添加：
```bash
FEISHU_APP_ID=cli_xxxxxxxx
FEISHU_APP_SECRET=xxxxxxxxxxxxxxxx
```

#### 钉钉配置

1. 访问 [钉钉开放平台](https://open.dingtalk.com/)
2. 创建企业内部应用，添加机器人能力
3. 配置权限：`qyapi_robot_sendmsg`、`qyapi_chat_manage`
4. 消息推送：启用 **Stream 模式**
5. 发布应用

在 `.env` 中添加：
```bash
DINGTALK_APP_KEY=dingxxxxxxxx
DINGTALK_APP_SECRET=xxxxxxxxxxxxxxxx
```

**可以同时配置两个平台！**

### 第 3 步：配置 AI API

根据你的 AI 后端选择：

**Claude API (Anthropic)**
```bash
ANTHROPIC_API_KEY=sk-ant-xxxxx
```

**Claude Code OAuth**
```bash
CLAUDE_CODE_OAUTH_TOKEN=sk-ant-oat01-xxxxx
```

**API 代理 (如 MiniMax)**
```bash
ANTHROPIC_AUTH_TOKEN=your-token
ANTHROPIC_API_KEY=your-token
ANTHROPIC_BASE_URL=https://api.minimaxi.com/anthropic
ANTHROPIC_MODEL=MiniMax-M2.1
```

### 第 4 步：完成 .env 配置

确保 `.env` 至少包含：
```bash
# 至少一个平台
FEISHU_APP_ID=cli_xxxxxxxx
FEISHU_APP_SECRET=xxxxxxxxxxxxxxxx

# 机器人名称
BOT_NAME=FlashClaw

# AI API
ANTHROPIC_API_KEY=sk-ant-xxxxx
```

### 第 5 步：编译 TypeScript

```bash
npm run build
```

### 第 6 步：创建数据目录

```bash
mkdir -p data store groups/main/logs
```

### 第 7 步：注册主频道

1. 临时启动：`npm run dev`
2. 在配置的平台（飞书/钉钉）中给机器人发消息
3. 查看日志中的聊天 ID：
   - 飞书：`chatId: "oc_xxxxxxxx"`
   - 钉钉：`chatId: "cidxxxxxxxx"`
4. 停止（Ctrl+C）

创建 `data/registered_groups.json`：
```json
{
  "你的聊天ID": {
    "name": "主频道",
    "folder": "main",
    "trigger": "all",
    "added_at": "2026-01-01T00:00:00.000Z"
  }
}
```

### 第 8 步：测试运行

```bash
npm run dev
```

在平台中发送测试消息，应该能看到机器人回复。

### 第 9 步：后台服务（可选）

使用 PM2 管理后台服务：

```bash
npm install -g pm2
pm2 start dist/index.js --name flashclaw
pm2 save
pm2 startup  # 开机自启
```

PM2 常用命令：
```bash
pm2 logs flashclaw    # 查看日志
pm2 restart flashclaw # 重启
pm2 stop flashclaw    # 停止
```

## 验证

- 在平台中发送消息
- 机器人应该回复
- 检查日志：`npm run dev` 或 `pm2 logs flashclaw`

## 常见问题

### "No message clients configured"
需要在 `.env` 中配置至少一个平台。

### "机器人不回复"
1. 检查应用已发布
2. 检查长连接/Stream 模式已启用
3. 检查聊天已在 `data/registered_groups.json` 中注册

## 快速命令

```bash
npm install          # 安装依赖
npm run build        # 编译
npm run dev          # 开发模式
npm start            # 运行
```

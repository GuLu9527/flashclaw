# 添加钉钉平台

为 FlashClaw 添加钉钉机器人支持，使用 Stream API（WebSocket 长连接）。

## 前置条件

- FlashClaw 已安装并运行
- 有钉钉开发者账号

## 配置步骤

### 第 1 步：创建钉钉应用

1. 访问 [钉钉开放平台](https://open.dingtalk.com/)
2. 登录后进入 **应用开发** > **企业内部应用**
3. 点击 **创建应用**，选择 **机器人**
4. 填写应用名称和描述
5. 创建完成后，记录以下信息：
   - `AppKey`
   - `AppSecret`
   - `RobotCode`（可选，默认使用 AppKey）

### 第 2 步：配置应用权限

在应用的 **权限管理** 中，添加以下权限：

- `qyapi_robot_sendmsg` - 机器人发送消息
- `qyapi_chat_manage` - 群聊管理
- `qyapi_get_member_name_list` - 获取成员列表

### 第 3 步：配置消息接收方式

1. 进入 **开发管理** > **消息推送**
2. 选择 **Stream 模式**（WebSocket 长连接）
3. 订阅以下事件：
   - `chat_add_user_v1` - 群成员变更
   - `im.chat.access.event` - IM 消息事件

### 第 4 步：发布应用

1. 进入 **版本管理与发布**
2. 创建新版本
3. 提交审核（企业内部应用通常立即生效）

### 第 5 步：配置 FlashClaw

在 `.env` 文件中添加钉钉配置：

```bash
# 钉钉配置
DINGTALK_APP_KEY=dingxxxxxxxxxx
DINGTALK_APP_SECRET=xxxxxxxxxxxxxxxxxxxx
DINGTALK_ROBOT_CODE=dingxxxxxxxxxx  # 可选
```

### 第 6 步：重启服务

```bash
# 开发模式
npm run dev

# 或重启后台服务
# PM2
pm2 restart flashclaw

# systemd (Linux/WSL2)
sudo systemctl restart flashclaw

# launchd (macOS)
launchctl unload ~/Library/LaunchAgents/com.flashclaw.plist
launchctl load ~/Library/LaunchAgents/com.flashclaw.plist
```

### 第 7 步：注册主聊天

启动后，在钉钉中给机器人发送任意消息。查看日志获取 `conversationId`：

```
Message from unregistered chat, ignoring { chatId: 'cidXXXXXXXXXX', platform: 'dingtalk' }
```

将此 ID 注册为主聊天，编辑 `data/registered_groups.json`：

```json
{
  "cidXXXXXXXXXX": {
    "name": "钉钉主群",
    "folder": "main",
    "trigger": "all",
    "added_at": "2026-02-02T00:00:00.000Z"
  }
}
```

### 第 8 步：测试

在钉钉中发送消息测试机器人响应。

## 多平台并存

FlashClaw 支持同时运行多个消息平台。例如同时配置飞书和钉钉：

```bash
# .env
# 飞书
FEISHU_APP_ID=cli_xxxxx
FEISHU_APP_SECRET=xxxxx

# 钉钉
DINGTALK_APP_KEY=dingxxxxx
DINGTALK_APP_SECRET=xxxxx
```

每个平台的聊天 ID 格式不同：
- 飞书: `oc_xxxxx` 或 `ou_xxxxx`
- 钉钉: `cidxxxxx` 或纯数字

FlashClaw 会自动识别并路由到正确的平台。

## 常见问题

### WebSocket 连接失败

1. 检查 AppKey 和 AppSecret 是否正确
2. 确认应用已发布
3. 确认已启用 Stream 模式

### 收不到消息

1. 检查事件订阅是否正确配置
2. 确认应用权限已授权
3. 查看日志中的错误信息

### 发送消息失败

1. 检查机器人权限
2. 确认 `robotCode` 配置正确
3. 某些消息类型可能需要额外权限

## 验证清单

- [ ] 钉钉应用已创建
- [ ] Stream 模式已启用
- [ ] `.env` 配置正确
- [ ] 服务已重启
- [ ] 能收到钉钉消息
- [ ] 能发送回复消息

# FlashClaw 调试指南

调试 FlashClaw 运行问题和多平台消息问题。用于排查故障、认证问题等。

## 架构概览

```
┌─────────────────────────────────────────────────────────────────────┐
│                           FlashClaw 主进程                           │
│  src/index.ts                                                        │
│       │                                                              │
│       ├── ClientManager ────────┬──── FeishuClient (WebSocket)      │
│       │   (src/clients/)        └──── DingtalkClient (Stream API)   │
│       │                                                              │
│       ├── Agent Runner (直接调用 Claude Code SDK)                    │
│       │                                                              │
│       └── Task Scheduler                                             │
└─────────────────────────────────────────────────────────────────────┘
```

## 日志位置

| 日志 | 位置 | 内容 |
|------|------|------|
| 主程序日志 | `logs/flashclaw.log` | 消息路由、Agent 调用 |
| 主程序错误 | `logs/flashclaw.error.log` | 错误信息 |
| Agent 运行日志 | `groups/{folder}/logs/agent-*.log` | 每次运行的详细日志 |

## 启用调试日志

设置 `LOG_LEVEL=debug` 获取详细输出：

```bash
LOG_LEVEL=debug npm run dev
```

调试级别显示：
- 完整消息内容
- Agent 调用参数
- 实时 Agent stderr

## 消息平台调试

### 检查哪些平台已启动

```bash
npm run dev 2>&1 | grep -E "(client initialized|platforms)"
```

预期输出：
```
Feishu client initialized
DingTalk client initialized
Message clients initialized { platforms: [ 'feishu', 'dingtalk' ] }
```

### 平台特定问题

#### 飞书
- 检查 `.env` 中的 `FEISHU_APP_ID` 和 `FEISHU_APP_SECRET`
- 确认飞书开放平台已启用长连接模式
- 检查事件订阅：`im.message.receive_v1`

#### 钉钉
- 检查 `.env` 中的 `DINGTALK_APP_KEY` 和 `DINGTALK_APP_SECRET`
- 确认已启用 Stream 模式
- 检查日志中的 WebSocket 连接状态

### 收不到消息

1. 检查平台客户端已启动：
   ```bash
   grep "client started" logs/flashclaw.log
   ```

2. 检查消息到达但聊天未注册：
   ```bash
   grep "unregistered chat" logs/flashclaw.log
   ```
   如果看到这个，在 `data/registered_groups.json` 中注册聊天

3. 检查聊天 ID 格式：
   - 飞书：`oc_xxxxx` 或 `ou_xxxxx`
   - 钉钉：`cidxxxxx` 或纯数字

## 常见问题

### 1. "Claude Code process exited with code 1"

**查看 Agent 日志** `groups/{folder}/logs/agent-*.log`

常见原因：

#### 缺少认证
```
Invalid API key · Please run /login
```
**修复**：确保 `.env` 有 OAuth token 或 API key：
```bash
cat .env  # 应该显示：
# CLAUDE_CODE_OAUTH_TOKEN=sk-ant-oat01-...
# 或 ANTHROPIC_API_KEY=sk-ant-api03-...
```

### 2. 环境变量未加载

验证环境变量：
```bash
npm run dev
# 检查日志中是否有 API key 相关错误
```

### 3. 权限问题

检查目录权限：
```bash
ls -la groups/
ls -la data/
ls -la logs/
```

确保当前用户有读写权限。

### 4. Agent 超时

如果 Agent 运行超时，可以调整超时时间：
```bash
# 在 .env 中设置（毫秒）
AGENT_TIMEOUT=600000  # 10 分钟
```

## 快速诊断脚本

```bash
echo "=== 检查 FlashClaw 设置 ==="

echo -e "\n1. 认证已配置？"
[ -f .env ] && grep -q "ANTHROPIC" .env && echo "OK" || echo "缺少 - 在 .env 中添加 API key"

echo -e "\n2. Node.js 版本？"
node --version

echo -e "\n3. 已编译？"
[ -d dist ] && echo "OK" || echo "缺少 - 运行: npm run build"

echo -e "\n4. 群组目录？"
ls -la groups/ 2>/dev/null || echo "缺少 - 创建 groups/main 目录"

echo -e "\n5. 最近的 Agent 日志？"
ls -t groups/*/logs/agent-*.log 2>/dev/null | head -3 || echo "还没有 Agent 日志"

echo -e "\n6. 检查平台配置"
grep -E "^(FEISHU_|DINGTALK_)" .env 2>/dev/null | wc -l | xargs -I {} echo "已配置 {} 个平台变量"
```

## 重新编译

```bash
# 重新编译主程序
npm run build

# 完全清理重建
rm -rf dist/
npm run build
```

## 检查运行状态

```bash
# PM2 状态
pm2 status

# 查看实时日志
pm2 logs flashclaw

# 重启服务
pm2 restart flashclaw
```

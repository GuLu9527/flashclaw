# FlashClaw Web UI 插件

FlashClaw 的 Web 管理界面，提供实时监控、日志查看、任务和插件管理功能。

## 特性

- 📊 **仪表盘** - 实时服务状态、统计数据、最近活动
- 📜 **日志查看** - SSE 实时日志流、级别筛选
- ⏰ **任务管理** - 查看、暂停、恢复、删除定时任务
- 🔌 **插件管理** - 查看插件列表、启用/禁用插件
- 🌓 **深色模式** - 自动跟随系统主题，支持手动切换
- 📱 **响应式设计** - 支持移动端访问

## 技术栈

- **Hono** - 轻量级 HTTP 框架
- **htmx** - 无需写 JS 的 AJAX
- **Alpine.js** - 轻量级响应式框架
- **Pico CSS** - 无类名 CSS 框架
- **SSE** - 实时日志推送

## 安装

Web UI 插件已包含在 FlashClaw 的 `community-plugins` 目录中，默认启用。

如果需要手动安装：

```bash
flashclaw plugins install web-ui
```

## 配置

通过环境变量配置：

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `WEBUI_PORT` | 监听端口 | `3000` |
| `WEBUI_HOST` | 监听地址 | `127.0.0.1` |
| `WEBUI_TOKEN` | 访问密钥（可选） | 无 |
| `WEBUI_OPEN` | 启动后自动打开浏览器 | `false` |

### 示例

```bash
# 在 .env 文件中配置
WEBUI_PORT=8080
WEBUI_HOST=0.0.0.0
WEBUI_TOKEN=your-secret-token
WEBUI_OPEN=1
```

## 使用

### 启动

Web UI 会随 FlashClaw 主服务自动启动：

```bash
flashclaw start
```

启动后访问：`http://localhost:3000`（默认地址）

### 认证

如果设置了 `WEBUI_TOKEN`，访问时需要输入密钥。支持以下认证方式：

1. **登录页面** - 访问任意页面会重定向到登录页
2. **URL 参数** - `http://localhost:3000?token=your-token`
3. **HTTP Header** - `Authorization: Bearer your-token`

### 远程访问

如需从其他设备访问：

1. 设置 `WEBUI_HOST=0.0.0.0`
2. **强烈建议**设置 `WEBUI_TOKEN` 保护接口
3. 通过服务器 IP 访问：`http://your-ip:3000`

## API

Web UI 提供以下 REST API：

### 状态

- `GET /api/status` - 获取服务状态（含 running/pid/uptime/messageCount/activeSessions/activeTaskCount/totalTaskCount/provider/model）

### 任务

- `GET /api/tasks` - 获取任务列表
- `POST /api/tasks/:id/pause` - 暂停任务
- `POST /api/tasks/:id/resume` - 恢复任务
- `DELETE /api/tasks/:id` - 删除任务

### 插件

- `GET /api/plugins` - 获取插件列表
- `POST /api/plugins/:name/toggle` - 切换插件状态

### SSE

- `GET /sse/logs` - 实时日志流
- `GET /sse/status` - 状态变化流

## 截图

### 仪表盘
```
┌─────────────────────────────────────────────────────────────┐
│  ⚡ FlashClaw    📊 仪表盘  📜 日志  ⏰ 任务  🔌 插件  🌓  │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  服务状态                                                    │
│  ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐    │
│  │🟢运行│ │12345 │ │2h 30m│ │1,234 │ │  5   │ │ 3/5  │    │
│  │ 中   │ │ PID  │ │运行  │ │消息数│ │活跃  │ │任务  │    │
│  └──────┘ └──────┘ └──────┘ └──────┘ └──────┘ └──────┘    │
│                                                             │
│  📝 最近活动                                                │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ 14:32  用户A    帮我查一下天气                       │   │
│  │ 14:32  Bot      今天北京晴，温度15°C...             │   │
│  │ 14:30  用户B    设置一个提醒                         │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## 注意事项

1. **安全性** - 如果暴露到公网，务必设置 `WEBUI_TOKEN`
2. **状态变更** - 插件启用/禁用后需要重启服务才能生效
3. **日志文件** - 日志实时流依赖 `~/.flashclaw/logs/flashclaw.log` 文件

## 许可证

MIT License

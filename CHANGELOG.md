# 更新日志

本项目的所有重要变更都会记录在此文件。
格式参考 [Keep a Changelog](https://keepachangelog.com/en/1.0.0/)，
并遵循 [语义化版本](https://semver.org/spec/v2.0.0.html)。

## [1.1.0] - 2026-02-05

### 新增
- **图片发送功能**：AI 可通过 `send_message` 工具发送图片到飞书
- `ToolContext` 新增 `sendImage` 方法，工具插件可主动发送图片
- `browser-control` 截图支持通过 `send_message({ image: "latest_screenshot" })` 发送
- `ChannelManager` 新增 `sendImage` 方法，支持图片消息路由

### 变更
- `browser_screenshot` 不再直接返回完整 base64，改为存储到临时文件并返回提示
- 优化截图在 Agent 上下文中的占用，避免 token 浪费

### 注意
- 飞书发送图片需要开通 `im:resource:upload` 或 `im:resource` 权限

## [1.0.0] - 2026-02-04

### 新增
- 核心 Agent 运行时（Claude API 接入与 Token 统计）
- CLI 启动与插件管理命令
- 插件系统（热加载与安装/更新）
- 飞书渠道集成
- 定时任务工具（创建/查询/暂停/恢复/取消）
- 记忆工具（remember/recall，支持用户/会话级）
- 网页抓取工具
- 社区插件示例（hello-world、web-fetch、browser-control）

### 安全
- Web 抓取的输入校验与 SSRF 防护
- 插件与配置路径的安全处理


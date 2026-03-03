# 插件变更日志

本文件记录内置插件与社区插件的重要变更，用于发布时同步说明。
格式参考 [Keep a Changelog](https://keepachangelog.com/en/1.0.0/)。

## [Unreleased]

---

## [1.7.0] - 2026-03-01

### Added
- anthropic-provider 内置插件（默认 AI Provider）
- openai-provider 社区插件（支持 OpenAI、Ollama、LocalAI 等兼容服务）
- cli-channel 内置插件（CLI 终端交互渠道）

### Changed
- feishu 从内置插件移至 community-plugins

## [1.4.0] - 2026-02-07

### Added
- telegram 社区插件（长轮询，支持图片收发、代理、白名单）
- 插件安装器自动安装 npm 依赖

## [1.2.0] - 2026-02-06

### Changed
- hello-world 插件完全重写，符合 ToolPlugin 接口规范
- memory 插件 scope 默认值改为 group
- pause-task/resume-task/register-group plugin.json name 改为 kebab-case
- cancel-task 移除未使用的 getTasksForGroup 导入
- feishu senderName 不再暴露完整 open_id

### Security
- web-ui openBrowser 命令注入修复
- web-ui Token 时序攻击修复
- web-fetch allowPrivate 参数从 schema 移除

---

## [1.0.0] - 2026-02-04

### Added
- 内置插件：feishu、send-message、schedule-task、list-tasks、cancel-task、pause-task、resume-task、memory、register-group
- 社区插件：hello-world、web-fetch、browser-control、web-ui

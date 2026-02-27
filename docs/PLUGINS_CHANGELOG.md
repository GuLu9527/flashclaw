# 插件变更日志

本文件记录内置插件与社区插件的重要变更，用于发布时同步说明。
格式参考 [Keep a Changelog](https://keepachangelog.com/en/1.0.0/)。

## [Unreleased]

### Added

### Changed
- hello-world 插件完全重写，符合 ToolPlugin 接口规范
- memory 插件 scope 默认值改为 group
- pause-task/resume-task/register-group plugin.json name 改为 kebab-case
- cancel-task 移除未使用的 getTasksForGroup 导入
- feishu senderName 不再暴露完整 open_id

### Fixed

### Security
- web-ui openBrowser 命令注入修复
- web-ui Token 时序攻击修复
- web-fetch allowPrivate 参数从 schema 移除

### Removed

---

## [1.0.0] - 2026-02-04

### Added
- 内置插件：feishu、send-message、schedule-task、list-tasks、cancel-task、pause-task、resume-task、memory、register-group
- 社区插件：hello-world、web-fetch、browser-control、web-ui

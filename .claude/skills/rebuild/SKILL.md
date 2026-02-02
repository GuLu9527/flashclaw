# FlashClaw 重建

重建项目的各个组件。用于代码更新后重新编译和重启服务。

## 快速命令

### 重建主程序

当修改了 `src/*.ts` 后使用：

```bash
npm run build
```

### 重启服务

编译后需要重启服务才能生效：

**开发模式**（自动重启）：
```bash
npm run dev
```

**PM2**：
```bash
pm2 restart flashclaw
```

### 完整重建

当需要完全重建时：

```bash
# 1. 编译主程序
npm run build

# 2. 重启服务
pm2 restart flashclaw
# 或重新运行 npm run dev
```

### 清理重建

如果遇到缓存问题，完全清理后重建：

```bash
# 清理编译输出
rm -rf dist/

# 重新编译
npm run build
```

## 什么时候需要重建？

| 修改了... | 需要做... |
|----------|----------|
| `.claude/skills/*.md` | 无需重建，立即生效 |
| `groups/*/CLAUDE.md` | 无需重建，下条消息生效 |
| `src/*.ts` | `npm run build` + 重启服务 |
| `src/clients/*.ts` | `npm run build` + 重启服务 |
| `.env` | 重启服务 |
| `package.json` | `npm install` + `npm run build` + 重启 |

## 检查当前状态

```bash
# 检查服务状态
pm2 status

# 检查编译输出
ls -la dist/
```

## 常见问题

### 编译错误

1. 检查 TypeScript 错误：`npm run build`
2. 检查依赖：`npm install`
3. 检查 Node 版本：`node --version`（需要 20+）

### 服务无法启动

1. 查看日志：`pm2 logs flashclaw`
2. 检查 `.env` 配置
3. 检查编译是否成功：`ls -la dist/`

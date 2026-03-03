# 发布流程

## 发布前检查

- `npm run typecheck`
- `npm test`
- `npm run build`
- 更新 `CHANGELOG.md`
- 更新 `docs/PLUGINS_CHANGELOG.md`（如有插件变更）
- 确认 `package.json` 版本号正确
- 运行 `flashclaw doctor` 确认环境正常
- 验证 `README.md` 中的说明与当前行为一致

## 发布步骤

1. 更新 `CHANGELOG.md`（将 `[Unreleased]` 改为 `[X.Y.Z] - YYYY-MM-DD`）
2. 更新 `docs/PLUGINS_CHANGELOG.md`（如有插件变更）
3. 更新 `CLAUDE.md` 版本历史表
4. 提交版本变更
   `git commit -m "release: 准备 vX.Y.Z 发布"`
5. 更新版本号（自动更新 package.json）
   `npm version X.Y.Z --no-git-tag-version`
6. 提交并打标签
   `git add package.json package-lock.json && git commit -m "X.Y.Z" && git tag vX.Y.Z`
7. 推送提交与标签
   `git push && git push --tags`
8. 发布到 npm（自动执行 build）
   `npm publish`
9. 创建 GitHub Release（填写更新日志）

## 版本号规则

- Patch（1.0.X）：问题修复
- Minor（1.X.0）：向后兼容的新功能
- Major（X.0.0）：不向后兼容的变更


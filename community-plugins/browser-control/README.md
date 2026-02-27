# browser-control

> FlashClaw 浏览器控制插件

## 功能

- 启动和连接 Chromium 系浏览器（Chrome/Edge/Brave）
- 页面导航、元素交互（点击、输入、拖拽等）
- 页面截图和 PDF 导出
- 表单填写和文件上传
- 页面快照和无障碍树提取
- 基于角色的元素引用系统（e1, e2, e3...）

## 安装

```bash
flashclaw plugins install browser-control
```

## 前置要求

- 需要安装以下浏览器之一：
  - Google Chrome
  - Microsoft Edge
  - Brave Browser
  - Chromium

插件会自动检测系统中已安装的浏览器。

## 工具列表

### browser_launch

启动浏览器实例。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| headless | boolean | ❌ | 是否无头模式（默认 false） |
| port | number | ❌ | CDP 调试端口（默认 9222） |
| userDataDir | string | ❌ | 用户数据目录 |

### browser_navigate

导航到指定 URL。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| url | string | ✅ | 目标 URL |
| waitUntil | string | ❌ | 等待状态：load/domcontentloaded/networkidle |
| timeout | number | ❌ | 超时时间（默认 30000ms） |

### browser_snapshot

获取页面快照，返回结构化页面描述和元素引用。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| maxChars | number | ❌ | 最大字符数限制 |
| timeout | number | ❌ | 超时时间（默认 5000ms） |

### browser_click

点击页面元素。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| ref | string | ✅ | 元素引用（如 e1, e2） |
| doubleClick | boolean | ❌ | 是否双击 |
| button | string | ❌ | 鼠标按钮：left/right/middle |
| timeout | number | ❌ | 超时时间（默认 8000ms） |

### browser_type

在元素中输入文本（追加模式）。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| ref | string | ✅ | 元素引用 |
| text | string | ✅ | 要输入的文本 |
| delay | number | ❌ | 每个字符间隔（默认 50ms） |
| timeout | number | ❌ | 超时时间 |

### browser_fill

填充元素文本（替换模式）。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| ref | string | ✅ | 元素引用 |
| text | string | ✅ | 要填充的文本 |
| timeout | number | ❌ | 超时时间 |

### browser_scroll

滚动页面或元素。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| ref | string | ❌ | 元素引用（不提供则滚动整个页面） |
| x | number | ❌ | 水平滚动位置 |
| y | number | ❌ | 垂直滚动位置 |

### browser_screenshot

截取页面或元素截图。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| ref | string | ❌ | 元素引用（截取特定元素） |
| fullPage | boolean | ❌ | 是否截取整页 |
| type | string | ❌ | 图片格式：png/jpeg |
| path | string | ❌ | 保存路径 |

### browser_select

下拉框选择选项。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| ref | string | ✅ | 下拉框元素引用 |
| values | string/string[] | ✅ | 要选择的值 |
| timeout | number | ❌ | 超时时间 |

### browser_upload

上传文件。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| ref | string | ✅ | 文件输入框元素引用 |
| files | string/string[] | ✅ | 文件路径 |
| timeout | number | ❌ | 超时时间 |

## 使用示例

### 启动浏览器并导航

```json
{
  "tool": "browser_launch",
  "args": { "headless": false }
}
```

```json
{
  "tool": "browser_navigate",
  "args": { "url": "https://example.com" }
}
```

### 获取页面快照

```json
{
  "tool": "browser_snapshot",
  "args": {}
}
```

返回结果包含页面结构和元素引用映射，如：

```
- button "登录" [e1]
- textbox "用户名" [e2]
- textbox "密码" [e3]
```

### 表单填写

```json
{
  "tool": "browser_fill",
  "args": { "ref": "e2", "text": "admin" }
}
```

```json
{
  "tool": "browser_fill",
  "args": { "ref": "e3", "text": "password123" }
}
```

```json
{
  "tool": "browser_click",
  "args": { "ref": "e1" }
}
```

### 截图保存

```json
{
  "tool": "browser_screenshot",
  "args": {
    "fullPage": true,
    "path": "./screenshots/page.png"
  }
}
```

### 截图并发送给用户

截图后可通过 `send_message` 工具发送给用户：

```json
// 1. 先截图
{
  "tool": "browser_screenshot",
  "args": {}
}

// 2. 发送截图
{
  "tool": "send_message",
  "args": {
    "image": "latest_screenshot",
    "caption": "这是当前页面截图"
  }
}
```

> **注意**：飞书发送图片需要开通 `im:resource:upload` 或 `im:resource` 权限。

## 元素引用系统

插件使用基于角色的元素引用系统，通过 `browser_snapshot` 获取页面快照时，会为可交互元素生成唯一引用（如 e1, e2, e3...）。

### 引用格式

- `e1` - 直接使用引用 ID
- `@e1` - 带 @ 前缀
- `ref=e1` - 带 ref= 前缀

以上三种格式等效，可根据习惯选择使用。

### 引用生命周期

- 引用在调用 `browser_snapshot` 后生成
- 页面内容变化后，引用可能失效
- 建议在执行交互操作前获取最新快照

## 注意事项

- 启动浏览器时会使用临时用户数据目录，关闭后数据不保留
- 默认 CDP 端口为 9222，如端口被占用请指定其他端口
- headless 模式下部分网站可能检测并限制访问
- 元素引用在页面导航或内容更新后需要重新获取快照
- 超时时间范围限制在 500ms - 60000ms
- 建议在复杂交互前使用 `browser_snapshot` 确认页面状态

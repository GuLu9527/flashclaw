# web-fetch

> FlashClaw 网页内容获取插件

## 功能
- 安全获取网页内容（SSRF 防护）
- 支持代理（HTTP_PROXY / HTTPS_PROXY）
- 支持 HTML/Text/Markdown 抽取
- 支持 selector 提取指定片段
- 支持超时、重定向与大小限制

## 安装

```bash
flashclaw plugins install web-fetch
```

## 工具参数

### web_fetch

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| url | string | ✅ | 目标 URL（仅 http/https） |
| method | string | ❌ | HTTP 方法（默认 GET） |
| headers | object | ❌ | 请求头 |
| query | object | ❌ | 查询参数 |
| body | string/object | ❌ | 请求体（非 GET/HEAD） |
| timeoutMs | number | ❌ | 超时（默认 10000） |
| maxBytes | number | ❌ | 最大响应大小（默认 2MB） |
| extract | string | ❌ | auto / text / html / markdown |
| selector | string | ❌ | CSS 选择器 |
| followRedirects | boolean | ❌ | 是否跟随重定向（默认 true） |
| maxRedirects | number | ❌ | 最大重定向次数（默认 3） |
| userAgent | string | ❌ | 自定义 UA |
| allowPrivate | boolean | ❌ | 允许访问内网（默认 false） |

## 示例

```json
{
  "url": "https://example.com",
  "extract": "text"
}
```

```json
{
  "url": "https://example.com/article",
  "selector": "article",
  "extract": "markdown"
}
```

## 注意事项

- 默认禁止访问内网地址和 localhost
- 需要访问内网时可设置 `allowPrivate=true` 或环境变量 `WEB_FETCH_ALLOW_PRIVATE=1`

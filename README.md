# RSS Feed Plugin

通过 Ting Reader 的能力化插件系统发布签名 RSS，并提供受控的订阅管理 UI。

## 安装

从 GitHub Releases 下载与当前版本对应的 `.tr` 包，在 Ting Reader 插件管理页上传安装。

插件提供“RSS 订阅”页面和书籍详情入口，可搜索书籍、选择单本书并复制该书的 RSS 订阅链接。UI 已适配最新 Web Container Bridge，通过 manifest 白名单调用 `rss.tools` 和 `user_settings.get`。

## 路由

- 全部可访问书籍：`/rss/library/all/feed.xml`
- 指定媒体库：`/rss/library/{library_id}/feed.xml`
- 指定单本书：`/rss/book/{book_id}/feed.xml`
- 本地封面代理：`/rss/cover/{book_id}`

生成给外部 RSS 阅读器使用的签名 URL：

```http
POST /api/v1/plugin-route-signatures
Content-Type: application/json

{
  "method": "GET",
  "path": "/rss/library/all/feed.xml",
  "expires_in_seconds": 2592000,
  "bind_current_user": true
}
```

单本书 feed 的签名示例：

```http
POST /api/v1/plugin-route-signatures
Content-Type: application/json

{
  "method": "GET",
  "path": "/rss/book/book-id/feed.xml",
  "expires_in_seconds": 2592000,
  "bind_current_user": true
}
```

把响应里的 `signed_url` 拼到你的公开服务地址后订阅即可。插件 UI 会自动补上服务器地址，并保存最近生成的订阅链接；再次打开面板可以直接复制、禁用、启用或删除。有效期选择“永久”时，签名 URL 使用 `expires=0`。

插件 UI 生成的单本书订阅链接会附带 `link_id`。RSS 请求到达插件时会回查插件缓存中的链接状态：链接被禁用时返回 403，被删除或不存在时返回 410。旧版已生成、没有 `link_id` 的单本书链接需要重新生成。

单本书 RSS 会把作者写入 `dc:creator` / `itunes:author`，把演播写入 `itunes:narrator`，避免 RSS 库导入时把演播误当成作者。本地相对封面会转换成签名的 `/rss/cover/{book_id}` 图片地址，由插件通过 HostGateway 读取媒体库文件后返回。

## 查询参数

- `limit=50`：返回条目数，范围 1-200。
- 单本书 feed 中 `limit` 表示章节数，最大 500，默认使用插件配置 `book_chapter_limit`。
- `offset=0`：分页偏移。
- `search=关键词` / `q=关键词`：按书名、作者、简介、演播搜索。
- `tag=标签`：按标签过滤。
- `chapters=0|1`：是否在条目中包含章节摘要。
- `chapter_preview_count=3`：每本书展示的章节数，范围 0-10。
- `lang=zh-cn`：RSS language 字段。
- `link_id=...`：插件 UI 生成的单本书订阅链接标识，用于禁用、启用和删除校验。

签名只绑定 `method + path + expires + user`，因此同一条签名 URL 的查询参数可按需调整，但访问范围仍受绑定用户权限限制。

## 配置

在插件管理页可配置对外访问地址。未配置 `public_base_url` 时，插件 UI 会默认使用当前服务访问地址；反向代理部署且当前访问地址不是外部 RSS 客户端可访问地址时，建议填写 `public_base_url`，例如 `https://reader.example.com`。章节数量、RSS 缓存秒数、订阅链接有效期、音频链接有效期和音频格式在插件 UI 中生成链接时选择。

## 说明

单本书 RSS 会把章节作为 item，并通过 HostGateway `media.get_signed_url` 输出签名媒体 `enclosure`。章节数量留空时不限制，插件会分页读取整本书的章节。

## 自动打包

仓库内置 GitHub Actions：push / pull request 会校验 manifest 并构建 `.tr` artifact；推送 `v*` 标签会创建对应的 GitHub Release。

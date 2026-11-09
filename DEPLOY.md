# 发布到 Cloudflare Workers

本项目运行在 Cloudflare Workers + Durable Objects，不需要 Render、传统服务器、信用卡验证流程或 Socket.IO 服务端。是否可用及免费额度以你的 Cloudflare 账户当前计划为准。

## 首次准备

1. 安装 Node.js 20+，在项目目录执行：

   ```bash
   npm install
   npm run build
   npm test
   ```

2. 通过浏览器授权 Wrangler（已有登录态时通常只需确认授权）：

   ```bash
   npx wrangler login
   ```

3. 可选：先启动完整的本地 Worker + Durable Object 环境验证：

   ```bash
   npm run dev:cloudflare
   ```

   打开终端显示的本地地址，创建房间并在无痕窗口加入即可测试实时联机。

## 发布

```bash
npm run deploy:cloudflare
```

该命令会依次执行类型检查、准备静态资源，然后发布 Worker。首次发布时 `wrangler.jsonc` 中的 `v1` 迁移会创建 `RoomCoordinator` 的 SQLite-backed Durable Object 类。发布成功后，Wrangler 会输出真实的 `https://…workers.dev` 地址；请把该地址和房间码发给群友。

如果你的账户已配置自定义域名，也可以在 Cloudflare Workers 控制台为该 Worker 添加路由或域名；这不需要改游戏代码。

## 配置说明

- `wrangler.jsonc` 中的 `name` 决定默认 Worker 名称；如该名称已被占用，可先改成你自己的唯一名称再发布。
- `assets.directory` 指向构建生成的 `public/`，浏览器资源与 Worker 同域名提供。
- 每个房间码通过 `idFromName(code)` 映射到一个独立的 Durable Object。
- 房间数据在每次变更后写入 Durable Object Storage。没有 WebSocket 连接时对象可以休眠，下一次请求会自动恢复数据。
- `public/` 和本地的 `.wrangler/` 状态目录都是构建/运行产物，不需要提交。

## 常见问题

| 现象 | 处理 |
| --- | --- |
| `wrangler login` 无法打开浏览器 | 直接复制终端给出的授权链接，在已登录 Cloudflare 的浏览器中完成授权。 |
| 发布提示 Worker 名称冲突 | 修改 `wrangler.jsonc` 的 `name` 后重新运行发布命令。 |
| 页面能打开但连不上房间 | 确认访问的是 Wrangler 输出的同一个 `workers.dev` 地址；WebSocket 与页面必须同源。 |
| 本地状态想清空 | 停止本地开发服务后删除 `.wrangler/`，再次启动时会新建本地 Durable Object 数据。 |

本指南只说明 Cloudflare 发布；本项目没有执行 Render 发布，也没有预先假定线上 URL。

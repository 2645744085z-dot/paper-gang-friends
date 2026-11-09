# 纸牌帮·群友专属版

给群友使用的中文联机协作扑克劫案。3–6 位玩家用筹码表达牌力判断、抢筹并合作打开三只保险箱；不需要注册，也不会把手牌在对局中泄露给其他人。

生产运行时使用 **Cloudflare Workers + Durable Objects**：每一个六位房间码对应一个 Durable Object，WebSocket 实时状态和房间数据都由它负责。房间状态会写入 Durable Object 的 SQLite 存储，因此 Worker 休眠或重新实例化后可以恢复；客户端使用浏览器原生 WebSocket 兼容层，不依赖 Socket.IO。

## 玩法规则

1. 一局依次经过 **翻牌前 → 翻牌 → 转牌 → 河牌**。每人有 2 张底牌，公共牌逐阶段翻开。
2. 每阶段每人要拿一枚筹码（1★~N★），也能抢走其他玩家正拿着的筹码；被抢者必须重新选择。
3. 河牌阶段全员选好后结算：筹码从小到大的顺序必须与牌力从弱到强完全一致。正确就打开一只保险箱，否则触发一次警报。
4. 先打开 3 只保险箱全员胜利；先触发 3 次警报则行动失败。

## 本地启动

需要 Node.js 20 或更高版本。

```bash
npm install
npm run dev
```

这会在本机启动 Cloudflare Workers 的本地运行环境（默认地址会显示在终端，通常是 `http://127.0.0.1:8787`），包括本地 Durable Object 和 WebSocket。

```bash
npm run build    # TypeScript 检查，并把浏览器资源准备到 public/
npm test         # 牌型和房间规则测试
```

## 发布到 Cloudflare

完整步骤见 [DEPLOY.md](DEPLOY.md)。简版命令：

```bash
npx wrangler login
npm run deploy:cloudflare
```

首次发布会创建 Durable Object 的 SQLite 迁移；成功后 Wrangler 会打印实际的 `workers.dev` 地址。项目未预设或声称任何线上地址，也不使用 Render。

## 工程结构

- `worker/index.ts`：Worker 入口和 `RoomCoordinator` Durable Object；处理房间、WebSocket、抢筹、结算和持久化。
- `ws-client.js`：浏览器原生 WebSocket 兼容层，保留前端原有的事件式调用方式。
- `src/poker.ts`：标准德州扑克 7 张牌取最佳 5 张的评估器。
- `src/game.ts`：可测试的游戏规则核心。
- `wrangler.jsonc`：Cloudflare Worker、静态资源和 Durable Object SQLite 迁移配置。
- `scripts/prepare-worker.mjs`：发布前复制浏览器资源。

## 联机说明

- 房主创建房间后，把六位房间码或房间链接发给朋友即可。
- 浏览器会保存会话标识；连接中断后会自动尝试回到原座位。
- 对局开始后不能加入新玩家；房主可在开局前移除误入者。
- Durable Object 在没有连接时可休眠。恢复时会从其持久化存储载入房间，不依赖某一台常驻 Node 服务器。

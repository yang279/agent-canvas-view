# agent-canvas-view

Canvas 白板 + 多 iframe 画布节点，REST API + WebSocket 驱动的实时协作工具。

## 启动

```bash
npm install
npm start          # node server.js，默认端口 8000
```

- 页面：`http://localhost:8000/`
- WebSocket：`ws://localhost:8000/ws`
- 静态目录：`public/`（`index.html`、`demo1.html`、`demo2.html`）

## 核心能力

- iframe 画布节点增删改查、自动命名（page1/page2…）
- 节点间单向连线（贝塞尔曲线 + 箭头）
- 基于连线的分层拓扑自动布局（入度 0 为根层，层=横向列，层内纵向排）
- WebSocket 实时广播，多端同步
- 缩放 / 平移 / 居中 / 拖拽交互

## REST API

所有接口以 `/api` 为前缀，请求/响应均为 JSON。

### iframe 节点

| 方法 | 路径 | 说明 |
|---|---|---|
| `POST` | `/api/frames` | 新增 iframe，body `{ url(必), width?, height?, id?, x?, y?, connectionLineIds? }`，默认 1920×1080 |
| `POST` | `/api/frames/bulk` | 批量新增，body `{ frames: [ {...} ] }`，非法项跳过 |
| `GET` | `/api/frames` | 列出所有 iframe |
| `PUT` | `/api/frames/:id` | 更新位置，body `{ x, y }`（拖拽后回传） |
| `DELETE` | `/api/frames` | 批量删除，body `{ ids:[...] }`（必填非空数组） |
| `DELETE` | `/api/frames/all` | 清空全部 |

### 连线

| 方法 | 路径 | 说明 |
|---|---|---|
| `POST` | `/api/frames/:id/connections/:toId` | 建连线 `id -> toId`（单向，去重） |
| `DELETE` | `/api/frames/:id/connections/:toId` | 删连线 |

### 视图控制

| 方法 | 路径 | 说明 |
|---|---|---|
| `POST` | `/api/zoom` | 全局缩放，body `{ scale }`，锚点视口中心，越界自动夹在 0.001~10 |
| `POST` | `/api/center` | 纯平移居中（不缩放），body `{ ids:[...] }`（非空数组必填）；未传/空 400 |
| `POST` | `/api/focus` | 居中 + 缩放适配（fit 到视口），body `{ ids? }`；未传/空 fit 所有 |

示例：

```bash
# 缩放到 100%（1:1 实际像素）
curl -X POST http://localhost:8000/api/zoom -H "Content-Type: application/json" -d '{"scale":1}'

# 居中某几个画板（不改变缩放）
curl -X POST http://localhost:8000/api/center -H "Content-Type: application/json" -d '{"ids":[1,2,3]}'

# 聚焦（居中 + 缩放适配到视口）
curl -X POST http://localhost:8000/api/focus -H "Content-Type: application/json" -d '{"ids":[123]}'

# 聚焦所有画布（缩放适配）
curl -X POST http://localhost:8000/api/focus -H "Content-Type: application/json" -d '{"ids":[]}'
```

> 注：`scale=1` 即 100%（世界坐标与屏幕像素 1:1）。「针对某画板放大到 100%」= `/api/center {"ids":[123]}` + `/api/zoom {scale:1}`，两步任意顺序均可。

## WebSocket 消息

连接 `/ws` 后，服务端会先下发当前快照，随后广播变更：

| type | 载荷 | 说明 |
|---|---|---|
| `frame:list` | `{ frames }` | 连接时下发快照 |
| `frame:add` | `{ frame }` | 新增单个 |
| `frames:add` | `{ frames, updates }` | 批量新增 |
| `frame:update` | `{ frame }` | 位置 / 连线变更 |
| `frames:remove` | `{ ids }` | 批量删除 |
| `frames:clear` | — | 清空全部 |
| `center` | `{ ids }` | 纯平移居中（`ids` 非空数组） |
| `focus` | `{ ids }` | 居中 + 缩放适配（`ids` 为数组或 null） |
| `zoom` | `{ scale }` | 全局缩放 |

"use strict";

const path = require("path");
const http = require("http");
const express = require("express");

const FrameManager = require("./src/frameManager");
const WSBroadcaster = require("./src/ws");
const createApiRouter = require("./src/api");

const PORT = process.env.PORT || 8000;

const app = express();
const server = http.createServer(app);

const frameManager = new FrameManager();
const broadcaster = new WSBroadcaster(server);

// 客户端连接后下发当前快照
broadcaster.onConnect((ws) => {
  broadcaster.send(ws, { type: "frame:list", frames: frameManager.list() });
});

app.use("/api", createApiRouter(frameManager, broadcaster));
app.use(express.static(path.join(__dirname, "public")));

server.listen(PORT, () => {
  console.log(`[canvas] http://localhost:${PORT}`);
  console.log(`[canvas] ws://localhost:${PORT}/ws`);
  console.log(`[canvas] POST /api/frames  DELETE /api/frames/:id  GET /api/frames`);
});

"use strict";

const WebSocket = require("ws");

class WSBroadcaster {
  constructor(server) {
    this.wss = new WebSocket.Server({ server: server, path: "/ws" });
    this.clients = new Set();
    this.onConnectListeners = [];

    this.wss.on("connection", (ws) => {
      this.clients.add(ws);
      ws.on("close", () => this.clients.delete(ws));
      ws.on("error", () => this.clients.delete(ws));
      for (const fn of this.onConnectListeners) fn(ws);
    });
  }

  onConnect(fn) {
    this.onConnectListeners.push(fn);
  }

  send(ws, msg) {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  }

  broadcast(msg) {
    const data = JSON.stringify(msg);
    for (const ws of this.clients) {
      if (ws.readyState === WebSocket.OPEN) ws.send(data);
    }
  }
}

module.exports = WSBroadcaster;
"use strict";

const express = require("express");

function createApiRouter(frameManager, broadcaster) {
  const router = express.Router();
  router.use(express.json());

  // 新增 iframe：{ url(必), width?, height?, id?, x?, y?, connectionLineIds? }
  router.post("/frames", (req, res) => {
    const body = req.body || {};
    if (!body.url) {
      return res.status(400).json({ error: "url 不能为空" });
    }
    const result = frameManager.addFrame(body);
    if (result.error) {
      return res.status(result.status || 400).json({ error: result.error });
    }
    broadcaster.broadcast({ type: "frame:add", frame: result.frame });
    (result.changed || []).forEach(function (f) {
      if (f.id !== result.frame.id) {
        broadcaster.broadcast({ type: "frame:update", frame: f });
      }
    });
    broadcaster.broadcast({ type: "center", id: null });
    res.json({ id: result.frame.id, frame: result.frame });
  });

  // 批量新增 iframe：{ frames: [ {url?, ...}, ... ] }，非法项跳过
  router.post("/frames/bulk", (req, res) => {
    const body = req.body || {};
    const list = Array.isArray(body.frames) ? body.frames : null;
    if (!list || list.length === 0) {
      return res.status(400).json({ error: "frames 不能为空数组" });
    }
    const result = frameManager.addFrames(list);
    const added = [];
    const failed = [];
    result.results.forEach(function (r) {
      if (r.frame) added.push(r.frame);
      else failed.push({ index: r.index, error: r.error });
    });

    if (added.length > 0) {
      const addedIds = {};
      added.forEach(function (f) { addedIds[f.id] = true; });
      const updates = (result.changed || []).filter(function (f) {
        return !addedIds[f.id]; // 本批新增已在 frames 里，无需单独 update
      });
      // 一次性广播批量消息，前端分片渲染（每批几个 iframe 重绘一次）
      broadcaster.broadcast({ type: "frames:add", frames: added, updates: updates });
    }
    res.json({ added: added, failed: failed });
  });

  // 建连线：frame id -> toId（单向）
  router.post("/frames/:id/connections/:toId", (req, res) => {
    const result = frameManager.addConnection(req.params.id, req.params.toId);
    if (result.error) {
      return res.status(result.status || 400).json({ error: result.error });
    }
    broadcaster.broadcast({ type: "frame:update", frame: result.frame });
    res.json({ frame: result.frame });
  });

  // 删连线
  router.delete("/frames/:id/connections/:toId", (req, res) => {
    const result = frameManager.removeConnection(req.params.id, req.params.toId);
    if (result.error) {
      return res.status(result.status || 400).json({ error: result.error });
    }
    broadcaster.broadcast({ type: "frame:update", frame: result.frame });
    res.json({ frame: result.frame });
  });

  // 更新位置（拖拽后回传，不广播）
  router.put("/frames/:id", (req, res) => {
    const body = req.body || {};
    const result = frameManager.updatePosition(req.params.id, body.x, body.y);
    if (result.error) {
      return res.status(result.status || 400).json({ error: result.error });
    }
    res.json({ frame: result.frame });
  });

  // 删除单个（:id 支持 "all" 清空）
  router.delete("/frames/:id", (req, res) => {
    const id = req.params.id;
    if (id === "all") {
      frameManager.clear();
      broadcaster.broadcast({ type: "frames:clear" });
      return res.json({ ok: true });
    }
    const result = frameManager.removeFrame(id);
    if (!result.existed) return res.status(404).json({ error: `iframe id ${id} 不存在` });
    broadcaster.broadcast({ type: "frame:remove", id: Number(id) });
    (result.changed || []).forEach(function (f) {
      broadcaster.broadcast({ type: "frame:update", frame: f });
    });
    res.json({ ok: true, id: Number(id) });
  });

  // 清空全部
  router.delete("/frames", (req, res) => {
    frameManager.clear();
    broadcaster.broadcast({ type: "frames:clear" });
    res.json({ ok: true });
  });

  // 居中：有 id 居中该 iframe，无 id 居中所有 iframe（画布居中）
  router.post("/center", (req, res) => {
    const body = req.body || {};
    const id = body.id != null ? Number(body.id) : null;
    if (id != null && !frameManager.get(id)) {
      return res.status(404).json({ error: `iframe id ${id} 不存在` });
    }
    broadcaster.broadcast({ type: "center", id: id });
    res.json({ ok: true, id: id });
  });

  // 全局缩放：设置画布缩放比（视口中心锚点），越界由前端 clamp
  router.post("/zoom", (req, res) => {
    const body = req.body || {};
    const scale = body.scale;
    if (typeof scale !== "number" || !Number.isFinite(scale)) {
      return res.status(400).json({ error: "scale 必须为数字" });
    }
    broadcaster.broadcast({ type: "zoom", scale: scale });
    res.json({ ok: true, scale: scale });
  });

  // 列表
  router.get("/frames", (req, res) => {
    res.json({ frames: frameManager.list() });
  });

  return router;
}

module.exports = createApiRouter;
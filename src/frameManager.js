"use strict";

const crypto = require("crypto");

class FrameManager {
  constructor() {
    this.frames = new Map(); // id -> frame
  }

  // 生成一个未被占用的随机数字 id
  _generateId() {
    let id;
    do {
      id = crypto.randomInt(1, 2 ** 31);
    } while (this.frames.has(id));
    return id;
  }

  // 默认名称：基于当前已有 iframe 的最大 page 序号 + 1
  _nextName() {
    let max = 0;
    this.frames.forEach(function (f) {
      var m = /^page(\d+)$/.exec(f.name || "");
      if (m) max = Math.max(max, parseInt(m[1], 10));
    });
    return "page" + (max + 1);
  }

  // 返回 { frame, changed } 或 { error, status }
  addFrame(opts) {
    const url = opts.url;
    const width = opts.width != null ? opts.width : 1920;
    const height = opts.height != null ? opts.height : 1080;

    let id;
    if (opts.id != null) {
      id = Number(opts.id);
      if (this.frames.has(id)) {
        return { error: `iframe id ${id} 已被使用`, status: 409 };
      }
    } else {
      id = this._generateId();
    }

    const manualPos = opts.x != null && opts.y != null;

    const frame = {
      id: id,
      url: url,
      name: opts.name != null ? opts.name : this._nextName(),
      x: manualPos ? Number(opts.x) : 120,
      y: manualPos ? Number(opts.y) : 120,
      width: width,
      height: height,
      connectionLineIds: opts.connectionLineIds || [],
      manualPos: manualPos,
    };
    this.frames.set(id, frame);
    const changed = this.layout();
    return { frame: frame, changed: changed };
  }

  // 批量追加：逐条处理，非法项跳过；全部处理完统一布局一次
  // 返回 { results, changed }，results[i] = { index, frame } 或 { index, error }
  addFrames(list) {
    const results = [];
    list.forEach((opts, index) => {
      if (!opts || !opts.url) {
        results.push({ index: index, error: "url 不能为空" });
        return;
      }
      const idNum = opts.id != null ? Number(opts.id) : null;
      if (idNum != null && this.frames.has(idNum)) {
        results.push({ index: index, error: `iframe id ${opts.id} 已被使用` });
        return;
      }
      const width = opts.width != null ? opts.width : 1920;
      const height = opts.height != null ? opts.height : 1080;
      const id = idNum != null ? idNum : this._generateId();
      const manualPos = opts.x != null && opts.y != null;
      const frame = {
        id: id,
        url: opts.url,
        name: opts.name != null ? opts.name : this._nextName(),
        x: manualPos ? Number(opts.x) : 120,
        y: manualPos ? Number(opts.y) : 120,
        width: width,
        height: height,
        connectionLineIds: opts.connectionLineIds || [],
        manualPos: manualPos,
      };
      this.frames.set(id, frame);
      results.push({ index: index, frame: frame });
    });
    const changed = this.layout();
    return { results: results, changed: changed };
  }

  // 批量删除：逐个删除存在的（跳过不存在），最后统一布局一次
  // 返回 { removed, changed }，removed 为删除成功的 id 列表
  removeFrames(ids) {
    const removed = [];
    ids.forEach((id) => {
      const n = Number(id);
      if (this.frames.delete(n)) removed.push(n);
    });
    const changed = this.layout();
    return { removed: removed, changed: changed };
  }

  clear() {
    this.frames.clear();
  }

  get(id) {
    return this.frames.get(Number(id));
  }

  list() {
    return Array.from(this.frames.values());
  }

  // 建连线：id -> toId（单向，去重；目标 id 无需存在）
  addConnection(id, toId) {
    id = Number(id);
    toId = Number(toId);
    const frame = this.frames.get(id);
    if (!frame) return { error: `iframe id ${id} 不存在`, status: 404 };
    if (frame.connectionLineIds.indexOf(toId) === -1) {
      frame.connectionLineIds.push(toId);
    }
    return { frame: frame };
  }

  // 删连线
  removeConnection(id, toId) {
    id = Number(id);
    toId = Number(toId);
    const frame = this.frames.get(id);
    if (!frame) return { error: `iframe id ${id} 不存在`, status: 404 };
    const idx = frame.connectionLineIds.indexOf(toId);
    if (idx !== -1) frame.connectionLineIds.splice(idx, 1);
    return { frame: frame };
  }

  // 更新位置（拖拽后回传；拖拽视为手动调整，后续不再自动布局）
  updatePosition(id, x, y) {
    id = Number(id);
    const frame = this.frames.get(id);
    if (!frame) return { error: `iframe id ${id} 不存在`, status: 404 };
    if (x != null) frame.x = Number(x);
    if (y != null) frame.y = Number(y);
    frame.manualPos = true;
    return { frame: frame };
  }

  // 拓扑层级：入度为 0 的根层级 0，子层级 = 父层级 + 1（BFS 最短路径）
  _computeLevels() {
    const levels = new Map();
    const indegree = new Map();
    this.frames.forEach(function (f) { indegree.set(f.id, 0); });
    this.frames.forEach(function (f) {
      (f.connectionLineIds || []).forEach(function (toId) {
        if (indegree.has(toId)) indegree.set(toId, indegree.get(toId) + 1);
      });
    });

    const queue = [];
    this.frames.forEach(function (f) {
      if (indegree.get(f.id) === 0) {
        levels.set(f.id, 0);
        queue.push(f.id);
      }
    });
    // 环：无根时选创建顺序第一个当根
    if (queue.length === 0 && this.frames.size > 0) {
      const first = this.frames.keys().next().value;
      levels.set(first, 0);
      queue.push(first);
    }
    while (queue.length) {
      const id = queue.shift();
      const f = this.frames.get(id);
      (f.connectionLineIds || []).forEach(function (toId) {
        if (this.frames.has(toId) && !levels.has(toId)) {
          levels.set(toId, levels.get(id) + 1);
          queue.push(toId);
        }
      }, this);
    }
    this.frames.forEach(function (f) {
      if (!levels.has(f.id)) levels.set(f.id, 0);
    });
    return levels;
  }

  // 分层布局：层=横向列，层内=纵向排；只更新自动 iframe，返回位置变化的 frame 列表
  layout() {
    const GAP = 100;
    const levels = this._computeLevels();
    const byLevel = {};
    this.frames.forEach(function (f) {
      const lv = levels.get(f.id) != null ? levels.get(f.id) : 0;
      if (!byLevel[lv]) byLevel[lv] = [];
      byLevel[lv].push(f); // Map 插入顺序 = 创建顺序
    });

    const sortedLevels = Object.keys(byLevel).map(Number).sort(function (a, b) { return a - b; });
    const changed = [];
    let colX = 120;

    sortedLevels.forEach(function (lv) {
      const list = byLevel[lv];
      let rowY = 120;
      let maxW = 0;
      list.forEach(function (f) {
        maxW = Math.max(maxW, f.width);
        if (f.manualPos) return; // 手动位置保持
        if (f.x !== colX || f.y !== rowY) {
          f.x = colX;
          f.y = rowY;
          changed.push(f);
        }
        rowY += f.height + GAP;
      });
      colX += maxW + GAP;
    });

    return changed;
  }
}

module.exports = FrameManager;
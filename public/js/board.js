(function (global) {
  function frameCenter(frame) {
    return { x: frame.x + frame.w / 2, y: frame.y + frame.h / 2 };
  }

  // 节点边框上指向 (fx,fy) 的交点（照搬 graph.html:366）
  function borderPoint(frame, fx, fy) {
    var cx = frame.x + frame.w / 2;
    var cy = frame.y + frame.h / 2;
    var dx = fx - cx;
    var dy = fy - cy;
    var adx = Math.abs(dx);
    var ady = Math.abs(dy);
    if (adx < 1e-6 && ady < 1e-6) return { x: cx, y: cy };
    var scale = 1 / Math.max(adx / (frame.w / 2), ady / (frame.h / 2));
    return { x: cx + dx * scale, y: cy + dy * scale };
  }

  function curvePoint(a, c, b, t) {
    var u = 1 - t;
    return {
      x: u * u * a.x + 2 * u * t * c.x + t * t * b.x,
      y: u * u * a.y + 2 * u * t * c.y + t * t * b.y,
    };
  }

  function distToSegment(p, a, b) {
    var dx = b.x - a.x, dy = b.y - a.y;
    var l = dx * dx + dy * dy;
    if (!l) return Math.hypot(p.x - a.x, p.y - a.y);
    var t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / l;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
  }

  function Board(opts) {
    this.canvas = opts.canvas;
    this.ctx = this.canvas.getContext("2d");
    this.host = opts.host;
    this.vp = opts.vp;
    this.frames = opts.frames || null; // Frames 实例，用于画连接线
    this.gridSize = opts.gridSize || 50;
    this.bg = opts.bg || "#e5e5e5";
    this.gridColor = opts.gridColor || "#d4d4d4";
    this.hoveredConn = null; // { fromId, toId } 命中的连接线
    this.hoveredFrame = null; // hover 的 iframe frame 对象

    this.backingW = 0;
    this.backingH = 0;
    this.backingDpr = 0;

    var self = this;
    window.addEventListener("resize", function () {
      self.draw();
    });

    this.draw();
  }

  Board.prototype.ensureBackingStore = function (w, h) {
    var dpr = window.devicePixelRatio || 1;
    var bw = Math.max(1, Math.round(w * dpr));
    var bh = Math.max(1, Math.round(h * dpr));
    if (bw === this.backingW && bh === this.backingH && dpr === this.backingDpr) return dpr;
    this.backingW = bw;
    this.backingH = bh;
    this.backingDpr = dpr;
    this.canvas.width = bw;
    this.canvas.height = bh;
    this.canvas.style.width = w + "px";
    this.canvas.style.height = h + "px";
    return dpr;
  };

  Board.prototype.draw = function () {
    var w = this.host.clientWidth;
    var h = this.host.clientHeight;
    if (!w || !h) return;

    var dpr = this.ensureBackingStore(w, h);
    var ctx = this.ctx;
    var vp = this.vp;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = this.bg;
    ctx.fillRect(0, 0, w, h);

    ctx.translate(vp.x, vp.y);
    ctx.scale(vp.scale, vp.scale);

    this.drawGrid(ctx);
    this.drawThumbnails(ctx);
    this.drawConnections(ctx);
    this.drawNames(ctx);
  };

  Board.prototype.drawGrid = function (ctx) {
    var vp = this.vp;
    var w = this.host.clientWidth;
    var h = this.host.clientHeight;
    var g = this.gridSize;

    var minX = -vp.x / vp.scale;
    var maxX = (w - vp.x) / vp.scale;
    var minY = -vp.y / vp.scale;
    var maxY = (h - vp.y) / vp.scale;

    ctx.strokeStyle = this.gridColor;
    ctx.lineWidth = 1 / vp.scale;
    ctx.beginPath();

    var x = Math.floor(minX / g) * g;
    for (; x <= maxX; x += g) {
      ctx.moveTo(x, minY);
      ctx.lineTo(x, maxY);
    }
    var y = Math.floor(minY / g) * g;
    for (; y <= maxY; y += g) {
      ctx.moveTo(minX, y);
      ctx.lineTo(maxX, y);
    }
    ctx.stroke();
  };

  // 构建所有连接线的几何（端点 + 控制点）
  Board.prototype.buildConnections = function () {
    var conns = [];
    if (!this.frames) return conns;
    var framesMap = this.frames.frames;
    framesMap.forEach(function (frame) {
      var ids = frame.connectionLineIds || [];
      ids.forEach(function (toId) {
        var to = framesMap.get(toId);
        if (!to) return;
        var tc = frameCenter(to);
        var a = borderPoint(frame, tc.x, tc.y);
        var b = borderPoint(to, a.x, a.y);
        var c = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        conns.push({ fromId: frame.id, toId: toId, a: a, b: b, c: c });
      });
    });
    return conns;
  };

  // 世界坐标命中检测：返回 { fromId, toId } 或 null
  Board.prototype.hitConnection = function (wx, wy) {
    var vp = this.vp;
    var tol = 8 / vp.scale;
    var conns = this.buildConnections();
    for (var i = 0; i < conns.length; i++) {
      var c = conns[i];
      var min = Infinity;
      var prev = c.a;
      for (var t = 1; t <= 12; t++) {
        var pt = curvePoint(c.a, c.c, c.b, t / 12);
        min = Math.min(min, distToSegment({ x: wx, y: wy }, prev, pt));
        prev = pt;
      }
      if (min < tol) return { fromId: c.fromId, toId: c.toId };
    }
    return null;
  };

  // 缩略白块：degraded 的 iframe 用 canvas 画白底 + 浅边框（代替 DOM，避免撑大画布 bounds）
  Board.prototype.drawThumbnails = function (ctx) {
    if (!this.frames) return;
    var vp = this.vp;
    var hovered = this.hoveredFrame;
    this.frames.frames.forEach(function (frame) {
      if (!frame.degraded) return;
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.rect(frame.x, frame.y, frame.w, frame.h);
      ctx.fill();
      if (hovered && hovered.id === frame.id) {
        ctx.strokeStyle = "#007dff";
        ctx.lineWidth = 2 / vp.scale;
        ctx.stroke();
      }
    });
  };

  // 连接线：单向邻接表，贝塞尔曲线 + 箭头（照搬 graph.html drawEdge 简化版）
  Board.prototype.drawConnections = function (ctx) {
    if (!this.frames) return;
    var vp = this.vp;
    var self = this;
    var conns = this.buildConnections();
    var hovered = this.hoveredConn;

    for (var i = 0; i < conns.length; i++) {
      var c = conns[i];
      var isHover = hovered && hovered.fromId === c.fromId && hovered.toId === c.toId;
      ctx.strokeStyle = isHover ? "#007dff" : "rgba(0,125,255,0.42)";
      ctx.fillStyle = isHover ? "#007dff" : "rgba(0,125,255,0.42)";
      ctx.lineWidth = (isHover ? 2 : 1.2) / vp.scale;

      ctx.beginPath();
      ctx.moveTo(c.a.x, c.a.y);
      ctx.quadraticCurveTo(c.c.x, c.c.y, c.b.x, c.b.y);
      ctx.stroke();

      self.drawArrowHead(ctx, c.b.x, c.b.y, Math.atan2(c.b.y - c.c.y, c.b.x - c.c.x), vp);
    }
  };

  // 名称：canvas 文字，照搬 graph.html:529（#191919，13px/scale，iframe 上方 8px/scale；hover 变 #007dff）
  Board.prototype.drawNames = function (ctx) {
    if (!this.frames) return;
    var vp = this.vp;
    ctx.font = (13 / vp.scale) + "px ui-sans-serif, system-ui, sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    var hovered = this.hoveredFrame;
    this.frames.frames.forEach(function (frame) {
      var isHover = hovered && hovered.id === frame.id;
      ctx.fillStyle = isHover ? "#007dff" : "#191919";
      ctx.fillText(frame.name || ("page" + frame.id), frame.x, frame.y - 8 / vp.scale);
    });
  };

  // 箭头（照搬 graph.html:434）
  Board.prototype.drawArrowHead = function (ctx, px, py, ang, vp) {
    var L = 9 / vp.scale;
    var W = 4.5 / vp.scale;
    var dx = Math.cos(ang);
    var dy = Math.sin(ang);
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.lineTo(px - L * dx + W * dy, py - L * dy - W * dx);
    ctx.lineTo(px - L * dx - W * dy, py - L * dy + W * dx);
    ctx.closePath();
    ctx.fill();
  };

  global.Board = Board;
})(window);
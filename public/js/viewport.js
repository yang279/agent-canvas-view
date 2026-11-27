(function (global) {
  // view = { scale, x, y }：世界坐标 -> 屏幕坐标 = (wx*scale+x, wy*scale+y)
  // 与 html-parse/graph.html 的 view 语义一致
  function Viewport(opts) {
    this.viewportEl = opts.viewport;
    this.worldEl = opts.world;

    var saved = opts.saved || null;
    this.scale = saved && saved.scale != null ? saved.scale : 1;
    this.x = saved && saved.x != null ? saved.x : 0;
    this.y = saved && saved.y != null ? saved.y : 0;

    this.minScale = 0.001;
    this.maxScale = 10;

    // 滚轮缩放惯性（照搬 graph.html 的 zoomVel）
    this.zoomVel = 0;
    this.zoomAnchor = { x: 0, y: 0 };
    this.zoomRaf = null;

    // 水平平移惯性（照搬 graph.html 的 panVelX）
    this.panVelX = 0;
    this.panRaf = null;

    this.onUpdate = opts.onUpdate || null;

    this.apply();
  }

  // 更新 iframe 容器的 CSS transform，并通知 canvas 重绘
  Viewport.prototype.apply = function () {
    this.worldEl.style.transform =
      "translate(" + this.x + "px," + this.y + "px) scale(" + this.scale + ")";
    if (this.onUpdate) this.onUpdate(this);
  };

  // 以画布像素 (px,py)（相对视口左上角）为锚点缩放，公式照搬 graph.html:922
  Viewport.prototype.zoomAt = function (px, py, factor) {
    var wx = (px - this.x) / this.scale;
    var wy = (py - this.y) / this.scale;
    var ns = this.scale * factor;
    if (ns < this.minScale) ns = this.minScale;
    if (ns > this.maxScale) ns = this.maxScale;
    this.x = px - wx * ns;
    this.y = py - wy * ns;
    this.scale = ns;
    this.apply();
  };

  Viewport.prototype.panBy = function (dx, dy) {
    this.x += dx;
    this.y += dy;
    this.apply();
  };

  // 绝对缩放：设置全局缩放比为 scale（视口中心锚点，内部 clamp 到 min/max）
  Viewport.prototype.zoomToScale = function (scale) {
    var px = this.viewportEl.clientWidth / 2;
    var py = this.viewportEl.clientHeight / 2;
    this.zoomAt(px, py, scale / this.scale);
  };

  // 滚轮方向累积为缩放"速度"，锚点记住鼠标位置
  Viewport.prototype.addZoomVel = function (px, py, delta) {
    this.zoomAnchor = { x: px, y: py };
    this.zoomVel -= delta * 0.0005;
    this.kickZoom();
  };

  Viewport.prototype.kickZoom = function () {
    if (this.zoomRaf) return;
    this.zoomRaf = requestAnimationFrame(this.zoomStep.bind(this));
  };

  Viewport.prototype.zoomStep = function () {
    if (Math.abs(this.zoomVel) < 0.0005) {
      this.zoomVel = 0;
      this.zoomRaf = null;
      return;
    }
    this.zoomAt(this.zoomAnchor.x, this.zoomAnchor.y, Math.exp(this.zoomVel));
    this.zoomVel *= 0.72;
    this.zoomRaf = requestAnimationFrame(this.zoomStep.bind(this));
  };

  // 水平平移惯性（Shift+滚轮）
  Viewport.prototype.addPanVel = function (delta) {
    this.panVelX -= delta * 0.3;
    this.kickPan();
  };

  Viewport.prototype.kickPan = function () {
    if (this.panRaf) return;
    this.panRaf = requestAnimationFrame(this.panStep.bind(this));
  };

  Viewport.prototype.panStep = function () {
    if (Math.abs(this.panVelX) < 0.05) {
      this.panVelX = 0;
      this.panRaf = null;
      return;
    }
    this.panBy(this.panVelX, 0);
    this.panVelX *= 0.72;
    this.panRaf = requestAnimationFrame(this.panStep.bind(this));
  };

  // 把世界包围盒 bbox {minX,minY,maxX,maxY} 缩放适配并居中到视口（留边距 pad）
  Viewport.prototype.fitOn = function (bbox, pad) {
    var w = this.viewportEl.clientWidth;
    var h = this.viewportEl.clientHeight;
    var bw = bbox.maxX - bbox.minX;
    var bh = bbox.maxY - bbox.minY;
    if (bw <= 0 || bh <= 0) return;

    var gap = pad != null ? pad : 60;
    var s = Math.min((w - gap * 2) / bw, (h - gap * 2) / bh);
    if (s < this.minScale) s = this.minScale;
    if (s > this.maxScale) s = this.maxScale;

    var cx = (bbox.minX + bbox.maxX) / 2;
    var cy = (bbox.minY + bbox.maxY) / 2;

    this.scale = s;
    this.x = w / 2 - cx * s;
    this.y = h / 2 - cy * s;
    this.apply();
  };

  // 只平移居中（不缩放）：把包围盒中心平移到视口中心
  Viewport.prototype.centerOn = function (bbox) {
    var cx = (bbox.minX + bbox.maxX) / 2;
    var cy = (bbox.minY + bbox.maxY) / 2;
    var w = this.viewportEl.clientWidth;
    var h = this.viewportEl.clientHeight;
    this.x = w / 2 - cx * this.scale;
    this.y = h / 2 - cy * this.scale;
    this.apply();
  };

  global.Viewport = Viewport;
})(window);
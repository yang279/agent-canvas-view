(function (global) {
  function Frames(opts) {
    this.worldEl = opts.world;
    this.vp = opts.vp;
    this.onUpdate = opts.onUpdate || null; // 增删/移动/连线变化后触发重绘
    this.onMoveEnd = opts.onMoveEnd || null; // 拖拽结束回调（回传位置）
    this.frames = new Map(); // id -> frame
    this.interactive = true; // true: iframe 正常交互；false: 允许整体拖拽
    this.altDown = false; // Alt 按住：允许拖拽 iframe（与 interactive 解耦）
  }

  Frames.prototype.create = function (id, url, name, x, y, w, h) {
    var wrap = document.createElement("div");
    wrap.className = "frame-wrap";

    var f = document.createElement("iframe");
    f.className = "frame";
    f.src = url;

    wrap.appendChild(f);
    this.worldEl.appendChild(wrap);

    var frame = {
      id: id,
      url: url,
      name: name,
      x: x,
      y: y,
      w: w,
      h: h,
      wrap: wrap,
      iframe: f,
      connectionLineIds: [],
      crossOrigin: false,
      degraded: false,
    };

    this.frames.set(id, frame);
    this.layout(frame);
    this.applyInteractive(frame);
    this.bind(frame);
    this.attach(frame);
    return frame;
  };

  Frames.prototype.get = function (id) {
    return this.frames.get(id);
  };

  Frames.prototype.removeAll = function () {
    this.frames.forEach(function (frame) {
      if (frame.wrap.parentNode) frame.wrap.parentNode.removeChild(frame.wrap);
    });
    this.frames.clear();
    this.notifyUpdate();
  };

  // 批量删除：一次遍历删 DOM，最后统一 notifyUpdate 一次
  Frames.prototype.removeMany = function (ids) {
    if (!Array.isArray(ids)) return;
    var self = this;
    ids.forEach(function (id) {
      var frame = self.frames.get(id);
      if (!frame) return;
      if (frame.wrap.parentNode) frame.wrap.parentNode.removeChild(frame.wrap);
      self.frames.delete(id);
    });
    this.notifyUpdate();
  };

  // 更新 frame（frame:update 广播）：同步 x/y 位置 + connectionLineIds + 重新布局 iframe DOM
  Frames.prototype.updateFrame = function (frameData) {
    var frame = this.frames.get(frameData.id);
    if (!frame) return;
    if (frameData.x != null) frame.x = frameData.x;
    if (frameData.y != null) frame.y = frameData.y;
    frame.connectionLineIds = (frameData.connectionLineIds || []).slice();
    this.layout(frame);
    this.notifyUpdate();
  };

  Frames.prototype.layout = function (frame) {
    frame.wrap.style.left = frame.x + "px";
    frame.wrap.style.top = frame.y + "px";
    frame.wrap.style.width = frame.w + "px";
    frame.wrap.style.height = frame.h + "px";
  };

  Frames.prototype.setPos = function (frame, x, y) {
    frame.x = x;
    frame.y = y;
    this.layout(frame);
    this.notifyUpdate();
  };

  Frames.prototype.notifyUpdate = function () {
    if (this.onUpdate) this.onUpdate();
  };

  // Shift 按下时禁用 iframe 交互（pointer-events none），让父页面捕获拖拽
  Frames.prototype.setInteractive = function (flag) {
    if (this.interactive === flag) return;
    this.interactive = flag;
    var self = this;
    this.frames.forEach(function (frame) {
      self.applyInteractive(frame);
    });
  };

  Frames.prototype.setAltDown = function (flag) {
    this.altDown = flag;
  };

  Frames.prototype.applyInteractive = function (frame) {
    if (frame.crossOrigin) {
      frame.iframe.style.pointerEvents = "none"; // 跨域：不可交互，拖拽优先
      return;
    }
    frame.iframe.style.pointerEvents = this.interactive ? "" : "none";
  };

  // 视口裁剪 + 缩略：每帧统一判定三层显示状态
  //   off        视口外 -> wrap display:none
  //   thumbnail  视口内但过小 -> wrap/iframe 隐藏，改由 board canvas 画白块
  //   full       视口内且够大 -> iframe 正常显示
  var THUMB_THRESHOLD = 80; // iframe 屏幕宽/高小于该像素值时进入 canvas 缩略模式

  Frames.prototype.updateVisibility = function () {
    var vp = this.vp;
    if (!vp) return;
    var el = vp.viewportEl;
    var vw = el.clientWidth;
    var vh = el.clientHeight;
    if (!vw || !vh) return;

    var s = vp.scale;
    var tx = vp.x;
    var ty = vp.y;
    var bx1 = -vw, by1 = -vh, bx2 = vw * 2, by2 = vh * 2; // 视口外扩 1 倍 buffer

    this.frames.forEach(function (frame) {
      var sx1 = frame.x * s + tx;
      var sy1 = frame.y * s + ty;
      var sx2 = (frame.x + frame.w) * s + tx;
      var sy2 = (frame.y + frame.h) * s + ty;
      var inView = sx2 >= bx1 && sx1 <= bx2 && sy2 >= by1 && sy1 <= by2;

      if (!inView) {
        frame.wrap.style.display = "none";
        return;
      }

      var tooSmall = frame.w * s < THUMB_THRESHOLD || frame.h * s < THUMB_THRESHOLD;
      if (tooSmall) {
        // 缩略：隐藏 DOM（缩小画布 bounds），改由 canvas 画白块
        if (frame.wrap.style.display !== "none") frame.wrap.style.display = "none";
        if (frame.iframe.style.display !== "none") frame.iframe.style.display = "none";
        frame.degraded = true;
      } else {
        if (frame.wrap.style.display !== "") frame.wrap.style.display = "";
        if (frame.iframe.style.display !== "") frame.iframe.style.display = "";
        frame.degraded = false;
      }
    });
  };

  Frames.prototype.bind = function (frame) {
    var self = this;

    // 整体拖拽：仅 Alt 按住时，pointerdown 才会落到 wrap 并拖拽
    frame.wrap.addEventListener("pointerdown", function (e) {
      if (!self.altDown) return;
      e.preventDefault();
      try { frame.wrap.setPointerCapture(e.pointerId); } catch (err) {}
      self.startMove(frame, e.clientX, e.clientY);
    });
  };

  // 同源注入：监听 iframe 内 Shift/Space 按下松开并转发给父页面（焦点在 iframe 内时父页面收不到键盘事件）
  // 对输入框放行，避免影响 iframe 内输入大写/空格
  Frames.prototype.attach = function (frame) {
    var f = frame.iframe;
    f.addEventListener("load", function () {
      var doc;
      try {
        doc = f.contentDocument;
      } catch (e) {
        doc = null;
      }
      if (!doc) {
        // 跨域：无法注入，不可交互，拖拽优先
        frame.crossOrigin = true;
        frame.iframe.style.pointerEvents = "none";
        return;
      }

      var code =
        "(function(){" +
        "function send(m){try{parent.postMessage(m,'*');}catch(e){}}" +
        "function isAlt(e){return e.code==='AltLeft'||e.code==='AltRight'||e.key==='Alt';}" +
        "function isCtrl(e){return e.code==='ControlLeft'||e.code==='ControlRight';}" +
        "function isShift(e){return e.code==='ShiftLeft'||e.code==='ShiftRight';}" +
        "function editable(){var t=document.activeElement;var tag=(t&&t.tagName||'').toLowerCase();return tag==='input'||tag==='textarea'||(t&&t.isContentEditable);}" +
        "document.addEventListener('keydown',function(e){" +
        "if(isAlt(e)){if(!editable())send({type:'frame:alt',down:true});}" +
        "else if(e.code==='Space'){if(!editable()){e.preventDefault();send({type:'frame:space',down:true});}}" +
        "else if(isCtrl(e)){send({type:'frame:ctrl',down:true});}" +
        "else if(isShift(e)){send({type:'frame:shift',down:true});}" +
        "},true);" +
        "document.addEventListener('keyup',function(e){" +
        "if(isAlt(e))send({type:'frame:alt',down:false});" +
        "else if(e.code==='Space')send({type:'frame:space',down:false});" +
        "else if(isCtrl(e))send({type:'frame:ctrl',down:false});" +
        "else if(isShift(e))send({type:'frame:shift',down:false});" +
        "},true);" +
        "document.addEventListener('mouseenter',function(){send({type:'frame:hover',id:" + frame.id + ",down:true});});" +
        "document.addEventListener('mouseleave',function(){send({type:'frame:hover',id:" + frame.id + ",down:false});});" +
        "})();";

      var s = doc.createElement("script");
      s.textContent = code;
      if (doc.head) doc.head.appendChild(s);
      else doc.documentElement.appendChild(s);
    });
  };

  Frames.prototype.startMove = function (frame, sx, sy) {
    var vp = this.vp;
    var origX = frame.x;
    var origY = frame.y;
    var self = this;

    function onMove(e) {
      var dx = (e.clientX - sx) / vp.scale;
      var dy = (e.clientY - sy) / vp.scale;
      self.setPos(frame, origX + dx, origY + dy);
    }
    function onUp() {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      if (self.onMoveEnd) self.onMoveEnd(frame);
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  };

  global.Frames = Frames;
})(window);
(function (global) {
  var viewportEl = document.getElementById("viewport");
  var worldEl = document.getElementById("world");
  var boardCanvas = document.getElementById("board");

  // view 状态持久化（sessionStorage）：刷新记忆缩放比和画布位置
  function loadView() {
    try {
      var s = sessionStorage.getItem("canvas-view");
      return s ? JSON.parse(s) : null;
    } catch (e) {
      return null;
    }
  }
  function saveView(v) {
    try {
      sessionStorage.setItem("canvas-view", JSON.stringify({ scale: v.scale, x: v.x, y: v.y }));
    } catch (e) {}
  }

  var vp = new Viewport({ viewport: viewportEl, world: worldEl, saved: loadView() });

  // 拖拽 iframe 结束后，回传最新位置到服务端
  function updateFramePosition(frame) {
    fetch("/api/frames/" + frame.id, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ x: frame.x, y: frame.y }),
    }).catch(function (e) {
      console.error("update position error", e);
    });
  }

  var frames = new Frames({
    world: worldEl,
    vp: vp,
    onMoveEnd: updateFramePosition,
  });

  var board = new Board({
    canvas: boardCanvas,
    host: viewportEl,
    vp: vp,
    frames: frames,
    gridSize: 50,
    bg: "#e5e5e5",
    gridColor: "#d4d4d4",
  });

  vp.onUpdate = function () {
    frames.updateVisibility();
    board.draw();
    saveView(vp);
  };
  frames.onUpdate = function () {
    frames.updateVisibility();
    board.draw();
  };

  var panState = null;
  var spaceDown = false;
  var altDown = false;
  var ctrlDown = false;
  var shiftDown = false;

  function viewPos(e) {
    var r = viewportEl.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  function isEditable(target) {
    if (!target) return false;
    var tag = (target.tagName || "").toLowerCase();
    return tag === "input" || tag === "textarea" || target.isContentEditable;
  }

  function updateCursor() {
    if (spaceDown) {
      viewportEl.style.cursor = panState ? "grabbing" : "grab";
    } else if (altDown) {
      viewportEl.style.cursor = "move";
    } else {
      viewportEl.style.cursor = "default";
    }
  }

  function setAlt(down) {
    if (altDown === down) return;
    altDown = down;
    frames.setAltDown(down);
    updateInteractive();
    updateCursor();
  }

  function setSpace(down) {
    if (spaceDown === down) return;
    spaceDown = down;
    updateInteractive();
    updateCursor();
  }

  function setCtrl(down) {
    if (ctrlDown === down) return;
    ctrlDown = down;
    updateInteractive();
    updateCursor();
  }

  function setShift(down) {
    if (shiftDown === down) return;
    shiftDown = down;
    updateInteractive();
    updateCursor();
  }

  // 任一修饰键（Alt/Space/Ctrl/Shift）按住时，iframe 全部 pointer-events:none，让父页面捕获事件
  function updateInteractive() {
    frames.setInteractive(!(altDown || spaceDown || ctrlDown || shiftDown));
  }

  // ---------- WebSocket ----------
  function connectWS() {
    var proto = location.protocol === "https:" ? "wss://" : "ws://";
    var ws = new WebSocket(proto + location.host + "/ws");

    ws.onmessage = function (ev) {
      var msg;
      try {
        msg = JSON.parse(ev.data);
      } catch (e) {
        return;
      }
      if (msg.type === "frame:list") {
        frames.removeAll();
        (msg.frames || []).forEach(addLocal);
        board.draw();
      } else if (msg.type === "frame:add") {
        addLocal(msg.frame);
        board.draw();
      } else if (msg.type === "frames:add") {
        addLocalBatch(msg);
      } else if (msg.type === "frame:remove") {
        frames.remove(msg.id);
      } else if (msg.type === "frames:remove") {
        frames.removeMany(msg.ids);
      } else if (msg.type === "frames:clear") {
        frames.removeAll();
      } else if (msg.type === "frame:update") {
        frames.updateFrame(msg.frame);
      } else if (msg.type === "center") {
        panCenter(msg.ids);
      } else if (msg.type === "focus") {
        fitCenter(msg.ids);
      } else if (msg.type === "zoom") {
        vp.zoomToScale(msg.scale);
      }
    };

    ws.onclose = function () {
      setTimeout(connectWS, 2000);
    };
  }

  function addLocal(fr) {
    if (!fr) return;
    var frame = frames.create(fr.id, fr.url, fr.name, fr.x, fr.y, fr.width, fr.height);
    frame.connectionLineIds = (fr.connectionLineIds || []).slice();
  }

  // 批量新增：分片渲染，每片几个 iframe 重绘一次，避免一次性长任务阻塞主线程
  var RENDER_BATCH = 5;

  function addLocalBatch(msg) {
    var updates = msg.updates || [];
    updates.forEach(function (u) {
      frames.updateFrame(u);
    });

    var list = (msg.frames || []).slice();
    var i = 0;

    function step() {
      var end = Math.min(i + RENDER_BATCH, list.length);
      for (; i < end; i++) {
        addLocal(list[i]);
      }
      board.draw();
      if (i < list.length) {
        requestAnimationFrame(step);
      } else {
        fitCenter(null);
      }
    }

    if (list.length === 0) {
      board.draw();
      return;
    }
    step();
  }

  // 计算居中目标包围盒：ids 数组取并集，空/null 取所有 iframe 并集
  function getCenterBBox(ids) {
    var list;
    if (Array.isArray(ids) && ids.length > 0) {
      list = [];
      ids.forEach(function (id) {
        var f = frames.get(id);
        if (f) list.push(f);
      });
      if (list.length === 0) return null;
    } else {
      list = Array.from(frames.frames.values());
      if (list.length === 0) return null; // 无 iframe
    }
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    list.forEach(function (fr) {
      minX = Math.min(minX, fr.x);
      minY = Math.min(minY, fr.y);
      maxX = Math.max(maxX, fr.x + fr.w);
      maxY = Math.max(maxY, fr.y + fr.h);
    });
    return { minX: minX, minY: minY, maxX: maxX, maxY: maxY };
  }

  // 适配居中（缩放+居中）：批量新增后自动布局 / focus 接口用
  function fitCenter(ids) {
    var bbox = getCenterBBox(ids);
    if (!bbox) return;
    vp.fitOn(bbox, 120);
  }

  // 纯平移居中（不缩放）：/api/center 触发
  function panCenter(ids) {
    var bbox = getCenterBBox(ids);
    if (!bbox) return;
    vp.centerOn(bbox);
  }

  connectWS();

  // ---------- 键盘：Alt(拖拽 iframe) / Space(平移) ----------
  window.addEventListener("keydown", function (e) {
    if (e.code === "AltLeft" || e.code === "AltRight") {
      setAlt(true);
    } else if (e.code === "Space") {
      if (!isEditable(e.target)) {
        e.preventDefault();
        setSpace(true);
      }
    } else if (e.code === "ControlLeft" || e.code === "ControlRight") {
      setCtrl(true);
    } else if (e.code === "ShiftLeft" || e.code === "ShiftRight") {
      setShift(true);
    }
  });

  window.addEventListener("keyup", function (e) {
    if (e.code === "AltLeft" || e.code === "AltRight") {
      setAlt(false);
    } else if (e.code === "Space") {
      setSpace(false);
    } else if (e.code === "ControlLeft" || e.code === "ControlRight") {
      setCtrl(false);
    } else if (e.code === "ShiftLeft" || e.code === "ShiftRight") {
      setShift(false);
    }
  });

  window.addEventListener("blur", function () {
    altDown = false;
    spaceDown = false;
    ctrlDown = false;
    shiftDown = false;
    frames.setAltDown(false);
    frames.setInteractive(true);
    updateCursor();
  });

  // 焦点在 iframe 内时父页面收不到键盘事件，这里接收 iframe 注入转发的 Alt/Space/hover 状态
  window.addEventListener("message", function (e) {
    var d = e.data;
    if (!d || typeof d !== "object") return;
    if (d.type !== "frame:alt" && d.type !== "frame:space" && d.type !== "frame:hover" && d.type !== "frame:ctrl" && d.type !== "frame:shift") return;
    var ok = false;
    frames.frames.forEach(function (f) {
      if (e.source === f.iframe.contentWindow) ok = true;
    });
    if (!ok) return;
    if (d.type === "frame:alt") setAlt(!!d.down);
    else if (d.type === "frame:space") setSpace(!!d.down);
    else if (d.type === "frame:ctrl") setCtrl(!!d.down);
    else if (d.type === "frame:shift") setShift(!!d.down);
    else if (d.type === "frame:hover") {
      board.hoveredFrame = d.down ? frames.get(d.id) : null;
      board.draw();
    }
  });

  // ---------- 滚轮：Shift+滚轮=水平平移 / 普通滚轮=缩放 ----------
  viewportEl.addEventListener(
    "wheel",
    function (e) {
      e.preventDefault();
      if (e.shiftKey) {
        var pd = e.deltaY !== 0 ? e.deltaY : e.deltaX;
        vp.addPanVel(pd);
        return;
      }
      var p = viewPos(e);
      var delta = Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
      vp.addZoomVel(p.x, p.y, delta);
    },
    { passive: false }
  );

  // ---------- 连接线 hover（变深） + 点击跳转 ----------
  function sameHit(a, b) {
    if (a === b) return true;
    if (!a || !b) return false;
    return a.fromId === b.fromId && a.toId === b.toId;
  }

  // 检测鼠标世界坐标落在哪个 iframe 包围盒内（重叠取最上层）
  function hitFrame(wx, wy) {
    var result = null;
    frames.frames.forEach(function (f) {
      if (wx >= f.x && wx <= f.x + f.w && wy >= f.y && wy <= f.y + f.h) {
        result = f;
      }
    });
    return result;
  }

  viewportEl.addEventListener("mousemove", function (e) {
    if (spaceDown || panState) return;
    var p = viewPos(e);
    var wx = (p.x - vp.x) / vp.scale;
    var wy = (p.y - vp.y) / vp.scale;

    // 始终检测 iframe hover（同源 Alt 时 + 跨域始终，父页面能收到 mousemove）
    var hf = hitFrame(wx, wy);
    if (hf !== board.hoveredFrame) {
      board.hoveredFrame = hf;
      board.draw();
    }

    if (altDown) return; // Alt 时只做 iframe hover，不做连接线 hover

    var hit = board.hitConnection(wx, wy);
    if (sameHit(hit, board.hoveredConn)) return;
    board.hoveredConn = hit;
    board.draw();
  });

  viewportEl.addEventListener("click", function (e) {
    if (spaceDown || altDown) return;
    var p = viewPos(e);
    var wx = (p.x - vp.x) / vp.scale;
    var wy = (p.y - vp.y) / vp.scale;
    var hit = board.hitConnection(wx, wy);
    if (!hit) return;
    var f = frames.get(hit.toId);
    if (!f) return;
    vp.centerOn({ minX: f.x, minY: f.y, maxX: f.x + f.w, maxY: f.y + f.h });
  });

  // 画布上禁掉右键菜单（macOS Ctrl+点击 也会触发 contextmenu）
  viewportEl.addEventListener("contextmenu", function (e) {
    e.preventDefault();
  });

  // ---------- 平移（空格拖拽） ----------
  viewportEl.addEventListener("pointerdown", function (e) {
    if (spaceDown) {
      panState = { sx: e.clientX, sy: e.clientY };
      updateCursor();
      try { viewportEl.setPointerCapture(e.pointerId); } catch (err) {}
      window.addEventListener("pointermove", onPanMove);
      window.addEventListener("pointerup", onPanUp);
      window.addEventListener("pointercancel", onPanUp);
      return;
    }

    if (e.target.closest && e.target.closest(".frame-wrap")) return;

    if (altDown) {
      // 缩略模式下 wrap 已隐藏，改由父容器命中拖拽 iframe
      var p = viewPos(e);
      var wx = (p.x - vp.x) / vp.scale;
      var wy = (p.y - vp.y) / vp.scale;
      var f = hitFrame(wx, wy);
      if (f) {
        e.preventDefault();
        frames.startMove(f, e.clientX, e.clientY);
      }
    }
  });

  function onPanMove(e) {
    vp.panBy(e.clientX - panState.sx, e.clientY - panState.sy);
    panState.sx = e.clientX;
    panState.sy = e.clientY;
  }
  function onPanUp() {
    window.removeEventListener("pointermove", onPanMove);
    window.removeEventListener("pointerup", onPanUp);
    window.removeEventListener("pointercancel", onPanUp);
    panState = null;
    updateCursor();
  }
})(window);
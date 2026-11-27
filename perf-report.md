# iframe 画布性能优化报告

- 日期：2026-11-26
- 对象：Node(Express)+WebSocket 白板（iframe 画布节点）

## 1. 背景

压测发现性能瓶颈集中在**缩放（zoom）**场景：缩放时 `scale` 全量变化，所有 iframe 每帧重新光栅化 + 合成，导致 FPS 大幅掉帧（N=100 时最低仅 10，N=150 最低 4）；而平移/拖拽全程 60fps（只改 translate，纯位移合成）。

## 2. 三项优化

| 项 | 内容 | 针对问题 |
|---|---|---|
| 1. 降低缩放下限 | `viewport.js` `minScale` 0.05 → 0.001 | 解决「缩小到 5% 就缩不动」；`fitOn` 能装下更多 iframe |
| 2. 视口裁剪 | `frames.js` 新增 `updateVisibility()`，视口外 iframe `display:none` | 放大后视口外 iframe 不再合成/光栅化 |
| 3. 白块 LOD | iframe 屏幕尺寸 < 40px 时，隐藏 iframe、显示白块（白底+浅边框） | 缩小时过小的 iframe 不再真实渲染 |

### 实现
- `frames.js`：`create` 加 `frame-placeholder` 白块节点；新增 `updateVisibility()` 每帧判定三层状态（off / placeholder / full）。
- `main.js`：`vp.onUpdate`、`frames.onUpdate` 里调用 `frames.updateVisibility()`。
- `style.css`：`.frame-placeholder`（白底 + `#d0d0d0` 浅边框）。
- 视口外扩 1 倍 buffer 避免边缘闪显；仅状态变化时改 `display`，避免每帧回流。
- name 由 canvas `board.drawNames` 绘制，白块降级后名称仍可见。

## 3. 缩放 FPS 优化前后对比（真实窗口）

| N | 优化前 min/avg | 优化后 min/avg | avg 提升 |
|---:|---:|---:|---:|
| 1 | 60 / 60 | 60 / 60 | — |
| 50 | 30 / 53 | 46 / 59 | +11% |
| 100 | 10 / 43 | 37 / 58 | +35% |
| 150 | 4 / 35 | 38 / 58 | +66% |
| 200 | 4 / 25 | 38 / 57 | +128% |
| 300 | 未测完 | 34 / 57 | — |

> 缩放场景为「放大到 max(10) → 缩到 min(0.001)」循环 5 次。

## 4. 结论

- **优化后缩放平均 FPS 稳定在 57~58（接近满帧 60），到 300 个 iframe 仍流畅**。
- 最低 FPS 从优化前的个位数（4~10）提升到 34~46，掉帧幅度大幅收窄。
- 视口裁剪 + 白块 LOD 精准打击了「iframe 光栅化/合成」这一瓶颈，缩放卡顿基本消除。

## 5. 遗留项

- `display:none` / 白块降级**不释放 iframe 内存**（iframe 仍在 DOM）。若后续出现内存型「空白」，需演进为「卸载重建（视口外 iframe 移除 DOM）」，代价是内部状态丢失 + 进出重载。
- 500 个级别未在优化后重测（此前 300 个曾出现正常大小空白，属内存/光栅化上限，与本次优化无关）。

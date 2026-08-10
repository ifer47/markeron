import { ref, shallowRef, computed, type Ref } from 'vue'
import type { EraserMode } from '../utils/eraserMode'
import {
  computeBbox,
  computeTextBbox,
  computeStampBbox,
  bboxesIntersect,
  offsetAttachedErasers,
  updateShapeHitCache,
  hitTestAction,
  snapPointToAngle,
} from './drawingGeometry'
import { drawActionDirect, drawInkStroke, drawLaserTrail } from './drawingRender'
import { normalizeTextOutline } from '../constants/textOutline'
import { stampFontSizeFromWidth } from '../constants/stamp'
import { isLaserTrailGone, pruneAgedLaserPoints } from '../constants/laser'
import { computeMinDistSq, normalizePressure, penStrokeStyle, smoothPenPoint } from '../constants/penStroke'
import { getStrokeSmoothing } from './strokeSmoothingState'

export type { Tool, Point, DrawAction } from './drawingTypes'
export type { InputPointLike } from './drawingTypes'

import type { Tool, Point, DrawAction, InputPointLike, TextOutlineStyle } from './drawingTypes'
import {
  createDefaultLineWidths,
  eraserLineWidth,
  highlighterLineWidth,
  resolveLineWidths,
  toolLineWidthGroup,
  type ToolLineWidths,
} from '../constants/tools'

const HIT_GRID_SIZE = 192
const HIT_GRID_MAX_CELLS = 64

// Adaptive point sampling in device-pixel space so density stays consistent across
// DPR and large CSS viewports (see computeMinDistSq).
let cachedMinDistSq = 4
let cachedViewportKey = ''

function getMinDistSq(): number {
  const w = window.innerWidth
  const h = window.innerHeight
  const dpr = window.devicePixelRatio || 1
  const key = `${w}x${h}@${dpr}`
  if (key !== cachedViewportKey) {
    cachedViewportKey = key
    cachedMinDistSq = computeMinDistSq(w, h, dpr)
  }
  return cachedMinDistSq
}

export function useDrawing(
  historyCanvasRef: Ref<HTMLCanvasElement | null>,
  previewCanvasRef: Ref<HTMLCanvasElement | null>,
) {
  const currentTool = ref<Tool>('pen')
  const currentColor = ref('#FF0000')
  const lineWidths = ref(createDefaultLineWidths())
  const lineWidth = computed({
    get: () => lineWidths.value[toolLineWidthGroup(currentTool.value)],
    set: (value: number) => {
      setLineWidth(value)
    },
  })
  const isDrawing = ref(false)
  const angleSnapStep = ref<15 | 30 | 45>(15)
  const eraserMode = ref<EraserMode>('stroke')

  /** Live ink buffer needs rebake (declared early for mid-gesture width sync). */
  let inkPreviewDirty = true

  function setEraserMode(mode: EraserMode) {
    eraserMode.value = mode
  }

  function setLineWidths(widths: Partial<ToolLineWidths> | null | undefined) {
    lineWidths.value = resolveLineWidths(widths)
  }

  function resolveDrawLineWidth(tool: Tool): number {
    const w = lineWidths.value[toolLineWidthGroup(tool)]
    if (tool === 'highlighter') return highlighterLineWidth(w)
    if (tool === 'eraser') return eraserLineWidth(w)
    return w
  }

  /**
   * Update the active tool's width preset.
   * `tip` = pointer position for mid-gesture eraser resizes (Ctrl+wheel): split the stroke
   * so the new radius applies at the cursor instead of re-erasing the old path.
   */
  function setLineWidth(value: number, tip?: Point) {
    lineWidths.value[toolLineWidthGroup(currentTool.value)] = value
    syncInProgressStrokeWidth(tip)
  }

  /** Keep live stroke width in sync when Ctrl+wheel (etc.) changes size mid-gesture. */
  function syncInProgressStrokeWidth(tip?: Point) {
    const action = currentAction.value
    if (!isDrawing.value || !action) return

    const next = resolveDrawLineWidth(action.tool)
    if (action.lineWidth === next) return

    // Eraser: one action has a single width. Changing it + redrawing would re-stamp the
    // whole path with the new radius (looks like erasing at old positions). Split instead.
    if (action.tool === 'eraser') {
      const pt = tip ?? action.points[action.points.length - 1]
      if (!pt) return
      endDraw()
      startDraw({ x: pt.x, y: pt.y, pointerType: action.pointerType })
      return
    }

    if (action.tool !== 'pen' && action.tool !== 'highlighter' && action.tool !== 'laser') {
      return
    }
    action.lineWidth = next
    previewDirty = true
    // Ink preview is a baked buffer; mark dirty so Ctrl+wheel width rebakes on next frame.
    if (action.tool === 'pen' || action.tool === 'highlighter') {
      inkPreviewDirty = true
    }
    scheduleRender()
  }

  let objectEraserBatch: { action: DrawAction; index: number }[] = []
  let objectEraserRemovedSet = new Set<DrawAction>()
  let objectEraserLastProcessedPt = 0

  function setAngleSnapStep(step: number) {
    angleSnapStep.value = step === 30 || step === 45 ? step : 15
  }

  interface DragSnapshot {
    points: Point[]
    index: number
    attachedErasers: DrawAction['attachedErasers']
    bbox: DrawAction['bbox']
    rectHit: DrawAction['rectHit']
    ellipseHit: DrawAction['ellipseHit']
  }

  type UndoEntry =
    | { type: 'add'; action: DrawAction }
    | { type: 'remove'; action: DrawAction; index: number }
    | { type: 'drag'; action: DrawAction; from: DragSnapshot; to: DragSnapshot }
    | {
        type: 'erase'
        targets: { action: DrawAction; before: DrawAction['attachedErasers']; after: DrawAction['attachedErasers'] }[]
      }
    | { type: 'removeBatch'; removed: { action: DrawAction; index: number }[] }
    | { type: 'clear'; actions: DrawAction[]; prevUndoStack: UndoEntry[] }

  function clonePoint(p: Point): Point {
    return {
      x: p.x,
      y: p.y,
      ...(p.pressure != null ? { pressure: p.pressure } : {}),
      ...(p.t != null ? { t: p.t } : {}),
    }
  }

  function takeDragSnapshot(action: DrawAction, index: number): DragSnapshot {
    return {
      points: action.points.map(clonePoint),
      index,
      attachedErasers: action.attachedErasers ? [...action.attachedErasers] : undefined,
      bbox: action.bbox ? { ...action.bbox } : undefined,
      rectHit: action.rectHit ? { ...action.rectHit } : undefined,
      ellipseHit: action.ellipseHit ? { ...action.ellipseHit } : undefined,
    }
  }

  function restoreDragSnapshot(action: DrawAction, snap: DragSnapshot) {
    action.points = snap.points.map(clonePoint)
    action.attachedErasers = snap.attachedErasers ? [...snap.attachedErasers] : undefined
    action.bbox = snap.bbox ? { ...snap.bbox } : undefined
    action.rectHit = snap.rectHit ? { ...snap.rectHit } : undefined
    action.ellipseHit = snap.ellipseHit ? { ...snap.ellipseHit } : undefined
    pathCache.delete(action)
  }

  const history: DrawAction[] = []
  const undoStack: UndoEntry[] = []
  const redoStack: UndoEntry[] = []
  const historyRevision = ref(0)

  interface LaserStroke {
    action: DrawAction
  }

  const laserStrokes: LaserStroke[] = []
  const laserRevision = ref(0)
  let laserRafId: number | null = null

  const canUndo = computed(() => {
    void historyRevision.value
    return undoStack.length > 0
  })
  const canRedo = computed(() => {
    void historyRevision.value
    return redoStack.length > 0
  })
  const canClear = computed(() => {
    void historyRevision.value
    void laserRevision.value
    return history.length > 0 || laserStrokes.length > 0
  })

  function isDrawingLaser() {
    return isDrawing.value && currentAction.value?.tool === 'laser'
  }

  function markHistoryStacksChanged() {
    historyRevision.value++
  }

  function markLaserChanged() {
    laserRevision.value++
  }

  function stopLaserAnimation() {
    if (laserRafId !== null) {
      clearTimeout(laserRafId)
      laserRafId = null
    }
  }

  function clearLaserStrokes(): boolean {
    if (laserStrokes.length === 0) return false
    laserStrokes.length = 0
    markLaserChanged()
    stopLaserAnimation()
    return true
  }

  function pruneExpiredLaserStrokes(now: number): boolean {
    let removed = false
    for (let i = laserStrokes.length - 1; i >= 0; i--) {
      const stroke = laserStrokes[i]
      const pruned = pruneAgedLaserPoints(stroke.action.points, now)
      if (pruned.length !== stroke.action.points.length) {
        stroke.action.points = pruned
        removed = true
      }
      if (isLaserTrailGone(stroke.action.points, now)) {
        laserStrokes.splice(i, 1)
        removed = true
      }
    }

    const cur = currentAction.value
    if (cur?.tool === 'laser' && cur.points.length > 1) {
      const pruned = pruneAgedLaserPoints(cur.points, now)
      if (pruned.length !== cur.points.length && pruned.length > 0) {
        cur.points = pruned
        removed = true
      }
    }

    if (removed) markLaserChanged()
    return removed
  }

  function needsLaserAnimation() {
    return laserStrokes.length > 0 || isDrawingLaser()
  }

  function ensureLaserAnimation() {
    if (laserRafId !== null) return
    const tick = () => {
      laserRafId = null
      const now = performance.now()
      pruneExpiredLaserStrokes(now)
      previewDirty = true
      scheduleRender()
      if (needsLaserAnimation()) {
        laserRafId = window.setTimeout(tick, 16)
      }
    }
    laserRafId = window.setTimeout(tick, 16)
  }

  function drawLaserStrokes(ctx: CanvasRenderingContext2D, now = performance.now()) {
    for (let i = 0; i < laserStrokes.length; i++) {
      const { action } = laserStrokes[i]
      drawLaserTrail(ctx, action.points, action.color, action.lineWidth, now, false)
    }
  }
  const currentAction = shallowRef<DrawAction | null>(null)
  const previewAction = shallowRef<DrawAction | null>(null)

  let cacheCanvas: HTMLCanvasElement | null = null
  let cacheCtx: CanvasRenderingContext2D | null = null
  let historyCtx: CanvasRenderingContext2D | null = null
  let previewCtx: CanvasRenderingContext2D | null = null
  let cacheValid = false
  let rafId: number | null = null
  let historyDirty = true
  let previewDirty = true

  // Live ink preview buffer (full-stroke redraw; avoids bake/join artifacts with variable width).
  let strokeCanvas: HTMLCanvasElement | null = null
  let strokeCtx: CanvasRenderingContext2D | null = null

  // Pre-rendered drag element canvas (avoids per-frame path reconstruction)
  let dragCanvas: HTMLCanvasElement | null = null
  let dragCtx: CanvasRenderingContext2D | null = null
  let dragOffsetX = 0
  let dragOffsetY = 0
  let dragBboxX = 0
  let dragBboxY = 0
  let useDragCanvas = false
  let tempCanvas: HTMLCanvasElement | null = null
  let tempCtx: CanvasRenderingContext2D | null = null
  const pathCache = new WeakMap<DrawAction, Path2D>()

  // O(1) action→history-index lookup (replaces O(n) lastIndexOf in findActionAt).
  // Lazily rebuilt when splice operations invalidate it.
  const historyIndexMap = new WeakMap<DrawAction, number>()
  let historyIndexDirty = true

  function ensureHistoryIndex() {
    if (!historyIndexDirty) return
    for (let i = 0; i < history.length; i++) {
      historyIndexMap.set(history[i], i)
    }
    historyIndexDirty = false
  }

  function trackHistoryPush(action: DrawAction) {
    historyIndexMap.set(action, history.length - 1)
  }

  let hitGridDirty = true
  const hitGrid = new Map<string, DrawAction[]>()
  let hitGridOverflow: DrawAction[] = []
  const hitGridCells = new WeakMap<DrawAction, string[] | null>()
  const hitGridOrder = new WeakMap<DrawAction, number>()
  let nextHitGridOrder = 1

  // Effective DPR cached to avoid repeated parseFloat(canvas.style.width)
  // inside renderFrame (called 3-5× per frame). Invalidated automatically
  // when canvas.width changes (i.e. after resizeCanvas).
  let cachedDpr = 0
  let cachedDprCanvasW = 0

  function getEffectiveDpr(): number {
    const canvas = previewCanvasRef.value ?? historyCanvasRef.value
    if (!canvas) return window.devicePixelRatio || 1
    if (canvas.width === cachedDprCanvasW && cachedDpr > 0) return cachedDpr
    const cssW = parseFloat(canvas.style.width)
    cachedDpr = cssW > 0 ? canvas.width / cssW : window.devicePixelRatio || 1
    cachedDprCanvasW = canvas.width
    return cachedDpr
  }

  function getHistoryCtx(): CanvasRenderingContext2D | null {
    const canvas = historyCanvasRef.value
    if (!canvas) {
      historyCtx = null
      return null
    }
    if (!historyCtx) {
      historyCtx = canvas.getContext('2d', { alpha: true, desynchronized: true })
    }
    return historyCtx
  }

  function getPreviewCtx(): CanvasRenderingContext2D | null {
    const canvas = previewCanvasRef.value
    if (!canvas) {
      previewCtx = null
      return null
    }
    if (!previewCtx) {
      previewCtx = canvas.getContext('2d', { alpha: true, desynchronized: true })
    }
    return previewCtx
  }

  function clearHitGridState() {
    hitGrid.clear()
    hitGridOverflow = []
    nextHitGridOrder = 1
  }

  function getHitGridCells(action: DrawAction): string[] | null {
    const bbox = action.bbox
    if (!bbox) return null

    const startCellX = Math.floor(bbox.x1 / HIT_GRID_SIZE)
    const endCellX = Math.floor(bbox.x2 / HIT_GRID_SIZE)
    const startCellY = Math.floor(bbox.y1 / HIT_GRID_SIZE)
    const endCellY = Math.floor(bbox.y2 / HIT_GRID_SIZE)
    const cellCount = (endCellX - startCellX + 1) * (endCellY - startCellY + 1)

    if (cellCount > HIT_GRID_MAX_CELLS) return null

    const cells: string[] = []
    for (let cy = startCellY; cy <= endCellY; cy++) {
      for (let cx = startCellX; cx <= endCellX; cx++) {
        cells.push(`${cx},${cy}`)
      }
    }
    return cells
  }

  function removeActionRef(list: DrawAction[], action: DrawAction) {
    const idx = list.lastIndexOf(action)
    if (idx !== -1) list.splice(idx, 1)
  }

  function addActionToHitGrid(action: DrawAction, order = nextHitGridOrder++) {
    const cells = getHitGridCells(action)
    hitGridCells.set(action, cells)
    hitGridOrder.set(action, order)

    if (!cells) {
      hitGridOverflow.push(action)
      return
    }

    for (let i = 0; i < cells.length; i++) {
      const key = cells[i]
      let bucket = hitGrid.get(key)
      if (!bucket) {
        bucket = []
        hitGrid.set(key, bucket)
      }
      bucket.push(action)
    }
  }

  function removeActionFromHitGrid(action: DrawAction) {
    const cells = hitGridCells.get(action)
    if (cells === undefined) return

    if (cells === null) {
      removeActionRef(hitGridOverflow, action)
    } else {
      for (let i = 0; i < cells.length; i++) {
        const key = cells[i]
        const bucket = hitGrid.get(key)
        if (!bucket) continue
        removeActionRef(bucket, action)
        if (bucket.length === 0) hitGrid.delete(key)
      }
    }

    hitGridCells.delete(action)
    hitGridOrder.delete(action)
  }

  function appendActionToHitGrid(action: DrawAction) {
    if (hitGridDirty) return
    addActionToHitGrid(action)
  }

  function deleteActionFromHitGrid(action: DrawAction) {
    if (hitGridDirty) return
    removeActionFromHitGrid(action)
  }

  function refreshActionInHitGrid(action: DrawAction, moveToTop = false) {
    if (hitGridDirty) return
    const prevOrder = hitGridOrder.get(action)
    removeActionFromHitGrid(action)
    addActionToHitGrid(action, moveToTop || prevOrder == null ? nextHitGridOrder++ : prevOrder)
  }

  function ensureHitGrid() {
    if (!hitGridDirty) return

    clearHitGridState()

    for (let i = 0; i < history.length; i++) {
      addActionToHitGrid(history[i])
    }

    hitGridDirty = false
  }

  function ensureCache() {
    const canvas = historyCanvasRef.value
    if (!canvas) return

    if (!cacheCanvas) {
      cacheCanvas = document.createElement('canvas')
    }

    if (cacheCanvas.width !== canvas.width || cacheCanvas.height !== canvas.height) {
      cacheCanvas.width = canvas.width
      cacheCanvas.height = canvas.height
      cacheCtx = cacheCanvas.getContext('2d')
      const dpr = getEffectiveDpr()
      if (cacheCtx) cacheCtx.scale(dpr, dpr)
      cacheValid = false
    }

    if (!cacheValid && cacheCtx) {
      cacheCtx.clearRect(0, 0, cacheCanvas.width, cacheCanvas.height)
      for (let i = 0; i < history.length; i++) {
        if (history[i] === previewAction.value) continue
        drawActionOn(cacheCtx, history[i])
      }
      cacheValid = true
    }
  }

  function invalidateCache() {
    cacheValid = false
    historyDirty = true
  }

  function initStrokeCanvas() {
    const canvas = previewCanvasRef.value
    if (!canvas) return
    if (!strokeCanvas) strokeCanvas = document.createElement('canvas')
    strokeCanvas.width = canvas.width
    strokeCanvas.height = canvas.height
    strokeCtx = strokeCanvas.getContext('2d')
    inkPreviewDirty = true
  }

  function clearStrokeCanvas() {
    if (strokeCtx && strokeCanvas) {
      strokeCtx.setTransform(1, 0, 0, 1, 0, 0)
      strokeCtx.clearRect(0, 0, strokeCanvas.width, strokeCanvas.height)
    }
    inkPreviewDirty = true
  }

  function isInkTool(tool: Tool): boolean {
    return tool === 'pen' || tool === 'highlighter'
  }

  /**
   * Rasterize the full in-progress ink stroke into strokeCanvas (last:false for
   * a live tip). Called when points change; preview just blit the buffer.
   */
  function bakeIncrementalStroke(action: DrawAction) {
    if (!strokeCtx || !strokeCanvas) return
    if (!isInkTool(action.tool)) return
    const pts = action.points
    if (pts.length === 0) return

    const dpr = getEffectiveDpr()
    strokeCtx.setTransform(1, 0, 0, 1, 0, 0)
    strokeCtx.clearRect(0, 0, strokeCanvas.width, strokeCanvas.height)
    strokeCtx.setTransform(dpr, 0, 0, dpr, 0, 0)
    strokeCtx.globalCompositeOperation = 'source-over'
    strokeCtx.globalAlpha = action.opacity
    strokeCtx.fillStyle = action.color
    drawInkStroke(strokeCtx, pts, action.lineWidth, false, action.pointerType)
    inkPreviewDirty = false
  }

  function renderHistoryFrame() {
    const ctx = getHistoryCtx()
    const canvas = historyCanvasRef.value
    if (!ctx || !canvas) return

    ensureCache()

    ctx.save()
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    if (cacheCanvas) ctx.drawImage(cacheCanvas, 0, 0)

    const action = currentAction.value
    if (action && action.tool === 'eraser' && eraserMode.value === 'stroke' && action.points.length > 0) {
      const dpr = getEffectiveDpr()
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      drawActionDirect(ctx, action, pathCache)
    }

    ctx.restore()
    historyDirty = false
  }

  function renderPreviewFrame() {
    const ctx = getPreviewCtx()
    const canvas = previewCanvasRef.value
    if (!ctx || !canvas) return

    const action = currentAction.value
    const preview = previewAction.value
    const dpr = getEffectiveDpr()

    ctx.save()
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, canvas.width, canvas.height)

    if (preview && useDragCanvas && dragCanvas) {
      const drawX = Math.round((dragBboxX + dragOffsetX) * dpr)
      const drawY = Math.round((dragBboxY + dragOffsetY) * dpr)
      ctx.drawImage(dragCanvas, drawX, drawY)
      if (laserStrokes.length > 0) {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
        drawLaserStrokes(ctx)
      }
      ctx.restore()
      previewDirty = false
      return
    }

    if (laserStrokes.length > 0) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      drawLaserStrokes(ctx)
    }

    if (action && action.tool !== 'eraser') {
      if (action.tool === 'laser') {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
        drawLaserTrail(ctx, action.points, action.color, action.lineWidth, performance.now(), true)
      } else if (isInkTool(action.tool) && strokeCanvas) {
        if (inkPreviewDirty) bakeIncrementalStroke(action)
        ctx.drawImage(strokeCanvas, 0, 0)
      } else {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
        drawActionOn(ctx, action)
      }
    }

    if (preview) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      if (dragOffsetX !== 0 || dragOffsetY !== 0) {
        ctx.save()
        ctx.translate(dragOffsetX, dragOffsetY)
        drawActionOn(ctx, preview)
        ctx.restore()
      } else {
        drawActionOn(ctx, preview)
      }
    }

    ctx.restore()
    previewDirty = false
  }

  function renderFrame() {
    if (historyDirty) renderHistoryFrame()
    if (previewDirty) renderPreviewFrame()
  }

  function scheduleRender() {
    if (rafId !== null) return
    rafId = requestAnimationFrame(() => {
      rafId = null
      renderFrame()
    })
  }

  function flushRender() {
    if (rafId !== null) {
      cancelAnimationFrame(rafId)
      rafId = null
    }
    renderFrame()
  }

  function addTextAction(
    text: string,
    x: number,
    y: number,
    width: number,
    fontSize: number,
    color?: string,
    textOutline?: TextOutlineStyle,
  ) {
    const normalizedOutline = normalizeTextOutline(textOutline)
    const action: DrawAction = {
      tool: 'text',
      color: color ?? currentColor.value,
      lineWidth: lineWidths.value.text,
      opacity: 1,
      points: [{ x, y }],
      text,
      fontSize,
    }
    if (normalizedOutline.enabled) {
      action.textOutline = normalizedOutline
    }

    const ctx = getPreviewCtx()
    if (ctx) {
      ctx.font = `${fontSize}px "Microsoft YaHei", "PingFang SC", system-ui, sans-serif`
      const lines = text.split('\n')
      let maxWidth = 0
      for (const line of lines) {
        const w = ctx.measureText(line).width
        if (w > maxWidth) maxWidth = w
      }
      action.textWidth = maxWidth
      action.bbox = computeTextBbox(action)
    }

    redoStack.length = 0
    ensureCache()
    if (cacheCtx) drawActionOn(cacheCtx, action)
    history.push(action)
    trackHistoryPush(action)
    undoStack.push({ type: 'add', action })
    appendActionToHitGrid(action)
    historyDirty = true
    previewDirty = true
    markHistoryStacksChanged()
    flushRender()
  }

  function addStampAction(text: string, x: number, y: number, fontSize?: number, color?: string) {
    const fs = fontSize ?? stampFontSizeFromWidth(lineWidths.value.text)
    const action: DrawAction = {
      tool: 'stamp',
      color: color ?? currentColor.value,
      lineWidth: lineWidths.value.text,
      opacity: 1,
      points: [{ x, y }],
      text,
      fontSize: fs,
    }
    action.bbox = computeStampBbox(action)

    redoStack.length = 0
    ensureCache()
    if (cacheCtx) drawActionOn(cacheCtx, action)
    history.push(action)
    trackHistoryPush(action)
    undoStack.push({ type: 'add', action })
    appendActionToHitGrid(action)
    historyDirty = true
    previewDirty = true
    markHistoryStacksChanged()
    flushRender()
  }

  function processObjectEraserHits(action: DrawAction) {
    const pts = action.points
    let removedAny = false
    for (let i = objectEraserLastProcessedPt; i < pts.length; i++) {
      const hit = findActionAt(pts[i], action.lineWidth / 2)
      if (!hit || objectEraserRemovedSet.has(hit.action)) continue
      objectEraserRemovedSet.add(hit.action)
      const idx = history.indexOf(hit.action)
      if (idx === -1) continue
      objectEraserBatch.push({ action: hit.action, index: idx })
      history.splice(idx, 1)
      historyIndexDirty = true
      deleteActionFromHitGrid(hit.action)
      removedAny = true
    }
    objectEraserLastProcessedPt = pts.length
    if (removedAny) markHistoryStacksChanged()
    invalidateCache()
  }

  function startDraw(point: Point) {
    if (currentTool.value === 'text' || currentTool.value === 'stamp') return
    isDrawing.value = true
    if (redoStack.length > 0) {
      redoStack.length = 0
      markHistoryStacksChanged()
    }

    const useInkBuffer = isInkTool(currentTool.value)
    if (useInkBuffer) initStrokeCanvas()

    const opacity = currentTool.value === 'highlighter' ? 0.35 : 1
    const width = resolveDrawLineWidth(currentTool.value)
    const startPoint: Point =
      currentTool.value === 'laser'
        ? { x: point.x, y: point.y, t: performance.now() }
        : {
            x: point.x,
            y: point.y,
            pressure: normalizePressure(point.pressure),
          }

    currentAction.value = {
      tool: currentTool.value,
      color: currentTool.value === 'eraser' ? 'rgba(0,0,0,1)' : currentColor.value,
      lineWidth: width,
      opacity,
      points: [startPoint],
      pointerType: point.pointerType ?? 'mouse',
    }
    previewDirty = true
    if (useInkBuffer) {
      inkPreviewDirty = true
      bakeIncrementalStroke(currentAction.value)
    }
    if (currentTool.value === 'laser') {
      ensureLaserAnimation()
    }
    if (currentTool.value === 'eraser') {
      if (eraserMode.value === 'object') {
        objectEraserBatch = []
        objectEraserRemovedSet = new Set()
        objectEraserLastProcessedPt = 0
      } else {
        historyDirty = true
      }
    }
    scheduleRender()
  }

  function draw(point: Point, isPerfect = false) {
    drawBatch([point], isPerfect)
  }

  function drawBatch(points: ArrayLike<InputPointLike>, isPerfect = false) {
    if (!isDrawing.value) return
    const action = currentAction.value
    if (!action || points.length === 0) return

    const pts = action.points
    const isFreehand =
      action.tool === 'pen' || action.tool === 'highlighter' || action.tool === 'laser' || action.tool === 'eraser'

    if (isFreehand) {
      let last = pts[pts.length - 1]
      let appended = false
      const minDist = getMinDistSq()
      const inkStreamline = isInkTool(action.tool) ? penStrokeStyle(getStrokeSmoothing()).inputStreamline : 0

      for (let i = 0; i < points.length; i++) {
        const point = points[i]
        const x = point.x ?? point.clientX
        const y = point.y ?? point.clientY
        if (x == null || y == null) continue

        const dx = x - last.x
        const dy = y - last.y
        if (dx * dx + dy * dy < minDist) continue

        let nextPoint: Point
        if (action.tool === 'laser') {
          nextPoint = { x, y, t: performance.now() }
        } else if (isInkTool(action.tool)) {
          const raw: Point = { x, y, pressure: normalizePressure(point.pressure) }
          nextPoint = smoothPenPoint(last, raw, inkStreamline)
        } else {
          nextPoint = { x, y }
        }
        pts.push(nextPoint)
        last = nextPoint
        appended = true
      }

      if (!appended) return
      if (action.tool === 'laser') {
        ensureLaserAnimation()
      } else if (isInkTool(action.tool)) {
        inkPreviewDirty = true
        bakeIncrementalStroke(action)
      } else if (action.tool === 'eraser' && eraserMode.value === 'object') {
        processObjectEraserHits(action)
      }
    } else {
      const point = points[points.length - 1]
      const x = point.x ?? point.clientX
      const y = point.y ?? point.clientY
      if (x == null || y == null) return

      let finalPoint = { x, y }
      if (pts.length > 0) {
        const start = pts[0]
        if (action.tool === 'line' || action.tool === 'arrow') {
          finalPoint = isPerfect ? snapPointToAngle(start, { x, y }, angleSnapStep.value) : { x, y }
        } else if (isPerfect && (action.tool === 'rect' || action.tool === 'ellipse')) {
          const dx = x - start.x
          const dy = y - start.y
          const maxDist = Math.max(Math.abs(dx), Math.abs(dy))
          finalPoint = {
            x: start.x + (dx < 0 ? -maxDist : maxDist),
            y: start.y + (dy < 0 ? -maxDist : maxDist),
          }
        }
      }

      if (pts.length === 1) {
        pts.push(finalPoint)
      } else {
        pts[1] = finalPoint
      }
    }

    previewDirty = true
    if (action.tool === 'eraser' && eraserMode.value === 'stroke') historyDirty = true
    scheduleRender()
  }

  function endDraw() {
    if (!isDrawing.value) return
    const action = currentAction.value
    if (!action) return
    isDrawing.value = false

    if (action.tool !== 'laser') {
      const pad = Math.max(20, action.lineWidth / 2 + 10)
      action.bbox = computeBbox(action, pad)
      updateShapeHitCache(action)
    }

    clearStrokeCanvas()

    if (action.tool === 'laser') {
      laserStrokes.push({ action })
      markLaserChanged()
      currentAction.value = null
      previewDirty = true
      ensureLaserAnimation()
      flushRender()
      return
    }

    if (action.tool === 'eraser' && eraserMode.value === 'object') {
      if (objectEraserLastProcessedPt < action.points.length) {
        processObjectEraserHits(action)
      }
      currentAction.value = null
      previewDirty = true
      if (objectEraserBatch.length > 0) {
        undoStack.push({ type: 'removeBatch', removed: [...objectEraserBatch] })
        redoStack.length = 0
        markHistoryStacksChanged()
      }
      objectEraserBatch = []
      objectEraserRemovedSet = new Set()
      objectEraserLastProcessedPt = 0
      flushRender()
      return
    }

    if (action.tool === 'eraser') {
      if (action.bbox) {
        const eraseTargets: {
          action: DrawAction
          before: DrawAction['attachedErasers']
          after: DrawAction['attachedErasers']
        }[] = []

        for (let i = 0; i < history.length; i++) {
          const target = history[i]
          if (!target.bbox || !bboxesIntersect(target.bbox, action.bbox!)) continue

          const before = target.attachedErasers ? [...target.attachedErasers] : undefined
          if (!target.attachedErasers) target.attachedErasers = []
          target.attachedErasers.push(action)
          const after = [...target.attachedErasers]
          eraseTargets.push({ action: target, before, after })
          pathCache.delete(target)
        }

        if (eraseTargets.length > 0) {
          undoStack.push({ type: 'erase', targets: eraseTargets })
          redoStack.length = 0
          markHistoryStacksChanged()
        }
      }
      invalidateCache()
    } else {
      ensureCache()
      if (cacheCtx) drawActionOn(cacheCtx, action)
      history.push(action)
      trackHistoryPush(action)
      undoStack.push({ type: 'add', action })
      appendActionToHitGrid(action)
      historyDirty = true
      markHistoryStacksChanged()
    }

    currentAction.value = null
    previewDirty = true
    flushRender()
  }

  function cancelDraw() {
    if (!isDrawing.value) return
    isDrawing.value = false
    currentAction.value = null
    clearStrokeCanvas()
    objectEraserBatch = []
    objectEraserRemovedSet = new Set()
    objectEraserLastProcessedPt = 0
    previewDirty = true
    flushRender()
  }

  function drawActionOn(ctx: CanvasRenderingContext2D, action: DrawAction) {
    if (action.tool !== 'eraser' && action.attachedErasers?.length) {
      const bbox = action.bbox
      if (!bbox) {
        drawActionDirect(ctx, action, pathCache)
        return
      }

      const dpr = getEffectiveDpr()
      const w = bbox.x2 - bbox.x1
      const h = bbox.y2 - bbox.y1
      const pw = Math.ceil(w * dpr)
      const ph = Math.ceil(h * dpr)
      if (pw <= 0 || ph <= 0) return

      if (!tempCanvas) {
        tempCanvas = document.createElement('canvas')
        tempCtx = null
      }
      // Round up to 256px multiples to avoid frequent GPU texture reallocation
      // when many erased strokes of varying sizes trigger cache rebuilds.
      const alignedW = (pw + 255) & ~255
      const alignedH = (ph + 255) & ~255
      if (tempCanvas.width < pw || tempCanvas.height < ph) {
        tempCanvas.width = Math.max(tempCanvas.width || 0, alignedW)
        tempCanvas.height = Math.max(tempCanvas.height || 0, alignedH)
        tempCtx = null
      }
      if (!tempCtx) tempCtx = tempCanvas.getContext('2d')
      const tctx = tempCtx
      if (!tctx) {
        drawActionDirect(ctx, action, pathCache)
        return
      }

      tctx.setTransform(1, 0, 0, 1, 0, 0)
      tctx.clearRect(0, 0, pw, ph)
      tctx.scale(dpr, dpr)
      tctx.translate(-bbox.x1, -bbox.y1)

      drawActionDirect(tctx, action, pathCache)
      for (let i = 0; i < action.attachedErasers.length; i++) {
        drawActionDirect(tctx, action.attachedErasers[i], pathCache)
      }

      ctx.save()
      ctx.globalCompositeOperation = 'source-over'
      ctx.globalAlpha = 1
      ctx.drawImage(tempCanvas, 0, 0, pw, ph, bbox.x1, bbox.y1, w, h)
      ctx.restore()
      return
    }
    drawActionDirect(ctx, action, pathCache)
  }

  function redrawAll() {
    invalidateCache()
    // resizeCanvas() clears bitmap state; keep the live ink buffer matched so
    // preview→history commit after a late DPI/geometry pass does not jump.
    const action = currentAction.value
    if (isDrawing.value && action && isInkTool(action.tool)) {
      initStrokeCanvas()
      bakeIncrementalStroke(action)
    } else {
      const canvas = previewCanvasRef.value
      if (canvas && strokeCanvas && (strokeCanvas.width !== canvas.width || strokeCanvas.height !== canvas.height)) {
        initStrokeCanvas()
      }
    }
    previewDirty = true
    flushRender()
  }

  function beginDrag(action: DrawAction) {
    previewAction.value = action
    invalidateCache()
    ensureCache()

    useDragCanvas = false
    dragOffsetX = 0
    dragOffsetY = 0

    const canvas = previewCanvasRef.value
    if (canvas) {
      const dpr = getEffectiveDpr()
      const pad = Math.max(20, action.lineWidth / 2 + 10) + 2
      const bbox =
        action.tool === 'text'
          ? computeTextBbox(action)
          : action.tool === 'stamp'
            ? computeStampBbox(action)
            : computeBbox(action, pad)
      if (bbox) {
        const bw = Math.ceil((bbox.x2 - bbox.x1) * dpr)
        const bh = Math.ceil((bbox.y2 - bbox.y1) * dpr)
        if (bw > 0 && bh > 0) {
          dragBboxX = bbox.x1
          dragBboxY = bbox.y1
          if (!dragCanvas) dragCanvas = document.createElement('canvas')
          dragCanvas.width = bw
          dragCanvas.height = bh
          dragCtx = dragCanvas.getContext('2d')
          if (dragCtx) {
            dragCtx.setTransform(1, 0, 0, 1, 0, 0)
            dragCtx.clearRect(0, 0, bw, bh)
            dragCtx.scale(dpr, dpr)
            dragCtx.translate(-bbox.x1, -bbox.y1)
            drawActionOn(dragCtx, action)
            useDragCanvas = true
          }
        }
      }
    }

    previewDirty = true
    scheduleRender()
  }

  function updateDragOffset(dx: number, dy: number) {
    dragOffsetX = dx
    dragOffsetY = dy
    previewDirty = true
    scheduleRender()
  }

  function endDrag() {
    if (previewAction.value) {
      const action = previewAction.value
      const hasMoved = dragOffsetX !== 0 || dragOffsetY !== 0

      const beforeIdx = history.indexOf(action)
      const beforeSnap = hasMoved ? takeDragSnapshot(action, beforeIdx) : null

      if (hasMoved) {
        for (const pt of action.points) {
          pt.x += dragOffsetX
          pt.y += dragOffsetY
        }
        offsetAttachedErasers(action, dragOffsetX, dragOffsetY)
        pathCache.delete(action)
      }

      if (action.tool === 'text' && action.textWidth != null) {
        action.bbox = computeTextBbox(action)
      } else if (action.tool === 'stamp') {
        action.bbox = computeStampBbox(action)
      } else {
        const pad = Math.max(20, action.lineWidth / 2 + 10)
        action.bbox = computeBbox(action, pad)
      }
      updateShapeHitCache(action)

      const idx = history.indexOf(action)
      const movedToTop = idx !== -1 && idx !== history.length - 1
      if (idx !== -1 && idx !== history.length - 1) {
        history.splice(idx, 1)
        history.push(action)
        historyIndexDirty = true
      }
      refreshActionInHitGrid(action, movedToTop)

      if (hasMoved && beforeSnap) {
        const afterSnap = takeDragSnapshot(action, history.indexOf(action))
        undoStack.push({ type: 'drag', action, from: beforeSnap, to: afterSnap })
        redoStack.length = 0
        markHistoryStacksChanged()
      }
    }
    previewAction.value = null
    useDragCanvas = false
    dragOffsetX = 0
    dragOffsetY = 0
    invalidateCache()
    previewDirty = true
    flushRender()
  }

  function undo() {
    if (undoStack.length === 0) return
    historyIndexDirty = true
    const entry = undoStack.pop()!

    if (entry.type === 'add') {
      const idx = history.lastIndexOf(entry.action)
      if (idx !== -1) {
        history.splice(idx, 1)
        deleteActionFromHitGrid(entry.action)
      }
    } else if (entry.type === 'remove') {
      const target = Math.min(entry.index, history.length)
      history.splice(target, 0, entry.action)
      appendActionToHitGrid(entry.action)
    } else if (entry.type === 'drag') {
      restoreDragSnapshot(entry.action, entry.from)
      const cur = history.indexOf(entry.action)
      if (cur !== -1) {
        history.splice(cur, 1)
        const target = Math.min(entry.from.index, history.length)
        history.splice(target, 0, entry.action)
      }
      refreshActionInHitGrid(entry.action, true)
    } else if (entry.type === 'erase') {
      for (const t of entry.targets) {
        t.action.attachedErasers = t.before ? [...t.before] : undefined
        pathCache.delete(t.action)
      }
    } else if (entry.type === 'removeBatch') {
      const sorted = [...entry.removed].sort((a, b) => a.index - b.index)
      for (const item of sorted) {
        history.splice(item.index, 0, item.action)
        appendActionToHitGrid(item.action)
      }
      historyIndexDirty = true
    } else if (entry.type === 'clear') {
      history.push(...entry.actions)
      undoStack.push(...entry.prevUndoStack)
      hitGridDirty = true
    }

    redoStack.push(entry)
    invalidateCache()
    markHistoryStacksChanged()
    flushRender()
  }

  function redo() {
    if (redoStack.length === 0) return
    historyIndexDirty = true
    const entry = redoStack.pop()!

    if (entry.type === 'add') {
      history.push(entry.action)
      appendActionToHitGrid(entry.action)
    } else if (entry.type === 'remove') {
      const idx = history.indexOf(entry.action)
      if (idx !== -1) {
        history.splice(idx, 1)
        deleteActionFromHitGrid(entry.action)
      }
    } else if (entry.type === 'drag') {
      restoreDragSnapshot(entry.action, entry.to)
      const cur = history.indexOf(entry.action)
      if (cur !== -1) {
        history.splice(cur, 1)
        const target = Math.min(entry.to.index, history.length)
        history.splice(target, 0, entry.action)
      }
      refreshActionInHitGrid(entry.action, true)
    } else if (entry.type === 'erase') {
      for (const t of entry.targets) {
        t.action.attachedErasers = t.after ? [...t.after] : undefined
        pathCache.delete(t.action)
      }
    } else if (entry.type === 'removeBatch') {
      const sorted = [...entry.removed].sort((a, b) => b.index - a.index)
      for (const item of sorted) {
        const idx = history.indexOf(item.action)
        if (idx !== -1) {
          history.splice(idx, 1)
          deleteActionFromHitGrid(item.action)
        }
      }
      historyIndexDirty = true
    } else if (entry.type === 'clear') {
      entry.actions = [...history]
      entry.prevUndoStack = [...undoStack]
      history.length = 0
      undoStack.length = 0
      clearHitGridState()
      hitGridDirty = false
    }

    undoStack.push(entry)
    invalidateCache()
    markHistoryStacksChanged()
    flushRender()
  }

  function clearAll() {
    const clearedLasers = clearLaserStrokes()
    if (history.length === 0) {
      if (clearedLasers) {
        currentAction.value = null
        previewAction.value = null
        previewDirty = true
        flushRender()
      }
      return
    }
    historyIndexDirty = true

    const entry: UndoEntry = {
      type: 'clear',
      actions: [...history],
      prevUndoStack: [...undoStack],
    }

    history.length = 0
    undoStack.length = 0
    redoStack.length = 0
    clearHitGridState()
    hitGridDirty = false

    undoStack.push(entry)

    invalidateCache()
    currentAction.value = null
    previewAction.value = null
    previewDirty = true
    markHistoryStacksChanged()
    flushRender()
  }

  function exportAsDataURL(backgroundColor?: string) {
    const canvas = historyCanvasRef.value
    if (!canvas) return null

    const exportCanvas = document.createElement('canvas')
    exportCanvas.width = canvas.width
    exportCanvas.height = canvas.height
    const ctx = exportCanvas.getContext('2d')
    if (!ctx) return canvas.toDataURL('image/png')

    if (backgroundColor) {
      ctx.fillStyle = backgroundColor
      ctx.fillRect(0, 0, exportCanvas.width, exportCanvas.height)
    }
    ctx.drawImage(canvas, 0, 0)

    if (laserStrokes.length > 0) {
      const dpr = getEffectiveDpr()
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      drawLaserStrokes(ctx)
      ctx.setTransform(1, 0, 0, 1, 0, 0)
    }

    return exportCanvas.toDataURL('image/png')
  }

  function hardReset() {
    historyIndexDirty = true
    history.length = 0
    undoStack.length = 0
    redoStack.length = 0
    clearLaserStrokes()
    clearHitGridState()
    hitGridDirty = false
    invalidateCache()
    currentAction.value = null
    previewAction.value = null
    useDragCanvas = false
    dragOffsetX = 0
    dragOffsetY = 0
    clearStrokeCanvas()
    previewDirty = true
    markHistoryStacksChanged()
    flushRender()
  }

  function findActionAt(p: Point, extraMargin = 0): { action: DrawAction; index: number } | null {
    ensureHitGrid()
    ensureHistoryIndex()

    const bucket = hitGrid.get(`${Math.floor(p.x / HIT_GRID_SIZE)},${Math.floor(p.y / HIT_GRID_SIZE)}`)
    let bucketPos = bucket ? bucket.length - 1 : -1
    let overflowPos = hitGridOverflow.length - 1

    while (bucketPos >= 0 || overflowPos >= 0) {
      let action: DrawAction
      if (overflowPos < 0) {
        action = bucket![bucketPos--]
      } else if (bucketPos < 0) {
        action = hitGridOverflow[overflowPos--]
      } else {
        const bucketAction = bucket![bucketPos]
        const overflowAction = hitGridOverflow[overflowPos]
        if ((hitGridOrder.get(bucketAction) ?? 0) >= (hitGridOrder.get(overflowAction) ?? 0)) {
          action = bucket![bucketPos--]
        } else {
          action = hitGridOverflow[overflowPos--]
        }
      }

      if (hitTestAction(action, p, extraMargin)) {
        const index = historyIndexMap.get(action)
        if (index !== undefined && index < history.length && history[index] === action) {
          return { action, index }
        }
      }
    }

    return null
  }

  function removeAction(index: number) {
    if (index >= 0 && index < history.length) {
      const action = history[index]
      history.splice(index, 1)
      historyIndexDirty = true
      deleteActionFromHitGrid(action)
      undoStack.push({ type: 'remove', action, index })
      redoStack.length = 0
      invalidateCache()
      markHistoryStacksChanged()
      flushRender()
    }
  }

  function destroy() {
    if (rafId !== null) {
      cancelAnimationFrame(rafId)
      rafId = null
    }
    stopLaserAnimation()
    laserStrokes.length = 0
    cacheCanvas = null
    cacheCtx = null
    historyCtx = null
    previewCtx = null
    strokeCanvas = null
    strokeCtx = null
    dragCanvas = null
    dragCtx = null
    tempCanvas = null
    tempCtx = null
  }

  return {
    currentTool,
    currentColor,
    lineWidth,
    lineWidths,
    setLineWidths,
    setLineWidth,
    angleSnapStep,
    eraserMode,
    setEraserMode,
    isDrawing,
    /** Active stroke width (for tests / diagnostics); null when not drawing. */
    getActiveStrokeLineWidth: () => currentAction.value?.lineWidth ?? null,
    getActiveStrokePointerType: () => currentAction.value?.pointerType ?? null,
    getActiveStrokeFirstPoint: () => {
      const pts = currentAction.value?.points
      return pts && pts.length > 0 ? { x: pts[0].x, y: pts[0].y } : null
    },
    getActiveStrokePointCount: () => currentAction.value?.points.length ?? 0,
    getStrokeSamplingStats: () => ({
      minDistSq: getMinDistSq(),
      smoothing: getStrokeSmoothing(),
      viewport: { w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio || 1 },
    }),
    startDraw,
    draw,
    drawBatch,
    endDraw,
    cancelDraw,
    findActionAt,
    removeAction,
    addTextAction,
    addStampAction,
    undo,
    redo,
    canUndo,
    canRedo,
    canClear,
    clearAll,
    exportAsDataURL,
    hardReset,
    redrawAll,
    beginDrag,
    updateDragOffset,
    endDrag,
    destroy,
    setAngleSnapStep,
  }
}

import { ref, shallowRef, computed, type Ref } from 'vue'
import type { EraserMode } from '../utils/eraserMode'
import type { LaserMode } from '../utils/laserMode'
import {
  computeBbox,
  computeTextBbox,
  computeStampBbox,
  bboxesIntersect,
  cloneActionWithOffset,
  getShapeRotation,
  offsetAttachedErasers,
  rotatePointAround,
  updateShapeHitCache,
  hitTestAction,
  hitTestActionWithFootprint,
  isLockedInkAction,
  perfectCircleCornersFromCenter,
  snapPointToAngle,
  clearInkNodeCache,
} from './drawingGeometry'
import {
  applyReshapeHandle,
  aspectRatioOfBounds,
  getActionReshapeBounds,
  getReshapeHandles,
  selectionFrameBounds,
  hitTestReshapeHandle,
  isInkReshapeTool,
  isReshapeableTool,
  RESHAPE_HANDLE_HALF,
  RESHAPE_ROTATE_HANDLE_OFFSET,
  type ReshapeBounds,
  type ReshapeHandle,
  type ReshapeHandleId,
} from './drawingReshape'
import { drawActionDirect, drawLaserTrail } from './drawingRender'
import { normalizeTextOutline } from '../constants/textOutline'
import { stampFontSizeFromWidth } from '../constants/stamp'
import { LASER_WRITING_HOLD_MS, isLaserTrailGone, laserWritingOpacity, pruneAgedLaserPoints } from '../constants/laser'
import {
  buildSweptPath,
  computeMinDistSq,
  dotRadius,
  INK_MIN_DIST_SQ,
  normalizePressure,
  planSweptFreeze,
  pruneNodes,
  SWEPT_STYLE,
  SweptSampleCache,
  isInkTaperEnabled,
  setInkTaperEnabled,
  taperMetrics,
  taperNodes,
  taperStyleFor,
  brushProfileFor,
} from '../constants/sweptStylus'
import { collapseStrokeToLine, STROKE_LINE_LOCK_HOLD_MS, strokeLineLockStillDistSq } from '../utils/strokeLineLock'
import { buildEraserFootprint, type EraserFootprint } from '../utils/eraserFootprint'

export type { Tool, Point, DrawAction } from './drawingTypes'
export type { InputPointLike } from './drawingTypes'

/** CSS px a pasted copy is offset by, per consecutive paste. */
const PASTE_CASCADE_OFFSET_PX = 12

/** Consecutive nudges within this window merge into one undo entry. */
const NUDGE_COALESCE_MS = 600

export type SelectionRect = { x1: number; y1: number; x2: number; y2: number }

function normalizeSelectionRect(r: SelectionRect): SelectionRect {
  return {
    x1: Math.min(r.x1, r.x2),
    y1: Math.min(r.y1, r.y2),
    x2: Math.max(r.x1, r.x2),
    y2: Math.max(r.y1, r.y2),
  }
}

import type { Tool, Point, DrawAction, InputPointLike, TextOutlineStyle } from './drawingTypes'
import {
  createDefaultLineWidths,
  eraserGlyphSize,
  eraserLineWidth,
  highlighterLineWidth,
  isDashableTool,
  isNonSolidDashStyle,
  isStrokeTool,
  nextStrokeDashStyle,
  normalizeStrokeDashStyle,
  resolveLineWidths,
  toolLineWidthGroup,
  type StrokeDashStyle,
  type ToolLineWidths,
} from '../constants/tools'
import { COLOR_PALETTE } from '../constants/colors'

const HIT_GRID_SIZE = 192
const HIT_GRID_MAX_CELLS = 64
/** Max distance between two object-eraser footprint samples along the pointer path (CSS px). */
const OBJECT_ERASER_MAX_STEP_PX = 4

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
  const angleSnapStep = ref(15)
  const eraserMode = ref<EraserMode>('stroke')
  const laserMode = ref<LaserMode>('trail')
  /** Session stroke dash style for pen / shapes (D / Shift+D). */
  const shapeDashStyle = ref<StrokeDashStyle>('solid')

  /** Live ink buffer needs rebake (declared early for mid-gesture width sync). */
  let inkPreviewDirty = true

  /** Current freehand stroke locked to a 2-point line after a still hold. */
  let strokeLineLocked = false
  let lineLockStillX = 0
  let lineLockStillY = 0
  let lineLockTimer: ReturnType<typeof setTimeout> | null = null

  function setEraserMode(mode: EraserMode) {
    eraserMode.value = mode
  }

  function clearLineLockTimer() {
    if (lineLockTimer != null) {
      clearTimeout(lineLockTimer)
      lineLockTimer = null
    }
  }

  function resetLineLockState() {
    clearLineLockTimer()
    strokeLineLocked = false
  }

  function scheduleLineLockTimer() {
    clearLineLockTimer()
    lineLockTimer = setTimeout(() => {
      lineLockTimer = null
      tryLockStrokeToLine()
    }, STROKE_LINE_LOCK_HOLD_MS)
  }

  function tryLockStrokeToLine() {
    if (!isDrawing.value || strokeLineLocked) return
    const action = currentAction.value
    if (!action || (action.tool !== 'pen' && action.tool !== 'highlighter')) return

    const collapsed = collapseStrokeToLine(action.points)
    if (!collapsed) return
    action.points = collapsed
    action.lockedLine = true
    strokeLineLocked = true
    clearLineLockTimer()
    // Drop the live ink buffer so locked preview redraws via drawActionOn each frame.
    // Leaving strokeCanvas allocated would freeze the bake until inkPreviewDirty is set.
    clearStrokeCanvas()
    strokeCanvas = null
    strokeCtx = null
    previewDirty = true
    scheduleRender()
  }

  function noteLineLockPointerActivity(x: number, y: number) {
    if (strokeLineLocked) return
    const dx = x - lineLockStillX
    const dy = y - lineLockStillY
    if (dx * dx + dy * dy >= strokeLineLockStillDistSq()) {
      lineLockStillX = x
      lineLockStillY = y
      scheduleLineLockTimer()
    }
  }

  function setShapeDashStyle(style: StrokeDashStyle) {
    const next = normalizeStrokeDashStyle(style)
    const prevNonSolid = isNonSolidDashStyle(shapeDashStyle.value)
    shapeDashStyle.value = next
    const action = currentAction.value
    if (isDrawing.value && action && isDashableTool(action.tool)) {
      const nextNonSolid = isNonSolidDashStyle(next)
      action.dashStyle = nextNonSolid ? next : undefined
      if (action.tool === 'pen') {
        if (nextNonSolid && !prevNonSolid) {
          // Leave the ink buffer; preview switches to dashed/dotted centerline stroke.
          clearStrokeCanvas()
        } else if (!nextNonSolid && prevNonSolid) {
          initStrokeCanvas()
          inkPreviewDirty = true
          bakeIncrementalStroke(action)
        }
      }
      previewDirty = true
      scheduleRender()
    }
  }

  /**
   * Cycle the dash style of the selected dashable actions (D / Shift+D).
   * Returns false when the selection has no dashable action, so the caller can
   * fall back to the session style used by the next drawing.
   */
  function cycleSelectedDashStyle(direction: 1 | -1): boolean {
    const targets = selectedActions.value.filter(
      (action) => isDashableTool(action.tool) && history.indexOf(action) !== -1,
    )
    if (targets.length === 0) return false

    const next = nextStrokeDashStyle(normalizeStrokeDashStyle(targets[0].dashStyle), direction)
    const nextDash = isNonSolidDashStyle(next) ? next : undefined
    const items: { action: DrawAction; before: StrokeDashStyle | undefined; after: StrokeDashStyle | undefined }[] = []

    for (const action of targets) {
      if (action.dashStyle === nextDash) continue
      items.push({ action, before: action.dashStyle, after: nextDash })
      action.dashStyle = nextDash
      pathCache.delete(action)
    }

    // Keep the session style (toolbar hint / next shape) aligned with the edit.
    shapeDashStyle.value = next

    if (items.length > 0) {
      undoStack.push({ type: 'style', items })
      redoStack.length = 0
      markHistoryStacksChanged()
    }

    // Pen ink is a baked ribbon; drop the history cache so the new dash is used.
    invalidateCache()
    previewDirty = true
    flushRender()
    return true
  }

  /**
   * Apply an explicit color to the selected actions (toolbar swatch / color picker).
   * Returns false when nothing is selected, so the caller can fall back to the
   * session color used by the next drawing.
   */
  function setSelectedColor(color: string): boolean {
    const targets = selectedActions.value.filter((action) => history.indexOf(action) !== -1)
    if (targets.length === 0) return false

    const items: { action: DrawAction; before: string; after: string }[] = []
    for (const action of targets) {
      if (action.color === color) continue
      items.push({ action, before: action.color, after: color })
      action.color = color
      pathCache.delete(action)
    }

    // Keep the session color (toolbar / next drawing) aligned with the edit.
    currentColor.value = color

    if (items.length > 0) {
      undoStack.push({ type: 'color', items })
      redoStack.length = 0
      markHistoryStacksChanged()
    }

    // Pen ink is a baked ribbon; drop the history cache so the new color is used.
    invalidateCache()
    previewDirty = true
    flushRender()
    return true
  }

  /**
   * Cycle the color of the selected actions (Q / E).
   * Returns false when nothing is selected, so the caller can fall back to the
   * session color used by the next drawing.
   */
  function cycleSelectedColor(direction: 1 | -1): boolean {
    const targets = selectedActions.value.filter((action) => history.indexOf(action) !== -1)
    if (targets.length === 0) return false

    const baseIdx = COLOR_PALETTE.indexOf(targets[0].color)
    const nextIdx = baseIdx === -1 ? 0 : (baseIdx + direction + COLOR_PALETTE.length) % COLOR_PALETTE.length
    return setSelectedColor(COLOR_PALETTE[nextIdx])
  }

  /** Text / stamp font size for a width preset (mirrors new-text sizing). */
  function fontSizeForWidthPreset(preset: number): number {
    return stampFontSizeFromWidth(preset)
  }

  /**
   * Apply a toolbar width preset to the current selection.
   * Returns false when nothing is selected, so the caller can fall back to the
   * session width used by the next drawing.
   */
  function setSelectedLineWidth(preset: number): boolean {
    const targets = selectedActions.value.filter((action) => history.indexOf(action) !== -1)
    if (targets.length === 0) return false

    const items: { action: DrawAction; before: LineWidthSnapshot; after: LineWidthSnapshot }[] = []
    for (const action of targets) {
      const before = takeLineWidthSnapshot(action)

      if (action.tool === 'text' || action.tool === 'stamp') {
        const fontSize = fontSizeForWidthPreset(preset)
        if (action.fontSize === fontSize) continue
        if (action.tool === 'text') {
          // textWidth was measured at the old size; scale it so the bbox stays proportional.
          if (action.textWidth != null) {
            const oldSize = action.fontSize && action.fontSize > 0 ? action.fontSize : 24
            action.textWidth = (action.textWidth * fontSize) / oldSize
          }
          action.fontSize = fontSize
          action.bbox = computeTextBbox(action)
        } else {
          action.fontSize = fontSize
          action.bbox = computeStampBbox(action)
        }
        action.lineWidth = preset
      } else if (action.tool === 'highlighter') {
        const width = highlighterLineWidth(preset)
        if (action.lineWidth === width) continue
        action.lineWidth = width
      } else if (isStrokeTool(action.tool)) {
        if (action.lineWidth === preset) continue
        action.lineWidth = preset
      } else {
        continue
      }

      items.push({ action, before, after: takeLineWidthSnapshot(action) })
      pathCache.delete(action)
      refreshActionGeometry(action)
      refreshActionInHitGrid(action)
    }

    // Keep each affected tool group's session width aligned with the edit.
    for (const action of targets) {
      lineWidths.value[toolLineWidthGroup(action.tool)] = preset
    }

    if (items.length > 0) {
      undoStack.push({ type: 'lineWidth', items })
      redoStack.length = 0
      markHistoryStacksChanged()
    }

    // Pen ink is a baked ribbon; drop the history cache so the new width is used.
    invalidateCache()
    previewDirty = true
    flushRender()
    return true
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
  /**
   * Index every action had when the eraser gesture began.
   *
   * `removeObjectEraserTarget` splices in sweep order, so `history.indexOf` returns
   * a live index that already shifted for every earlier removal. Undo re-inserts by
   * ascending index, which only restores z-order when the indices are the originals
   * (as `removeSelected` guarantees by deleting high → low). Recording the gesture-
   * start index keeps undo correct no matter which direction the eraser sweeps.
   */
  let objectEraserIndexSnapshot: Map<DrawAction, number> | null = null

  function setAngleSnapStep(step: number) {
    angleSnapStep.value = Number.isFinite(step) ? Math.min(90, Math.max(1, step)) : 15
  }

  /**
   * Apply the 笔锋 switch to every future paint.
   *
   * Existing ribbons are cached as `Path2D` and the eraser caches their nodes, so both
   * caches are dropped and the whole scene repaints — otherwise a change would only
   * affect ink drawn after it.
   */
  function setInkTaper(enabled: boolean) {
    if (isInkTaperEnabled() === enabled) return
    setInkTaperEnabled(enabled)
    pathCache = new WeakMap()
    clearInkNodeCache()
    redrawAll()
  }

  interface DragSnapshot {
    points: Point[]
    index: number
    attachedErasers: DrawAction['attachedErasers']
    bbox: DrawAction['bbox']
    rectHit: DrawAction['rectHit']
    ellipseHit: DrawAction['ellipseHit']
    rotation?: number
    /** Text / stamp corner scaling changes the font size and measured width. */
    fontSize?: number
    textWidth?: number
    stretchX?: number
  }

  /** Snapshot of the size-related fields a width preset can change. */
  type LineWidthSnapshot = {
    lineWidth: number
    fontSize?: number
    textWidth?: number
    bbox?: DrawAction['bbox']
  }

  type UndoEntry =
    | { type: 'add'; action: DrawAction }
    | { type: 'remove'; action: DrawAction; index: number }
    | { type: 'drag'; action: DrawAction; from: DragSnapshot; to: DragSnapshot }
    | {
        type: 'dragBatch'
        items: { action: DrawAction; from: DragSnapshot; to: DragSnapshot }[]
      }
    | {
        type: 'style'
        items: { action: DrawAction; before: StrokeDashStyle | undefined; after: StrokeDashStyle | undefined }[]
      }
    | {
        type: 'color'
        items: { action: DrawAction; before: string; after: string }[]
      }
    | {
        type: 'lineWidth'
        items: { action: DrawAction; before: LineWidthSnapshot; after: LineWidthSnapshot }[]
      }
    | {
        type: 'nudge'
        items: { action: DrawAction; from: DragSnapshot; to: DragSnapshot }[]
      }
    | {
        type: 'erase'
        targets: { action: DrawAction; before: DrawAction['attachedErasers']; after: DrawAction['attachedErasers'] }[]
      }
    | { type: 'removeBatch'; removed: { action: DrawAction; index: number }[] }
    | { type: 'paste'; items: { action: DrawAction; index: number }[] }
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
      rotation: action.rotation,
      fontSize: action.fontSize,
      textWidth: action.textWidth,
      stretchX: action.stretchX,
    }
  }

  function restoreDragSnapshot(action: DrawAction, snap: DragSnapshot) {
    action.points = snap.points.map(clonePoint)
    action.attachedErasers = snap.attachedErasers ? [...snap.attachedErasers] : undefined
    action.bbox = snap.bbox ? { ...snap.bbox } : undefined
    action.rectHit = snap.rectHit ? { ...snap.rectHit } : undefined
    action.ellipseHit = snap.ellipseHit ? { ...snap.ellipseHit } : undefined
    if (snap.rotation != null) action.rotation = snap.rotation
    else delete action.rotation
    if (snap.fontSize != null) action.fontSize = snap.fontSize
    else delete action.fontSize
    if (snap.textWidth != null) action.textWidth = snap.textWidth
    else delete action.textWidth
    if (snap.stretchX != null) action.stretchX = snap.stretchX
    else delete action.stretchX
    pathCache.delete(action)
  }

  function takeLineWidthSnapshot(action: DrawAction): LineWidthSnapshot {
    return {
      lineWidth: action.lineWidth,
      ...(action.fontSize != null ? { fontSize: action.fontSize } : {}),
      ...(action.textWidth != null ? { textWidth: action.textWidth } : {}),
      ...(action.bbox ? { bbox: { ...action.bbox } } : {}),
    }
  }

  function restoreLineWidthSnapshot(action: DrawAction, snap: LineWidthSnapshot) {
    action.lineWidth = snap.lineWidth
    if (snap.fontSize != null) action.fontSize = snap.fontSize
    else delete action.fontSize
    if (snap.textWidth != null) action.textWidth = snap.textWidth
    else delete action.textWidth
    if (snap.bbox) action.bbox = { ...snap.bbox }
    else delete action.bbox
    pathCache.delete(action)
  }

  const history: DrawAction[] = []
  const undoStack: UndoEntry[] = []
  const redoStack: UndoEntry[] = []
  /** Last nudge timestamp — consecutive key presses merge into one undo entry. */
  let lastNudgeAt = -Infinity
  const historyRevision = ref(0)
  /** Internal vector clipboard for Ctrl+C on a selection (never the OS bitmap clipboard). */
  let copiedActions: DrawAction[] = []
  /** Consecutive pastes step further from the original so copies never stack exactly. */
  let pasteCascade = 0

  interface LaserStroke {
    action: DrawAction
  }

  const laserStrokes: LaserStroke[] = []
  const laserRevision = ref(0)
  let laserRafId: number | null = null
  /** Writing mode: `performance.now()` of the last laser pen-up; drives the shared fade. */
  let laserReleasedAt = 0
  /** Writing mode: finished strokes do not change until they fade, so they are baked once. */
  let laserWritingCanvas: HTMLCanvasElement | null = null
  let laserWritingCtx: CanvasRenderingContext2D | null = null
  let laserWritingBaked = 0
  let laserWritingDpr = 0

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

  function resetLaserWritingCache() {
    laserWritingBaked = 0
    if (laserWritingCtx && laserWritingCanvas) {
      laserWritingCtx.setTransform(1, 0, 0, 1, 0, 0)
      laserWritingCtx.clearRect(0, 0, laserWritingCanvas.width, laserWritingCanvas.height)
    }
  }

  function clearLaserStrokes(): boolean {
    if (laserStrokes.length === 0) return false
    laserStrokes.length = 0
    resetLaserWritingCache()
    markLaserChanged()
    stopLaserAnimation()
    return true
  }

  function setLaserMode(mode: LaserMode) {
    if (laserMode.value === mode) return
    laserMode.value = mode
    if (clearLaserStrokes()) {
      previewDirty = true
      scheduleRender()
    }
  }

  function pruneExpiredLaserStrokes(now: number): boolean {
    if (laserMode.value === 'writing') {
      if (isDrawingLaser() || laserStrokes.length === 0) return false
      if (laserWritingOpacity(now, laserReleasedAt) > 0) return false
      laserStrokes.length = 0
      resetLaserWritingCache()
      markLaserChanged()
      return true
    }

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
      const removed = pruneExpiredLaserStrokes(now)
      // Resting writing-mode strokes are static until the fade starts; skip redundant repaints.
      const idle = laserMode.value === 'writing' && !isDrawingLaser() && laserWritingOpacity(now, laserReleasedAt) >= 1
      if (removed || !idle) {
        previewDirty = true
        scheduleRender()
      }
      if (needsLaserAnimation()) {
        laserRafId = window.setTimeout(tick, 16)
      }
    }
    laserRafId = window.setTimeout(tick, 16)
  }

  /** Bake finished writing-mode strokes into a canvas matching `target` (device pixels). */
  function syncLaserWritingCache(target: HTMLCanvasElement, dpr: number): HTMLCanvasElement | null {
    if (
      !laserWritingCanvas ||
      laserWritingCanvas.width !== target.width ||
      laserWritingCanvas.height !== target.height ||
      laserWritingDpr !== dpr
    ) {
      laserWritingCanvas ??= document.createElement('canvas')
      laserWritingCanvas.width = target.width
      laserWritingCanvas.height = target.height
      laserWritingCtx = laserWritingCanvas.getContext('2d')
      laserWritingDpr = dpr
      laserWritingBaked = 0
    }
    const ctx = laserWritingCtx
    if (!ctx) return null
    if (laserWritingBaked > laserStrokes.length) resetLaserWritingCache()
    if (laserWritingBaked < laserStrokes.length) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      for (let i = laserWritingBaked; i < laserStrokes.length; i++) {
        const { action } = laserStrokes[i]
        drawLaserTrail(ctx, action.points, action.color, action.lineWidth, 0, false, true)
      }
      laserWritingBaked = laserStrokes.length
    }
    return laserWritingCanvas
  }

  function drawLaserStrokes(ctx: CanvasRenderingContext2D, now = performance.now()) {
    if (laserMode.value === 'writing') {
      const opacity = isDrawingLaser() ? 1 : laserWritingOpacity(now, laserReleasedAt)
      const cache = opacity > 0 ? syncLaserWritingCache(ctx.canvas, getEffectiveDpr()) : null
      if (!cache) return
      ctx.save()
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.globalAlpha = opacity
      ctx.drawImage(cache, 0, 0)
      ctx.restore()
      return
    }
    for (let i = 0; i < laserStrokes.length; i++) {
      const { action } = laserStrokes[i]
      drawLaserTrail(ctx, action.points, action.color, action.lineWidth, now, false)
    }
  }
  const currentAction = shallowRef<DrawAction | null>(null)
  const previewAction = shallowRef<DrawAction | null>(null)
  /** Selected elements (shallow refs into history). Cleared when leaving select tool. */
  const selectedActions = shallowRef<DrawAction[]>([])
  const marqueeRect = shallowRef<SelectionRect | null>(null)

  let cacheCanvas: HTMLCanvasElement | null = null
  let cacheCtx: CanvasRenderingContext2D | null = null
  let historyCtx: CanvasRenderingContext2D | null = null
  let previewCtx: CanvasRenderingContext2D | null = null
  let cacheValid = false
  let rafId: number | null = null
  let historyDirty = true
  let previewDirty = true

  // Live ink preview: settled stroke points are rasterized once into strokeCanvas as
  // overlapping chunks at full opacity; only the tail behind the tip is re-outlined per
  // frame, so cost stays flat as the stroke grows. Opacity is applied when compositing.
  let strokeCanvas: HTMLCanvasElement | null = null
  let strokeCtx: CanvasRenderingContext2D | null = null
  let inkComposeCanvas: HTMLCanvasElement | null = null
  let inkComposeCtx: CanvasRenderingContext2D | null = null
  let inkLiveAction: DrawAction | null = null
  let inkLiveKey = ''
  /** Index of the first sample still re-outlined behind the live tip. */
  let inkChunkStart = 0
  /** EMA cache so frozen chunks and the live tail share one phase with the final render. */
  let inkSamples: SweptSampleCache | null = null
  let inkHasFrozen = false
  let inkTailPath: Path2D | null = null

  // Pre-rendered drag element canvas (avoids per-frame path reconstruction)
  let dragCanvas: HTMLCanvasElement | null = null
  let dragCtx: CanvasRenderingContext2D | null = null
  let dragOffsetX = 0
  let dragOffsetY = 0
  let dragBboxX = 0
  let dragBboxY = 0
  let useDragCanvas = false
  /** Actions currently being dragged (supports multi-select move). */
  let draggingActions: DrawAction[] = []
  let draggingSet = new Set<DrawAction>()
  /** Single-action reshape (Select tool handle drag). */
  let reshapingAction: DrawAction | null = null
  let reshapeHandleId: ReshapeHandleId | null = null
  let reshapeBeforeSnap: DragSnapshot | null = null
  /** Gesture-start geometry so Shift can toggle mid-drag without compounding. */
  let reshapeOriginPoints: Point[] | null = null
  let reshapeOriginEraserPoints: Point[][] | null = null
  let reshapeOriginBounds: ReshapeBounds | null = null
  let reshapeOriginAspect = 1
  let reshapeOriginRotation = 0
  let reshapeOriginFontSize: number | null = null
  let reshapeOriginTextWidth: number | null = null
  let reshapeOriginStretchX: number | null = null
  let reshapeRotateStartAngle = 0
  /** Pointer-down point for the active shape stroke (center for perfect circles). */
  let drawGestureOrigin: Point | null = null
  let tempCanvas: HTMLCanvasElement | null = null
  let tempCtx: CanvasRenderingContext2D | null = null
  let pathCache = new WeakMap<DrawAction, Path2D>()

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
  // inside renderFrame (called 3-5× per frame). Must key on CSS width too:
  // WebView2 DPI catch-up often keeps the bitmap at physical pixels while
  // style.width / innerWidth shrink to logical CSS (same canvas.width, new dpr).
  let cachedDpr = 0
  let cachedDprCanvasW = 0
  let cachedDprCssW = 0
  let cacheAppliedDpr = 0

  function getEffectiveDpr(): number {
    const canvas = previewCanvasRef.value ?? historyCanvasRef.value
    if (!canvas) return window.devicePixelRatio || 1
    const cssW = parseFloat(canvas.style.width)
    const width = cssW > 0 ? cssW : window.innerWidth
    if (width <= 0) return window.devicePixelRatio || 1
    if (canvas.width === cachedDprCanvasW && width === cachedDprCssW && cachedDpr > 0) {
      return cachedDpr
    }
    cachedDpr = canvas.width / width
    cachedDprCanvasW = canvas.width
    cachedDprCssW = width
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

    const dpr = getEffectiveDpr()
    if (cacheCanvas.width !== canvas.width || cacheCanvas.height !== canvas.height) {
      cacheCanvas.width = canvas.width
      cacheCanvas.height = canvas.height
      cacheCtx = cacheCanvas.getContext('2d')
      cacheValid = false
      cacheAppliedDpr = 0
    }

    if (cacheAppliedDpr !== dpr) {
      cacheAppliedDpr = dpr
      cacheValid = false
    }

    if (!cacheCtx) return

    cacheCtx.setTransform(dpr, 0, 0, dpr, 0, 0)

    if (!cacheValid) {
      cacheCtx.setTransform(1, 0, 0, 1, 0, 0)
      cacheCtx.clearRect(0, 0, cacheCanvas.width, cacheCanvas.height)
      cacheCtx.setTransform(dpr, 0, 0, dpr, 0, 0)
      for (let i = 0; i < history.length; i++) {
        if (draggingSet.has(history[i])) continue
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
    // Reassigning width/height reallocates the backing store even when unchanged.
    if (!strokeCtx || strokeCanvas.width !== canvas.width || strokeCanvas.height !== canvas.height) {
      strokeCanvas.width = canvas.width
      strokeCanvas.height = canvas.height
      strokeCtx = strokeCanvas.getContext('2d')
    }
    clearStrokeCanvas()
  }

  function clearStrokeCanvas() {
    if (strokeCtx && strokeCanvas) {
      strokeCtx.setTransform(1, 0, 0, 1, 0, 0)
      strokeCtx.clearRect(0, 0, strokeCanvas.width, strokeCanvas.height)
    }
    inkLiveAction = null
    inkLiveKey = ''
    inkChunkStart = 0
    inkSamples = null
    inkHasFrozen = false
    inkTailPath = null
    inkPreviewDirty = true
  }

  function getInkComposeCtx(): CanvasRenderingContext2D | null {
    if (!strokeCanvas) return null
    if (!inkComposeCanvas) inkComposeCanvas = document.createElement('canvas')
    if (
      !inkComposeCtx ||
      inkComposeCanvas.width !== strokeCanvas.width ||
      inkComposeCanvas.height !== strokeCanvas.height
    ) {
      inkComposeCanvas.width = strokeCanvas.width
      inkComposeCanvas.height = strokeCanvas.height
      inkComposeCtx = inkComposeCanvas.getContext('2d')
    }
    return inkComposeCtx
  }

  function resolveActionBbox(action: DrawAction): DrawAction['bbox'] {
    // Always recompute text bounds so selection frames pick up geometry fixes
    // (cached action.bbox may predate computeTextBbox changes in this session).
    if (action.tool === 'text') return computeTextBbox(action)
    if (action.tool === 'stamp') return action.bbox ?? computeStampBbox(action)
    if (action.bbox) return action.bbox
    const pad = Math.max(20, action.lineWidth / 2 + 10)
    return computeBbox(action, pad)
  }

  function refreshActionGeometry(action: DrawAction) {
    if (action.tool === 'text' && action.textWidth != null) {
      action.bbox = computeTextBbox(action)
    } else if (action.tool === 'stamp') {
      action.bbox = computeStampBbox(action)
    } else {
      const pad = Math.max(20, action.lineWidth / 2 + 10)
      action.bbox = computeBbox(action, pad)
    }
    updateShapeHitCache(action)
  }

  function drawSelectionOverlay(ctx: CanvasRenderingContext2D) {
    const selected = selectedActions.value
    const marquee = marqueeRect.value
    if (selected.length === 0 && !marquee) return

    const dx = draggingSet.size > 0 && !reshapingAction ? dragOffsetX : 0
    const dy = draggingSet.size > 0 && !reshapingAction ? dragOffsetY : 0

    ctx.save()
    ctx.lineWidth = 1.5
    ctx.setLineDash([6, 4])
    ctx.strokeStyle = 'rgba(0, 122, 255, 0.95)'

    for (const action of selected) {
      const ox = draggingSet.has(action) && !reshapingAction ? dx : 0
      const oy = draggingSet.has(action) && !reshapingAction ? dy : 0
      // Corner handles sit on geometric bounds. The dashed frame must share that
      // box so its stroke runs through the handle centers. The padded hit bbox is
      // for picking only and would leave the frame outside the four handles.
      const localBounds = selectionFrameBounds(action)
      if (localBounds) {
        const rot = getShapeRotation(action)
        const cx = (localBounds.x0 + localBounds.x1) / 2
        const cy = (localBounds.y0 + localBounds.y1) / 2
        ctx.save()
        ctx.translate(cx + ox, cy + oy)
        if (rot !== 0) ctx.rotate(rot)
        ctx.translate(-cx, -cy)
        ctx.strokeRect(localBounds.x0, localBounds.y0, localBounds.x1 - localBounds.x0, localBounds.y1 - localBounds.y0)
        ctx.restore()
      } else {
        const bbox = resolveActionBbox(action)
        if (!bbox) continue
        ctx.strokeRect(bbox.x1 + ox, bbox.y1 + oy, bbox.x2 - bbox.x1, bbox.y2 - bbox.y1)
      }
    }

    // Reshape handles: single selected reshapeable shape only.
    if (selected.length === 1 && isReshapeableTool(selected[0].tool)) {
      const action = selected[0]
      const ox = draggingSet.has(action) && !reshapingAction ? dx : 0
      const oy = draggingSet.has(action) && !reshapingAction ? dy : 0
      const half = RESHAPE_HANDLE_HALF
      const handles = getReshapeHandles(action)
      ctx.setLineDash([])
      ctx.lineWidth = 1
      // Stem from top-mid to rotate handle
      const rotateHandle = handles.find((h) => h.id === 'rotate')
      const bounds = getActionReshapeBounds(action)
      if (rotateHandle && bounds) {
        const rot = getShapeRotation(action)
        const cx = (bounds.x0 + bounds.x1) / 2
        const cy = (bounds.y0 + bounds.y1) / 2
        const topMid = rotatePointAround({ x: cx, y: bounds.y0 }, cx, cy, rot)
        ctx.beginPath()
        ctx.strokeStyle = 'rgba(0, 122, 255, 0.75)'
        ctx.moveTo(topMid.x + ox, topMid.y + oy)
        ctx.lineTo(rotateHandle.x + ox, rotateHandle.y + oy)
        ctx.stroke()
      }
      for (const h of handles) {
        const hx = h.x + ox
        const hy = h.y + oy
        ctx.fillStyle = 'rgba(255, 255, 255, 0.95)'
        ctx.strokeStyle = 'rgba(0, 122, 255, 0.95)'
        if (h.id === 'rotate' || h.id === 'bend') {
          // Circular bend handle distinguishes "drag the curve" from endpoint squares.
          const r = h.id === 'rotate' ? half + 1.5 : half + 0.5
          ctx.beginPath()
          ctx.arc(hx, hy, r, 0, Math.PI * 2)
          ctx.fill()
          ctx.stroke()
        } else {
          ctx.fillRect(hx - half, hy - half, half * 2, half * 2)
          ctx.strokeRect(hx - half, hy - half, half * 2, half * 2)
        }
      }
    }

    if (marquee) {
      const r = normalizeSelectionRect(marquee)
      const w = r.x2 - r.x1
      const h = r.y2 - r.y1
      ctx.setLineDash([4, 3])
      ctx.fillStyle = 'rgba(0, 122, 255, 0.12)'
      ctx.strokeStyle = 'rgba(0, 122, 255, 0.85)'
      ctx.fillRect(r.x1, r.y1, w, h)
      ctx.strokeRect(r.x1, r.y1, w, h)
    }

    ctx.restore()
  }

  /** Handle under point for the current single selection (Select tool). */
  function findReshapeHandleAt(p: Point): ReshapeHandle | null {
    if (selectedActions.value.length !== 1) return null
    const action = selectedActions.value[0]
    if (!isReshapeableTool(action.tool)) return null
    if (history.indexOf(action) === -1) return null
    return hitTestReshapeHandle(action, p)
  }

  function clearSelection() {
    if (selectedActions.value.length === 0 && marqueeRect.value == null) return
    selectedActions.value = []
    marqueeRect.value = null
    previewDirty = true
    scheduleRender()
  }

  function setSelection(actions: DrawAction[]) {
    const unique: DrawAction[] = []
    const seen = new Set<DrawAction>()
    for (const a of actions) {
      if (seen.has(a) || history.indexOf(a) === -1) continue
      seen.add(a)
      unique.push(a)
    }
    selectedActions.value = unique
    previewDirty = true
    scheduleRender()
  }

  /**
   * Select every annotation on the canvas (double-press V / double-click Select).
   * Returns how many actions are selected — 0 means there is nothing to select.
   */
  function selectAll(): number {
    if (isDrawing.value) return 0
    marqueeRect.value = null
    // History already holds unique action refs; Set only guards against accidental duplicates.
    const all = [...new Set(history)]
    selectedActions.value = all
    previewDirty = true
    scheduleRender()
    return all.length
  }

  /** True when every annotation on the canvas is selected (and history is non-empty). */
  function areAllActionsSelected(): boolean {
    const all = new Set(history)
    if (all.size === 0 || selectedActions.value.length !== all.size) return false
    const selected = new Set(selectedActions.value)
    return selected.size === all.size && [...all].every((action) => selected.has(action))
  }

  /**
   * Toggle select-all: select every annotation, or clear the selection when
   * everything is already selected (double-press V / double-click Select).
   */
  function toggleSelectAll(): { count: number; cleared: boolean } {
    if (isDrawing.value) return { count: selectedActions.value.length, cleared: false }
    if (areAllActionsSelected()) {
      clearSelection()
      return { count: 0, cleared: true }
    }
    return { count: selectAll(), cleared: false }
  }

  function toggleInSelection(action: DrawAction) {
    if (history.indexOf(action) === -1) return
    const cur = selectedActions.value
    const idx = cur.indexOf(action)
    selectedActions.value = idx === -1 ? [...cur, action] : cur.filter((a) => a !== action)
    previewDirty = true
    scheduleRender()
  }

  function isActionSelected(action: DrawAction): boolean {
    return selectedActions.value.includes(action)
  }

  /** True if point lies inside a selected action's bbox (for drag-from-selection-frame). */
  function findSelectedActionAt(p: Point): DrawAction | null {
    let best: DrawAction | null = null
    let bestIdx = -1
    for (const action of selectedActions.value) {
      if (history.indexOf(action) === -1) continue
      const bbox = resolveActionBbox(action)
      if (!bbox) continue
      if (p.x < bbox.x1 || p.x > bbox.x2 || p.y < bbox.y1 || p.y > bbox.y2) continue
      const idx = history.indexOf(action)
      if (idx >= bestIdx) {
        bestIdx = idx
        best = action
      }
    }
    return best
  }

  function setMarqueeRect(rect: SelectionRect | null) {
    marqueeRect.value = rect
    previewDirty = true
    scheduleRender()
  }

  function findActionsInRect(rect: SelectionRect): DrawAction[] {
    const r = normalizeSelectionRect(rect)
    const hits: DrawAction[] = []
    for (const action of history) {
      const bbox = resolveActionBbox(action)
      if (!bbox) continue
      if (bboxesIntersect(bbox, r)) hits.push(action)
    }
    return hits
  }

  function pruneSelection(removed: Iterable<DrawAction>) {
    const drop = removed instanceof Set ? removed : new Set(removed)
    if (drop.size === 0) return
    const next = selectedActions.value.filter((a) => !drop.has(a))
    if (next.length !== selectedActions.value.length) {
      selectedActions.value = next
      previewDirty = true
    }
  }

  function removeSelected() {
    const selected = selectedActions.value
    if (selected.length === 0) return

    const removed: { action: DrawAction; index: number }[] = []
    for (const action of selected) {
      const idx = history.indexOf(action)
      if (idx !== -1) removed.push({ action, index: idx })
    }
    if (removed.length === 0) {
      selectedActions.value = []
      marqueeRect.value = null
      previewDirty = true
      flushRender()
      return
    }

    // High→low splice keeps original indices valid for each removal and for undo.
    removed.sort((a, b) => b.index - a.index)
    for (const item of removed) {
      history.splice(item.index, 1)
      deleteActionFromHitGrid(item.action)
    }
    historyIndexDirty = true
    selectedActions.value = []
    marqueeRect.value = null
    undoStack.push({ type: 'removeBatch', removed: [...removed] })
    redoStack.length = 0
    invalidateCache()
    previewDirty = true
    markHistoryStacksChanged()
    flushRender()
  }

  /**
   * Copy the current selection into the internal vector clipboard (Mod+C).
   * Returns how many actions were copied — 0 means nothing was selected, so the
   * caller can fall back to copying the rendered screen / whiteboard bitmap.
   */
  function copySelection(): number {
    const selected = selectedActions.value.filter((action) => history.indexOf(action) !== -1)
    if (selected.length === 0) return 0
    // Keep z-order so the pasted group stacks exactly like the original.
    const ordered = [...selected].sort((a, b) => history.indexOf(a) - history.indexOf(b))
    copiedActions = ordered.map((action) => cloneActionWithOffset(action, 0, 0))
    pasteCascade = 0
    return copiedActions.length
  }

  function hasCopiedActions(): boolean {
    return copiedActions.length > 0
  }

  /**
   * Paste the copied actions as 1:1 clones cascaded below-right of the originals,
   * then select them so they can be dragged straight away. The whole paste is a
   * single undo step.
   */
  function pasteClipboard(): number {
    if (copiedActions.length === 0 || isDrawing.value) return 0

    pasteCascade += 1
    const offset = PASTE_CASCADE_OFFSET_PX * pasteCascade
    const pasted: DrawAction[] = []
    const items: { action: DrawAction; index: number }[] = []

    for (const source of copiedActions) {
      const action = cloneActionWithOffset(source, offset, offset)
      refreshActionGeometry(action)
      history.push(action)
      appendActionToHitGrid(action)
      pasted.push(action)
      items.push({ action, index: history.length - 1 })
    }

    historyIndexDirty = true
    undoStack.push({ type: 'paste', items })
    redoStack.length = 0
    setSelection(pasted)
    markHistoryStacksChanged()
    invalidateCache()
    previewDirty = true
    flushRender()
    return pasted.length
  }

  function isInkTool(tool: Tool): boolean {
    return tool === 'pen' || tool === 'highlighter'
  }

  /**
   * Bring the live ink preview up to date: freeze settled chunks into strokeCanvas
   * and rebuild the tail path. Raw samples are stored, so smoothing happens here
   * (per chunk) and the tip stays on the pointer. Width / DPR changes restart from
   * the first sample.
   */
  function bakeIncrementalStroke(action: DrawAction) {
    if (!strokeCtx || !strokeCanvas) return
    if (!isInkTool(action.tool)) return
    const pts = action.points
    if (pts.length === 0) return

    const dpr = getEffectiveDpr()
    const key = `${action.lineWidth}|${action.pointerType ?? ''}|${dpr}|${strokeCanvas.width}x${strokeCanvas.height}`
    if (action !== inkLiveAction || key !== inkLiveKey || inkChunkStart > pts.length) {
      clearStrokeCanvas()
      inkLiveAction = action
      inkLiveKey = key
    }

    // Every slice must sit on the same EMA phase as the final `buildInkPath`, else the
    // frozen chunks stick out and the stroke visibly re-renders on pointer up.
    const cache = (inkSamples ??= new SweptSampleCache(
      action.lineWidth,
      SWEPT_STYLE,
      action.pointerType,
      brushProfileFor(action.tool, action.lockedLine === true),
    ))
    cache.sync(pts)
    const taper = taperStyleFor(action.tool, action.lockedLine === true)
    // The ramp length comes from the whole stroke, so the live tail tapers exactly like
    // the committed path. Only the lifted tip gets a 锋: a frozen chunk's end is covered
    // by the live tail, and a ramp there would leave an unpainted notch mid-stroke.
    const strokeLength = cache.length(pts)
    const pathFor = (from: number, to: number): Path2D => {
      const nodes = cache.nodes(pts, from, to)
      const pruned = pruneNodes(nodes, SWEPT_STYLE)
      return buildSweptPath(
        taperNodes(pruned, action.lineWidth, strokeLength, taper, {
          taperStart: from === 0,
          taperEnd: to === pts.length - 1,
          metrics: taperMetrics(nodes),
        }),
      )
    }

    if (pts.length === 1) {
      // A tap uses the same pressure-aware radius as the committed path
      // (`drawActionDirect`), so the dot does not jump on pointer up.
      const path = new Path2D()
      path.arc(pts[0].x, pts[0].y, dotRadius(pts[0], action.lineWidth, SWEPT_STYLE, action.pointerType), 0, Math.PI * 2)
      inkTailPath = path
      inkPreviewDirty = false
      return
    }

    let plan = planSweptFreeze(pts.length, inkChunkStart)
    if (plan) {
      strokeCtx.setTransform(dpr, 0, 0, dpr, 0, 0)
      strokeCtx.globalCompositeOperation = 'source-over'
      strokeCtx.globalAlpha = 1
      strokeCtx.fillStyle = action.color
    }
    while (plan) {
      strokeCtx.fill(pathFor(inkChunkStart, plan.end))
      inkHasFrozen = true
      inkChunkStart = plan.nextStart
      plan = planSweptFreeze(pts.length, inkChunkStart)
    }

    inkTailPath = pathFor(inkChunkStart, pts.length - 1)
    inkPreviewDirty = false
  }

  /** Frozen chunks + live tail. Overlaps are composited at full alpha so opacity stays uniform. */
  function drawLiveInk(ctx: CanvasRenderingContext2D, action: DrawAction, dpr: number) {
    if (!strokeCanvas || !inkTailPath) return
    ctx.save()
    ctx.globalCompositeOperation = 'source-over'
    if (action.opacity >= 1 || !inkHasFrozen) {
      if (inkHasFrozen) {
        ctx.setTransform(1, 0, 0, 1, 0, 0)
        ctx.globalAlpha = 1
        ctx.drawImage(strokeCanvas, 0, 0)
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.globalAlpha = action.opacity
      ctx.fillStyle = action.color
      ctx.fill(inkTailPath)
    } else {
      const compose = getInkComposeCtx()
      if (compose && inkComposeCanvas) {
        compose.setTransform(1, 0, 0, 1, 0, 0)
        compose.globalCompositeOperation = 'source-over'
        compose.globalAlpha = 1
        compose.clearRect(0, 0, inkComposeCanvas.width, inkComposeCanvas.height)
        compose.drawImage(strokeCanvas, 0, 0)
        compose.setTransform(dpr, 0, 0, dpr, 0, 0)
        compose.fillStyle = action.color
        compose.fill(inkTailPath)
        ctx.setTransform(1, 0, 0, 1, 0, 0)
        ctx.globalAlpha = action.opacity
        ctx.drawImage(inkComposeCanvas, 0, 0)
      }
    }
    ctx.restore()
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
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      if (laserStrokes.length > 0) {
        drawLaserStrokes(ctx)
      }
      drawSelectionOverlay(ctx)
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
        drawLaserTrail(
          ctx,
          action.points,
          action.color,
          action.lineWidth,
          performance.now(),
          true,
          laserMode.value === 'writing',
        )
      } else if (isInkTool(action.tool) && strokeCanvas && !isNonSolidDashStyle(action.dashStyle)) {
        if (inkPreviewDirty) bakeIncrementalStroke(action)
        drawLiveInk(ctx, action, dpr)
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

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    drawSelectionOverlay(ctx)

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
    rotation?: number,
    stretchX?: number,
  ) {
    const normalizedOutline = normalizeTextOutline(textOutline)
    const stretch = typeof stretchX === 'number' && Number.isFinite(stretchX) && stretchX > 0 ? stretchX : 1
    const action: DrawAction = {
      tool: 'text',
      color: color ?? currentColor.value,
      lineWidth: lineWidths.value.text,
      opacity: 1,
      points: [{ x, y }],
      text,
      fontSize,
    }
    if (typeof rotation === 'number' && Number.isFinite(rotation) && rotation !== 0) action.rotation = rotation
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
      action.textWidth = Math.max(1, maxWidth * stretch)
      if (Math.abs(stretch - 1) >= 1e-6) action.stretchX = stretch
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

  /**
   * Every action whose paint overlaps the eraser footprint, topmost first.
   *
   * The hit grid is bucketed per action bbox, so the footprint bounds have to widen
   * the cell query: an action whose bbox sits in a neighbouring cell is still within
   * reach of a large eraser.
   */
  function collectActionsTouchingFootprint(footprint: EraserFootprint, out: DrawAction[]) {
    ensureHitGrid()
    const { x1, y1, x2, y2 } = footprint.bounds
    const minCellX = Math.floor(x1 / HIT_GRID_SIZE)
    const maxCellX = Math.floor(x2 / HIT_GRID_SIZE)
    const minCellY = Math.floor(y1 / HIT_GRID_SIZE)
    const maxCellY = Math.floor(y2 / HIT_GRID_SIZE)

    const seen = new Set<DrawAction>()
    const consider = (candidate: DrawAction) => {
      if (seen.has(candidate)) return
      seen.add(candidate)
      if (hitTestActionWithFootprint(candidate, footprint)) out.push(candidate)
    }

    for (let cy = minCellY; cy <= maxCellY; cy++) {
      for (let cx = minCellX; cx <= maxCellX; cx++) {
        const bucket = hitGrid.get(`${cx},${cy}`)
        if (!bucket) continue
        for (let i = 0; i < bucket.length; i++) consider(bucket[i])
      }
    }
    for (let i = 0; i < hitGridOverflow.length; i++) consider(hitGridOverflow[i])

    out.sort((a, b) => (hitGridOrder.get(b) ?? 0) - (hitGridOrder.get(a) ?? 0))
  }

  /** Remove one action because the object eraser touched it; returns true when it was live. */
  function removeObjectEraserTarget(target: DrawAction): boolean {
    if (objectEraserRemovedSet.has(target)) return false
    objectEraserRemovedSet.add(target)
    const liveIdx = history.indexOf(target)
    if (liveIdx === -1) return false
    // Undo re-inserts by ascending index, so the batch must carry the gesture-start
    // index — the live index shifts for every earlier removal in the same sweep.
    objectEraserBatch.push({ action: target, index: objectEraserIndexSnapshot?.get(target) ?? liveIdx })
    history.splice(liveIdx, 1)
    historyIndexDirty = true
    deleteActionFromHitGrid(target)
    pruneSelection([target])
    return true
  }

  /**
   * Object eraser: drop every element the eraser footprint touches.
   *
   * The footprint is swept along the eraser path — a slow drag stores sub-pixel steps
   * and a fast drag stores whole 20–30px jumps, so testing the stored points alone
   * would let the eraser jump across a stroke without touching it. Sub-stepping the
   * segments keeps the swept footprints overlapping, so "the eraser graphic touches the
   * ink" and "the ink is erased" stay the same instant.
   */
  function processObjectEraserHits(action: DrawAction) {
    const pts = action.points
    if (pts.length === 0) return
    // The footprint is the glyph the cursor draws, so the ink can never disappear
    // outside the eraser icon.
    const cursorSize = eraserGlyphSize(action.lineWidth)
    let removedAny = false
    const hits: DrawAction[] = []

    for (let i = objectEraserLastProcessedPt; i < pts.length; i++) {
      const from = i > 0 ? pts[i - 1] : pts[i]
      const to = pts[i]
      const dx = to.x - from.x
      const dy = to.y - from.y
      const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy) / OBJECT_ERASER_MAX_STEP_PX))
      for (let s = 1; s <= steps; s++) {
        const t = s / steps
        hits.length = 0
        collectActionsTouchingFootprint(buildEraserFootprint(from.x + dx * t, from.y + dy * t, cursorSize), hits)
        for (let h = 0; h < hits.length; h++) {
          if (removeObjectEraserTarget(hits[h])) removedAny = true
        }
      }
    }

    objectEraserLastProcessedPt = pts.length
    if (removedAny) {
      markHistoryStacksChanged()
      invalidateCache()
    }
  }

  function startDraw(point: Point) {
    if (currentTool.value === 'text' || currentTool.value === 'stamp' || currentTool.value === 'select') return
    isDrawing.value = true
    resetLineLockState()
    drawGestureOrigin = { x: point.x, y: point.y }
    if (redoStack.length > 0) {
      redoStack.length = 0
      markHistoryStacksChanged()
    }

    const dashNow =
      isDashableTool(currentTool.value) && isNonSolidDashStyle(shapeDashStyle.value) ? shapeDashStyle.value : undefined
    const useInkBuffer = isInkTool(currentTool.value) && !dashNow
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
      ...(dashNow ? { dashStyle: dashNow } : {}),
    }
    previewDirty = true
    if (useInkBuffer) {
      inkPreviewDirty = true
      bakeIncrementalStroke(currentAction.value)
    }
    if (currentTool.value === 'laser') {
      // A stroke started after the hold window begins a new passage; drop the fading one.
      if (
        laserMode.value === 'writing' &&
        laserStrokes.length > 0 &&
        performance.now() - laserReleasedAt > LASER_WRITING_HOLD_MS
      ) {
        clearLaserStrokes()
      }
      ensureLaserAnimation()
    }
    if (currentTool.value === 'eraser') {
      if (eraserMode.value === 'object') {
        objectEraserBatch = []
        objectEraserRemovedSet = new Set()
        objectEraserIndexSnapshot = new Map(history.map((action, index) => [action, index]))
        objectEraserLastProcessedPt = 0
      } else {
        historyDirty = true
      }
    }
    if (currentTool.value === 'pen' || currentTool.value === 'highlighter') {
      lineLockStillX = point.x
      lineLockStillY = point.y
      scheduleLineLockTimer()
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
    const inkLockedToLine = strokeLineLocked && (action.tool === 'pen' || action.tool === 'highlighter')
    const isFreehand =
      !inkLockedToLine &&
      (action.tool === 'pen' || action.tool === 'highlighter' || action.tool === 'laser' || action.tool === 'eraser')

    if (isFreehand) {
      let last = pts[pts.length - 1]
      let appended = false
      // Ink and laser keep (almost) every sample: both outline generators need
      // dense nodes for a smooth tangent hull, and raw points let the renderer
      // smooth without shortening the stroke. Other freehand tools keep the
      // adaptive thinning.
      // The object eraser tests the live pointer through a swept footprint, so it must
      // not thin its samples: a thinned path can lag the cursor by a couple of pixels,
      // and ink under the glyph would survive the gesture.
      const objectEraser = action.tool === 'eraser' && eraserMode.value === 'object'
      const minDist = objectEraser
        ? 0
        : isInkTool(action.tool) || action.tool === 'laser'
          ? INK_MIN_DIST_SQ
          : getMinDistSq()

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
          // 毛笔字 width follows nib speed, so every sample keeps the event timestamp.
          // Synthetic input (tests, scripted strokes) has none — the renderer then paints
          // at the chosen width instead of guessing a speed from `performance.now()`.
          nextPoint = { x, y, pressure: normalizePressure(point.pressure), t: point.timeStamp }
        } else {
          nextPoint = { x, y }
        }
        pts.push(nextPoint)
        last = nextPoint
        appended = true
        if (action.tool === 'pen' || action.tool === 'highlighter') {
          noteLineLockPointerActivity(nextPoint.x, nextPoint.y)
        }
      }

      if (!appended) return
      if (action.tool === 'laser') {
        ensureLaserAnimation()
      } else if (isInkTool(action.tool)) {
        // Rebuilt once per frame in renderPreviewFrame, not per pointer sample.
        inkPreviewDirty = true
      } else if (action.tool === 'eraser' && eraserMode.value === 'object') {
        processObjectEraserHits(action)
      }
    } else {
      const point = points[points.length - 1]
      const x = point.x ?? point.clientX
      const y = point.y ?? point.clientY
      if (x == null || y == null) return

      let finalPoint: Point = { x, y }
      if (inkLockedToLine) {
        // Width is frozen at lock time: the tip is dragged, not re-pressed, so the
        // live pen pressure must not repaint the whole line — a light hold at the
        // end of a stroke used to collapse the locked line into a hairline.
        finalPoint = { x, y, pressure: pts[0]?.pressure }
      }
      if (pts.length > 0) {
        const start = pts[0]
        if (inkLockedToLine || action.tool === 'line' || action.tool === 'arrow') {
          const snapped = isPerfect ? snapPointToAngle(start, { x, y }, angleSnapStep.value) : { x, y }
          finalPoint = inkLockedToLine ? { ...finalPoint, x: snapped.x, y: snapped.y } : snapped
        } else if (action.tool === 'rect' || action.tool === 'ellipse') {
          // Keep the press point as gesture origin so Alt can toggle mid-drag.
          const origin = drawGestureOrigin ?? start
          if (isPerfect && action.tool === 'ellipse') {
            const corners = perfectCircleCornersFromCenter(origin, { x, y })
            pts[0] = { ...pts[0], x: corners.start.x, y: corners.start.y }
            finalPoint = corners.end
          } else {
            pts[0] = { ...pts[0], x: origin.x, y: origin.y }
            if (isPerfect) {
              const dx = x - origin.x
              const dy = y - origin.y
              const maxDist = Math.max(Math.abs(dx), Math.abs(dy))
              finalPoint = {
                x: origin.x + (dx < 0 ? -maxDist : maxDist),
                y: origin.y + (dy < 0 ? -maxDist : maxDist),
              }
            } else {
              finalPoint = { x, y }
            }
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
    resetLineLockState()
    drawGestureOrigin = null

    if (action.tool !== 'laser') {
      const pad = Math.max(20, action.lineWidth / 2 + 10)
      action.bbox = computeBbox(action, pad)
      updateShapeHitCache(action)
    }

    clearStrokeCanvas()

    if (action.tool === 'laser') {
      laserStrokes.push({ action })
      laserReleasedAt = performance.now()
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
      objectEraserIndexSnapshot = null
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
    if (currentAction.value?.tool === 'laser') laserReleasedAt = performance.now()
    isDrawing.value = false
    resetLineLockState()
    drawGestureOrigin = null
    currentAction.value = null
    clearStrokeCanvas()
    objectEraserBatch = []
    objectEraserRemovedSet = new Set()
    objectEraserIndexSnapshot = null
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
    if (isDrawing.value && action && isInkTool(action.tool) && !isNonSolidDashStyle(action.dashStyle)) {
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
    beginDragMany([action])
  }

  function beginDragMany(actions: DrawAction[]) {
    const list = actions.filter((a) => history.indexOf(a) !== -1)
    if (list.length === 0) return

    draggingActions = list
    draggingSet = new Set(list)
    previewAction.value = list[0]
    invalidateCache()
    ensureCache()

    useDragCanvas = false
    dragOffsetX = 0
    dragOffsetY = 0

    const canvas = previewCanvasRef.value
    if (canvas) {
      const dpr = getEffectiveDpr()
      let union: NonNullable<DrawAction['bbox']> | null = null
      for (const action of list) {
        const pad = Math.max(20, action.lineWidth / 2 + 10) + 2
        const bbox =
          action.tool === 'text'
            ? computeTextBbox(action)
            : action.tool === 'stamp'
              ? computeStampBbox(action)
              : computeBbox(action, pad)
        if (!bbox) continue
        if (!union) {
          union = { ...bbox }
        } else {
          union.x1 = Math.min(union.x1, bbox.x1)
          union.y1 = Math.min(union.y1, bbox.y1)
          union.x2 = Math.max(union.x2, bbox.x2)
          union.y2 = Math.max(union.y2, bbox.y2)
        }
      }
      if (union) {
        const bw = Math.ceil((union.x2 - union.x1) * dpr)
        const bh = Math.ceil((union.y2 - union.y1) * dpr)
        if (bw > 0 && bh > 0) {
          dragBboxX = union.x1
          dragBboxY = union.y1
          if (!dragCanvas) dragCanvas = document.createElement('canvas')
          dragCanvas.width = bw
          dragCanvas.height = bh
          dragCtx = dragCanvas.getContext('2d')
          if (dragCtx) {
            dragCtx.setTransform(1, 0, 0, 1, 0, 0)
            dragCtx.clearRect(0, 0, bw, bh)
            dragCtx.scale(dpr, dpr)
            dragCtx.translate(-union.x1, -union.y1)
            for (const action of list) {
              drawActionOn(dragCtx, action)
            }
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
    const actions = (
      draggingActions.length > 0 ? draggingActions : previewAction.value ? [previewAction.value] : []
    ).filter((action) => history.indexOf(action) !== -1)
    if (actions.length > 0) {
      const hasMoved = dragOffsetX !== 0 || dragOffsetY !== 0

      const beforeSnaps = hasMoved ? actions.map((action) => takeDragSnapshot(action, history.indexOf(action))) : null

      if (hasMoved) {
        for (const action of actions) {
          for (const pt of action.points) {
            pt.x += dragOffsetX
            pt.y += dragOffsetY
          }
          offsetAttachedErasers(action, dragOffsetX, dragOffsetY)
          pathCache.delete(action)
        }
      }

      for (const action of actions) {
        refreshActionGeometry(action)
      }

      // Raise group to top (including zero-move click), preserving relative order.
      const ordered = [...actions].sort((a, b) => history.indexOf(a) - history.indexOf(b))
      for (let i = ordered.length - 1; i >= 0; i--) {
        const idx = history.indexOf(ordered[i])
        if (idx !== -1) history.splice(idx, 1)
      }
      history.push(...ordered)
      historyIndexDirty = true
      for (const action of ordered) {
        refreshActionInHitGrid(action, true)
      }

      if (hasMoved && beforeSnaps) {
        const items = actions.map((action, i) => ({
          action,
          from: beforeSnaps[i],
          to: takeDragSnapshot(action, history.indexOf(action)),
        }))
        if (items.length === 1) {
          undoStack.push({ type: 'drag', action: items[0].action, from: items[0].from, to: items[0].to })
        } else {
          undoStack.push({ type: 'dragBatch', items })
        }
        redoStack.length = 0
        markHistoryStacksChanged()
      }
    }
    previewAction.value = null
    draggingActions = []
    draggingSet = new Set()
    useDragCanvas = false
    dragOffsetX = 0
    dragOffsetY = 0
    invalidateCache()
    previewDirty = true
    flushRender()
  }

  /**
   * Move the selected actions by (dx, dy) — arrow-key nudging.
   * Consecutive nudges on the same selection within a short window merge into a
   * single undo entry, so holding an arrow key is one undo step.
   */
  function nudgeSelected(dx: number, dy: number): boolean {
    if (dx === 0 && dy === 0) return false
    // A live drag/reshape already owns the undo baseline; folding a nudge into it
    // would make the key press impossible to undo on its own.
    if (draggingSet.size > 0 || reshapingAction) return false
    const targets = selectedActions.value.filter((action) => history.indexOf(action) !== -1)
    if (targets.length === 0) return false

    const fromSnaps = targets.map((action) => takeDragSnapshot(action, history.indexOf(action)))
    for (const action of targets) {
      for (const pt of action.points) {
        pt.x += dx
        pt.y += dy
      }
      offsetAttachedErasers(action, dx, dy)
      pathCache.delete(action)
      refreshActionGeometry(action)
      refreshActionInHitGrid(action)
    }
    const items = targets.map((action, i) => ({
      action,
      from: fromSnaps[i],
      to: takeDragSnapshot(action, history.indexOf(action)),
    }))

    const now = Date.now()
    const last = undoStack[undoStack.length - 1]
    const canMerge =
      last?.type === 'nudge' &&
      now - lastNudgeAt <= NUDGE_COALESCE_MS &&
      last.items.length === items.length &&
      last.items.every((item) => targets.includes(item.action))

    if (canMerge && last?.type === 'nudge') {
      // Extend the previous nudge; `from` stays at the original position.
      for (const item of last.items) {
        item.to = takeDragSnapshot(item.action, history.indexOf(item.action))
      }
    } else {
      undoStack.push({ type: 'nudge', items })
    }
    redoStack.length = 0
    markHistoryStacksChanged()
    lastNudgeAt = now

    invalidateCache()
    previewDirty = true
    flushRender()
    return true
  }

  function clearReshapeState() {
    reshapingAction = null
    reshapeHandleId = null
    reshapeBeforeSnap = null
    reshapeOriginPoints = null
    reshapeOriginEraserPoints = null
    reshapeOriginBounds = null
    reshapeOriginAspect = 1
    reshapeOriginRotation = 0
    reshapeOriginFontSize = null
    reshapeOriginTextWidth = null
    reshapeOriginStretchX = null
    reshapeRotateStartAngle = 0
  }

  function restoreReshapeOriginGeometry(action: DrawAction) {
    if (!reshapeOriginPoints || reshapeOriginPoints.length !== action.points.length) return
    for (let i = 0; i < action.points.length; i++) {
      const src = reshapeOriginPoints[i]
      const dst = action.points[i]
      dst.x = src.x
      dst.y = src.y
      if (src.pressure != null) dst.pressure = src.pressure
      else delete dst.pressure
      if (src.t != null) dst.t = src.t
      else delete dst.t
    }
    if (action.attachedErasers && reshapeOriginEraserPoints) {
      for (let i = 0; i < action.attachedErasers.length; i++) {
        const srcPts = reshapeOriginEraserPoints[i]
        const ae = action.attachedErasers[i]
        if (!srcPts || !ae) continue
        for (let j = 0; j < ae.points.length && j < srcPts.length; j++) {
          ae.points[j].x = srcPts[j].x
          ae.points[j].y = srcPts[j].y
        }
      }
    }
    if (action.tool === 'rect' || action.tool === 'ellipse' || action.tool === 'text' || action.tool === 'stamp') {
      if (Math.abs(reshapeOriginRotation) < 1e-10) delete action.rotation
      else action.rotation = reshapeOriginRotation
    }
    if (reshapeOriginFontSize != null) action.fontSize = reshapeOriginFontSize
    if (reshapeOriginTextWidth != null) action.textWidth = reshapeOriginTextWidth
    if (reshapeOriginStretchX != null) action.stretchX = reshapeOriginStretchX
    else delete action.stretchX
  }

  /** Abandon an in-progress drag / reshape without committing (e.g. Delete mid-gesture). */
  function cancelDrag() {
    if (reshapingAction && reshapeBeforeSnap) {
      restoreDragSnapshot(reshapingAction, reshapeBeforeSnap)
      refreshActionGeometry(reshapingAction)
      pathCache.delete(reshapingAction)
    }
    clearReshapeState()
    previewAction.value = null
    draggingActions = []
    draggingSet = new Set()
    useDragCanvas = false
    dragOffsetX = 0
    dragOffsetY = 0
    invalidateCache()
    previewDirty = true
    flushRender()
  }

  function beginReshape(action: DrawAction, handleId: ReshapeHandleId, pointer?: Point) {
    if (history.indexOf(action) === -1) return
    if (!isReshapeableTool(action.tool)) return
    if (action.points.length === 0) return
    // Text / stamps anchor on a single point and only expose corner + rotate handles.
    if (action.points.length < 2 && action.tool !== 'text' && action.tool !== 'stamp') return

    // Snapshot before promotion so undo/cancel restore the straight two-point arrow.
    const beforeSnap = takeDragSnapshot(action, history.indexOf(action))

    // A straight line/arrow/locked ink keeps two points; promote it to a bent curve.
    if (
      handleId === 'bend' &&
      (action.tool === 'arrow' || action.tool === 'line' || isLockedInkAction(action)) &&
      action.points.length === 2
    ) {
      const [p0, p1] = action.points
      action.points.splice(1, 0, {
        x: (p0.x + p1.x) / 2,
        y: (p0.y + p1.y) / 2,
        ...(p0.pressure != null ? { pressure: p0.pressure } : {}),
      })
      pathCache.delete(action)
    }

    reshapingAction = action
    reshapeHandleId = handleId
    reshapeBeforeSnap = beforeSnap
    // Deep-clone ink eraser attachments so live scale does not mutate the undo snapshot.
    if (isInkReshapeTool(action.tool) && action.attachedErasers?.length) {
      action.attachedErasers = action.attachedErasers.map((ae) => cloneActionWithOffset(ae, 0, 0))
    }
    reshapeOriginPoints = action.points.map(clonePoint)
    reshapeOriginEraserPoints = action.attachedErasers?.map((ae) => ae.points.map(clonePoint)) ?? null
    reshapeOriginBounds = getActionReshapeBounds(action)
    reshapeOriginAspect = reshapeOriginBounds ? aspectRatioOfBounds(reshapeOriginBounds) : 1
    reshapeOriginRotation = getShapeRotation(action)
    reshapeOriginFontSize = action.fontSize ?? null
    reshapeOriginTextWidth = action.textWidth ?? null
    reshapeOriginStretchX = action.stretchX ?? null
    if (handleId === 'rotate' && reshapeOriginBounds) {
      const cx = (reshapeOriginBounds.x0 + reshapeOriginBounds.x1) / 2
      const cy = (reshapeOriginBounds.y0 + reshapeOriginBounds.y1) / 2
      const px = pointer?.x ?? cx
      const py = pointer?.y ?? reshapeOriginBounds.y0 - RESHAPE_ROTATE_HANDLE_OFFSET
      reshapeRotateStartAngle = Math.atan2(py - cy, px - cx)
    } else {
      reshapeRotateStartAngle = 0
    }
    draggingActions = [action]
    draggingSet = new Set([action])
    previewAction.value = action
    useDragCanvas = false
    dragOffsetX = 0
    dragOffsetY = 0
    invalidateCache()
    previewDirty = true
    scheduleRender()
  }

  function updateReshape(p: Point, constrain = false, fromCenter = false) {
    if (!reshapingAction || !reshapeHandleId) return
    restoreReshapeOriginGeometry(reshapingAction)
    applyReshapeHandle(reshapingAction, reshapeHandleId, p, {
      constrain,
      fromCenter,
      originAspect: reshapeOriginAspect,
      originBounds: reshapeOriginBounds ?? undefined,
      angleSnapStep: angleSnapStep.value,
      originRotation: reshapeOriginRotation,
      rotateStartAngle: reshapeRotateStartAngle,
      originFontSize: reshapeOriginFontSize ?? undefined,
      originTextWidth: reshapeOriginTextWidth ?? undefined,
      originStretchX: reshapeOriginStretchX ?? undefined,
    })
    pathCache.delete(reshapingAction)
    if (reshapingAction.attachedErasers) {
      for (const ae of reshapingAction.attachedErasers) pathCache.delete(ae)
    }
    refreshActionGeometry(reshapingAction)
    previewDirty = true
    scheduleRender()
  }

  function endReshape() {
    const action = reshapingAction
    const before = reshapeBeforeSnap
    const handleId = reshapeHandleId
    clearReshapeState()

    if (!action || !before || !handleId || history.indexOf(action) === -1) {
      draggingActions = []
      draggingSet = new Set()
      previewAction.value = null
      useDragCanvas = false
      invalidateCache()
      previewDirty = true
      flushRender()
      return
    }

    // A bend gesture that ends on the chord midpoint is visually straight again; drop
    // the promoted control point so a plain click leaves no phantom three-point curve.
    if (
      handleId === 'bend' &&
      (action.tool === 'arrow' || action.tool === 'line' || isLockedInkAction(action)) &&
      action.points.length === 3
    ) {
      const [p0, c, p1] = action.points
      if (Math.abs(c.x - (p0.x + p1.x) / 2) < 1e-9 && Math.abs(c.y - (p0.y + p1.y) / 2) < 1e-9) {
        action.points.splice(1, 1)
      }
    }

    const changed =
      before.points.length !== action.points.length ||
      before.points.some((pt, i) => pt.x !== action.points[i].x || pt.y !== action.points[i].y) ||
      (before.rotation ?? 0) !== (action.rotation ?? 0) ||
      (before.fontSize ?? null) !== (action.fontSize ?? null) ||
      (before.textWidth ?? null) !== (action.textWidth ?? null) ||
      (before.stretchX ?? null) !== (action.stretchX ?? null)

    // Geometric shapes: attachments no longer match after a real corner rewrite.
    // Only clear when geometry actually changed — a zero-move handle click must not drop erasers.
    // Ink: attachments were scaled with the stroke — keep them.
    if (changed && !isInkReshapeTool(action.tool) && action.attachedErasers?.length) {
      action.attachedErasers = undefined
    }
    pathCache.delete(action)
    if (action.attachedErasers) {
      for (const ae of action.attachedErasers) pathCache.delete(ae)
    }
    refreshActionGeometry(action)

    const idx = history.indexOf(action)
    // Raise to top (same as endDrag) for consistent stacking after edit.
    if (idx !== -1 && idx !== history.length - 1) {
      history.splice(idx, 1)
      history.push(action)
      historyIndexDirty = true
    }
    refreshActionInHitGrid(action, true)

    if (changed) {
      const to = takeDragSnapshot(action, history.indexOf(action))
      undoStack.push({ type: 'drag', action, from: before, to })
      redoStack.length = 0
      markHistoryStacksChanged()
    }

    draggingActions = []
    draggingSet = new Set()
    previewAction.value = null
    useDragCanvas = false
    dragOffsetX = 0
    dragOffsetY = 0
    invalidateCache()
    previewDirty = true
    flushRender()
  }

  function cancelReshape() {
    cancelDrag()
  }

  function undo() {
    if (undoStack.length === 0) return
    historyIndexDirty = true
    lastNudgeAt = -Infinity
    const entry = undoStack.pop()!

    if (entry.type === 'add') {
      const idx = history.lastIndexOf(entry.action)
      if (idx !== -1) {
        history.splice(idx, 1)
        deleteActionFromHitGrid(entry.action)
      }
      pruneSelection([entry.action])
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
    } else if (entry.type === 'style') {
      for (const item of entry.items) {
        item.action.dashStyle = item.before
        pathCache.delete(item.action)
      }
    } else if (entry.type === 'color') {
      for (const item of entry.items) {
        item.action.color = item.before
        pathCache.delete(item.action)
      }
    } else if (entry.type === 'lineWidth') {
      for (const item of entry.items) {
        restoreLineWidthSnapshot(item.action, item.before)
        refreshActionGeometry(item.action)
        refreshActionInHitGrid(item.action)
      }
    } else if (entry.type === 'nudge') {
      for (const item of entry.items) {
        restoreDragSnapshot(item.action, item.from)
        refreshActionInHitGrid(item.action)
      }
    } else if (entry.type === 'dragBatch') {
      for (const item of entry.items) {
        restoreDragSnapshot(item.action, item.from)
      }
      // Restore z-order by original indices (low → high).
      const byFrom = [...entry.items].sort((a, b) => a.from.index - b.from.index)
      for (const item of byFrom) {
        const cur = history.indexOf(item.action)
        if (cur !== -1) history.splice(cur, 1)
      }
      for (const item of byFrom) {
        const target = Math.min(item.from.index, history.length)
        history.splice(target, 0, item.action)
      }
      historyIndexDirty = true
      for (const item of byFrom) {
        refreshActionInHitGrid(item.action, true)
      }
    } else if (entry.type === 'erase') {
      for (const t of entry.targets) {
        t.action.attachedErasers = t.before ? [...t.before] : undefined
        pathCache.delete(t.action)
      }
    } else if (entry.type === 'removeBatch') {
      const sorted = [...entry.removed].sort((a, b) => a.index - b.index)
      for (const item of sorted) {
        history.splice(item.index, 0, item.action)
      }
      // Re-appending would hand the restored actions the highest hit order, so
      // `findActionAt` would pick them over the shapes drawn above them. Rebuild the
      // grid instead so hit order follows z-order again.
      hitGridDirty = true
      historyIndexDirty = true
    } else if (entry.type === 'paste') {
      const sorted = [...entry.items].sort((a, b) => b.index - a.index)
      for (const item of sorted) {
        const idx = history.indexOf(item.action)
        if (idx !== -1) {
          history.splice(idx, 1)
          deleteActionFromHitGrid(item.action)
        }
      }
      historyIndexDirty = true
      pruneSelection(sorted.map((item) => item.action))
    } else if (entry.type === 'clear') {
      history.push(...entry.actions)
      undoStack.push(...entry.prevUndoStack)
      hitGridDirty = true
    }

    redoStack.push(entry)
    invalidateCache()
    previewDirty = true
    markHistoryStacksChanged()
    flushRender()
  }

  function redo() {
    if (redoStack.length === 0) return
    historyIndexDirty = true
    lastNudgeAt = -Infinity
    const entry = redoStack.pop()!

    if (entry.type === 'add') {
      history.push(entry.action)
      appendActionToHitGrid(entry.action)
    } else if (entry.type === 'remove') {
      const idx = history.indexOf(entry.action)
      if (idx !== -1) {
        history.splice(idx, 1)
        deleteActionFromHitGrid(entry.action)
        pruneSelection([entry.action])
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
    } else if (entry.type === 'style') {
      for (const item of entry.items) {
        item.action.dashStyle = item.after
        pathCache.delete(item.action)
      }
    } else if (entry.type === 'color') {
      for (const item of entry.items) {
        item.action.color = item.after
        pathCache.delete(item.action)
      }
    } else if (entry.type === 'lineWidth') {
      for (const item of entry.items) {
        restoreLineWidthSnapshot(item.action, item.after)
        refreshActionGeometry(item.action)
        refreshActionInHitGrid(item.action)
      }
    } else if (entry.type === 'nudge') {
      for (const item of entry.items) {
        restoreDragSnapshot(item.action, item.to)
        refreshActionInHitGrid(item.action)
      }
    } else if (entry.type === 'dragBatch') {
      for (const item of entry.items) {
        restoreDragSnapshot(item.action, item.to)
      }
      const byTo = [...entry.items].sort((a, b) => a.to.index - b.to.index)
      for (const item of byTo) {
        const cur = history.indexOf(item.action)
        if (cur !== -1) history.splice(cur, 1)
      }
      for (const item of byTo) {
        const target = Math.min(item.to.index, history.length)
        history.splice(target, 0, item.action)
      }
      historyIndexDirty = true
      for (const item of byTo) {
        refreshActionInHitGrid(item.action, true)
      }
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
      pruneSelection(sorted.map((item) => item.action))
    } else if (entry.type === 'paste') {
      const sorted = [...entry.items].sort((a, b) => a.index - b.index)
      for (const item of sorted) {
        const target = Math.min(item.index, history.length)
        history.splice(target, 0, item.action)
        appendActionToHitGrid(item.action)
      }
      historyIndexDirty = true
      setSelection(sorted.map((item) => item.action))
    } else if (entry.type === 'clear') {
      entry.actions = [...history]
      entry.prevUndoStack = [...undoStack]
      history.length = 0
      undoStack.length = 0
      clearHitGridState()
      hitGridDirty = false
      selectedActions.value = []
      marqueeRect.value = null
    }

    undoStack.push(entry)
    invalidateCache()
    previewDirty = true
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
    selectedActions.value = []
    marqueeRect.value = null

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
    // Keep the vector clipboard (like an OS clipboard) but restart the cascade so
    // the first paste on a fresh canvas lands right next to the pointer origin.
    pasteCascade = 0
    history.length = 0
    undoStack.length = 0
    redoStack.length = 0
    clearLaserStrokes()
    clearHitGridState()
    hitGridDirty = false
    objectEraserBatch = []
    objectEraserRemovedSet = new Set()
    objectEraserIndexSnapshot = null
    objectEraserLastProcessedPt = 0
    selectedActions.value = []
    marqueeRect.value = null
    draggingActions = []
    draggingSet = new Set()
    clearReshapeState()
    invalidateCache()
    currentAction.value = null
    previewAction.value = null
    useDragCanvas = false
    dragOffsetX = 0
    dragOffsetY = 0
    resetLineLockState()
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
      pruneSelection([action])
      undoStack.push({ type: 'remove', action, index })
      redoStack.length = 0
      invalidateCache()
      markHistoryStacksChanged()
      flushRender()
    }
  }

  function destroy() {
    resetLineLockState()
    if (rafId !== null) {
      cancelAnimationFrame(rafId)
      rafId = null
    }
    stopLaserAnimation()
    laserStrokes.length = 0
    laserWritingCanvas = null
    laserWritingCtx = null
    laserWritingBaked = 0
    cacheCanvas = null
    cacheCtx = null
    cacheAppliedDpr = 0
    cachedDpr = 0
    cachedDprCanvasW = 0
    cachedDprCssW = 0
    historyCtx = null
    previewCtx = null
    strokeCanvas = null
    strokeCtx = null
    inkComposeCanvas = null
    inkComposeCtx = null
    inkLiveAction = null
    inkTailPath = null
    dragCanvas = null
    dragCtx = null
    tempCanvas = null
    tempCtx = null
    objectEraserBatch = []
    objectEraserRemovedSet = new Set()
    objectEraserIndexSnapshot = null
    objectEraserLastProcessedPt = 0
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
    laserMode,
    setLaserMode,
    shapeDashStyle,
    setShapeDashStyle,
    cycleSelectedDashStyle,
    setSelectedColor,
    cycleSelectedColor,
    setSelectedLineWidth,
    nudgeSelected,
    isDrawing,
    /** True after a still hold locked the active pen/highlighter stroke to a line. */
    isStrokeLineLocked: () => strokeLineLocked,
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
      viewport: { w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio || 1 },
    }),
    startDraw,
    draw,
    drawBatch,
    endDraw,
    cancelDraw,
    findActionAt,
    findActionsInRect,
    removeAction,
    removeSelected,
    copySelection,
    pasteClipboard,
    hasCopiedActions,
    selectedActions,
    marqueeRect,
    clearSelection,
    setSelection,
    selectAll,
    areAllActionsSelected,
    toggleSelectAll,
    toggleInSelection,
    isActionSelected,
    findSelectedActionAt,
    setMarqueeRect,
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
    beginDragMany,
    updateDragOffset,
    endDrag,
    cancelDrag,
    findReshapeHandleAt,
    beginReshape,
    updateReshape,
    endReshape,
    cancelReshape,
    destroy,
    setAngleSnapStep,
    setInkTaper,
  }
}

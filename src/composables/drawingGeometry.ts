import type { DrawAction, Point } from './drawingTypes'
import { textOutlinePadding } from '../constants/textOutline'
import { stampBboxPad, stampRadius } from '../constants/stamp'
import { isNonSolidDashStyle } from '../constants/tools'
import {
  connectingQuadPoints,
  nodesFromSmoothedPoints,
  SWEPT_STYLE,
  usesPressureInk,
  type StylusNode,
} from '../constants/sweptStylus'
import type { EraserFootprint } from '../utils/eraserFootprint'

/** Rotate point `p` around `(cx, cy)` by `angle` radians. */
export function rotatePointAround(p: Point, cx: number, cy: number, angle: number): Point {
  if (!angle) return { x: p.x, y: p.y }
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  const dx = p.x - cx
  const dy = p.y - cy
  return { x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos }
}

export function rotatePointsInPlace(pts: Point[], cx: number, cy: number, angle: number): void {
  if (!angle || pts.length === 0) return
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  for (const pt of pts) {
    const dx = pt.x - cx
    const dy = pt.y - cy
    pt.x = cx + dx * cos - dy * sin
    pt.y = cy + dx * sin + dy * cos
  }
}

export function getShapeRotation(action: DrawAction): number {
  // Text and stamps rotate around their own frame centre, so they honor `rotation` too.
  if (action.tool !== 'rect' && action.tool !== 'ellipse' && action.tool !== 'text' && action.tool !== 'stamp') return 0
  const r = action.rotation
  return typeof r === 'number' && Number.isFinite(r) ? r : 0
}

/** Horizontal stretch of text / stamps (1 = natural aspect). */
export function actionStretchX(action: DrawAction): number {
  const s = action.stretchX
  return typeof s === 'number' && Number.isFinite(s) && s > 0 ? s : 1
}

/** Pen / highlighter stroke straightened by holding still (0.5s). */
export function isLockedInkAction(action: DrawAction): boolean {
  return (action.tool === 'pen' || action.tool === 'highlighter') && action.lockedLine === true
}

/**
 * A bent two-point path stores `[start, control, end]`; a straight one stores
 * `[start, end]`. Covers lines, arrows, and hold-locked ink strokes.
 */
export function isCurvedLinearAction(action: DrawAction): boolean {
  return (action.tool === 'line' || action.tool === 'arrow' || isLockedInkAction(action)) && action.points.length >= 3
}

/** Point on the quadratic Bézier `p0 → c → p1` at `t`. */
export function quadraticPoint(p0: Point, c: Point, p1: Point, t: number): Point {
  const u = 1 - t
  return {
    x: u * u * p0.x + 2 * u * t * c.x + t * t * p1.x,
    y: u * u * p0.y + 2 * u * t * c.y + t * t * p1.y,
  }
}

/**
 * Control point that makes the curve pass through `handle` at `t = 0.5`.
 * `B(0.5) = (p0 + 2c + p1) / 4`, so `c = 2 × handle − (p0 + p1) / 2`.
 */
export function quadraticControlFromHandle(p0: Point, p1: Point, handle: Point): Point {
  return {
    x: 2 * handle.x - (p0.x + p1.x) / 2,
    y: 2 * handle.y - (p0.y + p1.y) / 2,
  }
}

/** Tight axis-aligned bounds of a quadratic Bézier (endpoints + interior extrema). */
export function quadraticBounds(p0: Point, c: Point, p1: Point): { x0: number; y0: number; x1: number; y1: number } {
  let x0 = Math.min(p0.x, p1.x)
  let x1 = Math.max(p0.x, p1.x)
  let y0 = Math.min(p0.y, p1.y)
  let y1 = Math.max(p0.y, p1.y)

  const denX = p0.x - 2 * c.x + p1.x
  if (Math.abs(denX) > 1e-9) {
    const t = (p0.x - c.x) / denX
    if (t > 0 && t < 1) {
      const x = quadraticPoint(p0, c, p1, t).x
      x0 = Math.min(x0, x)
      x1 = Math.max(x1, x)
    }
  }

  const denY = p0.y - 2 * c.y + p1.y
  if (Math.abs(denY) > 1e-9) {
    const t = (p0.y - c.y) / denY
    if (t > 0 && t < 1) {
      const y = quadraticPoint(p0, c, p1, t).y
      y0 = Math.min(y0, y)
      y1 = Math.max(y1, y)
    }
  }

  return { x0, y0, x1, y1 }
}

/** Sample a quadratic Bézier into `segments + 1` points (inclusive endpoints). */
export function sampleQuadratic(p0: Point, c: Point, p1: Point, segments: number): Point[] {
  const count = Math.max(1, Math.floor(segments))
  const out: Point[] = []
  for (let i = 0; i <= count; i++) out.push(quadraticPoint(p0, c, p1, i / count))
  return out
}

/**
 * Bend handle position for a line/arrow: the curve midpoint when bent, the chord
 * midpoint when still straight. `null` for every other tool.
 */
export function curveBendPoint(action: DrawAction): Point | null {
  const linear = action.tool === 'line' || action.tool === 'arrow' || isLockedInkAction(action)
  if (!linear) return null
  const pts = action.points
  if (pts.length < 2) return null
  const p0 = pts[0]
  const p1 = pts[pts.length - 1]
  if (pts.length >= 3) return quadraticPoint(p0, pts[1], p1, 0.5)
  return { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 }
}

export function computeBbox(action: DrawAction, pad: number): DrawAction['bbox'] {
  const pts = action.points
  if (pts.length === 0) return undefined

  const rot = getShapeRotation(action)
  if (rot !== 0 && pts.length >= 2 && (action.tool === 'rect' || action.tool === 'ellipse')) {
    const x0 = Math.min(pts[0].x, pts[1].x)
    const y0 = Math.min(pts[0].y, pts[1].y)
    const x1 = Math.max(pts[0].x, pts[1].x)
    const y1 = Math.max(pts[0].y, pts[1].y)
    const cx = (x0 + x1) / 2
    const cy = (y0 + y1) / 2
    const corners = [
      rotatePointAround({ x: x0, y: y0 }, cx, cy, rot),
      rotatePointAround({ x: x1, y: y0 }, cx, cy, rot),
      rotatePointAround({ x: x1, y: y1 }, cx, cy, rot),
      rotatePointAround({ x: x0, y: y1 }, cx, cy, rot),
    ]
    let minX = corners[0].x
    let minY = corners[0].y
    let maxX = corners[0].x
    let maxY = corners[0].y
    for (let i = 1; i < corners.length; i++) {
      const c = corners[i]
      if (c.x < minX) minX = c.x
      if (c.y < minY) minY = c.y
      if (c.x > maxX) maxX = c.x
      if (c.y > maxY) maxY = c.y
    }
    return { x1: minX - pad, y1: minY - pad, x2: maxX + pad, y2: maxY + pad }
  }

  // Bent lines/arrows/locked ink: the control point is outside the visible curve,
  // so use the exact quadratic extrema instead of the control-polygon bounds.
  if (isCurvedLinearAction(action)) {
    const b = quadraticBounds(pts[0], pts[1], pts[pts.length - 1])
    return { x1: b.x0 - pad, y1: b.y0 - pad, x2: b.x1 + pad, y2: b.y1 + pad }
  }

  let x1 = pts[0].x,
    y1 = pts[0].y,
    x2 = pts[0].x,
    y2 = pts[0].y
  for (let i = 1; i < pts.length; i++) {
    if (pts[i].x < x1) x1 = pts[i].x
    if (pts[i].y < y1) y1 = pts[i].y
    if (pts[i].x > x2) x2 = pts[i].x
    if (pts[i].y > y2) y2 = pts[i].y
  }
  return { x1: x1 - pad, y1: y1 - pad, x2: x2 + pad, y2: y2 + pad }
}

type BoxBounds = { x1: number; y1: number; x2: number; y2: number }

/** World AABB of `box` after rotating it about (cx, cy) — picking must cover the paint. */
function rotatedBounds(box: BoxBounds, cx: number, cy: number, rot: number): BoxBounds {
  if (rot === 0) return box
  const corners = [
    rotatePointAround({ x: box.x1, y: box.y1 }, cx, cy, rot),
    rotatePointAround({ x: box.x2, y: box.y1 }, cx, cy, rot),
    rotatePointAround({ x: box.x2, y: box.y2 }, cx, cy, rot),
    rotatePointAround({ x: box.x1, y: box.y2 }, cx, cy, rot),
  ]
  let x1 = corners[0].x
  let y1 = corners[0].y
  let x2 = corners[0].x
  let y2 = corners[0].y
  for (let i = 1; i < corners.length; i++) {
    const c = corners[i]
    if (c.x < x1) x1 = c.x
    if (c.y < y1) y1 = c.y
    if (c.x > x2) x2 = c.x
    if (c.y > y2) y2 = c.y
  }
  return { x1, y1, x2, y2 }
}

/** Padded selection box in the text's local (unrotated) frame. */
function textPaddedBox(action: DrawAction): BoxBounds {
  const fs = action.fontSize ?? 24
  const lh = Math.round(fs * 1.3)
  const lineCount = Math.max(1, (action.text ?? '').split('\n').length)
  const outlinePad = textOutlinePadding(action.textOutline)
  const x = action.points[0].x
  const y = action.points[0].y
  const textWidth = action.textWidth ?? 200
  // Match drawText / TextBox: line i is centered at y + i*lh, so content spans
  // [y - lh/2, y - lh/2 + lineCount*lh]. The old y2 used +lineCount*lh + lh/2 and
  // left an extra blank line under the selection frame.
  const top = y - lh / 2
  const bottom = top + lineCount * lh

  return {
    x1: x - 10 - outlinePad,
    y1: top - 10 - outlinePad,
    x2: x + textWidth + 20 + outlinePad,
    y2: bottom + 10 + outlinePad,
  }
}

export function computeTextBbox(action: DrawAction): DrawAction['bbox'] {
  if (action.tool !== 'text' || action.points.length === 0) return undefined
  const ink = textInkBox(action)
  return rotatedBounds(textPaddedBox(action), (ink.x1 + ink.x2) / 2, (ink.y1 + ink.y2) / 2, getShapeRotation(action))
}

/** Padded selection box in the stamp's local (unrotated) frame. */
function stampPaddedBox(action: DrawAction): BoxBounds {
  const fs = action.fontSize ?? 24
  const r = stampRadius(fs, action.text ?? '')
  const pad = stampBboxPad(r)
  const rx = r * actionStretchX(action)
  const { x, y } = action.points[0]
  return { x1: x - rx - pad, y1: y - r - pad, x2: x + rx + pad, y2: y + r + pad }
}

export function computeStampBbox(action: DrawAction): DrawAction['bbox'] {
  if (action.tool !== 'stamp' || action.points.length === 0) return undefined
  const { x, y } = action.points[0]
  return rotatedBounds(stampPaddedBox(action), x, y, getShapeRotation(action))
}

export function bboxesIntersect(a: NonNullable<DrawAction['bbox']>, b: NonNullable<DrawAction['bbox']>) {
  return a.x1 <= b.x2 && a.x2 >= b.x1 && a.y1 <= b.y2 && a.y2 >= b.y1
}

export function cloneActionWithOffset(action: DrawAction, dx: number, dy: number): DrawAction {
  return {
    ...action,
    points: action.points.map((pt) => ({
      x: pt.x + dx,
      y: pt.y + dy,
      ...(pt.pressure != null ? { pressure: pt.pressure } : {}),
      ...(pt.t != null ? { t: pt.t } : {}),
    })),
    ...(action.rotation != null ? { rotation: action.rotation } : {}),
    // Style object is mutated in place by the outline controls — clones must own it.
    ...(action.textOutline ? { textOutline: { ...action.textOutline } } : {}),
    bbox: action.bbox
      ? {
          x1: action.bbox.x1 + dx,
          y1: action.bbox.y1 + dy,
          x2: action.bbox.x2 + dx,
          y2: action.bbox.y2 + dy,
        }
      : undefined,
    rectHit: action.rectHit
      ? {
          x0: action.rectHit.x0 + dx,
          y0: action.rectHit.y0 + dy,
          x1: action.rectHit.x1 + dx,
          y1: action.rectHit.y1 + dy,
        }
      : undefined,
    ellipseHit: action.ellipseHit
      ? {
          cx: action.ellipseHit.cx + dx,
          cy: action.ellipseHit.cy + dy,
          rx: action.ellipseHit.rx,
          ry: action.ellipseHit.ry,
        }
      : undefined,
    attachedErasers: action.attachedErasers?.map((ae) => cloneActionWithOffset(ae, dx, dy)),
  }
}

export function offsetAttachedErasers(action: DrawAction, dx: number, dy: number) {
  if (!action.attachedErasers?.length) return
  for (let i = 0; i < action.attachedErasers.length; i++) {
    action.attachedErasers[i] = cloneActionWithOffset(action.attachedErasers[i], dx, dy)
  }
}

export function updateShapeHitCache(action: DrawAction) {
  action.rectHit = undefined
  action.ellipseHit = undefined

  if (action.points.length < 2) return

  if (action.tool === 'rect') {
    action.rectHit = {
      x0: Math.min(action.points[0].x, action.points[1].x),
      y0: Math.min(action.points[0].y, action.points[1].y),
      x1: Math.max(action.points[0].x, action.points[1].x),
      y1: Math.max(action.points[0].y, action.points[1].y),
    }
    return
  }

  if (action.tool === 'ellipse') {
    action.ellipseHit = {
      cx: (action.points[0].x + action.points[1].x) / 2,
      cy: (action.points[0].y + action.points[1].y) / 2,
      rx: Math.abs(action.points[1].x - action.points[0].x) / 2,
      ry: Math.abs(action.points[1].y - action.points[0].y) / 2,
    }
  }
}

export function distToSeg(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax,
    dy = by - ay
  const l2 = dx * dx + dy * dy
  if (l2 === 0) return Math.hypot(px - ax, py - ay)
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2))
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}

export function distancePointToSegment(p: Point, a: Point, b: Point): number {
  return distToSeg(p.x, p.y, a.x, a.y, b.x, b.y)
}

export function snapPointToAngle(start: Point, raw: Point, stepDegrees = 15): Point {
  const dx = raw.x - start.x
  const dy = raw.y - start.y
  const length = Math.hypot(dx, dy)
  if (length === 0) return { ...raw }

  const safeStep = Number.isFinite(stepDegrees) && stepDegrees > 0 ? stepDegrees : 15
  const step = (Math.PI / 180) * safeStep
  const snappedAngle = Math.round(Math.atan2(dy, dx) / step) * step
  return {
    x: start.x + Math.cos(snappedAngle) * length,
    y: start.y + Math.sin(snappedAngle) * length,
  }
}

/**
 * Diagonal corners of an axis-aligned circle grown from `center` toward `pointer`.
 * Radius is the Euclidean distance so the rim tracks the cursor.
 */
export function perfectCircleCornersFromCenter(center: Point, pointer: Point): { start: Point; end: Point } {
  const r = Math.hypot(pointer.x - center.x, pointer.y - center.y)
  return {
    start: { x: center.x - r, y: center.y - r },
    end: { x: center.x + r, y: center.y + r },
  }
}

export function hitTestAction(action: DrawAction, p: Point, extraMargin = 0): boolean {
  const pts = action.points
  if (pts.length === 0) return false

  const bbox = action.bbox
  if (bbox) {
    const m = extraMargin
    if (p.x < bbox.x1 - m || p.x > bbox.x2 + m || p.y < bbox.y1 - m || p.y > bbox.y2 + m) return false
  }

  const threshold = Math.max(10, (action.lineWidth || 2) / 2 + 5) + extraMargin

  if (action.tool === 'text' && action.text) {
    if (action.points.length === 0) return false
    const textBox = textPaddedBox(action)
    const rot = getShapeRotation(action)
    // Rotate the probe into the text's local frame (the frame centre is the render pivot).
    const ink = textInkBox(action)
    const probe = rot !== 0 ? rotatePointAround(p, (ink.x1 + ink.x2) / 2, (ink.y1 + ink.y2) / 2, -rot) : p
    return probe.x >= textBox.x1 && probe.x <= textBox.x2 && probe.y >= textBox.y1 && probe.y <= textBox.y2
  }

  if (action.tool === 'stamp' && action.text) {
    const fs = action.fontSize ?? 24
    const r = stampRadius(fs, action.text)
    const rot = getShapeRotation(action)
    const { x, y } = pts[0]
    const local = rot !== 0 ? rotatePointAround(p, x, y, -rot) : p
    const rx = r * actionStretchX(action) + extraMargin
    const ry = r + extraMargin
    const dx = local.x - x
    const dy = local.y - y
    return (dx * dx) / (rx * rx) + (dy * dy) / (ry * ry) <= 1
  }

  if (action.tool === 'pen' || action.tool === 'highlighter') {
    // Variable-width ink can exceed lineWidth/2; keep a slightly generous hit radius.
    const inkThreshold = Math.max(10, action.lineWidth * 0.65 + 5) + extraMargin
    if (isCurvedLinearAction(action)) {
      const samples = sampleQuadratic(pts[0], pts[1], pts[pts.length - 1], 24)
      for (let j = 0; j < samples.length - 1; j++) {
        if (distToSeg(p.x, p.y, samples[j].x, samples[j].y, samples[j + 1].x, samples[j + 1].y) <= inkThreshold) {
          return true
        }
      }
      return false
    }
    if (pts.length === 1) {
      if (Math.hypot(p.x - pts[0].x, p.y - pts[0].y) <= inkThreshold) return true
    } else {
      for (let j = 0, end = pts.length - 1; j < end; j++) {
        if (distToSeg(p.x, p.y, pts[j].x, pts[j].y, pts[j + 1].x, pts[j + 1].y) <= inkThreshold) return true
      }
    }
    return false
  }

  if (action.tool === 'line' || action.tool === 'arrow') {
    if (isCurvedLinearAction(action)) {
      const samples = sampleQuadratic(pts[0], pts[1], pts[pts.length - 1], 24)
      for (let j = 0; j < samples.length - 1; j++) {
        if (distToSeg(p.x, p.y, samples[j].x, samples[j].y, samples[j + 1].x, samples[j + 1].y) <= threshold) {
          return true
        }
      }
      return false
    }
    if (pts.length >= 2) {
      if (distancePointToSegment(p, pts[0], pts[1]) <= threshold) return true
    }
    return false
  }

  if (action.tool === 'rect') {
    if (pts.length >= 2) {
      const rect = action.rectHit ?? {
        x0: Math.min(pts[0].x, pts[1].x),
        y0: Math.min(pts[0].y, pts[1].y),
        x1: Math.max(pts[0].x, pts[1].x),
        y1: Math.max(pts[0].y, pts[1].y),
      }
      const rot = getShapeRotation(action)
      const cx = (rect.x0 + rect.x1) / 2
      const cy = (rect.y0 + rect.y1) / 2
      const local = rot !== 0 ? rotatePointAround(p, cx, cy, -rot) : p

      const d1 = distToSeg(local.x, local.y, rect.x0, rect.y0, rect.x1, rect.y0)
      const d2 = distToSeg(local.x, local.y, rect.x1, rect.y0, rect.x1, rect.y1)
      const d3 = distToSeg(local.x, local.y, rect.x1, rect.y1, rect.x0, rect.y1)
      const d4 = distToSeg(local.x, local.y, rect.x0, rect.y1, rect.x0, rect.y0)

      if (Math.min(d1, d2, d3, d4) <= threshold) return true
    }
    return false
  }

  if (action.tool === 'ellipse') {
    if (pts.length >= 2) {
      const ellipse = action.ellipseHit ?? {
        cx: (pts[0].x + pts[1].x) / 2,
        cy: (pts[0].y + pts[1].y) / 2,
        rx: Math.abs(pts[1].x - pts[0].x) / 2,
        ry: Math.abs(pts[1].y - pts[0].y) / 2,
      }
      const rot = getShapeRotation(action)
      const local = rot !== 0 ? rotatePointAround(p, ellipse.cx, ellipse.cy, -rot) : p

      if (ellipse.rx < 1 || ellipse.ry < 1) {
        return Math.hypot(local.x - ellipse.cx, local.y - ellipse.cy) <= threshold
      }

      if (
        local.x < ellipse.cx - ellipse.rx - threshold ||
        local.x > ellipse.cx + ellipse.rx + threshold ||
        local.y < ellipse.cy - ellipse.ry - threshold ||
        local.y > ellipse.cy + ellipse.ry + threshold
      )
        return false

      let minDist = Infinity
      for (let j = 0; j < 32; j++) {
        const angle = (j / 32) * Math.PI * 2
        const px = ellipse.cx + ellipse.rx * Math.cos(angle)
        const py = ellipse.cy + ellipse.ry * Math.sin(angle)
        const dist = Math.hypot(local.x - px, local.y - py)
        if (dist < minDist) minDist = dist
      }
      return minDist <= threshold
    }
  }

  return false
}

/**
 * Bent ink is already a mathematically smooth curve. Position smoothing would
 * lag it behind the bend handle, so only the pressure EMA stays enabled.
 */
export const CURVED_INK_STYLE = { ...SWEPT_STYLE, positionStreamline: 0 }

/**
 * Sample a bent hold-locked ink stroke into a polyline for the swept ribbon.
 * Every sample keeps the stroke's frozen pressure so the width stays uniform.
 */
export function curvedInkPoints(action: DrawAction): Point[] {
  const pts = action.points
  const p0 = pts[0]
  const c = pts[1]
  const p1 = pts[pts.length - 1]
  const chord = Math.hypot(c.x - p0.x, c.y - p0.y) + Math.hypot(p1.x - c.x, p1.y - c.y)
  const segments = Math.max(16, Math.min(64, Math.ceil(chord / 4)))
  const pressure = p0.pressure
  return sampleQuadratic(p0, c, p1, segments).map((p) => (pressure != null ? { ...p, pressure } : p))
}

interface InkNodeCacheEntry {
  /** Sample array the nodes were built from (replaced by drag/undo/lock edits). */
  points: Point[]
  count: number
  startX: number
  startY: number
  /** Bend control point of a 3-point stroke — mutated in place by the bend handle. */
  middleX: number
  middleY: number
  endX: number
  endY: number
  /** Painted radius inputs: a width edit repaints the ink without touching the points. */
  lineWidth: number
  pointerType: string | undefined
  tool: DrawAction['tool']
  dashStyle: DrawAction['dashStyle']
  nodes: StylusNode[]
}

const inkNodeCache = new WeakMap<DrawAction, InkNodeCacheEntry>()

/**
 * True when `entry` still describes `action`'s painted ink.
 *
 * Every input the ribbon depends on is compared: replacing or appending to the sample
 * array, editing a width preset / pressure source, or dragging the bend control point
 * repaints the ink, and a stale radius would move the eraser's contact point off the
 * glyph edge.
 */
function inkCacheMatches(entry: InkNodeCacheEntry | undefined, action: DrawAction): entry is InkNodeCacheEntry {
  if (!entry) return false
  const pts = action.points
  if (entry.points !== pts || pts.length !== entry.count) return false
  if (
    action.lineWidth !== entry.lineWidth ||
    action.pointerType !== entry.pointerType ||
    action.tool !== entry.tool ||
    action.dashStyle !== entry.dashStyle
  ) {
    return false
  }
  const first = pts[0]
  const last = pts[pts.length - 1]
  if (first.x !== entry.startX || first.y !== entry.startY || last.x !== entry.endX || last.y !== entry.endY) {
    return false
  }
  if (pts.length === 3 && (pts[1].x !== entry.middleX || pts[1].y !== entry.middleY)) return false
  return true
}

/**
 * The swept ribbon the renderer fills for solid pen / highlighter ink.
 *
 * `buildInkPath` does **not** paint the stored samples: positions go through a
 * 0.65 EMA and sharp turns are replaced by rounded corners. On a fast, tight curve —
 * the loop of a hand-drawn "6" — the painted ribbon therefore sits up to ~6px *inside*
 * the stored polyline. Hit-testing the samples erases early on the inside of a curve
 * and late on the outside, which is exactly the shape-dependent error the eraser shows.
 * So the eraser has to use the same nodes the renderer fills.
 *
 * Returns `null` for tools that are stroked directly from their geometry (dashed pen,
 * line, arrow, rect, ellipse, text, stamp) — their ink is not a swept ribbon.
 */
export function actionInkNodes(action: DrawAction): StylusNode[] | null {
  const solidRibbon = action.tool === 'highlighter' || (action.tool === 'pen' && !isNonSolidDashStyle(action.dashStyle))
  if (!solidRibbon) return null
  const pts = action.points
  if (pts.length < 2) return null

  const cached = inkNodeCache.get(action)
  if (inkCacheMatches(cached, action)) return cached.nodes

  const points = isCurvedLinearAction(action) ? curvedInkPoints(action) : pts
  const nodes = nodesFromSmoothedPoints(
    points,
    action.lineWidth,
    isCurvedLinearAction(action) ? CURVED_INK_STYLE : SWEPT_STYLE,
    action.pointerType,
  )

  const first = pts[0]
  const last = pts[pts.length - 1]
  inkNodeCache.set(action, {
    points: pts,
    count: pts.length,
    startX: first.x,
    startY: first.y,
    middleX: pts.length === 3 ? pts[1].x : 0,
    middleY: pts.length === 3 ? pts[1].y : 0,
    endX: last.x,
    endY: last.y,
    lineWidth: action.lineWidth,
    pointerType: action.pointerType,
    tool: action.tool,
    dashStyle: action.dashStyle,
    nodes,
  })
  return nodes
}

/**
 * How far the *paint* reaches beside an action's centreline.
 *
 * Solid pen / highlighter ink is a swept ribbon whose radius peaks at
 * `pressureFloor + pressureRange` × `lineWidth / 2` on pressure devices; every
 * other tool strokes a constant `lineWidth` band, i.e. `lineWidth / 2` per side.
 * Dashed pen ink is stroked with `lineWidth` as well, so it keeps the constant width.
 */
export function inkHalfWidth(action: DrawAction): number {
  const w = Math.max(1, action.lineWidth || 0)
  const pressureInk =
    action.tool === 'pen' && !isNonSolidDashStyle(action.dashStyle) && usesPressureInk(action.pointerType)
  return pressureInk ? (w / 2) * (SWEPT_STYLE.pressureFloor + SWEPT_STYLE.pressureRange) : w / 2
}

/**
 * Outline sample count for a disc / ellipse, dense enough to keep the chord error under ~0.1px
 * (large radii need more segments than small ones for the same accuracy).
 */
function ellipseRingSegments(rx: number, ry: number): number {
  const perimeter = Math.PI * (3 * (rx + ry) - Math.sqrt((3 * rx + ry) * (rx + 3 * ry)))
  return Math.min(256, Math.max(48, Math.ceil(perimeter / 6)))
}

/**
 * Quadratic Bézier sample count that keeps the chord error under ~0.1px
 * (long curves need more segments than short ones for the same accuracy).
 */
function curveSampleCount(p0: Point, control: Point, p1: Point): number {
  const length = Math.hypot(control.x - p0.x, control.y - p0.y) + Math.hypot(p1.x - control.x, p1.y - control.y)
  return Math.min(96, Math.max(16, Math.ceil(length / 6)))
}

/** Signed area cross product of `a → b` and `a → p`; sign tells which side `p` is on. */
function crossSign(a: Point, b: Point, p: Point): number {
  return (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)
}

/** True when `p` lies inside (or on) a convex polygon of either winding. */
export function pointInConvexPolygon(p: Point, polygon: readonly Point[]): boolean {
  let positive = false
  let negative = false
  for (let i = 0; i < polygon.length; i++) {
    const sign = crossSign(polygon[i], polygon[(i + 1) % polygon.length], p)
    if (sign > 0) positive = true
    else if (sign < 0) negative = true
    if (positive && negative) return false
  }
  return true
}

/** Distance from `p` to a convex polygon; 0 when inside. */
export function distancePointToConvexPolygon(p: Point, polygon: readonly Point[]): number {
  if (pointInConvexPolygon(p, polygon)) return 0
  let min = Infinity
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i]
    const b = polygon[(i + 1) % polygon.length]
    const d = distToSeg(p.x, p.y, a.x, a.y, b.x, b.y)
    if (d < min) min = d
  }
  return min
}

/** True when the segments `a–b` and `c–d` share at least one point. */
function segmentsIntersect(a: Point, b: Point, c: Point, d: Point): boolean {
  if (Math.max(a.x, b.x) < Math.min(c.x, d.x) || Math.max(c.x, d.x) < Math.min(a.x, b.x)) return false
  if (Math.max(a.y, b.y) < Math.min(c.y, d.y) || Math.max(c.y, d.y) < Math.min(a.y, b.y)) return false
  return crossSign(a, b, c) * crossSign(a, b, d) <= 0 && crossSign(c, d, a) * crossSign(c, d, b) <= 0
}

/** Distance from the segment `a–b` to a convex polygon; 0 when they touch. */
export function distanceSegmentToConvexPolygon(a: Point, b: Point, polygon: readonly Point[]): number {
  for (let i = 0; i < polygon.length; i++) {
    if (segmentsIntersect(a, b, polygon[i], polygon[(i + 1) % polygon.length])) return 0
  }
  let min = Math.min(distancePointToConvexPolygon(a, polygon), distancePointToConvexPolygon(b, polygon))
  // A closest pair of two disjoint convex shapes always includes a vertex of one of them.
  for (const v of polygon) {
    const d = distToSeg(v.x, v.y, a.x, a.y, b.x, b.y)
    if (d < min) min = d
  }
  return min
}

/** Separating-axis test: true when the two convex polygons share any area (touching counts). */
export function convexPolygonsOverlap(a: readonly Point[], b: readonly Point[]): boolean {
  return !hasSeparatingAxis(a, b) && !hasSeparatingAxis(b, a)
}

function hasSeparatingAxis(edgeOwner: readonly Point[], other: readonly Point[]): boolean {
  for (let i = 0; i < edgeOwner.length; i++) {
    const p1 = edgeOwner[i]
    const p2 = edgeOwner[(i + 1) % edgeOwner.length]
    const nx = p2.y - p1.y
    const ny = p1.x - p2.x
    let minA = Infinity
    let maxA = -Infinity
    for (const v of edgeOwner) {
      const d = v.x * nx + v.y * ny
      if (d < minA) minA = d
      if (d > maxA) maxA = d
    }
    let minB = Infinity
    let maxB = -Infinity
    for (const v of other) {
      const d = v.x * nx + v.y * ny
      if (d < minB) minB = d
      if (d > maxB) maxB = d
    }
    if (maxA < minB || maxB < minA) return true
  }
  return false
}

/** Distance between two convex polygons; 0 when they overlap. */
export function distanceConvexPolygons(a: readonly Point[], b: readonly Point[]): number {
  if (convexPolygonsOverlap(a, b)) return 0
  // Disjoint convex shapes: the closest pair always includes a vertex of one of them.
  let min = Infinity
  for (const v of a) min = Math.min(min, distancePointToConvexPolygon(v, b))
  for (const v of b) min = Math.min(min, distancePointToConvexPolygon(v, a))
  return min
}

/** Glyph extents of a text action — the selection frame pads 10–20px more. */
export function textInkBox(action: DrawAction): { x1: number; y1: number; x2: number; y2: number } {
  const pts = action.points
  const fs = action.fontSize ?? 24
  const lineHeight = Math.round(fs * 1.3)
  const lines = Math.max(1, (action.text ?? '').split('\n').length)
  const left = pts[0].x + 2 // drawText starts the glyphs 2px right of the anchor
  const top = pts[0].y - lineHeight / 2
  return { x1: left, y1: top, x2: left + (action.textWidth ?? 200), y2: top + lines * lineHeight }
}

/** Outer disc extents of a stamp action (ring included, no shadow padding). */
export function stampInkBox(action: DrawAction): { x1: number; y1: number; x2: number; y2: number } {
  const { x, y } = action.points[0] ?? { x: 0, y: 0 }
  const r = stampRadius(action.fontSize ?? 24, action.text ?? '')
  const rx = r * actionStretchX(action)
  return { x1: x - rx, y1: y - r, x2: x + rx, y2: y + r }
}

/**
 * True when the eraser footprint — the glyph body the user sees — overlaps an action's
 * paint.
 *
 * {@link hitTestAction} pads every threshold so thin strokes stay clickable with a
 * mouse; that padding is 10–15px too generous to drive an eraser with, because the
 * eraser would start removing a stroke while its own glyph is still far away. This test
 * compares the *paint itself* against the footprint, so erasing starts when the visible
 * eraser glyph — stroke plus its AA/shadow halo — touches the ink.
 */
export function hitTestActionWithFootprint(action: DrawAction, footprint: EraserFootprint): boolean {
  const pts = action.points
  if (pts.length === 0) return false

  const polygon = footprint.polygon
  const half = inkHalfWidth(action)
  // Ink reaches `half` past the centreline, paint reaches `expand` past the body outline.
  const reach = footprint.expand + half

  const bbox = action.bbox
  const bounds = footprint.bounds
  if (
    bbox &&
    (bbox.x2 + half < bounds.x1 ||
      bbox.x1 - half > bounds.x2 ||
      bbox.y2 + half < bounds.y1 ||
      bbox.y1 - half > bounds.y2)
  ) {
    return false
  }

  switch (action.tool) {
    case 'text': {
      const box = textInkBox(action)
      const rot = getShapeRotation(action)
      const cx = (box.x1 + box.x2) / 2
      const cy = (box.y1 + box.y2) / 2
      const local = rot !== 0 ? polygon.map((v) => rotatePointAround(v, cx, cy, -rot)) : polygon
      const corners = [
        { x: box.x1, y: box.y1 },
        { x: box.x2, y: box.y1 },
        { x: box.x2, y: box.y2 },
        { x: box.x1, y: box.y2 },
      ]
      return distanceConvexPolygons(local, corners) <= footprint.expand
    }
    case 'stamp': {
      const fs = action.fontSize ?? 24
      const r = stampRadius(fs, action.text ?? '')
      const rx = r * actionStretchX(action)
      const ry = r
      const rot = getShapeRotation(action)
      const { x, y } = pts[0]
      const local = rot !== 0 ? polygon.map((v) => rotatePointAround(v, x, y, -rot)) : polygon
      if (rx < 1e-6 || ry < 1e-6) return distancePointToConvexPolygon({ x, y }, local) <= footprint.expand
      // The disc is filled: a footprint parked inside it erases even without touching the rim.
      const inside = (p: Point) => {
        const ex = (p.x - x) / rx
        const ey = (p.y - y) / ry
        return ex * ex + ey * ey <= 1
      }
      if (local.some(inside)) return true
      // Ellipse is not a polygon: sample its outline, then compare with the footprint.
      const segments = ellipseRingSegments(rx, ry)
      let previous = { x: x + rx, y }
      for (let i = 1; i <= segments; i++) {
        const angle = (i / segments) * Math.PI * 2
        const next = { x: x + rx * Math.cos(angle), y: y + ry * Math.sin(angle) }
        if (distanceSegmentToConvexPolygon(previous, next, local) <= footprint.expand) return true
        previous = next
      }
      return false
    }
    case 'pen':
    case 'highlighter': {
      const ink = actionInkNodes(action)
      if (ink) {
        // Solid ink is the swept ribbon: node discs stitched together by their
        // connecting hulls, exactly what `buildInkPath` fills.
        for (let i = 0; i < ink.length; i++) {
          const node = ink[i]
          const next = i + 1 < ink.length ? ink[i + 1] : null
          const r = Math.max(node.r, next ? next.r : node.r) + footprint.expand
          const x1 = Math.min(node.x, next ? next.x : node.x) - r
          const x2 = Math.max(node.x, next ? next.x : node.x) + r
          const y1 = Math.min(node.y, next ? next.y : node.y) - r
          const y2 = Math.max(node.y, next ? next.y : node.y) + r
          if (x2 < bounds.x1 || x1 > bounds.x2 || y2 < bounds.y1 || y1 > bounds.y2) continue
          if (distancePointToConvexPolygon(node, polygon) <= node.r + footprint.expand) return true
          if (next) {
            const quad = connectingQuadPoints(node, next)
            if (quad && distanceConvexPolygons(quad, polygon) <= footprint.expand) return true
          }
        }
        return false
      }
      // Bent (hold-locked) ink is painted as one quadratic curve, so its centreline is
      // the curve — not the `p0 → control → p1` polygon the samples describe. Testing
      // the polygon would erase at the bend handle and miss the painted curve.
      if (isCurvedLinearAction(action)) {
        const p0 = pts[0]
        const control = pts[1]
        const p1 = pts[pts.length - 1]
        const samples = sampleQuadratic(p0, control, p1, curveSampleCount(p0, control, p1))
        for (let i = 0; i < samples.length - 1; i++) {
          if (distanceSegmentToConvexPolygon(samples[i], samples[i + 1], polygon) <= reach) return true
        }
        return false
      }
      // Straight dashed pen is stroked along the stored samples (`drawFreehand`).
      if (pts.length === 1) return distancePointToConvexPolygon(pts[0], polygon) <= reach
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i]
        const b = pts[i + 1]
        if (Math.min(a.x, b.x) - half > bounds.x2 || Math.max(a.x, b.x) + half < bounds.x1) continue
        if (Math.min(a.y, b.y) - half > bounds.y2 || Math.max(a.y, b.y) + half < bounds.y1) continue
        if (distanceSegmentToConvexPolygon(a, b, polygon) <= reach) return true
      }
      return false
    }
    case 'line':
    case 'arrow': {
      if (isCurvedLinearAction(action)) {
        const p0 = pts[0]
        const control = pts[1]
        const p1 = pts[pts.length - 1]
        const samples = sampleQuadratic(p0, control, p1, curveSampleCount(p0, control, p1))
        for (let i = 0; i < samples.length - 1; i++) {
          if (distanceSegmentToConvexPolygon(samples[i], samples[i + 1], polygon) <= reach) return true
        }
        return false
      }
      if (pts.length === 1) return distancePointToConvexPolygon(pts[0], polygon) <= reach
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i]
        const b = pts[i + 1]
        // Cheap reject first: long strokes carry thousands of 1–2px segments and only
        // the few inside the footprint can touch it.
        if (Math.min(a.x, b.x) - half > bounds.x2 || Math.max(a.x, b.x) + half < bounds.x1) continue
        if (Math.min(a.y, b.y) - half > bounds.y2 || Math.max(a.y, b.y) + half < bounds.y1) continue
        if (distanceSegmentToConvexPolygon(a, b, polygon) <= reach) return true
      }
      return false
    }
    case 'rect': {
      if (pts.length < 2) return false
      const rect = action.rectHit ?? {
        x0: Math.min(pts[0].x, pts[1].x),
        y0: Math.min(pts[0].y, pts[1].y),
        x1: Math.max(pts[0].x, pts[1].x),
        y1: Math.max(pts[0].y, pts[1].y),
      }
      const rot = getShapeRotation(action)
      // The footprint is a polygon, so rotate it into the shape's frame instead of the
      // probe point; rotation keeps distances intact.
      const cx = (rect.x0 + rect.x1) / 2
      const cy = (rect.y0 + rect.y1) / 2
      const local = rot !== 0 ? polygon.map((v) => rotatePointAround(v, cx, cy, -rot)) : polygon
      const corners = [
        { x: rect.x0, y: rect.y0 },
        { x: rect.x1, y: rect.y0 },
        { x: rect.x1, y: rect.y1 },
        { x: rect.x0, y: rect.y1 },
      ]
      for (let i = 0; i < corners.length; i++) {
        if (distanceSegmentToConvexPolygon(corners[i], corners[(i + 1) % corners.length], local) <= reach) {
          return true
        }
      }
      return false
    }
    case 'ellipse': {
      if (pts.length < 2) return false
      const ellipse = action.ellipseHit ?? {
        cx: (pts[0].x + pts[1].x) / 2,
        cy: (pts[0].y + pts[1].y) / 2,
        rx: Math.abs(pts[1].x - pts[0].x) / 2,
        ry: Math.abs(pts[1].y - pts[0].y) / 2,
      }
      const rot = getShapeRotation(action)
      const local = rot !== 0 ? polygon.map((v) => rotatePointAround(v, ellipse.cx, ellipse.cy, -rot)) : polygon
      if (ellipse.rx < 1 || ellipse.ry < 1) {
        return distancePointToConvexPolygon({ x: ellipse.cx, y: ellipse.cy }, local) <= reach
      }
      // Dense outline sampling: an eraser cannot tolerate the few-pixel chord error a
      // fixed 32-segment ring produces on a large ellipse.
      const { rx, ry } = ellipse
      const segments = ellipseRingSegments(rx, ry)
      let previous = { x: ellipse.cx + rx, y: ellipse.cy }
      for (let i = 1; i <= segments; i++) {
        const angle = (i / segments) * Math.PI * 2
        const next = { x: ellipse.cx + rx * Math.cos(angle), y: ellipse.cy + ry * Math.sin(angle) }
        if (distanceSegmentToConvexPolygon(previous, next, local) <= reach) return true
        previous = next
      }
      return false
    }
    default:
      return false
  }
}

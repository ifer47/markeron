import type { DrawAction, Point } from './drawingTypes'
import { textOutlinePadding } from '../constants/textOutline'
import { stampBboxPad, stampRadius } from '../constants/stamp'

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
  if (action.tool !== 'rect' && action.tool !== 'ellipse') return 0
  const r = action.rotation
  return typeof r === 'number' && Number.isFinite(r) ? r : 0
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

export function computeTextBbox(action: DrawAction): DrawAction['bbox'] {
  if (action.tool !== 'text' || action.points.length === 0) return undefined
  const fs = action.fontSize ?? 24
  const lh = Math.round(fs * 1.3)
  const lines = (action.text ?? '').split('\n')
  const lineCount = Math.max(1, lines.length)
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

export function computeStampBbox(action: DrawAction): DrawAction['bbox'] {
  if (action.tool !== 'stamp' || action.points.length === 0) return undefined
  const fs = action.fontSize ?? 24
  const label = action.text ?? ''
  const r = stampRadius(fs, label)
  const pad = stampBboxPad(r)
  const { x, y } = action.points[0]
  return { x1: x - r - pad, y1: y - r - pad, x2: x + r + pad, y2: y + r + pad }
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
    const textBox = computeTextBbox(action)
    return !!textBox && p.x >= textBox.x1 && p.x <= textBox.x2 && p.y >= textBox.y1 && p.y <= textBox.y2
  }

  if (action.tool === 'stamp' && action.text) {
    const fs = action.fontSize ?? 24
    const r = stampRadius(fs, action.text) + extraMargin
    return Math.hypot(p.x - pts[0].x, p.y - pts[0].y) <= r
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

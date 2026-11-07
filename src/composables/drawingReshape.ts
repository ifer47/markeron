import type { DrawAction, Point, Tool } from './drawingTypes'
import { snapPointToAngle } from './drawingGeometry'

export type ReshapeHandleId = 'p0' | 'p1' | 'tl' | 'tr' | 'br' | 'bl'

export interface ReshapeHandle {
  id: ReshapeHandleId
  x: number
  y: number
  /** CSS cursor while hovering / dragging this handle. */
  cursor: string
}

export type ReshapeBounds = { x0: number; y0: number; x1: number; y1: number }

export interface ReshapeApplyOptions {
  /** Shift held: aspect lock for corners, angle snap for line/arrow endpoints. */
  constrain?: boolean
  /** width/height at gesture start (corners only). */
  originAspect?: number
  /** Bounds at gesture start — corner/ink transforms are computed from this box. */
  originBounds?: ReshapeBounds
  /** Degrees; used when constraining line/arrow endpoints. */
  angleSnapStep?: number
}

/** Hit radius in CSS pixels — larger than typical stroke hit so handles win over move. */
export const RESHAPE_HANDLE_HIT_RADIUS = 10

/** Visual half-size of the square handle (CSS px). */
export const RESHAPE_HANDLE_HALF = 4

/** Minimum bbox edge after ink/corner scale so the stroke does not collapse. */
export const RESHAPE_MIN_SIZE = 1

export function isInkReshapeTool(tool: Tool): boolean {
  return tool === 'pen' || tool === 'highlighter'
}

export function isReshapeableTool(tool: Tool): boolean {
  return tool === 'line' || tool === 'arrow' || tool === 'rect' || tool === 'ellipse' || isInkReshapeTool(tool)
}

export function isCornerHandleId(id: ReshapeHandleId): boolean {
  return id === 'tl' || id === 'tr' || id === 'br' || id === 'bl'
}

export function getPointsBounds(pts: Point[]): ReshapeBounds | null {
  if (pts.length === 0) return null
  let x0 = pts[0].x
  let y0 = pts[0].y
  let x1 = pts[0].x
  let y1 = pts[0].y
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i]
    if (p.x < x0) x0 = p.x
    if (p.y < y0) y0 = p.y
    if (p.x > x1) x1 = p.x
    if (p.y > y1) y1 = p.y
  }
  return { x0, y0, x1, y1 }
}

/** Axis-aligned bounds used for corner handles / aspect lock. */
export function getActionReshapeBounds(action: DrawAction): ReshapeBounds | null {
  const pts = action.points
  if (pts.length < 2) return null
  if (action.tool === 'line' || action.tool === 'arrow') {
    return getPointsBounds(pts)
  }
  if (isInkReshapeTool(action.tool)) {
    return getPointsBounds(pts)
  }
  // rect / ellipse — diagonal points
  return {
    x0: Math.min(pts[0].x, pts[1].x),
    y0: Math.min(pts[0].y, pts[1].y),
    x1: Math.max(pts[0].x, pts[1].x),
    y1: Math.max(pts[0].y, pts[1].y),
  }
}

export function aspectRatioOfBounds(b: ReshapeBounds): number {
  const w = Math.max(RESHAPE_MIN_SIZE, b.x1 - b.x0)
  const h = Math.max(RESHAPE_MIN_SIZE, b.y1 - b.y0)
  return w / h
}

function cornerHandles(x0: number, y0: number, x1: number, y1: number): ReshapeHandle[] {
  return [
    { id: 'tl', x: x0, y: y0, cursor: 'nwse-resize' },
    { id: 'tr', x: x1, y: y0, cursor: 'nesw-resize' },
    { id: 'br', x: x1, y: y1, cursor: 'nwse-resize' },
    { id: 'bl', x: x0, y: y1, cursor: 'nesw-resize' },
  ]
}

export function oppositeCorner(bounds: ReshapeBounds, handleId: ReshapeHandleId): Point {
  switch (handleId) {
    case 'tl':
      return { x: bounds.x1, y: bounds.y1 }
    case 'tr':
      return { x: bounds.x0, y: bounds.y1 }
    case 'br':
      return { x: bounds.x0, y: bounds.y0 }
    case 'bl':
      return { x: bounds.x1, y: bounds.y0 }
    default:
      return { x: bounds.x0, y: bounds.y0 }
  }
}

/**
 * Uniform scale from `fixed` toward `raw` so width/height = `aspect` (w/h).
 * Uses the larger of the two axis scales so the pointer stays outside the box.
 */
export function aspectLockedFreePoint(fixed: Point, raw: Point, aspect: number): Point {
  const a = aspect > 0 && Number.isFinite(aspect) ? aspect : 1
  const dx = raw.x - fixed.x
  const dy = raw.y - fixed.y
  const signX = dx < 0 ? -1 : 1
  const signY = dy < 0 ? -1 : 1
  const scaleW = Math.abs(dx) / a
  const scaleH = Math.abs(dy)
  const h = Math.max(RESHAPE_MIN_SIZE, scaleW, scaleH)
  const w = h * a
  return {
    x: fixed.x + signX * w,
    y: fixed.y + signY * h,
  }
}

/**
 * New axis-aligned box after dragging `handleId` to `p`.
 * The opposite corner of `from` stays fixed even if the pointer crosses it;
 * min-size expands away from that fixed corner (avoids jumping the anchor).
 */
export function boundsAfterCornerDrag(from: ReshapeBounds, handleId: ReshapeHandleId, p: Point): ReshapeBounds {
  if (!isCornerHandleId(handleId)) return { ...from }

  const fixed = oppositeCorner(from, handleId)
  let x0 = Math.min(fixed.x, p.x)
  let y0 = Math.min(fixed.y, p.y)
  let x1 = Math.max(fixed.x, p.x)
  let y1 = Math.max(fixed.y, p.y)

  if (x1 - x0 < RESHAPE_MIN_SIZE) {
    if (p.x >= fixed.x) {
      x0 = fixed.x
      x1 = fixed.x + RESHAPE_MIN_SIZE
    } else {
      x1 = fixed.x
      x0 = fixed.x - RESHAPE_MIN_SIZE
    }
  }
  if (y1 - y0 < RESHAPE_MIN_SIZE) {
    if (p.y >= fixed.y) {
      y0 = fixed.y
      y1 = fixed.y + RESHAPE_MIN_SIZE
    } else {
      y1 = fixed.y
      y0 = fixed.y - RESHAPE_MIN_SIZE
    }
  }
  return { x0, y0, x1, y1 }
}

export function scalePointsToBounds(pts: Point[], from: ReshapeBounds, to: ReshapeBounds): void {
  const fw = from.x1 - from.x0
  const fh = from.y1 - from.y0
  const sx = fw === 0 ? 1 : (to.x1 - to.x0) / fw
  const sy = fh === 0 ? 1 : (to.y1 - to.y0) / fh
  for (const pt of pts) {
    pt.x = fw === 0 ? to.x0 : to.x0 + (pt.x - from.x0) * sx
    pt.y = fh === 0 ? to.y0 : to.y0 + (pt.y - from.y0) * sy
  }
}

export function getReshapeHandles(action: DrawAction): ReshapeHandle[] {
  if (!isReshapeableTool(action.tool)) return []
  const pts = action.points
  if (pts.length < 2) return []

  if (action.tool === 'line' || action.tool === 'arrow') {
    return [
      { id: 'p0', x: pts[0].x, y: pts[0].y, cursor: 'grab' },
      { id: 'p1', x: pts[1].x, y: pts[1].y, cursor: 'grab' },
    ]
  }

  const b = getActionReshapeBounds(action)
  if (!b) return []
  return cornerHandles(b.x0, b.y0, b.x1, b.y1)
}

export function hitTestReshapeHandle(
  action: DrawAction,
  p: Point,
  radius = RESHAPE_HANDLE_HIT_RADIUS,
): ReshapeHandle | null {
  const handles = getReshapeHandles(action)
  if (handles.length === 0) return null
  const r2 = radius * radius
  let best: ReshapeHandle | null = null
  let bestDist = Infinity
  for (const h of handles) {
    const d = (p.x - h.x) * (p.x - h.x) + (p.y - h.y) * (p.y - h.y)
    if (d <= r2 && d < bestDist) {
      bestDist = d
      best = h
    }
  }
  return best
}

function resolveCornerFreePoint(
  originBounds: ReshapeBounds,
  handleId: ReshapeHandleId,
  p: Point,
  options?: ReshapeApplyOptions,
): Point {
  if (!options?.constrain) return p
  const aspect = options.originAspect ?? aspectRatioOfBounds(originBounds)
  const fixed = oppositeCorner(originBounds, handleId)
  return aspectLockedFreePoint(fixed, p, aspect)
}

/**
 * Mutate `action.points` (and ink `attachedErasers`) for the given handle drag.
 * For corner/ink transforms, pass `originBounds` and restore points to the gesture-start
 * geometry before calling so Shift can toggle mid-drag without drift.
 */
export function applyReshapeHandle(
  action: DrawAction,
  handleId: ReshapeHandleId,
  p: Point,
  options?: ReshapeApplyOptions,
): void {
  const pts = action.points
  if (pts.length < 2) return

  if (handleId === 'p0' || handleId === 'p1') {
    const idx = handleId === 'p0' ? 0 : 1
    const anchor = pts[idx === 0 ? 1 : 0]
    const target =
      options?.constrain && options.angleSnapStep != null
        ? snapPointToAngle(anchor, p, options.angleSnapStep)
        : options?.constrain
          ? snapPointToAngle(anchor, p)
          : p
    pts[idx].x = target.x
    pts[idx].y = target.y
    return
  }

  const originBounds = options?.originBounds ?? getActionReshapeBounds(action)
  if (!originBounds) return
  const free = resolveCornerFreePoint(originBounds, handleId, p, options)
  const to = boundsAfterCornerDrag(originBounds, handleId, free)
  const boundsUnchanged =
    to.x0 === originBounds.x0 && to.y0 === originBounds.y0 && to.x1 === originBounds.x1 && to.y1 === originBounds.y1
  // Zero-move (or no-op after constrain): keep original point order / attachments intact.
  if (boundsUnchanged) return

  if (isInkReshapeTool(action.tool)) {
    scalePointsToBounds(pts, originBounds, to)
    if (action.attachedErasers?.length) {
      for (const ae of action.attachedErasers) {
        if (ae.points.length > 0) scalePointsToBounds(ae.points, originBounds, to)
      }
    }
    return
  }

  // rect / ellipse — rewrite the two diagonal points from the target box
  pts[0].x = to.x0
  pts[0].y = to.y0
  pts[1].x = to.x1
  pts[1].y = to.y1
}

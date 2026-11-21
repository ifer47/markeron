import type { DrawAction, Point, Tool } from './drawingTypes'
import {
  actionStretchX,
  curveBendPoint,
  getShapeRotation,
  isLockedInkAction,
  quadraticBounds,
  quadraticControlFromHandle,
  rotatePointAround,
  rotatePointsInPlace,
  snapPointToAngle,
  stampInkBox,
  textInkBox,
} from './drawingGeometry'

export type ReshapeHandleId = 'p0' | 'p1' | 'bend' | 'tl' | 'tr' | 'br' | 'bl' | 'rotate'

export interface ReshapeHandle {
  id: ReshapeHandleId
  x: number
  y: number
  /** CSS cursor while hovering / dragging this handle. */
  cursor: string
}

export type ReshapeBounds = { x0: number; y0: number; x1: number; y1: number }

export interface ReshapeApplyOptions {
  /** Shift held: aspect lock for corners, angle snap for line/arrow endpoints / rotate. */
  constrain?: boolean
  /** Alt held: scale corners from the box center instead of the opposite corner. */
  fromCenter?: boolean
  /** width/height at gesture start (corners only). */
  originAspect?: number
  /** Bounds at gesture start — corner/ink transforms are computed from this box. */
  originBounds?: ReshapeBounds
  /** Degrees; used when constraining line/arrow endpoints or rotation. */
  angleSnapStep?: number
  /** Rotation (radians) at gesture start — rect/ellipse/text/stamp rotate handle. */
  originRotation?: number
  /** atan2 from center to pointer at gesture start — rotate handle. */
  rotateStartAngle?: number
  /** Text / stamp font size at gesture start — corner scale is relative to it. */
  originFontSize?: number
  /** Text measured width at gesture start (scales with the font size). */
  originTextWidth?: number
  /** Horizontal stretch at gesture start (1 = natural). */
  originStretchX?: number
}

/** Hit radius in CSS pixels — larger than typical stroke hit so handles win over move. */
export const RESHAPE_HANDLE_HIT_RADIUS = 10

/** Visual half-size of the square handle (CSS px). */
export const RESHAPE_HANDLE_HALF = 4

/** Distance from the top edge midpoint to the rotate handle (local/CSS px). */
export const RESHAPE_ROTATE_HANDLE_OFFSET = 28

/** Minimum bbox edge after ink/corner scale so the stroke does not collapse. */
export const RESHAPE_MIN_SIZE = 1

export function isInkReshapeTool(tool: Tool): boolean {
  return tool === 'pen' || tool === 'highlighter'
}

export function isReshapeableTool(tool: Tool): boolean {
  return (
    tool === 'line' ||
    tool === 'arrow' ||
    tool === 'rect' ||
    tool === 'ellipse' ||
    tool === 'text' ||
    tool === 'stamp' ||
    isInkReshapeTool(tool)
  )
}

/**
 * Text / stamps anchor on a single point and own their own frame size (font size + measured
 * width + horizontal stretch) instead of a pair of end points.
 */
export function isUniformScaleTool(tool: Tool): boolean {
  return tool === 'text' || tool === 'stamp'
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

/**
 * Box the dashed selection frame shares with the four corner handles.
 * Line and arrow use endpoint handles, so they keep the padded hit bbox.
 */
export function selectionFrameBounds(action: DrawAction): ReshapeBounds | null {
  if (
    action.tool !== 'rect' &&
    action.tool !== 'ellipse' &&
    action.tool !== 'text' &&
    action.tool !== 'stamp' &&
    !isInkReshapeTool(action.tool)
  )
    return null
  return getActionReshapeBounds(action)
}

/** Axis-aligned bounds used for corner handles / aspect lock (local space for rotated shapes). */
export function getActionReshapeBounds(action: DrawAction): ReshapeBounds | null {
  const pts = action.points
  if (pts.length === 0) return null
  // Text / stamps anchor on a single point; their frame comes from the glyph / disc extents.
  if (action.tool === 'text') {
    const box = textInkBox(action)
    return { x0: box.x1, y0: box.y1, x1: box.x2, y1: box.y2 }
  }
  if (action.tool === 'stamp') {
    const box = stampInkBox(action)
    return { x0: box.x1, y0: box.y1, x1: box.x2, y1: box.y2 }
  }
  if (pts.length < 2) return null
  if (action.tool === 'line' || action.tool === 'arrow' || isLockedInkAction(action)) {
    if (pts.length >= 3) {
      // The control point can sit outside the visible curve.
      const b = quadraticBounds(pts[0], pts[1], pts[pts.length - 1])
      return { x0: b.x0, y0: b.y0, x1: b.x1, y1: b.y1 }
    }
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

function rotateHandleForBounds(b: ReshapeBounds, rotation = 0): ReshapeHandle {
  const cx = (b.x0 + b.x1) / 2
  const cy = (b.y0 + b.y1) / 2
  const local = { x: cx, y: b.y0 - RESHAPE_ROTATE_HANDLE_OFFSET }
  const world = rotatePointAround(local, cx, cy, rotation)
  return { id: 'rotate', x: world.x, y: world.y, cursor: 'grab' }
}

/** Map local-space handles into world space when the shape has rotation. */
function mapHandlesToWorld(handles: ReshapeHandle[], b: ReshapeBounds, rotation: number): ReshapeHandle[] {
  if (!rotation) return handles
  const cx = (b.x0 + b.x1) / 2
  const cy = (b.y0 + b.y1) / 2
  return handles.map((h) => {
    if (h.id === 'rotate') return h
    const world = rotatePointAround({ x: h.x, y: h.y }, cx, cy, rotation)
    return { ...h, x: world.x, y: world.y }
  })
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
 * Axis-aligned box grown from the center of `from` toward pointer `p`.
 * With `constrain`, keeps `aspect` (width/height) using the larger axis demand.
 */
export function boundsAfterCenterScale(
  from: ReshapeBounds,
  p: Point,
  options?: { constrain?: boolean; aspect?: number },
): ReshapeBounds {
  const cx = (from.x0 + from.x1) / 2
  const cy = (from.y0 + from.y1) / 2
  const minHalf = RESHAPE_MIN_SIZE / 2
  let halfW: number
  let halfH: number
  if (options?.constrain) {
    const a = options.aspect != null && options.aspect > 0 && Number.isFinite(options.aspect) ? options.aspect : 1
    const dx = Math.abs(p.x - cx)
    const dy = Math.abs(p.y - cy)
    halfH = Math.max(minHalf, dx / a, dy)
    halfW = halfH * a
  } else {
    halfW = Math.max(minHalf, Math.abs(p.x - cx))
    halfH = Math.max(minHalf, Math.abs(p.y - cy))
  }
  return { x0: cx - halfW, y0: cy - halfH, x1: cx + halfW, y1: cy + halfH }
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
  if (pts.length === 0) return []

  // Text / stamps have no endpoints — four corners plus the rotate handle.
  if (isUniformScaleTool(action.tool)) {
    const b = getActionReshapeBounds(action)
    if (!b) return []
    const rot = getShapeRotation(action)
    const handles = [...cornerHandles(b.x0, b.y0, b.x1, b.y1), rotateHandleForBounds(b, rot)]
    return mapHandlesToWorld(handles, b, rot)
  }

  if (pts.length < 2) return []

  if (action.tool === 'line' || action.tool === 'arrow' || isLockedInkAction(action)) {
    const b = getActionReshapeBounds(action)
    const bend = curveBendPoint(action)
    if (!b || !bend) return []
    return [
      { id: 'p0', x: pts[0].x, y: pts[0].y, cursor: 'grab' },
      { id: 'bend', x: bend.x, y: bend.y, cursor: 'move' },
      { id: 'p1', x: pts[pts.length - 1].x, y: pts[pts.length - 1].y, cursor: 'grab' },
      rotateHandleForBounds(b, 0),
    ]
  }

  const b = getActionReshapeBounds(action)
  if (!b) return []
  const rot = getShapeRotation(action)
  const handles = [...cornerHandles(b.x0, b.y0, b.x1, b.y1), rotateHandleForBounds(b, rot)]
  return mapHandlesToWorld(handles, b, rot)
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

function snapRotationDelta(
  originRotation: number,
  delta: number,
  constrain: boolean | undefined,
  angleSnapStep: number | undefined,
): number {
  if (!constrain) return delta
  const stepDeg = angleSnapStep != null && Number.isFinite(angleSnapStep) && angleSnapStep > 0 ? angleSnapStep : 15
  const step = (Math.PI / 180) * stepDeg
  const total = originRotation + delta
  const snapped = Math.round(total / step) * step
  return snapped - originRotation
}

function scaleTextStampHandle(
  action: DrawAction,
  handleId: ReshapeHandleId,
  localPointer: Point,
  originBounds: ReshapeBounds,
  options?: ReshapeApplyOptions,
): void {
  if (!isCornerHandleId(handleId)) return
  const w0 = Math.max(RESHAPE_MIN_SIZE, originBounds.x1 - originBounds.x0)
  const h0 = Math.max(RESHAPE_MIN_SIZE, originBounds.y1 - originBounds.y0)
  const minScale = RESHAPE_MIN_SIZE / Math.min(w0, h0)
  const fromCenter = options?.fromCenter === true

  // Anchor: the opposite corner, or the box centre when Alt is held.
  const cx = (originBounds.x0 + originBounds.x1) / 2
  const cy = (originBounds.y0 + originBounds.y1) / 2
  const fixed = fromCenter ? { x: cx, y: cy } : oppositeCorner(originBounds, handleId)
  const halfX = fromCenter ? w0 / 2 : w0
  const halfY = fromCenter ? h0 / 2 : h0
  const scaleX = Math.max(minScale, Math.abs(localPointer.x - fixed.x) / halfX)
  const scaleY = Math.max(minScale, Math.abs(localPointer.y - fixed.y) / halfY)

  // Free-form: each axis follows the pointer on its own, so the dragged corner stays under
  // the cursor. Shift locks the aspect instead — both axes share the larger scale, so text
  // keeps its stretch and a stamp stays a circle.
  let sx: number
  let sy: number
  if (options?.constrain) {
    const uniform = Math.max(scaleX, scaleY)
    sx = uniform
    sy = uniform
  } else {
    sx = scaleX
    sy = scaleY
  }

  const w = w0 * sx
  const h = h0 * sy
  let box: ReshapeBounds
  if (fromCenter) {
    box = { x0: cx - w / 2, y0: cy - h / 2, x1: cx + w / 2, y1: cy + h / 2 }
  } else {
    const growsRight = handleId === 'tr' || handleId === 'br'
    const growsDown = handleId === 'bl' || handleId === 'br'
    box = { x0: fixed.x, y0: fixed.y, x1: fixed.x, y1: fixed.y }
    if (growsRight) box.x1 = fixed.x + w
    else box.x0 = fixed.x - w
    if (growsDown) box.y1 = fixed.y + h
    else box.y0 = fixed.y - h
  }

  // Line height drives the font size; the horizontal ratio becomes the glyph stretch.
  const originFs = options?.originFontSize ?? action.fontSize ?? 24
  const fontSize = Math.max(1, originFs * sy)
  action.fontSize = fontSize
  const stretch = Math.max(0.02, (options?.originStretchX ?? actionStretchX(action)) * (sx / sy))
  if (Math.abs(stretch - 1) < 1e-6) delete action.stretchX
  else action.stretchX = stretch

  if (action.tool === 'text') {
    action.textWidth = Math.max(1, w0 * sx)
    // Ink box starts 2px right of the anchor and is centred on the first line.
    const lineHeight = Math.round(fontSize * 1.3)
    action.points[0].x = box.x0 - 2
    action.points[0].y = box.y0 + lineHeight / 2
    return
  }

  action.points[0].x = (box.x0 + box.x1) / 2
  action.points[0].y = (box.y0 + box.y1) / 2
}

/**
 * Mutate `action.points` / `rotation` (and ink `attachedErasers`) for the given handle drag.
 * For corner/ink/rotate transforms, pass `originBounds` and restore geometry to the gesture-start
 * state before calling so Shift can toggle mid-drag without drift.
 */
export function applyReshapeHandle(
  action: DrawAction,
  handleId: ReshapeHandleId,
  p: Point,
  options?: ReshapeApplyOptions,
): void {
  const pts = action.points
  if (pts.length === 0) return
  // Every other tool needs two end points; only text / stamps resize from a single anchor.
  if (pts.length < 2 && !isUniformScaleTool(action.tool)) return

  if (handleId === 'rotate') {
    const originBounds = options?.originBounds ?? getActionReshapeBounds(action)
    if (!originBounds) return
    const cx = (originBounds.x0 + originBounds.x1) / 2
    const cy = (originBounds.y0 + originBounds.y1) / 2
    const originRotation = options?.originRotation ?? getShapeRotation(action)
    const startAngle = options?.rotateStartAngle ?? Math.atan2(p.y - cy, p.x - cx)
    const currentAngle = Math.atan2(p.y - cy, p.x - cx)
    const delta = snapRotationDelta(
      originRotation,
      currentAngle - startAngle,
      options?.constrain,
      options?.angleSnapStep,
    )

    if (action.tool === 'rect' || action.tool === 'ellipse' || isUniformScaleTool(action.tool)) {
      const next = originRotation + delta
      if (Math.abs(next) < 1e-10) delete action.rotation
      else action.rotation = next
      return
    }

    rotatePointsInPlace(pts, cx, cy, delta)
    if (action.attachedErasers?.length) {
      for (const ae of action.attachedErasers) {
        if (ae.points.length > 0) rotatePointsInPlace(ae.points, cx, cy, delta)
      }
    }
    return
  }

  if (handleId === 'bend') {
    if ((action.tool !== 'arrow' && action.tool !== 'line' && !isLockedInkAction(action)) || pts.length < 3) return
    const p0 = pts[0]
    const p1 = pts[pts.length - 1]
    // Constrain snaps the offset from the chord midpoint, keeping the bend symmetric in angle.
    const target = options?.constrain
      ? snapPointToAngle({ x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 }, p, options.angleSnapStep ?? 15)
      : p
    const control = quadraticControlFromHandle(p0, p1, target)
    pts[1].x = control.x
    pts[1].y = control.y
    return
  }

  if (handleId === 'p0' || handleId === 'p1') {
    const idx = handleId === 'p0' ? 0 : pts.length - 1
    const anchor = pts[idx === 0 ? pts.length - 1 : 0]
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

  const rot = options?.originRotation ?? getShapeRotation(action)
  let localPointer = p
  if (rot !== 0 && (action.tool === 'rect' || action.tool === 'ellipse' || isUniformScaleTool(action.tool))) {
    const cx = (originBounds.x0 + originBounds.x1) / 2
    const cy = (originBounds.y0 + originBounds.y1) / 2
    localPointer = rotatePointAround(p, cx, cy, -rot)
  }

  // Text / stamps keep their glyph aspect: the corner drag scales the font size uniformly.
  if (isUniformScaleTool(action.tool)) {
    scaleTextStampHandle(action, handleId, localPointer, originBounds, options)
    return
  }

  const to = options?.fromCenter
    ? boundsAfterCenterScale(originBounds, localPointer, {
        constrain: options.constrain,
        aspect: options.originAspect ?? aspectRatioOfBounds(originBounds),
      })
    : boundsAfterCornerDrag(
        originBounds,
        handleId,
        resolveCornerFreePoint(originBounds, handleId, localPointer, options),
      )
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

  // rect / ellipse — rewrite the two diagonal points from the target box (local space)
  pts[0].x = to.x0
  pts[0].y = to.y0
  pts[1].x = to.x1
  pts[1].y = to.y1
}

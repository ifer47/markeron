/** Freehand pen/highlighter: hold still to lock the stroke into a previewable straight line. */

/** Hold still this long (ms) while drawing to lock into a 2-point line. */
export const STROKE_LINE_LOCK_HOLD_MS = 500

/** Movement beyond this distance (CSS px) from the still-anchor resets the hold timer. */
export const STROKE_LINE_LOCK_STILL_PX = 10

export function strokeLineLockStillDistSq(): number {
  return STROKE_LINE_LOCK_STILL_PX * STROKE_LINE_LOCK_STILL_PX
}

export type LineLockPoint = {
  x: number
  y: number
  pressure?: number
  t?: number
  pointerType?: string
}

/** Collapse a freehand polyline to start → end for locked-line preview / commit. */
export function collapseStrokeToLine(points: LineLockPoint[]): LineLockPoint[] | null {
  if (points.length < 1) return null
  const start = points[0]
  const end = points[points.length - 1]
  return [
    { x: start.x, y: start.y, pressure: start.pressure },
    { x: end.x, y: end.y, pressure: end.pressure },
  ]
}

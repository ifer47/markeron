/** Freehand pen/highlighter: hold still to lock the stroke into a previewable straight line. */

/** Hold still this long (ms) while drawing to lock into a 2-point line. */
export const STROKE_LINE_LOCK_HOLD_MS = 500

/** Movement beyond this distance (CSS px) from the still-anchor resets the hold timer. */
export const STROKE_LINE_LOCK_STILL_PX = 10

/**
 * Shortest start → end chord (CSS px) that still reads as a straight line. A
 * stroke whose ends nearly meet (a closed loop) has a near-zero chord, and
 * collapsing it would erase the whole drawing instead of straightening it.
 */
export const STROKE_LINE_LOCK_MIN_CHORD_PX = 12

/**
 * Longest arc-length / chord-length ratio still considered "an almost straight
 * stroke". A hand-drawn line wobbles around 1.0–1.1; a 90° corner is ~1.41 and
 * any loop is far above that, so loops and elbows keep their freehand shape.
 */
export const STROKE_LINE_LOCK_MAX_ARC_RATIO = 1.35

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

/**
 * Collapse a freehand polyline to start → end for locked-line preview / commit.
 *
 * Returns `null` when the stroke is not line-like (loops, elbows, or two ends
 * that nearly touch): straightening such a stroke destroys its shape, and for a
 * closed loop the collapsed line is degenerate — the drawing simply vanishes.
 */
export function collapseStrokeToLine(points: LineLockPoint[]): LineLockPoint[] | null {
  if (points.length < 2) return null
  const start = points[0]
  const end = points[points.length - 1]

  const chord = Math.hypot(end.x - start.x, end.y - start.y)
  if (chord < STROKE_LINE_LOCK_MIN_CHORD_PX) return null

  let arc = 0
  for (let i = 1; i < points.length; i++) {
    arc += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y)
  }
  if (arc > chord * STROKE_LINE_LOCK_MAX_ARC_RATIO) return null

  // Uniform ink width: both caps share one pressure (prefer tip / hold pressure).
  const pressure = end.pressure ?? start.pressure
  return [
    { x: start.x, y: start.y, pressure },
    { x: end.x, y: end.y, pressure },
  ]
}

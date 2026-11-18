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
 * Pressure the ink was actually laid down with, for a line that is drawn at one
 * uniform width.
 *
 * Neither end sample is representative: the tip is whatever the pen read while
 * it hovered or lifted (often 0.05–0.15 on a tablet) and the start is the
 * initial contact, so taking either turns the whole locked line into a hairline.
 *
 * Two steps keep the hold out of the average:
 * 1. drop the trailing run that sits inside `STROKE_LINE_LOCK_STILL_PX` of the
 *    tip — that is the part the lock itself considers "not moving", and at
 *    120–240 Hz it can outnumber the real samples many times over;
 * 2. weight the rest by segment length so uneven sampling cannot bias it.
 *
 * Falls back to the tip then the start sample when no sample carries pressure
 * (mouse input), so callers keep the previous behaviour for pressure-less tools.
 */
export function representativePressure(points: LineLockPoint[]): number | undefined {
  const tip = points[points.length - 1]
  let lastMoving = points.length - 1
  while (lastMoving > 0 && tip) {
    const prev = points[lastMoving - 1]
    if (Math.hypot(tip.x - prev.x, tip.y - prev.y) > STROKE_LINE_LOCK_STILL_PX) break
    lastMoving--
  }
  const body = lastMoving > 0 ? points.slice(0, lastMoving + 1) : points

  let weighted = 0
  let total = 0

  for (let i = 1; i < body.length; i++) {
    const pressure = body[i].pressure
    if (pressure == null) continue
    const length = Math.hypot(body[i].x - body[i - 1].x, body[i].y - body[i - 1].y)
    if (!(length > 0)) continue
    weighted += pressure * length
    total += length
  }

  if (total > 0) return weighted / total
  return tip?.pressure ?? points[0]?.pressure
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

  // Uniform ink width: both caps share the stroke's representative pressure, so a
  // light hold at the tip cannot turn the whole line into a hairline.
  const pressure = representativePressure(points) ?? end.pressure ?? start.pressure
  return [
    { x: start.x, y: start.y, pressure },
    { x: end.x, y: end.y, pressure },
  ]
}

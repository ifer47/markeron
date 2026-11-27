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
 * How far the stroke may stray from its own start → end chord, as a fraction of
 * that chord, and still read as "a straight line".
 *
 * Judged by perpendicular deviation instead of arc length: arc length barely
 * grows for a smooth bend (a 100×30 arc scores 1.22, a 100×10 arc 1.03), so the
 * old 1.35 arc-ratio limit flattened every smooth arc up to ~149° of bend and
 * only spared elbows, loops and near-circles. Deviation separates the two
 * cleanly — a hand-drawn line wobbles 1–3% of the chord, while a 100×10 arc,
 * barely a curve to the eye, is already 10%.
 *
 * 0.05 is roughly 23° of total bend, i.e. the point where the curve becomes
 * visible rather than "a line with a wobble".
 */
export const STROKE_LINE_LOCK_MAX_DEVIATION_RATIO = 0.05

/**
 * Absolute deviation floor (CSS px). Very short strokes have a tiny chord, so a
 * ratio-only limit would reject a hand-drawn line of pen-width wobble.
 */
export const STROKE_LINE_LOCK_MIN_DEVIATION_PX = 3

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
 * Largest perpendicular distance (CSS px) between any sampled point and the
 * start → end chord.
 *
 * This is the shape test behind the line lock: it stays near zero for a wobbly
 * hand-drawn line and grows with the sagitta of a curve, so a shallow arc is
 * recognised as a curve instead of being flattened.
 *
 * Returns 0 when the two ends coincide; callers reject those strokes through
 * the minimum chord instead.
 */
export function maxChordDeviation(points: LineLockPoint[]): number {
  if (points.length < 2) return 0
  const start = points[0]
  const end = points[points.length - 1]
  const dx = end.x - start.x
  const dy = end.y - start.y
  const chord = Math.hypot(dx, dy)
  if (!(chord > 0)) return 0

  let max = 0
  for (let i = 1; i < points.length - 1; i++) {
    const point = points[i]
    // |cross product| / chord is the distance from the point to the chord line.
    const deviation = Math.abs((point.x - start.x) * dy - (point.y - start.y) * dx) / chord
    if (deviation > max) max = deviation
  }
  return max
}

/**
 * Collapse a freehand polyline to start → end for locked-line preview / commit.
 *
 * Returns `null` unless the stroke is already almost straight. Curves, loops,
 * elbows and strokes whose two ends nearly touch keep their freehand shape:
 * straightening them destroys what the user drew, and for a closed loop the
 * collapsed line is degenerate — the drawing simply vanishes.
 */
export function collapseStrokeToLine(points: LineLockPoint[]): LineLockPoint[] | null {
  if (points.length < 2) return null
  const start = points[0]
  const end = points[points.length - 1]

  const chord = Math.hypot(end.x - start.x, end.y - start.y)
  if (chord < STROKE_LINE_LOCK_MIN_CHORD_PX) return null

  // Curves are judged against their own chord, so this holds at any size; the
  // absolute floor keeps a short wobbly line from being rejected by ratio alone.
  const maxDeviation = Math.max(STROKE_LINE_LOCK_MIN_DEVIATION_PX, chord * STROKE_LINE_LOCK_MAX_DEVIATION_RATIO)
  if (maxChordDeviation(points) > maxDeviation) return null

  // Uniform ink width: both caps share the stroke's representative pressure, so a
  // light hold at the tip cannot turn the whole line into a hairline.
  const pressure = representativePressure(points) ?? end.pressure ?? start.pressure
  return [
    { x: start.x, y: start.y, pressure },
    { x: end.x, y: end.y, pressure },
  ]
}

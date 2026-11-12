/** Freehand ink: optionally snap nearly-straight strokes to a 2-point line on pointer-up. */

export type StrokeStraightenPoint = {
  x: number
  y: number
  pressure?: number
  t?: number
  pointerType?: string
}

/** Default: on — only clearly straight strokes are rewritten (strict thresholds). */
export const DEFAULT_STROKE_STRAIGHTEN = true

/** Max perpendicular deviation as a fraction of chord length. */
export const STROKE_STRAIGHTEN_MAX_DEVIATION_RATIO = 0.035

/** Max path length / chord length (rejects loops and heavy wobble). */
export const STROKE_STRAIGHTEN_MAX_PATH_RATIO = 1.12

/** Ignore tiny ticks / dots. */
export const STROKE_STRAIGHTEN_MIN_CHORD_PX = 24

/** Need at least a short polyline to judge. */
export const STROKE_STRAIGHTEN_MIN_POINTS = 3

/**
 * Fraction of samples whose projection onto the chord must be monotonic
 * (forward progress). Allows a little backtracking from hand tremor.
 */
export const STROKE_STRAIGHTEN_MIN_FORWARD_RATIO = 0.85

export function resolveStrokeStraighten(general?: { strokeStraighten?: boolean }): boolean {
  return general?.strokeStraighten ?? DEFAULT_STROKE_STRAIGHTEN
}

function dist(a: StrokeStraightenPoint, b: StrokeStraightenPoint): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  return Math.hypot(dx, dy)
}

/** Perpendicular distance from p to the infinite line through a→b. */
function distToLine(p: StrokeStraightenPoint, a: StrokeStraightenPoint, b: StrokeStraightenPoint): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const lenSq = dx * dx + dy * dy
  if (lenSq < 1e-12) return dist(p, a)
  return Math.abs(dy * (p.x - a.x) - dx * (p.y - a.y)) / Math.sqrt(lenSq)
}

/** Projection of p onto a→b as a scalar along the chord (0 at a, |ab| at b). */
function projectScalar(p: StrokeStraightenPoint, a: StrokeStraightenPoint, b: StrokeStraightenPoint): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const lenSq = dx * dx + dy * dy
  if (lenSq < 1e-12) return 0
  return ((p.x - a.x) * dx + (p.y - a.y) * dy) / Math.sqrt(lenSq)
}

export function isNearlyStraightStroke(
  points: StrokeStraightenPoint[],
  options?: {
    maxDeviationRatio?: number
    maxPathRatio?: number
    minChordPx?: number
    minForwardRatio?: number
  },
): boolean {
  const maxDeviationRatio = options?.maxDeviationRatio ?? STROKE_STRAIGHTEN_MAX_DEVIATION_RATIO
  const maxPathRatio = options?.maxPathRatio ?? STROKE_STRAIGHTEN_MAX_PATH_RATIO
  const minChordPx = options?.minChordPx ?? STROKE_STRAIGHTEN_MIN_CHORD_PX
  const minForwardRatio = options?.minForwardRatio ?? STROKE_STRAIGHTEN_MIN_FORWARD_RATIO

  if (points.length < STROKE_STRAIGHTEN_MIN_POINTS) return false

  const start = points[0]
  const end = points[points.length - 1]
  const chord = dist(start, end)
  if (!(chord >= minChordPx)) return false

  let pathLen = 0
  let maxDev = 0
  let forwardSteps = 0
  let totalSteps = 0
  let prevProj = projectScalar(start, start, end)

  for (let i = 1; i < points.length; i++) {
    const p = points[i]
    pathLen += dist(points[i - 1], p)
    maxDev = Math.max(maxDev, distToLine(p, start, end))
    const proj = projectScalar(p, start, end)
    totalSteps++
    if (proj >= prevProj - 1e-6) forwardSteps++
    prevProj = proj
  }

  if (pathLen / chord > maxPathRatio) return false
  if (maxDev / chord > maxDeviationRatio) return false
  if (totalSteps > 0 && forwardSteps / totalSteps < minForwardRatio) return false
  return true
}

/**
 * If points form a nearly straight stroke, return `[start, end]` (pressure/t preserved).
 * Otherwise return `null` (caller keeps the original polyline).
 */
export function straightenStrokePoints(
  points: StrokeStraightenPoint[],
  options?: Parameters<typeof isNearlyStraightStroke>[1],
): StrokeStraightenPoint[] | null {
  if (!isNearlyStraightStroke(points, options)) return null
  const start = points[0]
  const end = points[points.length - 1]
  return [
    { x: start.x, y: start.y, pressure: start.pressure, t: start.t, pointerType: start.pointerType },
    { x: end.x, y: end.y, pressure: end.pressure, t: end.t },
  ]
}

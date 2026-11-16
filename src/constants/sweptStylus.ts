import type { Point } from '../composables/drawingTypes'

/**
 * Port of WPF's ink renderer (`StrokeRenderer.CalcGeometryAndBounds` +
 * `EllipticalNodeOperations`), the pipeline used by Ink Canvas Plus:
 *
 * - one **elliptical stroke node** per pointer sample (radius = width/2 × pressure)
 * - adjacent nodes joined by their **convex hull** (external tangents), so the
 *   silhouette is the exact swept ribbon with no polyline facets
 * - nodes **pruned** unless the direction changes past a tolerance or the node
 *   area changes a lot; pruned spans are covered by the tangent hull
 * - everything filled with the **non-zero** rule so overlaps merge into one shape
 *
 * Unlike perfect-freehand there is no thinning gain and no min-distance
 * decimation. Smoothness comes from three places: the tangent hull, a position /
 * pressure EMA, and **corner rounding** — a sharp turn is cut with a quadratic
 * Bézier so its radius comes from `cornerCutMaxPx` instead of being inherited
 * from the pen width (otherwise a fast hand on a tight loop reads as a polygon).
 */

/** Base min distance in device pixels (squared) before adaptive area scaling. */
export const BASE_MIN_DIST_DEVICE_SQ = 4

/** Viewport area used as the 1.0 reference for adaptive sampling. */
export const BASE_VIEWPORT_AREA = 1440 * 900

/** Cap how aggressively large CSS viewports thin points (was 4 → ~4 CSS px). */
export const MAX_AREA_SCALE = 2

/**
 * Min squared distance between stored ink samples (CSS px). Only a guard against
 * pathological pointer rates — WPF keeps every packet, so this stays well below
 * one pixel.
 */
export const INK_MIN_DIST_SQ = 0.25

/**
 * Min squared distance in CSS pixels so physical spacing stays near
 * ~2 device px (scaled gently on large viewports).
 */
export function computeMinDistSq(cssW: number, cssH: number, dpr: number): number {
  const area = cssW * cssH
  const scale = area / BASE_VIEWPORT_AREA
  const deviceDistSq = scale > 1.5 ? BASE_MIN_DIST_DEVICE_SQ * Math.min(scale, MAX_AREA_SCALE) : BASE_MIN_DIST_DEVICE_SQ
  const safeDpr = dpr > 0 ? dpr : 1
  return deviceDistSq / (safeDpr * safeDpr)
}

/** Clamp pointer pressure for ink; mouse / missing → 0.5. */
export function normalizePressure(pressure: number | undefined | null): number {
  if (pressure == null || !(pressure > 0)) return 0.5
  return Math.min(1, Math.max(0.05, pressure))
}

/** Real pressure devices: stylus / finger. Mouse stays uniform-width ink. */
export function usesPressureInk(pointerType: string | undefined | null): boolean {
  return pointerType === 'pen' || pointerType === 'touch'
}

/** One stylus tip position: a circle of radius `r` (WPF `StrokeNode`). */
export interface StylusNode {
  x: number
  y: number
  r: number
}

export interface SweptStyle {
  /**
   * Radius = (lineWidth / 2) × pressureGain × pressure, matching WPF's
   * `Width / 2 * PressureFactor`.
   */
  pressureGain: number
  /** Position EMA towards the previous stored sample; 0 = raw samples. */
  positionStreamline: number
  /** Pressure EMA coefficient; 0 = raw pressure (no width noise filtering). */
  pressureAlpha: number
  /** Direction-change tolerance in degrees before a node is kept; 0 disables pruning. */
  pruneAngleDeg: number
  /** Keep a node when the neighbour area ratio drops to this; <= 0 disables. */
  pruneAreaRatio: number
  /**
   * Direction change (degrees) at which a corner is rounded off; also the max
   * turn between two consecutive interpolated tips. 0 disables rounding.
   */
  cornerAngleDeg: number
  /** How much of each neighbouring segment the corner may consume (0–0.5). */
  cornerCutRatio: number
  /** Cap on the corner cut in CSS px, i.e. the max rounding radius it can buy. */
  cornerCutMaxPx: number
}

/**
 * Radius gain. WPF uses `Width / 2`; ours doubles it so mid pressure keeps the
 * stroke as thick as the previous perfect-freehand build.
 */
const PRESSURE_GAIN = 2

/**
 * WPF prunes at 45° / 70% area, which is safe for its OS-filtered packets but
 * folds noisy WebView2 input into visible corners (measured: 0.29 → 0.51 px
 * edge wobble). So smoothing here is an EMA on position **and** pressure, and
 * pruning only collapses near-straight runs where the tangent hull is exact.
 */
const SAFE_PRUNE_ANGLE_DEG = 3

/**
 * Fixed ink style: the strongest filter. Position and pressure are both
 * low-passed (measured edge wobble 0.16 / 0.07 / 0.18 px on synthetic jitter,
 * ~45% below the raw sweep) and pruning stays safe, so no setting is exposed.
 */
export const SWEPT_STYLE: SweptStyle = {
  pressureGain: PRESSURE_GAIN,
  positionStreamline: 0.65,
  pressureAlpha: 0.15,
  pruneAngleDeg: SAFE_PRUNE_ANGLE_DEG,
  pruneAreaRatio: 0,
  cornerAngleDeg: 8,
  cornerCutRatio: 0.5,
  cornerCutMaxPx: 8,
}

/**
 * Excalidraw-style EMA towards the previous stored sample. Pressure is filtered
 * too: unfiltered pressure noise is what makes the silhouette look furry.
 */
export function smoothPenPoint(prev: Point, raw: Point, style: SweptStyle): Point {
  const pull = 1 - style.positionStreamline
  const prevPressure = normalizePressure(prev.pressure)
  const rawPressure = normalizePressure(raw.pressure)
  const pressure =
    style.pressureAlpha > 0 ? prevPressure + (rawPressure - prevPressure) * style.pressureAlpha : rawPressure
  return {
    x: style.positionStreamline > 0 ? prev.x + (raw.x - prev.x) * pull : raw.x,
    y: style.positionStreamline > 0 ? prev.y + (raw.y - prev.y) * pull : raw.y,
    pressure,
  }
}

/** Build the stroke node for one sample (WPF `StrokeNodeData` radius). */
export function nodeFromPoint(point: Point, lineWidth: number, style: SweptStyle, pressureInk: boolean): StylusNode {
  const baseRadius = Math.max(0.5, lineWidth / 2)
  const r = pressureInk
    ? Math.max(0.1, baseRadius * style.pressureGain * normalizePressure(point.pressure))
    : baseRadius
  return { x: point.x, y: point.y, r }
}

export function nodesFromPoints(
  points: Point[],
  lineWidth: number,
  style: SweptStyle,
  pointerType?: string | null,
): StylusNode[] {
  const pressureInk = usesPressureInk(pointerType)
  return points.map((point) => nodeFromPoint(point, lineWidth, style, pressureInk))
}

/**
 * Replace one interior sample with the rounded corner it introduces.
 *
 * The swept silhouette is the exact offset of the sample polyline, so a corner
 * can only be rounded as tightly as the tip radius — a fast hand moving 10–15 px
 * per packet on a tight loop turns 30–45° per sample and the outline reads as a
 * polygon. Cutting the corner with a quadratic Bézier from the midpoint of the
 * incoming segment, through the sample, to the midpoint of the outgoing segment
 * turns that angle into an arc whose radius is chosen here instead of inherited
 * from the pen width. Straight runs return the sample untouched, so slow strokes
 * and long strokes cost nothing.
 */
export function roundCornerTips(prev: Point, node: Point, next: Point, style: SweptStyle): Point[] {
  const threshold = style.cornerAngleDeg
  if (threshold <= 0) return [node]

  const inX = node.x - prev.x
  const inY = node.y - prev.y
  const outX = next.x - node.x
  const outY = next.y - node.y
  const inLen = Math.hypot(inX, inY)
  const outLen = Math.hypot(outX, outY)
  if (inLen < 1e-6 || outLen < 1e-6) return [node]

  const cos = Math.min(1, Math.max(-1, (inX * outX + inY * outY) / (inLen * outLen)))
  const turnDeg = (Math.acos(cos) * 180) / Math.PI
  if (turnDeg < threshold) return [node]

  const cut = Math.min(Math.min(inLen, outLen) * style.cornerCutRatio, style.cornerCutMaxPx)
  if (!(cut > 1e-6)) return [node]

  const start: Point = { x: node.x - (inX / inLen) * cut, y: node.y - (inY / inLen) * cut, pressure: node.pressure }
  const end: Point = { x: node.x + (outX / outLen) * cut, y: node.y + (outY / outLen) * cut, pressure: node.pressure }

  // Keep the turn between neighbouring tips below the threshold so the ribbon
  // never shows the chord it just replaced.
  const steps = Math.max(2, Math.ceil(turnDeg / threshold))
  const out: Point[] = [start]
  for (let i = 1; i < steps; i++) {
    const t = i / steps
    const u = 1 - t
    out.push({
      x: u * u * start.x + 2 * u * t * node.x + t * t * end.x,
      y: u * u * start.y + 2 * u * t * node.y + t * t * end.y,
      pressure: node.pressure,
    })
  }
  out.push(end)
  return out
}

/**
 * EMA + corner rounding for a **complete** run of samples.
 *
 * Position / pressure are low-passed except for the **tip**: the last sample
 * stays raw so the stroke never falls short of the pointer (a capture-time EMA
 * shortens every stroke). Interior samples are then replaced by their rounded
 * corner, which is what keeps fast, tight turns from looking like a polygon.
 */
export function smoothSamples(points: Point[], style: SweptStyle): Point[] {
  const out: Point[] = []
  let prev: Point | null = null
  for (const raw of points) {
    const current: Point = prev ? smoothPenPoint(prev, raw, style) : raw
    out.push(current)
    prev = current
  }
  return out
}

export function nodesFromSmoothedPoints(
  points: Point[],
  lineWidth: number,
  style: SweptStyle,
  pointerType?: string | null,
): StylusNode[] {
  const pressureInk = usesPressureInk(pointerType)
  const smoothed = smoothSamples(points, style)

  const out: StylusNode[] = []
  const count = smoothed.length
  if (count === 0) return out

  out.push(nodeFromPoint(smoothed[0], lineWidth, style, pressureInk))
  for (let i = 1; i < count - 1; i++) {
    for (const tip of roundCornerTips(smoothed[i - 1], smoothed[i], smoothed[i + 1], style)) {
      out.push(nodeFromPoint(tip, lineWidth, style, pressureInk))
    }
  }
  // The tip stays on the raw sample so the stroke never falls short of the pointer.
  if (count > 1) out.push(nodeFromPoint(points[count - 1], lineWidth, style, pressureInk))
  return out
}

/**
 * Incremental EMA cache for a **live** stroke.
 *
 * The live preview cannot re-outline the whole stroke every frame, so it freezes
 * settled chunks and only re-outlines the tail — calling `nodesFromSmoothedPoints`
 * per slice restarts the EMA at every chunk boundary, which makes those starts stick
 * out past the final silhouette (the stroke visibly "thins out" when the pointer is
 * released). Caching the smoothed samples keeps every slice on the same EMA phase,
 * so the union of the chunks is **exactly** `nodesFromSmoothedPoints(points)`.
 *
 * Corner rounding is cached the same way: the tips for sample `i` are final as
 * soon as sample `i + 1` exists, so an interior sample only ever has to be
 * materialised once.
 */
export class SweptSampleCache {
  private readonly smoothed: Point[] = []
  /** Tips introduced by each **interior** sample (corner arc, or the sample itself). */
  private readonly perSample: StylusNode[][] = []
  private readonly lineWidth: number
  private readonly style: SweptStyle
  private readonly pressureInk: boolean

  constructor(lineWidth: number, style: SweptStyle, pointerType?: string | null) {
    this.lineWidth = lineWidth
    this.style = style
    this.pressureInk = usesPressureInk(pointerType)
  }

  /** Extend the cache to cover every sample and round whatever is settled. */
  sync(points: Point[]): void {
    while (this.smoothed.length < points.length) {
      const i = this.smoothed.length
      const prev = i > 0 ? this.smoothed[i - 1] : null
      this.smoothed.push(prev ? smoothPenPoint(prev, points[i], this.style) : points[i])
    }

    // Samples 0…n-2 are settled: their rounded corner depends only on neighbours that exist.
    while (this.perSample.length < this.smoothed.length - 1) {
      const i = this.perSample.length
      const tips =
        i === 0
          ? [this.smoothed[0]]
          : roundCornerTips(this.smoothed[i - 1], this.smoothed[i], this.smoothed[i + 1], this.style)
      this.perSample.push(tips.map((tip) => nodeFromPoint(tip, this.lineWidth, this.style, this.pressureInk)))
    }
  }

  /** Node for sample `i`; `points` must already be synced. */
  nodeAt(points: Point[], i: number): StylusNode {
    const sample = i === points.length - 1 ? points[i] : this.smoothed[i]
    return nodeFromPoint(sample, this.lineWidth, this.style, this.pressureInk)
  }

  /** Nodes for samples `[from, to]` inclusive — same values `nodesFromSmoothedPoints` yields. */
  nodes(points: Point[], from: number, to: number = points.length - 1): StylusNode[] {
    const out: StylusNode[] = []
    for (let i = from; i <= to; i++) {
      if (i === points.length - 1) {
        out.push(nodeFromPoint(points[i], this.lineWidth, this.style, this.pressureInk))
      } else {
        out.push(...this.perSample[i])
      }
    }
    return out
  }
}

/** Angle in [0, 360) from `from` to `to`, mirroring WPF's `GetAngleBetween`. */
function angleBetween(from: Point, to: Point): number {
  const angle = (Math.atan2(to.y - from.y, to.x - from.x) * 180) / Math.PI
  return angle < 0 ? angle + 360 : angle
}

/** WPF's `GetAngleDeltaFromLast`: signed delta with 0/360 wraparound. */
function angleDeltaFromLast(from: Point, to: Point, lastAngle: number): number {
  const angle = angleBetween(from, to)
  let delta: number
  if (lastAngle >= 270 && angle <= 90) delta = lastAngle - (360 + angle)
  else if (lastAngle <= 90 && angle >= 270) delta = 360 + lastAngle - angle
  else delta = lastAngle - angle
  return delta
}

/**
 * Drop nodes that add nothing: WPF renders a node only for the first two, the
 * last two, a direction change past `pruneAngleDeg`, or a node-area jump. When
 * a corner is kept, the previous node is emitted too so the hull cannot cut it.
 */
export function pruneNodes(nodes: StylusNode[], style: SweptStyle): StylusNode[] {
  if (nodes.length <= 4 || style.pruneAngleDeg <= 0) return nodes.slice()

  const out: StylusNode[] = []
  let lastAngle = 0
  let lastArea = 0
  let previousPreviousRendered = false

  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]
    const prev = i > 0 ? nodes[i - 1] : null

    let delta = 0
    if (prev && (node.x !== prev.x || node.y !== prev.y)) {
      delta = Math.abs(angleDeltaFromLast(prev, node, lastAngle))
      lastAngle = angleBetween(prev, node)
    }

    const area = 4 * node.r * node.r
    const areaChanged =
      style.pruneAreaRatio > 0 &&
      lastArea > 0 &&
      Math.min(lastArea, area) / Math.max(lastArea, area) <= style.pruneAreaRatio
    lastArea = area

    // Wider tips need more nodes to keep their silhouette faithful.
    const tolerance = node.r * 2 > 40 ? 20 : style.pruneAngleDeg
    const directionChanged = delta > tolerance && delta < 360 - tolerance

    if (i <= 1 || i >= nodes.length - 2 || directionChanged || areaChanged) {
      if (directionChanged && !previousPreviousRendered && prev && i > 1 && i < nodes.length - 1) {
        out.push(prev)
        previousPreviousRendered = true
      }
      out.push(node)
    }

    if (!directionChanged) previousPreviousRendered = false
  }

  return out
}

/** Cubic Bézier circle constant (4 segments ≈ 0.02% error). */
const KAPPA = 0.5522847498307936

/** Append a clockwise (screen space) ellipse subpath. */
function addEllipse(path: Path2D, node: StylusNode) {
  const { x, y, r } = node
  const k = r * KAPPA
  path.moveTo(x + r, y)
  path.bezierCurveTo(x + r, y + k, x + k, y + r, x, y + r)
  path.bezierCurveTo(x - k, y + r, x - r, y + k, x - r, y)
  path.bezierCurveTo(x - r, y - k, x - k, y - r, x, y - r)
  path.bezierCurveTo(x + k, y - r, x + r, y - k, x + r, y)
  path.closePath()
}

/** Polygonized tip outline (clockwise in screen space), for tests and bounds math. */
export function ellipsePoints(node: StylusNode, segments = 32): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = []
  for (let i = 0; i < segments; i++) {
    const angle = (i / segments) * Math.PI * 2
    out.push({ x: node.x + node.r * Math.cos(angle), y: node.y + node.r * Math.sin(angle) })
  }
  return out
}

function signedArea(points: StylusNode[] | { x: number; y: number }[]): number {
  let sum = 0
  for (let i = 0; i < points.length; i++) {
    const a = points[i]
    const b = points[(i + 1) % points.length]
    sum += a.x * b.y - b.x * a.y
  }
  return sum / 2
}

/**
 * The convex hull (external tangents) shared by two neighbouring nodes, i.e. the
 * quad WPF calls `GetConnectingQuad`. `null` when one tip swallows the other.
 */
export function connectingQuadPoints(a: StylusNode, b: StylusNode): { x: number; y: number }[] | null {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const d = Math.hypot(dx, dy)
  if (d < 1e-6 || Math.abs(a.r - b.r) >= d) return null

  const theta = Math.atan2(dy, dx)
  const phi = Math.acos(Math.min(1, Math.max(-1, (a.r - b.r) / d)))
  // 两侧切点各一对；必须按 a+ → b+ → b- → a- 绕行，否则是自相交的蝴蝶结，
  // 非零填充会把中间挖空。
  const tangent = (sign: number) => {
    const angle = theta + sign * phi
    const ux = Math.cos(angle)
    const uy = Math.sin(angle)
    return {
      a: { x: a.x + a.r * ux, y: a.y + a.r * uy },
      b: { x: b.x + b.r * ux, y: b.y + b.r * uy },
    }
  }
  const plus = tangent(1)
  const minus = tangent(-1)
  const quad = [plus.a, plus.b, minus.b, minus.a]
  // Non-zero fill unions same-winding subpaths only: flip the quad to match the discs.
  return signedArea(quad) < 0 ? [quad[3], quad[2], quad[1], quad[0]] : quad
}

/**
 * Union of the swept ribbon, ready for `fill(path)` (non-zero winding).
 *
 * Like WPF, **every** adjacent sample pair contributes its tangent hull — that
 * body is what makes the silhouette continuous — and only pruned joints get a tip
 * disc. Callers pass `pruneNodes(...)` as `discs`; leaving it out renders every
 * disc.
 *
 * The hulls form **one** ribbon figure — forward along the `+` side, then back
 * along the `-` side in reverse — instead of one subpath per sample: rasterizing
 * a 1500-sample stroke costs ~1.8 ms as 1500 subpaths versus ~0.12 ms as one
 * ribbon (measured). Both the traversal order and the turn-around matter — per-hull
 * rings, or a forward `-` side, bridge across the stroke and fill 6× the ink.
 */
export function buildSweptPath(nodes: StylusNode[], discs: StylusNode[] = nodes): Path2D {
  const path = new Path2D()
  const quads: { x: number; y: number }[][] = []
  for (let i = 1; i < nodes.length; i++) {
    const quad = connectingQuadPoints(nodes[i - 1], nodes[i])
    if (quad) quads.push(quad)
  }

  if (quads.length > 0) {
    const forward: { x: number; y: number }[] = []
    const backward: { x: number; y: number }[] = []
    for (const [aPlus, bPlus, bMinus, aMinus] of quads) {
      forward.push(aPlus, bPlus)
      backward.push(aMinus, bMinus)
    }
    const ribbon = forward.concat(backward.reverse())
    // 非零填充要求色带与圆盘同向，方向取决于笔画走向
    const ordered = signedArea(ribbon) < 0 ? ribbon.slice().reverse() : ribbon
    path.moveTo(ordered[0].x, ordered[0].y)
    for (let i = 1; i < ordered.length; i++) path.lineTo(ordered[i].x, ordered[i].y)
    path.closePath()
  }

  for (const disc of discs) addEllipse(path, disc)
  return path
}

/** Nodes required before a live-ink chunk may be frozen. */
export const SWEPT_FREEZE_MIN_NODES = 64
/** Nodes kept re-outlined each frame behind the live tip. */
export const SWEPT_TAIL_NODES = 32
/** Nodes shared between a frozen chunk and the next slice so the seam is covered. */
export const SWEPT_CHUNK_OVERLAP_NODES = 8

/**
 * Next live-ink chunk to freeze: nodes `[chunkStart, end]` are rasterized once,
 * the live tail restarts at `nextStart` (overlapping by a few nodes so the
 * union seam stays hidden).
 */
export function planSweptFreeze(nodeCount: number, chunkStart: number): { end: number; nextStart: number } | null {
  const end = nodeCount - 1 - SWEPT_TAIL_NODES
  if (end - chunkStart < SWEPT_FREEZE_MIN_NODES) return null
  return { end, nextStart: Math.max(chunkStart + 1, end - SWEPT_CHUNK_OVERLAP_NODES) }
}

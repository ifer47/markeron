import type { Point } from '../composables/drawingTypes'

/**
 * Port of WPF's ink renderer (`StrokeRenderer.CalcGeometryAndBounds` +
 * `EllipticalNodeOperations`), the pipeline used by Ink Canvas Plus:
 *
 * - one **elliptical stroke node** per pointer sample (radius = width/2 × pressure curve)
 * - adjacent nodes joined by their **convex hull** (external tangents), so the
 *   silhouette is the exact swept ribbon with no polyline facets
 * - nodes **pruned** unless the direction changes past a tolerance or the node
 *   area changes a lot; pruned spans are covered by the tangent hull
 * - everything filled with the **non-zero** rule so overlaps merge into one shape
 *
 * Unlike perfect-freehand there is no extra speed-based thinning and no
 * min-distance decimation. Smoothness comes from three places: the tangent hull,
 * a position / pressure EMA, and **corner rounding** — a sharp turn is cut with a quadratic
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
   * Radius at zero pressure, as a multiple of `lineWidth / 2` (mouse = 1).
   * Keeps a light touch from collapsing the stroke into a hairline.
   */
  pressureFloor: number
  /** Radius added at full pressure, as a multiple of `lineWidth / 2`. */
  pressureRange: number
  /** Position EMA towards the previous stored sample; 0 = raw samples. */
  positionStreamline: number
  /** Steady-state pressure EMA coefficient; 0 = raw pressure (no width noise filtering). */
  pressureAlpha: number
  /**
   * Samples over which the pressure filter ramps from raw (1.0) down to
   * `pressureAlpha`. A cold EMA only closes 15% of the gap per sample, so the
   * first 10–20 samples would read as a thin lead-in.
   */
  pressureWarmupSamples: number
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
 * Pressure → width curve.
 *
 * WPF maps radius = Width / 2 × pressure, so a light touch (0.05–0.3 on most
 * tablets) collapses to 10–60% of the mouse width. Anchor mid pressure (0.5)
 * at the mouse width and bound the range instead: 55% at zero pressure, 145%
 * at full pressure.
 */
const PRESSURE_FLOOR = 0.55
const PRESSURE_RANGE = 0.9

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
  pressureFloor: PRESSURE_FLOOR,
  pressureRange: PRESSURE_RANGE,
  positionStreamline: 0.65,
  pressureAlpha: 0.15,
  pressureWarmupSamples: 6,
  pruneAngleDeg: SAFE_PRUNE_ANGLE_DEG,
  pruneAreaRatio: 0,
  cornerAngleDeg: 8,
  cornerCutRatio: 0.5,
  cornerCutMaxPx: 8,
}

/**
 * 笔锋: how the painted radius ramps at **both** ends of a stroke.
 *
 * WPF's `StrokeRenderer` only varies width through pressure, so a mouse — pinned
 * to pressure 0.5 — paints a constant ribbon with a round cap at both ends, which
 * reads as a marker instead of handwriting. These ramps are purely geometric, so a
 * mouse, a trackpad and a light stylus touch all get the same 锋 no matter what the
 * tablet reports.
 *
 * The two ends are deliberately **not** mirror images. A brush lays a short, sharp
 * 尖起 (露锋) when it lands fast, or a blunt 藏锋 when it presses first, and then
 * trails a long, thin 出锋 when it lifts: the entry ramp is an order of magnitude
 * shorter, convex instead of concave, and its tip leans the other way. Tapering
 * both ends with one shape is what reads as a symmetric leaf instead of a stroke.
 *
 * A real 锋 is also not a needle: the bristles lay a belly that keeps its width for
 * a while (the 肩), then trail off in a thin thread (the 尾), and the thread curls
 * away from the belly. {@link taperNodes} models both ends from arc length plus the
 * entry/exit speed and the exit turn, so two strokes never produce the same wedge.
 *
 * Distances are multiples of `lineWidth`, so the 锋 scales with the pen size: a
 * 1px hairline tapers over ~1px while a 9px marker tapers over ~30px.
 */
export interface TaperStyle {
  /** Entry ramp length as a multiple of `lineWidth` on a fast 露锋 landing. */
  startLength: number
  /** Radius multiplier at the first sample; the 尖起 tip. */
  startTipScale: number
  /**
   * Entry ramp exponent. < 1 flares the width straight out of a sharp 尖入 tip,
   * > 1 keeps a thin 藏锋 lip before the press takes over.
   */
  startExponent: number
  /**
   * Entry skew relative to the exit skew, 0…1. The entry tip leans opposite the
   * exit thread, which is what stops the two ends from mirroring each other.
   */
  startSkew: number
  /** Exit ramp length as a multiple of `lineWidth`, before the speed gain. */
  endLength: number
  /** Radius multiplier at the last sample; the thread's thickness. */
  endTipScale: number
  /**
   * Ramp exponent. > 1 keeps the thread thin for most of the ramp and flares it
   * into the belly (a brush 肩), < 1 collapses the width right at the tip (a needle).
   */
  profileExponent: number
  /** Longest share of the whole stroke the exit ramp may consume. */
  maxLengthRatio: number
  /** Extra ramp length per unit of normalized exit speed: a fast flick gets a longer 锋. */
  speedLengthGain: number
  /** How much a fast exit sharpens the thread, 0…1. */
  speedTipGain: number
  /**
   * Largest belly/thread length split, 0…1. 0 keeps the 锋 symmetric; 0.5 gives the
   * belly a ramp 3× as long as the thread.
   */
  skew: number
  /** Turn (radians) that counts as fully curved when picking the skew. */
  skewTurn: number
}

/**
 * Fountain-pen ink: a full-width touchdown (起笔) and a long, thin exit (出锋).
 *
 * The exit is the visible 笔锋 — the thread thins out over the last few widths and
 * flares into the belly where the nib was still pressed, which is what reads as a
 * brush rather than a wooden skewer.
 */
export const PEN_TAPER: TaperStyle = {
  startLength: 1,
  startTipScale: 0.28,
  startExponent: 0.8,
  startSkew: 0.6,
  endLength: 3.2,
  endTipScale: 0.24,
  profileExponent: 2.4,
  maxLengthRatio: 0.7,
  speedLengthGain: 0.9,
  speedTipGain: 0.4,
  skew: 0.5,
  skewTurn: 1,
}

/** Highlighter: a chisel swipe — a blunt touchdown, a soft tail, never a needle. */
export const HIGHLIGHTER_TAPER: TaperStyle = {
  startLength: 0.45,
  startTipScale: 0.6,
  startExponent: 1,
  startSkew: 0.15,
  endLength: 1.8,
  endTipScale: 0.3,
  profileExponent: 1.6,
  maxLengthRatio: 0.75,
  speedLengthGain: 0.45,
  speedTipGain: 0.2,
  skew: 0.2,
  skewTurn: 1.1,
}

/** Thinnest painted tip (CSS px): a hairline pen still ends in a visible point. */
export const MIN_TAPER_RADIUS = 0.18

/** Disabled 笔锋: a zero-length ramp turns `taperNodes` into a no-op. */
const NO_TAPER: TaperStyle = {
  startLength: 0,
  startTipScale: 1,
  startExponent: 1,
  startSkew: 0,
  endLength: 0,
  endTipScale: 1,
  profileExponent: 1,
  maxLengthRatio: 0,
  speedLengthGain: 0,
  speedTipGain: 0,
  skew: 0,
  skewTurn: 1,
}

/**
 * Global 笔锋 switch.
 *
 * The setting lives in `config.json` (`general.inkTaper`) and the overlay applies it
 * here, because every consumer — committed ribbons, the live tail, eraser hit testing —
 * resolves its style through {@link taperStyleFor}. Keeping it module-level avoids
 * threading a render-only preference through every draw call and action record.
 */
let inkTaperEnabled = true

export function setInkTaperEnabled(enabled: boolean): void {
  inkTaperEnabled = enabled
}

export function isInkTaperEnabled(): boolean {
  return inkTaperEnabled
}

/**
 * Excalidraw-style EMA towards the previous stored sample. Pressure is filtered
 * too: unfiltered pressure noise is what makes the silhouette look furry.
 *
 * The pressure filter warms up: a cold EMA only closes 15% of the gap per
 * sample, so a pen-down that starts light and presses harder would keep the
 * first 10–20 samples below the real pressure and leave a visible thin lead-in.
 */
export function smoothPenPoint(prev: Point, raw: Point, style: SweptStyle, index = 0): Point {
  const pull = 1 - style.positionStreamline
  const prevPressure = normalizePressure(prev.pressure)
  const rawPressure = normalizePressure(raw.pressure)
  const alpha = pressureAlphaAt(index, style)
  const pressure = alpha > 0 ? prevPressure + (rawPressure - prevPressure) * alpha : rawPressure
  return {
    x: style.positionStreamline > 0 ? prev.x + (raw.x - prev.x) * pull : raw.x,
    y: style.positionStreamline > 0 ? prev.y + (raw.y - prev.y) * pull : raw.y,
    pressure,
  }
}

/**
 * Pressure EMA coefficient for sample `index`: ramps from 1 (raw) down to
 * `pressureAlpha` across `pressureWarmupSamples`, then stays there.
 */
export function pressureAlphaAt(index: number, style: SweptStyle): number {
  if (!(style.pressureAlpha > 0)) return 0
  const warmup = Math.max(0, style.pressureWarmupSamples)
  if (warmup === 0 || index >= warmup) return style.pressureAlpha
  return 1 - (index / warmup) * (1 - style.pressureAlpha)
}

/** Build the stroke node for one sample (WPF `StrokeNodeData` radius). */
export function nodeFromPoint(
  point: Point,
  lineWidth: number,
  style: SweptStyle,
  pressureInk: boolean,
  widthScale = 1,
): StylusNode {
  const baseRadius = Math.max(0.5, lineWidth / 2)
  const pressureScale = pressureInk ? pressureRadiusScale(normalizePressure(point.pressure), style) : 1
  const r = Math.max(0.1, baseRadius * pressureScale * widthScale)
  return { x: point.x, y: point.y, r }
}

/**
 * 毛笔字 body: how the painted width follows how fast the nib is moving.
 *
 * A brush lays down ink while it dwells and runs dry when it races — the effect
 * `handWritingWithJS` gets by stamping a smaller brush the faster the pointer
 * moves. Reproducing it as a width multiplier keeps the renderer a single filled
 * ribbon, and keeps the eraser footprint, hit testing and the live preview on the
 * same numbers without a second code path.
 */
export interface BrushProfile {
  /** Nib speed (CSS px/ms) that paints at exactly the chosen width. */
  typicalSpeed: number
  /** Width swing per unit of normalized speed: how strongly speed shows up. */
  gain: number
  /** Widest a slow press paints, as a multiple of the chosen width. */
  slowScale: number
  /** Thinnest a fast flick paints. */
  fastScale: number
}

/**
 * Fountain-pen brush: ±40% around the chosen width between a careful stroke and a
 * quick flick. Tuned so handwriting stays legible at every speed while the width
 * swing is clearly visible.
 */
export const PEN_BRUSH: BrushProfile = {
  typicalSpeed: 0.9,
  gain: 0.4,
  slowScale: 1.3,
  fastScale: 0.42,
}

/** Fastest speed the profile reacts to, in CSS px/ms — spikes from coalesced events. */
const SPEED_CLAMP = 30

/** Width multiplier for a nib moving at `speed` CSS px/ms. */
export function brushWidthScale(speed: number, profile: BrushProfile = PEN_BRUSH): number {
  if (!(speed > 0)) return profile.slowScale
  const normalized = (Math.min(speed, SPEED_CLAMP) - profile.typicalSpeed) / profile.typicalSpeed
  const scale = 1 - profile.gain * normalized
  return Math.min(profile.slowScale, Math.max(profile.fastScale, scale))
}

/**
 * Brush profile for a tool: only the pen is a brush. A highlighter is a chisel
 * marker, so it keeps a constant width and only its ends taper.
 *
 * A hold-locked stroke has been collapsed into a line — a shape, not handwriting —
 * so it paints at the chosen width like the other shapes. Disabled 毛笔字效果
 * (`inkTaperEnabled` off) returns `null` as well, which leaves the plain marker look.
 */
export function brushProfileFor(tool: string | undefined | null, lockedLine = false): BrushProfile | null {
  if (!inkTaperEnabled || lockedLine || tool !== 'pen') return null
  return PEN_BRUSH
}

/** Width multiplier for a normalized pressure: `pressureFloor + pressureRange × p`. */
export function pressureRadiusScale(pressure: number, style: SweptStyle): number {
  return style.pressureFloor + style.pressureRange * pressure
}

/** Radius of a single-tap dot; identical to the swept stroke at the same pressure. */
export function dotRadius(point: Point, lineWidth: number, style: SweptStyle, pointerType?: string | null): number {
  return nodeFromPoint(point, lineWidth, style, usesPressureInk(pointerType)).r
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
  for (let i = 0; i < points.length; i++) {
    const raw = points[i]
    const current: Point = prev ? smoothPenPoint(prev, raw, style, i) : raw
    out.push(current)
    prev = current
  }
  return out
}

/**
 * Width multiplier for sample `index`, smoothed like pressure (EMA).
 *
 * Speed is distance over the event's own `timeStamp`, so the width follows the
 * hand rather than the event rate. A sample without timestamps (synthetic strokes,
 * older actions) paints at the chosen width instead of guessing.
 */
export function brushScaleAt(
  points: readonly Point[],
  index: number,
  style: SweptStyle,
  profile: BrushProfile | null,
  previous: number,
): number {
  if (!profile) return 1
  const point = points[index]
  const prev = index > 0 ? points[index - 1] : null
  if (!prev || point.t == null || prev.t == null) return 1
  const elapsed = point.t - prev.t
  if (!(elapsed > 0)) return 1
  const speed = Math.hypot(point.x - prev.x, point.y - prev.y) / elapsed
  const target = brushWidthScale(speed, profile)
  return previous + (target - previous) * pressureAlphaAt(index, style)
}

export function nodesFromSmoothedPoints(
  points: Point[],
  lineWidth: number,
  style: SweptStyle,
  pointerType?: string | null,
  profile: BrushProfile | null = null,
): StylusNode[] {
  const pressureInk = usesPressureInk(pointerType)
  const smoothed = smoothSamples(points, style)
  const scales = brushScales(points, style, profile)

  const out: StylusNode[] = []
  const count = smoothed.length
  if (count === 0) return out

  out.push(nodeFromPoint(smoothed[0], lineWidth, style, pressureInk, scales[0]))
  for (let i = 1; i < count - 1; i++) {
    for (const tip of roundCornerTips(smoothed[i - 1], smoothed[i], smoothed[i + 1], style)) {
      out.push(nodeFromPoint(tip, lineWidth, style, pressureInk, scales[i]))
    }
  }
  // The tip stays on the raw sample so the stroke never falls short of the pointer.
  if (count > 1) out.push(nodeFromPoint(points[count - 1], lineWidth, style, pressureInk, scales[count - 1]))
  return out
}

/** Smoothed width multiplier for every sample of a stroke. */
export function brushScales(points: readonly Point[], style: SweptStyle, profile: BrushProfile | null): number[] {
  const scales: number[] = new Array(points.length).fill(1)
  if (!profile) return scales
  for (let i = 1; i < points.length; i++) {
    scales[i] = brushScaleAt(points, i, style, profile, scales[i - 1])
  }
  return scales
}

/**
 * Taper preset for a tool: only the pen and the highlighter paint a swept ribbon.
 *
 * A hold-locked stroke (`lockedLine`) has been collapsed into a straight or bent
 * **line** — a shape, not handwriting — so it keeps a uniform width with round caps
 * at both ends. A 锋 there would read as if the straight line had been written by
 * hand and then left with two sharpened tips.
 */
export function taperStyleFor(tool: string | undefined | null, lockedLine = false): TaperStyle {
  if (!inkTaperEnabled || lockedLine) return NO_TAPER
  return tool === 'highlighter' ? HIGHLIGHTER_TAPER : PEN_TAPER
}

/** Arc length of a polyline, i.e. the distance the pen actually travels. */
export function polylineLength(points: readonly { x: number; y: number }[]): number {
  let total = 0
  for (let i = 1; i < points.length; i++) {
    total += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y)
  }
  return total
}

/** Ramp lengths for one stroke, in CSS px. */
export interface TaperRamps {
  /** Entry ramp: short and sharp on a 露锋 landing, gone on a 藏锋 press. */
  start: number
  /** Exit ramp on the belly side (肩): long, stretched by the exit speed. */
  belly: number
  /** Exit ramp on the thread side (尾): shorter than the belly, hence the skew. */
  thread: number
}

/**
 * Ramp lengths for both ends of one stroke.
 *
 * The three ramps share a single `maxLengthRatio` budget, so a 12px tick keeps a
 * full-width body instead of turning into three joining wedges — that is what makes
 * a fast dot read as a dot instead of a sliver.
 *
 * Exit speed (0…1) stretches the 出锋: a quick flick lifts the nib for longer than a
 * slow, deliberate press. Entry speed does the opposite — a fast landing leaves a
 * short 露锋, a slow press stays blunt (藏锋) — so the stroke starts the way it was
 * actually put down.
 */
export function taperRamps(
  totalLength: number,
  lineWidth: number,
  style: TaperStyle,
  metrics: TaperMetrics = NO_METRICS,
): TaperRamps {
  if (!(totalLength > 0) || !(lineWidth > 0)) return { start: 0, belly: 0, thread: 0 }

  const speed = clamp01(metrics.speed)
  const entry = clamp01(metrics.entrySpeed)
  const curvature = Math.min(1, Math.abs(metrics.turn) / Math.max(1e-6, style.skewTurn))
  const skew = Math.min(0.9, Math.max(0, style.skew) * (0.5 + 0.5 * curvature))

  let start = Math.max(0, style.startLength) * lineWidth * entry
  const base = Math.max(0, style.endLength) * lineWidth * (1 + Math.max(0, style.speedLengthGain) * speed)
  let belly = base * (1 + skew)
  let thread = base * (1 - skew)

  const budget = totalLength * Math.max(0, style.maxLengthRatio)
  const sum = start + belly
  if (sum > budget && sum > 1e-9) {
    const scale = budget / sum
    start *= scale
    belly *= scale
    thread *= scale
  }
  return { start, belly, thread }
}

function clamp01(value: number): number {
  return value > 0 ? (value < 1 ? value : 1) : 0
}

/** Samples averaged into the exit-speed proxy. */
const SPEED_SAMPLES = 6
/** Spacing (CSS px per sample) at or below which the exit counts as a slow press. */
const SPEED_SLOW_PX = 1
/** Spacing at or above which the exit counts as a fast flick. */
const SPEED_FAST_PX = 5
/** Segments summed into the exit turn. */
const TURN_SEGMENTS = 8

/**
 * Speed of both ends plus the turn of the stroke's exit.
 *
 * Everything has to be read from the **raw** samples: {@link pruneNodes} drops samples
 * on smooth stretches, so a pruned tail would report the ramp's own length as spacing
 * and a slow, straight stroke would look like the fastest flick in the app.
 *
 * Speed is spacing per pointer sample — the same proxy WPF's InkCanvas uses, since
 * the event rate is roughly constant, so distance ≈ speed. Turn is the signed sum of
 * the last few direction changes, which is what tells the 锋 which way to curl.
 */
export interface TaperMetrics {
  /** Normalized exit speed: 0 = slow press, 1 = fast flick. */
  speed: number
  /** Signed turn over the exit ramp in radians, positive = clockwise on screen. */
  turn: number
  /** Normalized entry speed: 0 = the nib landed and pressed (藏锋), 1 = flicked down (露锋). */
  entrySpeed: number
}

const NO_METRICS: TaperMetrics = { speed: 0, turn: 0, entrySpeed: 0 }

/** Map spacing per sample onto 0 (slow press) … 1 (fast flick). */
function normalizeSpeed(spacing: number, sampled: number): number {
  const perSample = spacing / Math.max(1, sampled)
  return clamp01((perSample - SPEED_SLOW_PX) / (SPEED_FAST_PX - SPEED_SLOW_PX))
}

export function taperMetrics(nodes: readonly StylusNode[]): TaperMetrics {
  const count = nodes.length
  if (count < 3) return NO_METRICS

  let spacing = 0
  let sampled = 0
  for (let i = count - 1; i > 0 && sampled < SPEED_SAMPLES; i--, sampled++) {
    spacing += Math.hypot(nodes[i].x - nodes[i - 1].x, nodes[i].y - nodes[i - 1].y)
  }
  const speed = normalizeSpeed(spacing, sampled)

  let entrySpacing = 0
  let entrySampled = 0
  for (let i = 1; i < count && entrySampled < SPEED_SAMPLES; i++, entrySampled++) {
    entrySpacing += Math.hypot(nodes[i].x - nodes[i - 1].x, nodes[i].y - nodes[i - 1].y)
  }
  const entrySpeed = normalizeSpeed(entrySpacing, entrySampled)

  const start = Math.max(1, count - TURN_SEGMENTS)
  let turn = 0
  let lastAngle = angleBetween(nodes[start - 1], nodes[start])
  for (let i = start + 1; i < count; i++) {
    const a = nodes[i - 1]
    const b = nodes[i]
    if (a.x === b.x && a.y === b.y) continue
    const angle = angleBetween(a, b)
    let delta = angle - lastAngle
    if (delta > 180) delta -= 360
    else if (delta < -180) delta += 360
    turn += (delta * Math.PI) / 180
    lastAngle = angle
  }

  return { speed, turn: Math.max(-Math.PI, Math.min(Math.PI, turn)), entrySpeed }
}

/**
 * Densify both ramps so a fast flick still gets a real 锋.
 *
 * Pointer samples can be 10–30px apart on a quick stroke while a ramp is only a few
 * widths long; without extra nodes the ramp would be sampled at its two endpoints and
 * the whole segment would read as a thin wedge. Points are inserted along the existing
 * segments with linearly interpolated radii, i.e. exactly on the polyline the hull
 * renderer would draw anyway.
 */
function densifyRamps(nodes: StylusNode[], start: number, end: number, lineWidth: number): StylusNode[] {
  const count = nodes.length
  if (count < 2 || (start <= 0 && end <= 0)) return nodes

  const total = polylineLength(nodes)
  // A ramp is a width ramp: resolve it far finer than the pen radius, so the
  // silhouette is a smooth curve rather than one long wedge.
  const maxSegment = Math.min(1.6, Math.max(0.6, lineWidth * 0.22))
  const out: StylusNode[] = [nodes[0]]
  let travelled = 0

  for (let i = 1; i < count; i++) {
    const a = nodes[i - 1]
    const b = nodes[i]
    const segment = Math.hypot(b.x - a.x, b.y - a.y)
    if (segment > maxSegment) {
      // Distances along this segment that fall inside either ramp. Clamping to the
      // segment keeps the cost proportional to the ramp length, not to a fast flick.
      const cuts: number[] = []
      const addRamp = (from: number, to: number) => {
        const lo = Math.max(0, from - travelled)
        const hi = Math.min(segment, to - travelled)
        for (let d = lo; d < hi - 1e-9; d += maxSegment) cuts.push(d)
        // Close the ramp exactly on its boundary, so the full-width run between the two
        // ramps is a straight hull instead of a 0.1px-deep valley.
        if (hi > lo + 1e-9 && hi < segment - 1e-9) cuts.push(hi)
      }
      if (start > 0) addRamp(0, start)
      if (end > 0) addRamp(total - end, total)
      cuts.sort((p, q) => p - q)

      let previous = 0
      for (const distance of cuts) {
        if (distance <= previous + 1e-9 || distance >= segment - 1e-9) continue
        const t = distance / segment
        out.push({
          x: a.x + (b.x - a.x) * t,
          y: a.y + (b.y - a.y) * t,
          r: a.r + (b.r - a.r) * t,
        })
        previous = distance
      }
    }
    out.push(b)
    travelled += segment
  }
  return out
}

/** How a slice of the stroke should be tapered. */
interface TaperOptions {
  /**
   * This slice starts at the pen-down sample. A frozen chunk's start is a seam inside
   * the stroke, so the live tail passes `false` — a ramp there would leave a notch.
   */
  taperStart?: boolean
  /**
   * This slice ends at the lifted tip. A frozen chunk's end is covered by the live
   * tail, so it passes `false` — a ramp there would leave an unpainted notch
   * mid-stroke.
   */
  taperEnd?: boolean
  /**
   * Entry / exit speed and exit turn, measured on the **raw** samples with
   * {@link taperMetrics}. Omitting it falls back to a symmetric, speed-agnostic ramp.
   */
  metrics?: TaperMetrics
}

/** Unit normal of the stroke at `index`, pointing to the right of travel (screen). */
function nodeNormal(nodes: readonly StylusNode[], index: number): { x: number; y: number } {
  const a = nodes[Math.max(0, index - 1)]
  const b = nodes[Math.min(nodes.length - 1, index + 1)]
  const dx = b.x - a.x
  const dy = b.y - a.y
  const length = Math.hypot(dx, dy)
  if (!(length > 1e-9)) return { x: 0, y: 0 }
  return { x: -dy / length, y: dx / length }
}

/**
 * Apply the 笔锋 ramps to a run of stroke nodes.
 *
 * `totalLength` is the arc length of the **whole** stroke (not of `nodes`): the
 * live preview re-outlines only its tail, and the ramp it draws there has to match
 * what `buildInkPath` will paint on pointer up, or the tail visibly sharpens when
 * the pointer is released.
 *
 * Neither end is a single symmetric shrink. At the exit each side gets its own
 * length — the belly (肩) keeps its width a while, the thread (尾) trails off — and
 * the whole tail is displaced towards the belly, so the 锋 reads as a brush lifted
 * off the paper. The entry is much shorter and convex (尖起 / 露锋), leans the other
 * way, and fades out entirely on a slow press (藏锋). Exit speed stretches the 出锋
 * and sharpens the thread; entry speed decides whether there is a 露锋 at all.
 *
 * Returns a new array; the input nodes may be cached and are never mutated.
 */
export function taperNodes(
  nodes: StylusNode[],
  lineWidth: number,
  totalLength: number,
  style: TaperStyle,
  { taperStart = true, taperEnd = true, metrics = NO_METRICS }: TaperOptions = {},
): StylusNode[] {
  const count = nodes.length
  if (count === 0) return nodes

  const ramps = taperRamps(totalLength, lineWidth, style, metrics)
  const entry = taperStart ? ramps.start : 0
  const belly = taperEnd ? ramps.belly : 0
  const thread = taperEnd ? ramps.thread : 0
  if (entry <= 1e-6 && belly <= 1e-6) return nodes

  const dense = densifyRamps(nodes, entry, Math.max(belly, thread), lineWidth)
  const denseCount = dense.length

  // Measure along the ink: a fast flick and a slow press taper over the same visual
  // distance, which is what makes either end read as a real nib.
  const cumulative: number[] = [0]
  for (let i = 1; i < denseCount; i++) {
    cumulative.push(cumulative[i - 1] + Math.hypot(dense[i].x - dense[i - 1].x, dense[i].y - dense[i - 1].y))
  }
  const last = cumulative[denseCount - 1]
  const exponent = style.profileExponent > 0 ? style.profileExponent : 1

  const speed = clamp01(metrics.speed)
  const tipScale = Math.min(1, Math.max(0.02, style.endTipScale * (1 - Math.max(0, style.speedTipGain) * speed)))
  const entryScale = Math.min(1, Math.max(0.02, style.startTipScale))
  const entryExponent = style.startExponent > 0 ? style.startExponent : 1
  const ramp = (tip: number, exp: number, distance: number, length: number): number =>
    tip + (1 - tip) * Math.pow(Math.min(1, distance / length), exp)

  // A brush leans its belly into the curve and trails the thin thread on the outside, so
  // the two edges never share a ramp length. The entry tip leans the other way, which is
  // what stops the two ends from mirroring each other into a leaf.
  const curvature = Math.min(1, Math.abs(metrics.turn) / Math.max(1e-6, style.skewTurn))
  const asym = Math.min(0.9, Math.max(0, style.skew) * (0.5 + 0.5 * curvature))
  const side = metrics.turn < 0 ? -1 : 1
  const entrySkew = asym * Math.min(1, Math.max(0, style.startSkew))

  const out: StylusNode[] = []
  for (let i = 0; i < denseCount; i++) {
    const node = dense[i]
    const fromEnd = last - cumulative[i]
    const fromStart = cumulative[i]
    const inEntry = entry > 1e-6 && fromStart < entry
    const inExit = belly > 1e-6 && fromEnd < Math.max(belly, thread)

    if (!inEntry && !inExit) {
      out.push(node)
      continue
    }

    // Two edges, two ramps: their mean is the painted radius. The centreline then drifts
    // towards the belly by however much the thread has already eaten into it, so the
    // deviation grows monotonically to the tip — the belly edge stays straight while the
    // thread cuts in, instead of both edges mirroring each other.
    let radius = node.r
    let shift = 0
    if (inExit) {
      const bellyRadius = node.r * ramp(tipScale, exponent, fromEnd, belly)
      const threadRadius = node.r * ramp(tipScale, exponent, fromEnd, thread)
      radius = (bellyRadius + threadRadius) / 2
      shift = (node.r - radius) * asym * side
    }
    if (inEntry) {
      const entryRadius = node.r * ramp(entryScale, entryExponent, fromStart, entry)
      radius = Math.min(radius, entryRadius)
      shift += (node.r - entryRadius) * entrySkew * -side
    }

    const normal = nodeNormal(dense, i)
    out.push({
      x: node.x + normal.x * shift,
      y: node.y + normal.y * shift,
      r: Math.max(MIN_TAPER_RADIUS, radius),
    })
  }
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
  private readonly profile: BrushProfile | null
  /** 毛笔字 width multiplier per sample, on the same EMA phase as the smoothing. */
  private readonly scales: number[] = []
  /** Arc length between the cached smoothed samples (the raw tip is added in `length`). */
  private arcLength = 0

  constructor(lineWidth: number, style: SweptStyle, pointerType?: string | null, profile: BrushProfile | null = null) {
    this.lineWidth = lineWidth
    this.style = style
    this.pressureInk = usesPressureInk(pointerType)
    this.profile = profile
  }

  /** Extend the cache to cover every sample and round whatever is settled. */
  sync(points: Point[]): void {
    while (this.smoothed.length < points.length) {
      const i = this.smoothed.length
      const prev = i > 0 ? this.smoothed[i - 1] : null
      const current = prev ? smoothPenPoint(prev, points[i], this.style, i) : points[i]
      if (prev) this.arcLength += Math.hypot(current.x - prev.x, current.y - prev.y)
      this.smoothed.push(current)
      this.scales.push(brushScaleAt(points, i, this.style, this.profile, i > 0 ? this.scales[i - 1] : 1))
    }

    // Samples 0…n-2 are settled: their rounded corner depends only on neighbours that exist.
    while (this.perSample.length < this.smoothed.length - 1) {
      const i = this.perSample.length
      const tips =
        i === 0
          ? [this.smoothed[0]]
          : roundCornerTips(this.smoothed[i - 1], this.smoothed[i], this.smoothed[i + 1], this.style)
      this.perSample.push(
        tips.map((tip) => nodeFromPoint(tip, this.lineWidth, this.style, this.pressureInk, this.scales[i])),
      )
    }
  }

  /**
   * Arc length of the painted centreline so far, including the raw tip.
   *
   * The live tail needs the same whole-stroke length `buildInkPath` measures when
   * it commits, otherwise a short stroke sharpens its ramps on pointer up.
   */
  length(points: Point[]): number {
    const count = this.smoothed.length
    if (count === 0 || points.length < count) return this.arcLength
    const last = this.smoothed[count - 1]
    const tip = points[count - 1]
    return this.arcLength + Math.hypot(tip.x - last.x, tip.y - last.y)
  }

  /** Node for sample `i`; `points` must already be synced. */
  nodeAt(points: Point[], i: number): StylusNode {
    const sample = i === points.length - 1 ? points[i] : this.smoothed[i]
    return nodeFromPoint(sample, this.lineWidth, this.style, this.pressureInk, this.scales[i] ?? 1)
  }

  /** Nodes for samples `[from, to]` inclusive — same values `nodesFromSmoothedPoints` yields. */
  nodes(points: Point[], from: number, to: number = points.length - 1): StylusNode[] {
    const out: StylusNode[] = []
    for (let i = from; i <= to; i++) {
      if (i === points.length - 1) {
        out.push(nodeFromPoint(points[i], this.lineWidth, this.style, this.pressureInk, this.scales[i] ?? 1))
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
  /** Direction of the segment that ends at the last **kept** node. */
  let keptAngle = 0
  let lastArea = 0
  let previousPreviousRendered = false

  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]
    const prev = i > 0 ? nodes[i - 1] : null
    const angle = prev ? angleBetween(prev, node) : 0

    let delta = 0
    // 转角必须相对「上一个保留的节点」量：只比相邻两点时，密集采样（慢速书写）
    // 的每个采样点只转几分之一度，整条曲线会被简化成一条弦。
    if (prev && (node.x !== prev.x || node.y !== prev.y)) {
      delta = Math.abs(angleDeltaFromLast(prev, node, keptAngle))
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
      keptAngle = angle
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

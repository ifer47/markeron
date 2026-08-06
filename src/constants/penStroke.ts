import getStroke from 'perfect-freehand'
import type { Point } from '../composables/drawingTypes'
import type { StrokeSmoothing } from '../utils/strokeSmoothing'

/** Base min distance in device pixels (squared) before adaptive area scaling. */
export const BASE_MIN_DIST_DEVICE_SQ = 4

/** Viewport area used as the 1.0 reference for adaptive sampling. */
export const BASE_VIEWPORT_AREA = 1440 * 900

/** Cap how aggressively large CSS viewports thin points (was 4 → ~4 CSS px). */
export const MAX_AREA_SCALE = 2

export interface PenStrokeStyle {
  /** Position streamline applied before points are stored (0 = off). */
  inputStreamline: number
  thinning: number
  smoothing: number
  /** Extra streamline inside perfect-freehand (kept low; we pre-smooth). */
  strokeStreamline: number
}

const STYLE_BY_LEVEL: Record<StrokeSmoothing, PenStrokeStyle> = {
  off: {
    inputStreamline: 0,
    thinning: 0.25,
    smoothing: 0.35,
    strokeStreamline: 0,
  },
  standard: {
    inputStreamline: 0.35,
    thinning: 0.55,
    smoothing: 0.45,
    strokeStreamline: 0.1,
  },
  strong: {
    inputStreamline: 0.5,
    thinning: 0.65,
    smoothing: 0.55,
    strokeStreamline: 0.15,
  },
}

export function penStrokeStyle(level: StrokeSmoothing): PenStrokeStyle {
  return STYLE_BY_LEVEL[level]
}

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

/**
 * Smooth one sample toward the previous stored point (Excalidraw-style).
 * Pressure is taken from the raw sample (not blended).
 */
export function smoothPenPoint(prev: Point, raw: Point, streamline: number): Point {
  if (streamline <= 0) return raw
  const pull = 1 - streamline
  return {
    x: prev.x + (raw.x - prev.x) * pull,
    y: prev.y + (raw.y - prev.y) * pull,
    pressure: raw.pressure,
  }
}

export type FreehandInputPoint = [number, number, number]

export function toFreehandInputs(points: Point[]): FreehandInputPoint[] {
  const out: FreehandInputPoint[] = []
  for (let i = 0; i < points.length; i++) {
    const p = points[i]
    out.push([p.x, p.y, normalizePressure(p.pressure)])
  }
  return out
}

export function getInkOutline(
  points: Point[],
  size: number,
  level: StrokeSmoothing,
  last: boolean,
  pointerType?: string | null,
): number[][] {
  if (points.length === 0) return []
  const style = penStrokeStyle(level)
  const pressureInk = usesPressureInk(pointerType)
  return getStroke(toFreehandInputs(points), {
    size: Math.max(1, size),
    // Mouse: no thinning (uniform). Pen/touch: real pressure only — never speed-simulate.
    thinning: pressureInk ? style.thinning : 0,
    smoothing: style.smoothing,
    streamline: style.strokeStreamline,
    simulatePressure: false,
    easing: (t) => t,
    start: { taper: 0, cap: true },
    end: { taper: 0, cap: true },
    last,
  })
}

/** Build a closed Path2D from a perfect-freehand outline. */
export function outlineToPath2D(outline: number[][]): Path2D {
  const path = new Path2D()
  if (outline.length < 2) {
    if (outline.length === 1) {
      path.moveTo(outline[0][0], outline[0][1])
      path.arc(outline[0][0], outline[0][1], 0.5, 0, Math.PI * 2)
    }
    return path
  }

  path.moveTo(outline[0][0], outline[0][1])
  for (let i = 1; i < outline.length - 1; i++) {
    const [x0, y0] = outline[i]
    const [x1, y1] = outline[i + 1]
    path.quadraticCurveTo(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2)
  }
  const last = outline[outline.length - 1]
  const first = outline[0]
  path.quadraticCurveTo(last[0], last[1], (last[0] + first[0]) / 2, (last[1] + first[1]) / 2)
  path.closePath()
  return path
}

import type { Point } from '../composables/drawingTypes'

/**
 * Eraser cursor footprint.
 *
 * The eraser cursor is the lucide eraser glyph — a diagonal eraser whose body sits
 * inside its 24 × 24 box (the nearest edge passes ~5.5 units from the pointer, the far
 * corner reaches ~10.5). Erasing with a disc therefore cannot line up with the icon: a
 * disc of the erase diameter starts many pixels before the icon touches, and a disc small
 * enough to stay inside the icon leaves ink under the icon unerased.
 *
 * So the object eraser tests the *body polygon* below — the shape the user sees — grown
 * by the stroke half-width and the AA/shadow tolerance. Keep in sync with the eraser
 * paths in `DrawingOverlay.vue`.
 */

/** Cursor viewBox edge (lucide 24 × 24 glyph space). */
export const ERASER_CURSOR_VIEWBOX = 24

/**
 * The eraser body outline in cursor viewBox space, clockwise.
 *
 * Traced from the glyph's `d` attribute, with each rounded corner sampled as its arc
 * (6 chords per corner, ≤0.03 units of error) so the footprint follows the painted
 * outline instead of cutting the corners. The chamfer `L12.834 21` is part of the
 * outline: dropping it would add the triangle between the chamfer and the bottom edge,
 * i.e. erase ink ~8 units outside the icon's bottom-right end.
 *
 * Must stay convex — every probe helper assumes a convex polygon.
 */
export const ERASER_BODY_POLYGON: readonly Point[] = [
  { x: 12.834, y: 21 },
  { x: 8, y: 21 },
  { x: 7.738, y: 20.983 },
  { x: 7.48, y: 20.932 },
  { x: 7.231, y: 20.848 },
  { x: 6.996, y: 20.732 },
  { x: 6.777, y: 20.586 },
  { x: 6.58, y: 20.413 },
  { x: 2.586, y: 16.414 },
  { x: 2.268, y: 16 },
  { x: 2.069, y: 15.518 },
  { x: 2, y: 15 },
  { x: 2.069, y: 14.482 },
  { x: 2.268, y: 14 },
  { x: 2.586, y: 13.586 },
  { x: 12.586, y: 3.586 },
  { x: 13, y: 3.268 },
  { x: 13.483, y: 3.068 },
  { x: 14, y: 3 },
  { x: 14.518, y: 3.068 },
  { x: 15.001, y: 3.268 },
  { x: 15.415, y: 3.586 },
  { x: 21.414, y: 9.586 },
  { x: 21.732, y: 10 },
  { x: 21.931, y: 10.482 },
  { x: 22, y: 11 },
  { x: 21.931, y: 11.518 },
  { x: 21.732, y: 12 },
  { x: 21.414, y: 12.414 },
]

/** Half the glyph stroke (the paint reaches this far past the body outline). */
export const ERASER_GLYPH_HALF_STROKE = 1

/**
 * Extra reach covering what the eye reads as the glyph's edge: the `drop-shadow(0 0 1px)`
 * halo plus anti-aliasing.
 *
 * CSS px, not viewBox units: the shadow is a fixed 1px blur whatever the glyph size, so
 * a proportional tolerance would vanish on a small eraser and over-reach on a large one.
 * Without it the eraser looks like it touches ink ~1px before it erases.
 */
export const ERASER_FOOTPRINT_TOLERANCE_PX = 0.5

/** A convex probe shape: the eraser body as the user sees it, in screen space. */
export interface EraserFootprint {
  /** Painted eraser body in CSS px, clockwise. */
  polygon: Point[]
  /** How far the visible glyph reaches past `polygon` (half the stroke + AA/shadow). */
  expand: number
  /** Bounds of `polygon` grown by `expand`. */
  bounds: { x1: number; y1: number; x2: number; y2: number }
}

/**
 * Place the eraser glyph — `cursorSize` CSS px square, centred on the pointer — in
 * screen space. `cursorSize` must be the rendered glyph size so the footprint and the
 * cursor stay the same shape.
 */
export function buildEraserFootprint(centerX: number, centerY: number, cursorSize: number): EraserFootprint {
  const scale = (Number.isFinite(cursorSize) ? cursorSize : 0) / ERASER_CURSOR_VIEWBOX
  const half = ERASER_CURSOR_VIEWBOX / 2
  const expand = ERASER_GLYPH_HALF_STROKE * scale + ERASER_FOOTPRINT_TOLERANCE_PX

  const polygon: Point[] = ERASER_BODY_POLYGON.map((v) => ({
    x: centerX + (v.x - half) * scale,
    y: centerY + (v.y - half) * scale,
  }))

  let x1 = Infinity
  let y1 = Infinity
  let x2 = -Infinity
  let y2 = -Infinity
  for (const v of polygon) {
    if (v.x < x1) x1 = v.x
    if (v.x > x2) x2 = v.x
    if (v.y < y1) y1 = v.y
    if (v.y > y2) y2 = v.y
  }

  return { polygon, expand, bounds: { x1: x1 - expand, y1: y1 - expand, x2: x2 + expand, y2: y2 + expand } }
}

import { describe, it, expect } from 'vitest'
import type { DrawAction, Point } from './drawingTypes'
import {
  computeBbox,
  computeTextBbox,
  quadraticBounds,
  quadraticControlFromHandle,
  curveBendPoint,
  sampleQuadratic,
  isCurvedLinearAction,
  bboxesIntersect,
  cloneActionWithOffset,
  offsetAttachedErasers,
  updateShapeHitCache,
  distToSeg,
  distancePointToSegment,
  snapPointToAngle,
  perfectCircleCornersFromCenter,
  hitTestAction,
  actionInkNodes,
  hitTestActionWithFootprint,
  inkHalfWidth,
  pointInConvexPolygon,
  distancePointToConvexPolygon,
  distanceSegmentToConvexPolygon,
  convexPolygonsOverlap,
  rotatePointAround,
} from './drawingGeometry'
import {
  buildEraserFootprint,
  ERASER_FOOTPRINT_TOLERANCE_PX,
  ERASER_GLYPH_HALF_STROKE,
  type EraserFootprint,
} from '../utils/eraserFootprint'
import { PEN_TAPER } from '../constants/sweptStylus'

function makeAction(overrides: Partial<DrawAction> = {}): DrawAction {
  return {
    tool: 'pen',
    color: '#FF0000',
    lineWidth: 3,
    opacity: 1,
    points: [],
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// computeBbox
// ---------------------------------------------------------------------------
describe('computeBbox', () => {
  it('returns undefined for empty points', () => {
    const action = makeAction({ points: [] })
    expect(computeBbox(action, 10)).toBeUndefined()
  })

  it('computes bbox for a single point with padding', () => {
    const action = makeAction({ points: [{ x: 50, y: 80 }] })
    const bbox = computeBbox(action, 5)
    expect(bbox).toEqual({ x1: 45, y1: 75, x2: 55, y2: 85 })
  })

  it('computes bbox for multiple points', () => {
    const action = makeAction({
      points: [
        { x: 10, y: 20 },
        { x: 40, y: 5 },
        { x: 25, y: 50 },
      ],
    })
    const bbox = computeBbox(action, 0)
    expect(bbox).toEqual({ x1: 10, y1: 5, x2: 40, y2: 50 })
  })

  it('applies padding symmetrically', () => {
    const action = makeAction({
      points: [
        { x: 0, y: 0 },
        { x: 100, y: 100 },
      ],
    })
    const bbox = computeBbox(action, 15)
    expect(bbox).toEqual({ x1: -15, y1: -15, x2: 115, y2: 115 })
  })

  it('handles negative coordinates', () => {
    const action = makeAction({
      points: [
        { x: -30, y: -10 },
        { x: 20, y: 40 },
      ],
    })
    const bbox = computeBbox(action, 0)
    expect(bbox).toEqual({ x1: -30, y1: -10, x2: 20, y2: 40 })
  })

  it('uses the curve, not the control point, for a bent line/arrow bbox', () => {
    for (const tool of ['line', 'arrow'] as const) {
      const action = makeAction({
        tool,
        points: [
          { x: 0, y: 0 },
          { x: 50, y: 80 },
          { x: 100, y: 0 },
        ],
      })
      expect(computeBbox(action, 0)).toEqual({ x1: 0, y1: 0, x2: 100, y2: 40 })
    }
  })
})

// ---------------------------------------------------------------------------
// bboxesIntersect
// ---------------------------------------------------------------------------
describe('bboxesIntersect', () => {
  it('detects overlapping boxes', () => {
    const a = { x1: 0, y1: 0, x2: 10, y2: 10 }
    const b = { x1: 5, y1: 5, x2: 15, y2: 15 }
    expect(bboxesIntersect(a, b)).toBe(true)
  })

  it('detects non-overlapping boxes', () => {
    const a = { x1: 0, y1: 0, x2: 10, y2: 10 }
    const b = { x1: 20, y1: 20, x2: 30, y2: 30 }
    expect(bboxesIntersect(a, b)).toBe(false)
  })

  it('detects edge-touching boxes as intersecting', () => {
    const a = { x1: 0, y1: 0, x2: 10, y2: 10 }
    const b = { x1: 10, y1: 0, x2: 20, y2: 10 }
    expect(bboxesIntersect(a, b)).toBe(true)
  })

  it('detects containment', () => {
    const outer = { x1: 0, y1: 0, x2: 100, y2: 100 }
    const inner = { x1: 20, y1: 20, x2: 40, y2: 40 }
    expect(bboxesIntersect(outer, inner)).toBe(true)
    expect(bboxesIntersect(inner, outer)).toBe(true)
  })

  it('returns false when separated on Y axis only', () => {
    const a = { x1: 0, y1: 0, x2: 10, y2: 10 }
    const b = { x1: 0, y1: 11, x2: 10, y2: 20 }
    expect(bboxesIntersect(a, b)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// cloneActionWithOffset
// ---------------------------------------------------------------------------
describe('cloneActionWithOffset', () => {
  it('offsets points by (dx, dy)', () => {
    const action = makeAction({
      points: [
        { x: 10, y: 20 },
        { x: 30, y: 40 },
      ],
    })
    const cloned = cloneActionWithOffset(action, 5, -3)
    expect(cloned.points).toEqual([
      { x: 15, y: 17 },
      { x: 35, y: 37 },
    ])
  })

  it('preserves pressure and pointerType when offsetting', () => {
    const action = makeAction({
      pointerType: 'pen',
      points: [
        { x: 10, y: 20, pressure: 0.4 },
        { x: 30, y: 40, pressure: 0.8 },
      ],
    })
    const cloned = cloneActionWithOffset(action, 5, -3)
    expect(cloned.pointerType).toBe('pen')
    expect(cloned.points).toEqual([
      { x: 15, y: 17, pressure: 0.4 },
      { x: 35, y: 37, pressure: 0.8 },
    ])
  })

  it('offsets bbox', () => {
    const action = makeAction({
      points: [{ x: 0, y: 0 }],
      bbox: { x1: 0, y1: 0, x2: 100, y2: 100 },
    })
    const cloned = cloneActionWithOffset(action, 10, 20)
    expect(cloned.bbox).toEqual({ x1: 10, y1: 20, x2: 110, y2: 120 })
  })

  it('offsets rectHit', () => {
    const action = makeAction({
      points: [{ x: 0, y: 0 }],
      rectHit: { x0: 0, y0: 0, x1: 50, y1: 50 },
    })
    const cloned = cloneActionWithOffset(action, -5, 10)
    expect(cloned.rectHit).toEqual({ x0: -5, y0: 10, x1: 45, y1: 60 })
  })

  it('offsets ellipseHit (cx/cy only, rx/ry unchanged)', () => {
    const action = makeAction({
      points: [{ x: 0, y: 0 }],
      ellipseHit: { cx: 50, cy: 50, rx: 30, ry: 20 },
    })
    const cloned = cloneActionWithOffset(action, 10, 10)
    expect(cloned.ellipseHit).toEqual({ cx: 60, cy: 60, rx: 30, ry: 20 })
  })

  it('preserves undefined optional fields', () => {
    const action = makeAction({ points: [{ x: 0, y: 0 }] })
    const cloned = cloneActionWithOffset(action, 1, 1)
    expect(cloned.bbox).toBeUndefined()
    expect(cloned.rectHit).toBeUndefined()
    expect(cloned.ellipseHit).toBeUndefined()
    expect(cloned.attachedErasers).toBeUndefined()
  })

  it('recursively offsets attachedErasers', () => {
    const eraser = makeAction({
      tool: 'eraser',
      points: [{ x: 5, y: 5 }],
      bbox: { x1: 0, y1: 0, x2: 10, y2: 10 },
    })
    const action = makeAction({
      points: [{ x: 20, y: 20 }],
      attachedErasers: [eraser],
    })
    const cloned = cloneActionWithOffset(action, 100, 200)
    expect(cloned.attachedErasers).toHaveLength(1)
    expect(cloned.attachedErasers![0].points[0]).toEqual({ x: 105, y: 205 })
    expect(cloned.attachedErasers![0].bbox).toEqual({ x1: 100, y1: 200, x2: 110, y2: 210 })
  })

  it('gives the clone its own textOutline style object', () => {
    const action = makeAction({
      tool: 'text',
      points: [{ x: 10, y: 20 }],
      text: 'A',
      textOutline: { enabled: true, colorMode: 'fixed', color: '#000000', width: 2 },
    })
    const cloned = cloneActionWithOffset(action, 10, 10)

    expect(cloned.textOutline).toEqual(action.textOutline)
    expect(cloned.textOutline).not.toBe(action.textOutline)
    cloned.textOutline!.width = 99
    expect(action.textOutline!.width).toBe(2)
  })

  it('does not mutate the original action', () => {
    const action = makeAction({
      points: [{ x: 10, y: 20 }],
      bbox: { x1: 5, y1: 15, x2: 15, y2: 25 },
    })
    cloneActionWithOffset(action, 99, 99)
    expect(action.points[0]).toEqual({ x: 10, y: 20 })
    expect(action.bbox).toEqual({ x1: 5, y1: 15, x2: 15, y2: 25 })
  })
})

// ---------------------------------------------------------------------------
// offsetAttachedErasers
// ---------------------------------------------------------------------------
describe('offsetAttachedErasers', () => {
  it('does nothing when no attachedErasers', () => {
    const action = makeAction({ points: [{ x: 0, y: 0 }] })
    offsetAttachedErasers(action, 10, 10)
    expect(action.attachedErasers).toBeUndefined()
  })

  it('does nothing for empty attachedErasers array', () => {
    const action = makeAction({ points: [{ x: 0, y: 0 }], attachedErasers: [] })
    offsetAttachedErasers(action, 10, 10)
    expect(action.attachedErasers).toEqual([])
  })

  it('offsets each attached eraser in place', () => {
    const e1 = makeAction({ tool: 'eraser', points: [{ x: 10, y: 20 }] })
    const e2 = makeAction({ tool: 'eraser', points: [{ x: 30, y: 40 }] })
    const action = makeAction({ points: [{ x: 0, y: 0 }], attachedErasers: [e1, e2] })
    offsetAttachedErasers(action, 5, -5)
    expect(action.attachedErasers![0].points[0]).toEqual({ x: 15, y: 15 })
    expect(action.attachedErasers![1].points[0]).toEqual({ x: 35, y: 35 })
  })
})

// ---------------------------------------------------------------------------
// updateShapeHitCache
// ---------------------------------------------------------------------------
describe('updateShapeHitCache', () => {
  it('clears caches for fewer than 2 points', () => {
    const action = makeAction({
      tool: 'rect',
      points: [{ x: 0, y: 0 }],
      rectHit: { x0: 0, y0: 0, x1: 1, y1: 1 },
    })
    updateShapeHitCache(action)
    expect(action.rectHit).toBeUndefined()
    expect(action.ellipseHit).toBeUndefined()
  })

  it('computes rectHit for rect tool', () => {
    const action = makeAction({
      tool: 'rect',
      points: [
        { x: 30, y: 10 },
        { x: 10, y: 50 },
      ],
    })
    updateShapeHitCache(action)
    expect(action.rectHit).toEqual({ x0: 10, y0: 10, x1: 30, y1: 50 })
    expect(action.ellipseHit).toBeUndefined()
  })

  it('computes ellipseHit for ellipse tool', () => {
    const action = makeAction({
      tool: 'ellipse',
      points: [
        { x: 0, y: 0 },
        { x: 100, y: 60 },
      ],
    })
    updateShapeHitCache(action)
    expect(action.ellipseHit).toEqual({ cx: 50, cy: 30, rx: 50, ry: 30 })
    expect(action.rectHit).toBeUndefined()
  })

  it('does nothing for pen tool', () => {
    const action = makeAction({
      tool: 'pen',
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 10 },
      ],
    })
    updateShapeHitCache(action)
    expect(action.rectHit).toBeUndefined()
    expect(action.ellipseHit).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// distToSeg / distancePointToSegment
// ---------------------------------------------------------------------------
describe('distToSeg', () => {
  it('returns 0 when point is on the segment', () => {
    expect(distToSeg(5, 0, 0, 0, 10, 0)).toBe(0)
  })

  it('returns perpendicular distance to mid-segment', () => {
    expect(distToSeg(5, 3, 0, 0, 10, 0)).toBe(3)
  })

  it('returns distance to nearest endpoint when projection falls outside', () => {
    const d = distToSeg(15, 0, 0, 0, 10, 0)
    expect(d).toBe(5)
  })

  it('handles degenerate segment (single point)', () => {
    const d = distToSeg(3, 4, 0, 0, 0, 0)
    expect(d).toBe(5)
  })

  it('handles diagonal segment', () => {
    // perpendicular distance from (0,1) to segment (0,0)→(1,1) = 1/√2
    const d = distToSeg(0, 1, 0, 0, 1, 1)
    expect(d).toBeCloseTo(Math.SQRT1_2, 10)
  })
})

describe('distancePointToSegment', () => {
  it('delegates to distToSeg with Point objects', () => {
    const p: Point = { x: 5, y: 3 }
    const a: Point = { x: 0, y: 0 }
    const b: Point = { x: 10, y: 0 }
    expect(distancePointToSegment(p, a, b)).toBe(3)
  })
})

// ---------------------------------------------------------------------------
// snapPointToAngle
// ---------------------------------------------------------------------------
describe('snapPointToAngle', () => {
  it('keeps the raw point when the segment is already aligned', () => {
    const snapped = snapPointToAngle({ x: 0, y: 0 }, { x: 100, y: 0 })
    expect(snapped.x).toBeCloseTo(100)
    expect(snapped.y).toBeCloseTo(0)
  })

  it('snaps to the nearest 15-degree angle while preserving length', () => {
    const snapped = snapPointToAngle({ x: 0, y: 0 }, { x: 100, y: 50 })
    const angle = Math.atan2(snapped.y, snapped.x)
    expect((angle * 180) / Math.PI).toBeCloseTo(30, 1)
    expect(Math.hypot(snapped.x, snapped.y)).toBeCloseTo(Math.hypot(100, 50), 10)
  })

  it('supports fine custom steps (1 degree) with fractional values', () => {
    const snapped = snapPointToAngle({ x: 0, y: 0 }, { x: 100, y: 37 }, 1)
    const angleDeg = (Math.atan2(snapped.y, snapped.x) * 180) / Math.PI
    expect(angleDeg).toBeCloseTo(Math.round((Math.atan2(37, 100) * 180) / Math.PI), 5)
    expect(Math.hypot(snapped.x, snapped.y)).toBeCloseTo(Math.hypot(100, 37), 10)
  })

  it('returns a copy of the raw point when length is zero', () => {
    const raw = { x: 10, y: 10 }
    const snapped = snapPointToAngle({ x: 10, y: 10 }, raw)
    expect(snapped).toEqual(raw)
    expect(snapped).not.toBe(raw)
  })
})

// ---------------------------------------------------------------------------
// perfectCircleCornersFromCenter
// ---------------------------------------------------------------------------
describe('perfectCircleCornersFromCenter', () => {
  it('expands equally in all directions from the center', () => {
    const { start, end } = perfectCircleCornersFromCenter({ x: 100, y: 80 }, { x: 130, y: 80 })
    expect(start).toEqual({ x: 70, y: 50 })
    expect(end).toEqual({ x: 130, y: 110 })
  })

  it('uses Euclidean distance so diagonal drags grow the full radius', () => {
    const { start, end } = perfectCircleCornersFromCenter({ x: 0, y: 0 }, { x: 30, y: 40 })
    expect(start.x).toBeCloseTo(-50)
    expect(start.y).toBeCloseTo(-50)
    expect(end.x).toBeCloseTo(50)
    expect(end.y).toBeCloseTo(50)
  })

  it('collapses to a point when the pointer is on the center', () => {
    const { start, end } = perfectCircleCornersFromCenter({ x: 12, y: 34 }, { x: 12, y: 34 })
    expect(start).toEqual({ x: 12, y: 34 })
    expect(end).toEqual({ x: 12, y: 34 })
  })
})

// ---------------------------------------------------------------------------
// hitTestAction
// ---------------------------------------------------------------------------
describe('hitTestAction', () => {
  describe('general', () => {
    it('returns false for empty points', () => {
      const action = makeAction({ points: [] })
      expect(hitTestAction(action, { x: 0, y: 0 })).toBe(false)
    })

    it('returns false when point is outside bbox', () => {
      const action = makeAction({
        points: [
          { x: 0, y: 0 },
          { x: 10, y: 10 },
        ],
        bbox: { x1: -5, y1: -5, x2: 15, y2: 15 },
      })
      expect(hitTestAction(action, { x: 100, y: 100 })).toBe(false)
    })
  })

  describe('pen tool', () => {
    it('hits a single-point pen stroke', () => {
      const action = makeAction({
        tool: 'pen',
        lineWidth: 3,
        points: [{ x: 50, y: 50 }],
        bbox: { x1: 40, y1: 40, x2: 60, y2: 60 },
      })
      expect(hitTestAction(action, { x: 50, y: 50 })).toBe(true)
    })

    it('hits near a pen segment', () => {
      const action = makeAction({
        tool: 'pen',
        lineWidth: 3,
        points: [
          { x: 0, y: 0 },
          { x: 100, y: 0 },
        ],
        bbox: { x1: -15, y1: -15, x2: 115, y2: 15 },
      })
      expect(hitTestAction(action, { x: 50, y: 5 })).toBe(true)
    })

    it('misses far from a pen segment', () => {
      const action = makeAction({
        tool: 'pen',
        lineWidth: 3,
        points: [
          { x: 0, y: 0 },
          { x: 100, y: 0 },
        ],
        bbox: { x1: -15, y1: -50, x2: 115, y2: 50 },
      })
      expect(hitTestAction(action, { x: 50, y: 40 })).toBe(false)
    })

    it('extraMargin expands hit radius', () => {
      const action = makeAction({
        tool: 'pen',
        lineWidth: 3,
        points: [
          { x: 0, y: 0 },
          { x: 100, y: 0 },
        ],
        bbox: { x1: -15, y1: -50, x2: 115, y2: 50 },
      })
      expect(hitTestAction(action, { x: 50, y: 40 }, 30)).toBe(true)
    })
  })

  describe('highlighter tool', () => {
    it('hits near a highlighter segment', () => {
      const action = makeAction({
        tool: 'highlighter',
        lineWidth: 20,
        points: [
          { x: 0, y: 0 },
          { x: 100, y: 0 },
        ],
        bbox: { x1: -25, y1: -25, x2: 125, y2: 25 },
      })
      expect(hitTestAction(action, { x: 50, y: 8 })).toBe(true)
    })
  })

  describe('line tool', () => {
    it('hits near a line', () => {
      const action = makeAction({
        tool: 'line',
        lineWidth: 3,
        points: [
          { x: 0, y: 0 },
          { x: 100, y: 0 },
        ],
        bbox: { x1: -15, y1: -15, x2: 115, y2: 15 },
      })
      expect(hitTestAction(action, { x: 50, y: 5 })).toBe(true)
    })

    it('misses far from a line', () => {
      const action = makeAction({
        tool: 'line',
        lineWidth: 3,
        points: [
          { x: 0, y: 0 },
          { x: 100, y: 0 },
        ],
        bbox: { x1: -15, y1: -50, x2: 115, y2: 50 },
      })
      expect(hitTestAction(action, { x: 50, y: 40 })).toBe(false)
    })

    it('returns false for line with fewer than 2 points', () => {
      const action = makeAction({
        tool: 'line',
        points: [{ x: 0, y: 0 }],
        bbox: { x1: -15, y1: -15, x2: 15, y2: 15 },
      })
      expect(hitTestAction(action, { x: 0, y: 0 })).toBe(false)
    })
  })

  describe('arrow tool', () => {
    it('detects bent lines and arrows by point count', () => {
      for (const tool of ['line', 'arrow'] as const) {
        expect(
          isCurvedLinearAction(
            makeAction({
              tool,
              points: [
                { x: 0, y: 0 },
                { x: 100, y: 0 },
              ],
            }),
          ),
        ).toBe(false)
        expect(
          isCurvedLinearAction(
            makeAction({
              tool,
              points: [
                { x: 0, y: 0 },
                { x: 50, y: 80 },
                { x: 100, y: 0 },
              ],
            }),
          ),
        ).toBe(true)
      }
      expect(
        isCurvedLinearAction(
          makeAction({
            tool: 'rect',
            points: [
              { x: 0, y: 0 },
              { x: 50, y: 80 },
              { x: 100, y: 0 },
            ],
          }),
        ),
      ).toBe(false)
    })

    it('hits near a curved line/arrow shaft', () => {
      for (const tool of ['line', 'arrow'] as const) {
        const action = makeAction({
          tool,
          lineWidth: 3,
          points: [
            { x: 0, y: 0 },
            { x: 50, y: 80 },
            { x: 100, y: 0 },
          ],
          bbox: { x1: -15, y1: -15, x2: 115, y2: 55 },
        })
        // B(0.5) = (50, 40) sits on the curve.
        expect(hitTestAction(action, { x: 50, y: 40 })).toBe(true)
        expect(hitTestAction(action, { x: 50, y: 70 })).toBe(false)
      }
    })

    it('hits near an arrow shaft', () => {
      const action = makeAction({
        tool: 'arrow',
        lineWidth: 3,
        points: [
          { x: 0, y: 0 },
          { x: 100, y: 0 },
        ],
        bbox: { x1: -15, y1: -15, x2: 115, y2: 15 },
      })
      expect(hitTestAction(action, { x: 50, y: 5 })).toBe(true)
    })
  })

  describe('quadratic arrow helpers', () => {
    const p0 = { x: 0, y: 0 }
    const c = { x: 50, y: 80 }
    const p1 = { x: 100, y: 0 }

    it('computes tight bounds from curve extrema, not the control point', () => {
      const b = quadraticBounds(p0, c, p1)
      expect(b.x0).toBeCloseTo(0, 5)
      expect(b.y0).toBeCloseTo(0, 5)
      expect(b.x1).toBeCloseTo(100, 5)
      expect(b.y1).toBeCloseTo(40, 5)
    })

    it('round-trips the bend handle through the control point', () => {
      const control = quadraticControlFromHandle(p0, p1, { x: 50, y: 40 })
      expect(control.x).toBeCloseTo(50, 5)
      expect(control.y).toBeCloseTo(80, 5)

      for (const tool of ['line', 'arrow'] as const) {
        const action = makeAction({ tool, points: [p0, control, p1] })
        expect(curveBendPoint(action)).toMatchObject({ x: 50, y: 40 })
      }
    })

    it('uses the chord midpoint for a straight line/arrow bend handle', () => {
      for (const tool of ['line', 'arrow'] as const) {
        const action = makeAction({
          tool,
          points: [
            { x: 0, y: 0 },
            { x: 100, y: 60 },
          ],
        })
        expect(curveBendPoint(action)).toMatchObject({ x: 50, y: 30 })
      }
      expect(curveBendPoint(makeAction({ tool: 'rect', points: [p0, p1] }))).toBeNull()
    })

    it('samples inclusive endpoints', () => {
      const samples = sampleQuadratic(p0, c, p1, 4)
      expect(samples).toHaveLength(5)
      expect(samples[0]).toMatchObject({ x: 0, y: 0 })
      expect(samples[4]).toMatchObject({ x: 100, y: 0 })
      expect(samples[2]).toMatchObject({ x: 50, y: 40 })
    })
  })

  describe('hold-locked ink', () => {
    const straight = makeAction({
      tool: 'pen',
      lockedLine: true,
      points: [
        { x: 0, y: 0, pressure: 0.6 },
        { x: 100, y: 0, pressure: 0.6 },
      ],
    })
    const bent = makeAction({
      tool: 'pen',
      lockedLine: true,
      points: [
        { x: 0, y: 0, pressure: 0.6 },
        { x: 50, y: 80, pressure: 0.6 },
        { x: 100, y: 0, pressure: 0.6 },
      ],
    })

    it('treats only locked ink as a bendable linear path', () => {
      expect(isCurvedLinearAction(straight)).toBe(false)
      expect(isCurvedLinearAction(bent)).toBe(true)
      expect(
        isCurvedLinearAction(
          makeAction({
            tool: 'pen',
            points: [
              { x: 0, y: 0 },
              { x: 50, y: 80 },
              { x: 100, y: 0 },
            ],
          }),
        ),
      ).toBe(false)
      expect(curveBendPoint(straight)).toMatchObject({ x: 50, y: 0 })
      expect(curveBendPoint(bent)).toMatchObject({ x: 50, y: 40 })
    })

    it('uses the curve for bbox and hit testing', () => {
      expect(computeBbox(bent, 0)).toEqual({ x1: 0, y1: 0, x2: 100, y2: 40 })
      expect(hitTestAction(bent, { x: 50, y: 40 })).toBe(true)
      expect(hitTestAction(bent, { x: 50, y: 70 })).toBe(false)
    })

    it('paints a locked line at uniform width — a shape carries no 锋', () => {
      const ink = actionInkNodes(straight)!
      // 3 / 2 = 1.5px at every sample, tip included: two round caps, no taper.
      expect(Math.min(...ink.map((n) => n.r))).toBeCloseTo(1.5, 10)
      expect(Math.max(...ink.map((n) => n.r))).toBeCloseTo(1.5, 10)

      // The same samples as freehand ink still taper the lifted tip.
      const freehand = actionInkNodes({ ...straight, lockedLine: false })!
      expect(freehand[freehand.length - 1].r).toBeLessThan(1.5)
      expect(freehand[0].r).toBeCloseTo(1.5, 10)
    })
  })

  describe('rect tool', () => {
    it('hits on the edge of a rectangle', () => {
      const action = makeAction({
        tool: 'rect',
        lineWidth: 3,
        points: [
          { x: 0, y: 0 },
          { x: 100, y: 80 },
        ],
        bbox: { x1: -15, y1: -15, x2: 115, y2: 95 },
      })
      // point near top edge
      expect(hitTestAction(action, { x: 50, y: 2 })).toBe(true)
    })

    it('misses inside a rectangle (not filled)', () => {
      const action = makeAction({
        tool: 'rect',
        lineWidth: 3,
        points: [
          { x: 0, y: 0 },
          { x: 200, y: 200 },
        ],
        bbox: { x1: -15, y1: -15, x2: 215, y2: 215 },
      })
      expect(hitTestAction(action, { x: 100, y: 100 })).toBe(false)
    })

    it('uses cached rectHit when available', () => {
      const action = makeAction({
        tool: 'rect',
        lineWidth: 3,
        points: [
          { x: 50, y: 50 },
          { x: 0, y: 0 },
        ],
        rectHit: { x0: 0, y0: 0, x1: 50, y1: 50 },
        bbox: { x1: -15, y1: -15, x2: 65, y2: 65 },
      })
      expect(hitTestAction(action, { x: 25, y: 1 })).toBe(true)
    })

    it('returns false for rect with fewer than 2 points', () => {
      const action = makeAction({
        tool: 'rect',
        points: [{ x: 0, y: 0 }],
        bbox: { x1: -15, y1: -15, x2: 15, y2: 15 },
      })
      expect(hitTestAction(action, { x: 0, y: 0 })).toBe(false)
    })
  })

  describe('ellipse tool', () => {
    it('hits on the perimeter of an ellipse', () => {
      const action = makeAction({
        tool: 'ellipse',
        lineWidth: 3,
        points: [
          { x: 0, y: 0 },
          { x: 100, y: 60 },
        ],
        ellipseHit: { cx: 50, cy: 30, rx: 50, ry: 30 },
        bbox: { x1: -15, y1: -15, x2: 115, y2: 75 },
      })
      // rightmost point of ellipse
      expect(hitTestAction(action, { x: 100, y: 30 })).toBe(true)
    })

    it('misses inside a large ellipse', () => {
      const action = makeAction({
        tool: 'ellipse',
        lineWidth: 3,
        points: [
          { x: 0, y: 0 },
          { x: 200, y: 200 },
        ],
        ellipseHit: { cx: 100, cy: 100, rx: 100, ry: 100 },
        bbox: { x1: -15, y1: -15, x2: 215, y2: 215 },
      })
      expect(hitTestAction(action, { x: 100, y: 100 })).toBe(false)
    })

    it('hits a degenerate (tiny) ellipse at its center', () => {
      const action = makeAction({
        tool: 'ellipse',
        lineWidth: 3,
        points: [
          { x: 50, y: 50 },
          { x: 50, y: 50 },
        ],
        ellipseHit: { cx: 50, cy: 50, rx: 0, ry: 0 },
        bbox: { x1: 35, y1: 35, x2: 65, y2: 65 },
      })
      expect(hitTestAction(action, { x: 50, y: 50 })).toBe(true)
    })

    it('returns false for ellipse with fewer than 2 points', () => {
      const action = makeAction({
        tool: 'ellipse',
        points: [{ x: 50, y: 50 }],
        bbox: { x1: 35, y1: 35, x2: 65, y2: 65 },
      })
      expect(hitTestAction(action, { x: 50, y: 50 })).toBe(false)
    })
  })

  describe('text tool', () => {
    it('hits inside the text bounding box', () => {
      const action = makeAction({
        tool: 'text',
        lineWidth: 3,
        points: [{ x: 100, y: 100 }],
        text: 'Hello',
        fontSize: 24,
        textWidth: 60,
        bbox: { x1: 85, y1: 75, x2: 170, y2: 140 },
      })
      expect(hitTestAction(action, { x: 110, y: 105 })).toBe(true)
    })

    it('misses outside the text bounding box', () => {
      const action = makeAction({
        tool: 'text',
        lineWidth: 3,
        points: [{ x: 100, y: 100 }],
        text: 'Hello',
        fontSize: 24,
        textWidth: 60,
        bbox: { x1: 85, y1: 75, x2: 170, y2: 140 },
      })
      expect(hitTestAction(action, { x: 300, y: 300 })).toBe(false)
    })

    it('accounts for multiline text height', () => {
      const action = makeAction({
        tool: 'text',
        lineWidth: 3,
        points: [{ x: 50, y: 50 }],
        text: 'Line1\nLine2\nLine3',
        fontSize: 20,
        textWidth: 80,
        bbox: { x1: 30, y1: 20, x2: 160, y2: 150 },
      })
      // within the multiline region (content height = lineCount * lh, plus 10px pad)
      const lh = Math.round(20 * 1.3)
      const boxY = 50 - lh / 2 - 10
      const boxBottom = boxY + 3 * lh + 20
      expect(hitTestAction(action, { x: 60, y: boxBottom - 5 })).toBe(true)
      // one full line below the frame must miss (regression: old bbox was +lh too tall)
      expect(hitTestAction(action, { x: 60, y: boxBottom + lh / 2 })).toBe(false)
    })

    it('computeTextBbox height matches line centers without an extra blank line', () => {
      const fs = 24
      const lh = Math.round(fs * 1.3)
      const action = makeAction({
        tool: 'text',
        points: [{ x: 100, y: 100 }],
        text: '多对对',
        fontSize: fs,
        textWidth: 80,
      })
      const box = computeTextBbox(action)!
      expect(box.y1).toBe(100 - lh / 2 - 10)
      expect(box.y2).toBe(100 - lh / 2 + lh + 10)
      expect(box.y2 - box.y1).toBe(lh + 20)
    })

    it('returns false for text without text content', () => {
      const action = makeAction({
        tool: 'text',
        points: [{ x: 50, y: 50 }],
        bbox: { x1: 35, y1: 35, x2: 65, y2: 65 },
      })
      // no text → falls through to generic path, no special text handling
      expect(hitTestAction(action, { x: 50, y: 50 })).toBe(false)
    })
  })

  describe('stamp tool', () => {
    it('hits inside the stamp circle', () => {
      const action = makeAction({
        tool: 'stamp',
        lineWidth: 3,
        points: [{ x: 100, y: 100 }],
        text: '1',
        fontSize: 24,
        bbox: { x1: 82, y1: 82, x2: 118, y2: 118 },
      })
      expect(hitTestAction(action, { x: 100, y: 100 })).toBe(true)
      expect(hitTestAction(action, { x: 110, y: 100 })).toBe(true)
    })

    it('misses outside the stamp circle', () => {
      const action = makeAction({
        tool: 'stamp',
        lineWidth: 3,
        points: [{ x: 100, y: 100 }],
        text: '1',
        fontSize: 24,
        bbox: { x1: 82, y1: 82, x2: 118, y2: 118 },
      })
      expect(hitTestAction(action, { x: 160, y: 100 })).toBe(false)
    })

    it('follows the stretched disc when a stamp becomes an ellipse', () => {
      const action = makeAction({
        tool: 'stamp',
        lineWidth: 3,
        points: [{ x: 100, y: 100 }],
        text: '1',
        fontSize: 24,
        stretchX: 3,
        bbox: { x1: 40, y1: 82, x2: 160, y2: 118 },
      })
      // stampRadius(24, '1') = 19.68 → rx = 59.04, ry stays 19.68.
      expect(hitTestAction(action, { x: 155, y: 100 })).toBe(true)
      expect(hitTestAction(action, { x: 100, y: 155 })).toBe(false)
    })

    it('rotates the stamp hit disc with the shape', () => {
      const action = makeAction({
        tool: 'stamp',
        lineWidth: 3,
        points: [{ x: 100, y: 100 }],
        text: '1',
        fontSize: 24,
        stretchX: 3,
        rotation: Math.PI / 2,
        // Rotated AABB: rx = 59.04 runs vertically, ry = 19.68 horizontally.
        bbox: { x1: 80.32, y1: 40.96, x2: 119.68, y2: 159.04 },
      })
      // Quarter turn swaps the axes: the long radius now runs vertically.
      expect(hitTestAction(action, { x: 100, y: 155 })).toBe(true)
      expect(hitTestAction(action, { x: 155, y: 100 })).toBe(false)
    })
  })
})

// ---------------------------------------------------------------------------
// inkHalfWidth — how far the paint reaches beside the centreline
// ---------------------------------------------------------------------------
describe('inkHalfWidth', () => {
  it('is half the stroke width for uniform ink', () => {
    expect(inkHalfWidth(makeAction({ tool: 'pen', lineWidth: 6 }))).toBe(3)
    expect(inkHalfWidth(makeAction({ tool: 'highlighter', lineWidth: 21 }))).toBe(10.5)
    expect(inkHalfWidth(makeAction({ tool: 'rect', lineWidth: 4 }))).toBe(2)
    expect(inkHalfWidth(makeAction({ tool: 'arrow', lineWidth: 1.15 }))).toBeCloseTo(0.575, 10)
  })

  it('uses the widest pressure radius for solid pressure ink', () => {
    // pressureFloor + pressureRange = 0.55 + 0.9 = 1.45 → 6 / 2 × 1.45
    expect(inkHalfWidth(makeAction({ tool: 'pen', lineWidth: 6, pointerType: 'pen' }))).toBeCloseTo(4.35, 10)
    expect(inkHalfWidth(makeAction({ tool: 'pen', lineWidth: 6, pointerType: 'touch' }))).toBeCloseTo(4.35, 10)
    expect(inkHalfWidth(makeAction({ tool: 'pen', lineWidth: 6, pointerType: 'mouse' }))).toBe(3)
  })

  it('keeps the constant width for dashed pen ink (stroked, not swept)', () => {
    expect(inkHalfWidth(makeAction({ tool: 'pen', lineWidth: 6, pointerType: 'pen', dashStyle: 'dashed' }))).toBe(3)
    expect(inkHalfWidth(makeAction({ tool: 'pen', lineWidth: 6, pointerType: 'pen', dashStyle: 'dotted' }))).toBe(3)
  })

  it('never reports a zero-width band for a degenerate action', () => {
    expect(inkHalfWidth(makeAction({ tool: 'pen', lineWidth: 0 }))).toBe(0.5)
  })
})

// ---------------------------------------------------------------------------
// Convex polygon probe helpers (the eraser footprint)
// ---------------------------------------------------------------------------
/** Axis-aligned square probe, `half` px around (cx, cy). */
function squareProbe(cx: number, cy: number, half: number, expand = 0): EraserFootprint {
  return {
    polygon: [
      { x: cx - half, y: cy - half },
      { x: cx + half, y: cy - half },
      { x: cx + half, y: cy + half },
      { x: cx - half, y: cy + half },
    ],
    expand,
    bounds: { x1: cx - half - expand, y1: cy - half - expand, x2: cx + half + expand, y2: cy + half + expand },
  }
}

describe('pointInConvexPolygon', () => {
  const square = squareProbe(0, 0, 5).polygon

  it('accepts interior and boundary points', () => {
    expect(pointInConvexPolygon({ x: 0, y: 0 }, square)).toBe(true)
    expect(pointInConvexPolygon({ x: 4.9, y: -4.9 }, square)).toBe(true)
    expect(pointInConvexPolygon({ x: 5, y: 0 }, square)).toBe(true)
  })

  it('rejects points outside any edge', () => {
    expect(pointInConvexPolygon({ x: 5.1, y: 0 }, square)).toBe(false)
    expect(pointInConvexPolygon({ x: 0, y: -5.1 }, square)).toBe(false)
    expect(pointInConvexPolygon({ x: 99, y: 99 }, square)).toBe(false)
  })

  it('works for either winding', () => {
    expect(pointInConvexPolygon({ x: 0, y: 0 }, [...square].reverse())).toBe(true)
    expect(pointInConvexPolygon({ x: 99, y: 0 }, [...square].reverse())).toBe(false)
  })
})

describe('distancePointToConvexPolygon', () => {
  const square = squareProbe(0, 0, 5).polygon

  it('is zero inside', () => {
    expect(distancePointToConvexPolygon({ x: 0, y: 0 }, square)).toBe(0)
    expect(distancePointToConvexPolygon({ x: 5, y: 5 }, square)).toBe(0)
  })

  it('measures perpendicular distance beside an edge', () => {
    expect(distancePointToConvexPolygon({ x: 8, y: 0 }, square)).toBeCloseTo(3, 10)
    expect(distancePointToConvexPolygon({ x: 0, y: -9 }, square)).toBeCloseTo(4, 10)
  })

  it('measures corner distance on the diagonal', () => {
    expect(distancePointToConvexPolygon({ x: 8, y: 8 }, square)).toBeCloseTo(Math.hypot(3, 3), 10)
  })
})

describe('distanceSegmentToConvexPolygon', () => {
  const square = squareProbe(0, 0, 5).polygon

  it('is zero when either endpoint is inside', () => {
    expect(distanceSegmentToConvexPolygon({ x: 0, y: 0 }, { x: 50, y: 50 }, square)).toBe(0)
  })

  it('is zero when the segment crosses with both endpoints outside', () => {
    expect(distanceSegmentToConvexPolygon({ x: -20, y: 0 }, { x: 20, y: 0 }, square)).toBe(0)
    expect(distanceSegmentToConvexPolygon({ x: 20, y: -20 }, { x: -20, y: 20 }, square)).toBe(0)
  })

  it('measures the gap of a parallel segment', () => {
    expect(distanceSegmentToConvexPolygon({ x: -20, y: 8 }, { x: 20, y: 8 }, square)).toBeCloseTo(3, 10)
  })

  it('measures corner distance for a segment that misses the corner', () => {
    // x + y = 11 passes 0.7071px outside the (5, 5) corner and never enters the square.
    const gap = distanceSegmentToConvexPolygon({ x: 9, y: 2 }, { x: 2, y: 9 }, square)
    expect(gap).toBeCloseTo(Math.SQRT1_2, 10)
  })
})

describe('convexPolygonsOverlap', () => {
  const square = squareProbe(0, 0, 5).polygon

  it('overlaps itself and neighbours', () => {
    expect(convexPolygonsOverlap(square, square)).toBe(true)
    expect(convexPolygonsOverlap(square, squareProbe(9, 9, 5).polygon)).toBe(true)
  })

  it('treats touching edges as overlapping', () => {
    expect(convexPolygonsOverlap(square, squareProbe(10, 0, 5).polygon)).toBe(true)
  })

  it('detects containment in both directions', () => {
    expect(convexPolygonsOverlap(square, squareProbe(0, 0, 1).polygon)).toBe(true)
    expect(convexPolygonsOverlap(squareProbe(0, 0, 1).polygon, square)).toBe(true)
  })

  it('rejects separated boxes', () => {
    expect(convexPolygonsOverlap(square, squareProbe(10.1, 0, 5).polygon)).toBe(false)
  })

  it('detects a cross with no vertex inside either shape', () => {
    const horizontal = [
      { x: -10, y: -1 },
      { x: 10, y: -1 },
      { x: 10, y: 1 },
      { x: -10, y: 1 },
    ]
    const vertical = [
      { x: -1, y: -10 },
      { x: 1, y: -10 },
      { x: 1, y: 10 },
      { x: -1, y: 10 },
    ]
    expect(convexPolygonsOverlap(horizontal, vertical)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// hitTestActionWithFootprint — what the object eraser uses
// ---------------------------------------------------------------------------
describe('hitTestActionWithFootprint', () => {
  function stroke(overrides: Partial<DrawAction> = {}): DrawAction {
    return makeAction({
      tool: 'pen',
      lineWidth: 6,
      pointerType: 'mouse',
      points: [
        { x: 50, y: 0 },
        { x: 50, y: 100 },
      ],
      bbox: { x1: 40, y1: -10, x2: 60, y2: 110 },
      ...overrides,
    })
  }

  describe('general', () => {
    it('returns false for an action without points', () => {
      expect(hitTestActionWithFootprint(makeAction({ points: [] }), squareProbe(0, 0, 5))).toBe(false)
    })

    it('rejects early when the probe is outside the padded bbox', () => {
      expect(hitTestActionWithFootprint(stroke(), squareProbe(200, 200, 5))).toBe(false)
    })

    it('touches as soon as the probe reaches the paint, not before', () => {
      // Ink reaches 3px beside the centreline; a 5px half-square touches at 8px.
      expect(hitTestActionWithFootprint(stroke(), squareProbe(58 - 0.01, 50, 5))).toBe(true)
      expect(hitTestActionWithFootprint(stroke(), squareProbe(58 + 0.01, 50, 5))).toBe(false)
    })

    it('counts the painted expansion of the probe', () => {
      expect(hitTestActionWithFootprint(stroke(), squareProbe(60 - 0.01, 50, 5, 2))).toBe(true)
      expect(hitTestActionWithFootprint(stroke(), squareProbe(60 + 0.01, 50, 5, 2))).toBe(false)
    })

    it('accounts for the wider pressure ribbon', () => {
      const action = stroke({
        pointerType: 'pen',
        points: [
          { x: 50, y: 0, pressure: 1 },
          { x: 50, y: 100, pressure: 1 },
        ],
      })
      // Full pressure: 6 / 2 × 1.45 = 4.35px. Only the lifted tip is 笔锋-tapered,
      // so the widest painted cross-section is the full-width body.
      const widest = Math.max(...actionInkNodes(action)!.map((n) => n.r))
      expect(widest).toBeCloseTo(4.35, 10)
      expect(hitTestActionWithFootprint(action, squareProbe(50 + widest + 5 - 0.01, 50, 5))).toBe(true)
      expect(hitTestActionWithFootprint(action, squareProbe(50 + widest + 5 + 0.01, 50, 5))).toBe(false)
    })

    it('erases where the tapered tip is, not where the old round cap was', () => {
      const action = stroke({
        pointerType: 'pen',
        points: [
          { x: 50, y: 0, pressure: 1 },
          { x: 50, y: 100, pressure: 1 },
        ],
      })
      const tip = actionInkNodes(action)!.reduce((lowest, node) => (node.y > lowest.y ? node : lowest))
      // 4.35 × endTipScale — the paint ends in a thin thread, not a disc.
      expect(tip.r).toBeCloseTo(4.35 * PEN_TAPER.endTipScale, 5)
      expect(hitTestActionWithFootprint(action, squareProbe(50, 100, 5))).toBe(true)
      // The old round cap reached 4.35px at the tip; the tapered ribbon is gone by then.
      expect(hitTestActionWithFootprint(action, squareProbe(50 + 4.35 + 5 - 0.01, 100, 5))).toBe(false)
    })

    it('reaches single-point dots', () => {
      const dot = makeAction({
        tool: 'pen',
        lineWidth: 6,
        points: [{ x: 50, y: 50 }],
        bbox: { x1: 40, y1: 40, x2: 60, y2: 60 },
      })
      expect(hitTestActionWithFootprint(dot, squareProbe(58 - 0.01, 50, 5))).toBe(true)
      expect(hitTestActionWithFootprint(dot, squareProbe(58 + 0.01, 50, 5))).toBe(false)
    })

    it('reaches a bent line through its curve, not its control polygon', () => {
      const bent = makeAction({
        tool: 'line',
        lineWidth: 2,
        points: [
          { x: 0, y: 0 },
          { x: 50, y: 80 },
          { x: 100, y: 0 },
        ],
        bbox: { x1: -20, y1: -20, x2: 120, y2: 100 },
      })
      // Curve apex is at (50, 40); ink reaches 1px beside it, square half is 5px.
      expect(hitTestActionWithFootprint(bent, squareProbe(50, 46 - 0.01, 5))).toBe(true)
      expect(hitTestActionWithFootprint(bent, squareProbe(50, 46 + 0.01, 5))).toBe(false)
    })
  })

  describe('curved ink', () => {
    const cx = 100
    const cy = 100
    const radius = 14
    const lineWidth = 3.25

    /**
     * A fast, tight arc — the loop of a hand-drawn "6": 3.9px between samples, i.e.
     * 16° per sample. The renderer low-passes the samples, so the painted ribbon sits
     * ~2px inside the stored polyline.
     */
    function tightLoop(): DrawAction {
      const steps = 18
      const points: Point[] = []
      for (let i = 0; i <= steps; i++) {
        const angle = (i / steps) * Math.PI * 1.6
        points.push({ x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle) })
      }
      return makeAction({
        tool: 'pen',
        lineWidth,
        pointerType: 'mouse',
        points,
        bbox: { x1: cx - 60, y1: cy - 60, x2: cx + 60, y2: cy + 60 },
      })
    }

    /** Smallest footprint radius, centred on the arc centre, that touches the ink. */
    function eraserBoundary(action: DrawAction): number {
      let lo = 0
      let hi = 60
      for (let i = 0; i < 40; i++) {
        const mid = (lo + hi) / 2
        if (hitTestActionWithFootprint(action, squareProbe(cx, cy, 0.01, mid))) hi = mid
        else lo = mid
      }
      return hi
    }

    it('paints inside the stored polyline, so the raw samples would be wrong', () => {
      const ink = actionInkNodes(tightLoop())!
      // Closest approach of the *paint* to the arc centre.
      const inkRadius = Math.min(...ink.map((n) => Math.hypot(n.x - cx, n.y - cy) - n.r))
      const rawBoundary = radius - lineWidth / 2
      expect(rawBoundary - inkRadius).toBeGreaterThan(1.5)
    })

    it('erases when the footprint reaches the painted ribbon, not the samples', () => {
      const action = tightLoop()
      const ink = actionInkNodes(action)!
      const inkRadius = Math.min(...ink.map((n) => Math.hypot(n.x - cx, n.y - cy) - n.r))
      const rawBoundary = radius - lineWidth / 2
      const boundary = eraserBoundary(action)

      // The eraser starts where the ink is, i.e. ~2px inside where the raw samples are.
      expect(boundary).toBeCloseTo(inkRadius, 1)
      expect(boundary).toBeLessThan(rawBoundary - 1.5)
    })

    it('follows the curve of a bent dashed pen, not its control polygon', () => {
      // Control (50, 220) is 60px below the curve apex (50, 160); a dashed stroke is
      // stroked along the quadratic (`drawCurvedLine`), so only the curve is paint.
      const bent = makeAction({
        tool: 'pen',
        lineWidth: 3.25,
        pointerType: 'mouse',
        dashStyle: 'dashed',
        lockedLine: true,
        points: [
          { x: 0, y: 100 },
          { x: 50, y: 220 },
          { x: 100, y: 100 },
        ],
        bbox: { x1: -40, y1: 60, x2: 140, y2: 280 },
      })
      expect(hitTestActionWithFootprint(bent, squareProbe(50, 160, 0.01))).toBe(true)
      expect(hitTestActionWithFootprint(bent, squareProbe(50, 220, 0.01))).toBe(false)
    })
  })

  describe('ink node cache', () => {
    it('rebuilds the ribbon after a width edit', () => {
      const action = makeAction({
        tool: 'pen',
        lineWidth: 3.25,
        pointerType: 'mouse',
        points: [
          { x: 0, y: 0 },
          { x: 0, y: 100 },
        ],
        bbox: { x1: -40, y1: -40, x2: 40, y2: 140 },
      })
      // Prime the cache with the 3.25px ribbon (r = 1.625).
      expect(hitTestActionWithFootprint(action, squareProbe(5, 20, 0.01))).toBe(false)
      action.lineWidth = 20
      // The repainted ribbon is ~9px wide here (the 锋 ramp only eats the last 70px); a
      // stale radius would still report 1.625 and leave the ink under the glyph unerased.
      expect(hitTestActionWithFootprint(action, squareProbe(5, 20, 0.01))).toBe(true)
    })

    it('rebuilds bent ink after the bend handle moves', () => {
      const action = makeAction({
        tool: 'pen',
        lineWidth: 3.25,
        pointerType: 'mouse',
        lockedLine: true,
        points: [
          { x: 0, y: 0 },
          { x: 50, y: 20 },
          { x: 100, y: 0 },
        ],
        bbox: { x1: -40, y1: -40, x2: 140, y2: 260 },
      })
      // Apex B(0.5) = (p0 + 2c + p1) / 4 = (50, 10).
      expect(hitTestActionWithFootprint(action, squareProbe(50, 10, 0.01))).toBe(true)
      // The bend handle mutates the control point in place; the painted apex moves to (50, 110).
      action.points[1].y = 220
      expect(hitTestActionWithFootprint(action, squareProbe(50, 10, 0.01))).toBe(false)
      expect(hitTestActionWithFootprint(action, squareProbe(50, 110, 0.01))).toBe(true)
    })
  })

  describe('shapes', () => {
    it('tests the rect outline, not its interior', () => {
      const rect = makeAction({
        tool: 'rect',
        lineWidth: 4,
        points: [
          { x: 0, y: 0 },
          { x: 100, y: 100 },
        ],
        bbox: { x1: -20, y1: -20, x2: 120, y2: 120 },
      })
      expect(hitTestActionWithFootprint(rect, squareProbe(106 - 0.01, 50, 4))).toBe(true)
      expect(hitTestActionWithFootprint(rect, squareProbe(106 + 0.01, 50, 4))).toBe(false)
      expect(hitTestActionWithFootprint(rect, squareProbe(50, 50, 4))).toBe(false)
    })

    it('follows a rotated rect edge', () => {
      const rect = makeAction({
        tool: 'rect',
        lineWidth: 4,
        rotation: Math.PI / 4,
        points: [
          { x: 50, y: 50 },
          { x: 150, y: 150 },
        ],
        bbox: { x1: -50, y1: -50, x2: 250, y2: 250 },
      })
      updateShapeHitCache(rect)
      // Top edge midpoint (100, 50) rotates around (100, 100) by +45°; ink reaches 2px
      // beside the edge, so a 4px half-square touches at 6px.
      const mid = rotatePointAround({ x: 100, y: 50 }, 100, 100, Math.PI / 4)
      const normal = { x: Math.SQRT1_2, y: -Math.SQRT1_2 }
      const at = (distance: number) => ({ x: mid.x + normal.x * distance, y: mid.y + normal.y * distance })
      // Rotated into the shape's frame the square becomes a diamond, so it reaches
      // 4√2 along the edge normal; ink reaches 2 → touch at 4√2 + 2.
      const boundary = 4 * Math.SQRT2 + 2
      expect(hitTestActionWithFootprint(rect, squareProbe(at(boundary - 0.01).x, at(boundary - 0.01).y, 4))).toBe(true)
      expect(hitTestActionWithFootprint(rect, squareProbe(at(boundary + 0.01).x, at(boundary + 0.01).y, 4))).toBe(false)
      expect(hitTestActionWithFootprint(rect, squareProbe(100, 100, 4))).toBe(false)
    })

    it('tests the ellipse outline with a dense ring', () => {
      const ellipse = makeAction({
        tool: 'ellipse',
        lineWidth: 2,
        points: [
          { x: 0, y: 0 },
          { x: 200, y: 100 },
        ],
        bbox: { x1: -20, y1: -20, x2: 220, y2: 120 },
      })
      // Rightmost point is (200, 50); ink reaches 1px beside it, square half is 4px.
      expect(hitTestActionWithFootprint(ellipse, squareProbe(205 - 0.01, 50, 4))).toBe(true)
      expect(hitTestActionWithFootprint(ellipse, squareProbe(205 + 0.01, 50, 4))).toBe(false)
      expect(hitTestActionWithFootprint(ellipse, squareProbe(100, 50, 4))).toBe(false)
    })
  })

  describe('text and stamps', () => {
    it('touches the glyphs, not the padded selection frame', () => {
      const action = makeAction({
        tool: 'text',
        points: [{ x: 100, y: 100 }],
        text: 'hi',
        fontSize: 24,
        textWidth: 60,
      })
      // Glyphs span x = 102…162 and y = 84.5…115.5 (24px font, one 31px line).
      expect(hitTestActionWithFootprint(action, squareProbe(167 - 0.01, 100, 5))).toBe(true)
      expect(hitTestActionWithFootprint(action, squareProbe(167 + 0.01, 100, 5))).toBe(false)
      // The selection frame reaches 20px further right.
      expect(hitTestActionWithFootprint(action, squareProbe(167.5, 100, 0.01))).toBe(false)
      // Corners are round, not square: a diagonal miss is not a touch.
      expect(hitTestActionWithFootprint(action, squareProbe(166, 120.5, 0.01))).toBe(false)
    })

    it('touches the stamp disc', () => {
      const action = makeAction({
        tool: 'stamp',
        points: [{ x: 100, y: 100 }],
        text: '1',
        fontSize: 24,
        bbox: { x1: 80, y1: 80, x2: 120, y2: 120 },
      })
      // stampRadius(24, '1') = 24 × 0.82 = 19.68, so a 5px half-square touches at 24.68.
      expect(hitTestActionWithFootprint(action, squareProbe(124.66, 100, 5))).toBe(true)
      expect(hitTestActionWithFootprint(action, squareProbe(124.7, 100, 5))).toBe(false)
    })

    it('erases a stamp from inside its filled disc', () => {
      const action = makeAction({
        tool: 'stamp',
        points: [{ x: 100, y: 100 }],
        text: '1',
        fontSize: 24,
        bbox: { x1: 80, y1: 80, x2: 120, y2: 120 },
      })
      // Parked in the middle: no rim contact, but the disc is painted there.
      expect(hitTestActionWithFootprint(action, squareProbe(100, 100, 5))).toBe(true)
      // A footprint large enough to swallow the disc still erases it.
      expect(hitTestActionWithFootprint(action, squareProbe(100, 100, 40))).toBe(true)
    })

    it('follows a rotated text glyph box', () => {
      const action = makeAction({
        tool: 'text',
        points: [{ x: 100, y: 100 }],
        text: 'hi',
        fontSize: 24,
        textWidth: 60,
        rotation: Math.PI / 2,
        // Padded local box 90…180 × 74.5…125.5 rotated a quarter turn about (132, 100).
        bbox: { x1: 106.5, y1: 58, x2: 157.5, y2: 148 },
      })
      // Ink box 102…162 × 84.5…115.5, centre (132, 100); a quarter turn makes it tall.
      expect(hitTestAction(action, { x: 132, y: 120 })).toBe(true)
      expect(hitTestAction(action, { x: 160, y: 100 })).toBe(false)
    })
  })

  describe('real eraser glyph', () => {
    it('erases exactly when the visible glyph edge reaches a vertical stroke', () => {
      // 26px cursor: the glyph's leftmost arc sits (12 − 2) / 24 × 26 = 10.833px from
      // the pointer, its visible edge — the 2-unit stroke (1.083px) plus the fixed
      // AA/shadow tolerance (1.2px) — 2.283px further.
      const glyphEdge = ((12 - 2) / 24) * 26
      const visible = (ERASER_GLYPH_HALF_STROKE / 24) * 26 + ERASER_FOOTPRINT_TOLERANCE_PX
      const inkHalf = 1.625
      const boundary = 50 + glyphEdge + visible + inkHalf
      expect(
        hitTestActionWithFootprint(stroke({ lineWidth: 3.25 }), buildEraserFootprint(boundary - 0.01, 50, 26)),
      ).toBe(true)
      expect(
        hitTestActionWithFootprint(stroke({ lineWidth: 3.25 }), buildEraserFootprint(boundary + 0.01, 50, 26)),
      ).toBe(false)
    })

    it('clips the bottom-right chamfer, so ink outside the icon is not erased', () => {
      // ViewBox (20, 21) sits in the empty wedge beyond the chamfer. The old chord
      // polygon (which dropped `L12.834 21`) included it and erased ink several pixels
      // outside the icon; the real outline must not.
      const dot = makeAction({
        tool: 'pen',
        lineWidth: 3.25,
        points: [{ x: 50 + ((20 - 12) / 24) * 26, y: 50 + ((21 - 12) / 24) * 26 }],
        bbox: { x1: 40, y1: 40, x2: 80, y2: 80 },
      })
      expect(hitTestActionWithFootprint(dot, buildEraserFootprint(50, 50, 26))).toBe(false)
    })
  })
})

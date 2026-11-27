import { describe, expect, it } from 'vitest'
import {
  collapseStrokeToLine,
  maxChordDeviation,
  representativePressure,
  STROKE_LINE_LOCK_HOLD_MS,
  STROKE_LINE_LOCK_MAX_DEVIATION_RATIO,
  STROKE_LINE_LOCK_MIN_CHORD_PX,
  STROKE_LINE_LOCK_MIN_DEVIATION_PX,
  STROKE_LINE_LOCK_STILL_PX,
  strokeLineLockStillDistSq,
} from './strokeLineLock'
import type { LineLockPoint } from './strokeLineLock'

/**
 * Circular arc from (0, 0) to (`chord`, 0) bulging up by `sagitta` px — the
 * shape of a hand-drawn curve, so tests can state "a 100×30 curve" directly.
 */
function arcPoints(chord: number, sagitta: number, sampleCount = 60): LineLockPoint[] {
  const radius = (chord * chord) / (8 * sagitta) + sagitta / 2
  const halfAngle = Math.asin(chord / (2 * radius))
  const cx = chord / 2
  const cy = sagitta - radius
  return Array.from({ length: sampleCount + 1 }, (_, i) => {
    // Sweep the upper arc from the left end to the right end.
    const angle = Math.PI / 2 + halfAngle - (2 * halfAngle * i) / sampleCount
    return { x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle) }
  })
}

describe('strokeLineLock', () => {
  it('uses a 500ms hold, a 10px still threshold, and a 5% deviation limit', () => {
    expect(STROKE_LINE_LOCK_HOLD_MS).toBe(500)
    expect(STROKE_LINE_LOCK_STILL_PX).toBe(10)
    expect(strokeLineLockStillDistSq()).toBe(100)
    expect(STROKE_LINE_LOCK_MAX_DEVIATION_RATIO).toBe(0.05)
    expect(STROKE_LINE_LOCK_MIN_DEVIATION_PX).toBe(3)
  })

  it('collapses a polyline to start and end with uniform pressure', () => {
    const out = collapseStrokeToLine([
      { x: 0, y: 0, pressure: 0.4 },
      { x: 10, y: 1 },
      { x: 20, y: -1 },
      { x: 100, y: 2, pressure: 0.8 },
    ])
    expect(out![0]).toMatchObject({ x: 0, y: 0 })
    expect(out![1]).toMatchObject({ x: 100, y: 2 })
    expect(out![0].pressure).toBeCloseTo(0.8, 5)
    expect(out![1].pressure).toBeCloseTo(0.8, 5)
  })

  it('falls back to start pressure when the tip has none', () => {
    const out = collapseStrokeToLine([
      { x: 0, y: 0, pressure: 0.35 },
      { x: 40, y: 0 },
    ])
    expect(out).toEqual([
      { x: 0, y: 0, pressure: 0.35 },
      { x: 40, y: 0, pressure: 0.35 },
    ])
  })

  it('returns null for an empty point list', () => {
    expect(collapseStrokeToLine([])).toBeNull()
  })

  it('weights pressure by segment length so a light hold at the tip cannot thin the line', () => {
    // 10 个 10px 的移动采样（p=0.5）+ 6 个 0.4px 的静止抖动采样（p=0.05）
    const points: { x: number; y: number; pressure: number }[] = []
    for (let i = 0; i <= 10; i++) points.push({ x: i * 10, y: 0, pressure: 0.5 })
    for (let i = 0; i < 6; i++) points.push({ x: 100 + (i % 2) * 0.4, y: 0, pressure: 0.05 })

    const out = collapseStrokeToLine(points)
    expect(out).not.toBeNull()
    expect(out![0].pressure).toBeCloseTo(0.5, 2)
    expect(out![1].pressure).toBe(out![0].pressure)
  })

  it('keeps a long hold from dragging the representative pressure down', () => {
    const points: { x: number; y: number; pressure: number }[] = []
    for (let i = 0; i <= 10; i++) points.push({ x: i * 10, y: 0, pressure: 0.5 })
    for (let i = 0; i < 200; i++) points.push({ x: 100 + (i % 2) * 0.02, y: 0, pressure: 0.02 })

    const out = collapseStrokeToLine(points)
    expect(out![0].pressure).toBeCloseTo(0.5, 2)
  })

  it('returns undefined for pressure-less input so mouse ink keeps its base width', () => {
    const points = Array.from({ length: 10 }, (_, i) => ({ x: i * 10, y: 0 }))
    expect(representativePressure(points)).toBeUndefined()
  })

  it('averages a stroke that starts heavy and ends light instead of taking the tail', () => {
    const out = collapseStrokeToLine([
      { x: 0, y: 0, pressure: 0.9 },
      { x: 50, y: 0, pressure: 0.9 },
      { x: 100, y: 0, pressure: 0.05 },
      { x: 100.4, y: 0, pressure: 0.05 },
    ])
    // (0.9 × 50 + 0.05 × 50) / 100
    expect(out![0].pressure).toBeCloseTo(0.475, 6)
  })

  it('lets the moving part of a light stroke set a light width', () => {
    const points: { x: number; y: number; pressure: number }[] = []
    for (let i = 0; i <= 10; i++) points.push({ x: i * 10, y: 0, pressure: 0.12 })

    const out = collapseStrokeToLine(points)
    expect(out![0].pressure).toBeCloseTo(0.12, 5)
  })

  it('keeps a single point freehand (no zero-length line)', () => {
    expect(collapseStrokeToLine([{ x: 5, y: 7, pressure: 0.5 }])).toBeNull()
  })

  it('keeps a nearly closed loop freehand', () => {
    // Circle of radius 120 whose ends stop 3px apart: chord ≈ 3px.
    const points: { x: number; y: number }[] = []
    const n = 400
    const deg = 360 - (3 / 120) * (180 / Math.PI)
    for (let i = 0; i <= n; i++) {
      const a = ((i / n) * deg * Math.PI) / 180
      points.push({ x: 400 + Math.cos(a) * 120, y: 300 + Math.sin(a) * 120 })
    }
    expect(collapseStrokeToLine(points)).toBeNull()
  })

  it('keeps a 90° elbow freehand', () => {
    const points: { x: number; y: number }[] = []
    for (let i = 0; i <= 20; i++) points.push({ x: i * 10, y: 0 })
    for (let i = 1; i <= 20; i++) points.push({ x: 200, y: i * 10 })
    expect(collapseStrokeToLine(points)).toBeNull()
  })

  it('keeps a too-short stroke freehand', () => {
    expect(
      collapseStrokeToLine([
        { x: 0, y: 0 },
        { x: STROKE_LINE_LOCK_MIN_CHORD_PX / 2, y: 0 },
      ]),
    ).toBeNull()
  })

  it('keeps a zig-zag freehand', () => {
    const points: { x: number; y: number }[] = []
    for (let i = 0; i <= 40; i++) points.push({ x: i * 5, y: i % 2 === 0 ? 0 : 20 })
    expect(collapseStrokeToLine(points)).toBeNull()
  })

  it('measures how far the stroke strays from its chord', () => {
    expect(
      maxChordDeviation([
        { x: 0, y: 0 },
        { x: 100, y: 0 },
      ]),
    ).toBe(0)
    expect(
      maxChordDeviation([
        { x: 0, y: 0 },
        { x: 100, y: 8 },
        { x: 200, y: 0 },
      ]),
    ).toBeCloseTo(8, 6)
  })

  // Arc length barely grows for a shallow bend, so the old ratio test flattened
  // exactly the curves people draw most. These are the regression cases.
  it('keeps a visible shallow curve freehand (100 × 30)', () => {
    expect(collapseStrokeToLine(arcPoints(100, 30))).toBeNull()
  })

  it('keeps a 100 × 10 arc freehand', () => {
    expect(collapseStrokeToLine(arcPoints(100, 10))).toBeNull()
  })

  it('keeps a short arc freehand once it strays past the absolute floor', () => {
    // 20px chord, 5px sagitta: the 3px floor applies, so this is a curve.
    expect(collapseStrokeToLine(arcPoints(20, 5))).toBeNull()
  })

  it('still straightens a stroke flatter than the deviation limit', () => {
    // 100px chord with a 4px sagitta ≈ 4%, under the 5% limit: reads as a line.
    expect(collapseStrokeToLine(arcPoints(100, 4))).not.toBeNull()
  })

  it('still straightens a hand-drawn line that wobbles a pixel or two', () => {
    const points = Array.from({ length: 61 }, (_, i) => ({ x: i * 4, y: Math.sin(i / 2) * 1.5 }))
    expect(collapseStrokeToLine(points)).not.toBeNull()
  })
})

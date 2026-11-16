import { describe, expect, it } from 'vitest'
import {
  collapseStrokeToLine,
  STROKE_LINE_LOCK_HOLD_MS,
  STROKE_LINE_LOCK_MAX_ARC_RATIO,
  STROKE_LINE_LOCK_MIN_CHORD_PX,
  STROKE_LINE_LOCK_STILL_PX,
  strokeLineLockStillDistSq,
} from './strokeLineLock'

describe('strokeLineLock', () => {
  it('uses a 500ms hold and 10px still threshold', () => {
    expect(STROKE_LINE_LOCK_HOLD_MS).toBe(500)
    expect(STROKE_LINE_LOCK_STILL_PX).toBe(10)
    expect(strokeLineLockStillDistSq()).toBe(100)
  })

  it('collapses a polyline to start and end with uniform pressure', () => {
    const out = collapseStrokeToLine([
      { x: 0, y: 0, pressure: 0.4 },
      { x: 10, y: 1 },
      { x: 20, y: -1 },
      { x: 100, y: 2, pressure: 0.8 },
    ])
    expect(out).toEqual([
      { x: 0, y: 0, pressure: 0.8 },
      { x: 100, y: 2, pressure: 0.8 },
    ])
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

  it('rejects a stroke that wobbles past the arc ratio', () => {
    // Zig-zag along x: arc ≈ 2× chord.
    const points: { x: number; y: number }[] = []
    for (let i = 0; i <= 40; i++) points.push({ x: i * 5, y: i % 2 === 0 ? 0 : 20 })
    const arc = 40 * Math.hypot(5, 20)
    expect(arc / Math.hypot(200, 0)).toBeGreaterThan(STROKE_LINE_LOCK_MAX_ARC_RATIO)
    expect(collapseStrokeToLine(points)).toBeNull()
  })
})

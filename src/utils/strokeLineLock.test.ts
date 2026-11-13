import { describe, expect, it } from 'vitest'
import {
  collapseStrokeToLine,
  STROKE_LINE_LOCK_HOLD_MS,
  STROKE_LINE_LOCK_STILL_PX,
  strokeLineLockStillDistSq,
} from './strokeLineLock'

describe('strokeLineLock', () => {
  it('uses a 500ms hold and 10px still threshold', () => {
    expect(STROKE_LINE_LOCK_HOLD_MS).toBe(500)
    expect(STROKE_LINE_LOCK_STILL_PX).toBe(10)
    expect(strokeLineLockStillDistSq()).toBe(100)
  })

  it('collapses a polyline to start and end', () => {
    const out = collapseStrokeToLine([
      { x: 0, y: 0, pressure: 0.4 },
      { x: 10, y: 1 },
      { x: 20, y: -1 },
      { x: 100, y: 2, pressure: 0.8 },
    ])
    expect(out).toEqual([
      { x: 0, y: 0, pressure: 0.4 },
      { x: 100, y: 2, pressure: 0.8 },
    ])
  })

  it('returns null for an empty point list', () => {
    expect(collapseStrokeToLine([])).toBeNull()
  })

  it('duplicates a single point into a zero-length line', () => {
    expect(collapseStrokeToLine([{ x: 5, y: 7, pressure: 0.5 }])).toEqual([
      { x: 5, y: 7, pressure: 0.5 },
      { x: 5, y: 7, pressure: 0.5 },
    ])
  })
})

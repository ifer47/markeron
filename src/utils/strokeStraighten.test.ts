import { describe, expect, it } from 'vitest'
import {
  DEFAULT_STROKE_STRAIGHTEN,
  isNearlyStraightStroke,
  resolveStrokeStraighten,
  straightenStrokePoints,
} from './strokeStraighten'

function line(n: number, dx = 10, dy = 0, wobble = 0) {
  return Array.from({ length: n }, (_, i) => ({
    x: i * dx,
    y: i * dy + (i % 2 === 0 ? wobble : -wobble),
    pressure: 0.5,
  }))
}

describe('resolveStrokeStraighten', () => {
  it('defaults to on', () => {
    expect(resolveStrokeStraighten()).toBe(DEFAULT_STROKE_STRAIGHTEN)
    expect(resolveStrokeStraighten({})).toBe(true)
  })

  it('reads explicit flag', () => {
    expect(resolveStrokeStraighten({ strokeStraighten: false })).toBe(false)
    expect(resolveStrokeStraighten({ strokeStraighten: true })).toBe(true)
  })
})

describe('isNearlyStraightStroke / straightenStrokePoints', () => {
  it('rejects short polylines and tiny chords', () => {
    expect(
      isNearlyStraightStroke([
        { x: 0, y: 0 },
        { x: 1, y: 0 },
      ]),
    ).toBe(false)
    expect(isNearlyStraightStroke(line(5, 1, 0))).toBe(false)
  })

  it('accepts a clean horizontal freehand stroke', () => {
    const pts = line(20, 8, 0, 0.2)
    expect(isNearlyStraightStroke(pts)).toBe(true)
    const out = straightenStrokePoints(pts)
    expect(out).toEqual([
      { x: 0, y: 0.2, pressure: 0.5, t: undefined, pointerType: undefined },
      { x: 152, y: -0.2, pressure: 0.5, t: undefined },
    ])
  })

  it('accepts a clean diagonal stroke', () => {
    const pts = line(15, 10, 10, 0.3)
    expect(isNearlyStraightStroke(pts)).toBe(true)
    expect(straightenStrokePoints(pts)?.length).toBe(2)
  })

  it('accepts a near-vertical stroke', () => {
    const pts = line(18, 0.1, 12, 0.2)
    expect(isNearlyStraightStroke(pts)).toBe(true)
  })

  it('rejects a clearly curved stroke', () => {
    const pts = Array.from({ length: 20 }, (_, i) => ({
      x: i * 10,
      y: Math.sin(i / 3) * 40,
    }))
    expect(isNearlyStraightStroke(pts)).toBe(false)
    expect(straightenStrokePoints(pts)).toBeNull()
  })

  it('rejects a U-turn / looped path even if endpoints are far', () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 80 },
      { x: 0, y: 80 },
      { x: 200, y: 0 },
    ]
    expect(isNearlyStraightStroke(pts)).toBe(false)
  })

  it('preserves endpoint pressure when straightening', () => {
    const pts = [
      { x: 0, y: 0, pressure: 0.2, t: 1, pointerType: 'pen' },
      ...Array.from({ length: 10 }, (_, i) => ({ x: (i + 1) * 10, y: 0.1, pressure: 0.5 })),
      { x: 120, y: 0, pressure: 0.9, t: 99 },
    ]
    const out = straightenStrokePoints(pts)
    expect(out?.[0]).toMatchObject({ x: 0, y: 0, pressure: 0.2, t: 1, pointerType: 'pen' })
    expect(out?.[1]).toMatchObject({ x: 120, y: 0, pressure: 0.9, t: 99 })
  })
})

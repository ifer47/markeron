import { describe, expect, it } from 'vitest'
import {
  computeMinDistSq,
  getInkOutline,
  normalizePressure,
  outlineToPath2D,
  penStrokeStyle,
  smoothPenPoint,
  toFreehandInputs,
  usesPressureInk,
  BASE_MIN_DIST_DEVICE_SQ,
  MAX_AREA_SCALE,
} from './penStroke'

describe('normalizePressure', () => {
  it('defaults missing or zero to 0.5', () => {
    expect(normalizePressure(undefined)).toBe(0.5)
    expect(normalizePressure(null)).toBe(0.5)
    expect(normalizePressure(0)).toBe(0.5)
  })

  it('clamps into a usable range', () => {
    expect(normalizePressure(0.01)).toBe(0.05)
    expect(normalizePressure(0.8)).toBe(0.8)
    expect(normalizePressure(2)).toBe(1)
  })
})

describe('usesPressureInk', () => {
  it('is true for pen and touch only', () => {
    expect(usesPressureInk('pen')).toBe(true)
    expect(usesPressureInk('touch')).toBe(true)
    expect(usesPressureInk('mouse')).toBe(false)
    expect(usesPressureInk(undefined)).toBe(false)
    expect(usesPressureInk(null)).toBe(false)
  })
})

describe('smoothPenPoint', () => {
  it('returns raw when streamline is 0', () => {
    const prev = { x: 0, y: 0, pressure: 0.5 }
    const raw = { x: 10, y: 10, pressure: 0.9 }
    expect(smoothPenPoint(prev, raw, 0)).toEqual(raw)
  })

  it('blends position but keeps raw pressure', () => {
    const prev = { x: 0, y: 0, pressure: 0.5 }
    const raw = { x: 10, y: 0, pressure: 0.9 }
    const out = smoothPenPoint(prev, raw, 0.5)
    expect(out.x).toBe(5)
    expect(out.y).toBe(0)
    expect(out.pressure).toBe(0.9)
  })
})

describe('computeMinDistSq', () => {
  it('uses device-pixel base at reference viewport and dpr 1', () => {
    expect(computeMinDistSq(1440, 900, 1)).toBe(BASE_MIN_DIST_DEVICE_SQ)
  })

  it('shrinks CSS threshold on higher dpr', () => {
    const at1 = computeMinDistSq(1440, 900, 1)
    const at2 = computeMinDistSq(1440, 900, 2)
    expect(at2).toBeCloseTo(at1 / 4)
  })

  it('caps area scale so large viewports do not thin too hard', () => {
    const huge = computeMinDistSq(3840, 2160, 1)
    expect(huge).toBeLessThanOrEqual(BASE_MIN_DIST_DEVICE_SQ * MAX_AREA_SCALE + 1e-6)
  })
})

describe('penStrokeStyle', () => {
  it('maps smoothing levels', () => {
    expect(penStrokeStyle('off').inputStreamline).toBe(0)
    expect(penStrokeStyle('standard').inputStreamline).toBeGreaterThan(0)
    expect(penStrokeStyle('strong').inputStreamline).toBeGreaterThan(penStrokeStyle('standard').inputStreamline)
  })
})

describe('getInkOutline / outlineToPath2D', () => {
  it('handles empty and single points', () => {
    expect(getInkOutline([], 3, 'standard', true)).toEqual([])
    const one = getInkOutline([{ x: 1, y: 2, pressure: 0.5 }], 3, 'standard', true, 'mouse')
    expect(one.length).toBeGreaterThan(0)
    expect(outlineToPath2D(one)).toBeTruthy()
  })

  it('builds an outline for a short stroke', () => {
    const pts = [
      { x: 0, y: 0, pressure: 0.4 },
      { x: 10, y: 2, pressure: 0.6 },
      { x: 20, y: 0, pressure: 0.5 },
    ]
    const outline = getInkOutline(pts, 4, 'standard', true, 'pen')
    expect(outline.length).toBeGreaterThan(3)
    expect(toFreehandInputs(pts)[0][2]).toBe(0.4)
    expect(outlineToPath2D(outline)).toBeTruthy()
  })

  it('varies width with pressure for pen, not for mouse', () => {
    const pts = [
      { x: 0, y: 0, pressure: 0.15 },
      { x: 20, y: 0, pressure: 0.95 },
      { x: 40, y: 0, pressure: 0.15 },
    ]
    const mouse = getInkOutline(pts, 10, 'standard', true, 'mouse')
    const pen = getInkOutline(pts, 10, 'standard', true, 'pen')
    expect(mouse.length).toBeGreaterThan(3)
    expect(pen.length).toBeGreaterThan(3)
    expect(pen).not.toEqual(mouse)
  })
})

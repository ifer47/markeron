import { describe, expect, it } from 'vitest'
import { getStrokePoints } from 'perfect-freehand'
import {
  computeMinDistSq,
  getInkOutline,
  getInkOutlineFromStrokePoints,
  inkChunkOverlapLength,
  inkFreehandOptions,
  InkStrokePointStream,
  INK_FREEZE_MIN_POINTS,
  INK_LIVE_TAIL_POINTS,
  planInkFreeze,
  type FreehandInputPoint,
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

/** Deterministic wobbly walk with repeats, stalls and pressure changes. */
function randomInputs(count: number, seed: number): FreehandInputPoint[] {
  let s = seed
  const rand = () => {
    s = (s * 1664525 + 1013904223) % 4294967296
    return s / 4294967296
  }
  const out: FreehandInputPoint[] = []
  let x = 100
  let y = 100
  let angle = 0
  for (let i = 0; i < count; i++) {
    const r = rand()
    if (r < 0.08 && out.length > 0) {
      out.push([...out[out.length - 1]] as FreehandInputPoint)
      continue
    }
    angle += (rand() - 0.5) * 1.2
    const step = r < 0.15 ? rand() * 0.3 : 0.5 + rand() * 12
    x += Math.cos(angle) * step
    y += Math.sin(angle) * step
    out.push([x, y, 0.05 + rand() * 0.95])
  }
  return out
}

describe('InkStrokePointStream', () => {
  it('matches perfect-freehand getStrokePoints for every prefix', { timeout: 15_000 }, () => {
    for (const level of ['off', 'standard', 'strong'] as const) {
      for (const size of [1, 3, 12, 40]) {
        const options = inkFreehandOptions(size, level, false, 'pen')
        const inputs = randomInputs(160, size * 31 + level.length)
        const stream = new InkStrokePointStream(options)
        for (let n = 1; n <= inputs.length; n++) {
          stream.append(inputs[n - 1])
          expect(stream.slice(0)).toEqual(getStrokePoints(inputs.slice(0, n), options))
        }
      }
    }
  })

  it('never rewrites settled points', () => {
    const options = inkFreehandOptions(6, 'standard', false, 'mouse')
    const inputs = randomInputs(300, 7)
    const stream = new InkStrokePointStream(options)
    const snapshots: unknown[] = []
    for (const input of inputs) {
      stream.append(input)
      for (let i = snapshots.length; i < stream.settledCount; i++) {
        snapshots.push(structuredClone(stream.settledAt(i)))
      }
    }
    for (let i = 1; i < snapshots.length; i++) {
      expect(stream.settledAt(i)).toEqual(snapshots[i])
    }
  })

  it('slices from a later index without the head-vector fixup', () => {
    const options = inkFreehandOptions(4, 'standard', false, 'mouse')
    const stream = new InkStrokePointStream(options)
    for (const input of randomInputs(80, 3)) stream.append(input)
    const full = stream.slice(0)
    const tail = stream.slice(10)
    expect(tail).toEqual(full.slice(10))
    expect(getInkOutlineFromStrokePoints(tail, options).length).toBeGreaterThan(3)
    expect(getInkOutlineFromStrokePoints([], options)).toEqual([])
  })
})

describe('planInkFreeze', () => {
  function streamOf(count: number, size: number) {
    const stream = new InkStrokePointStream(inkFreehandOptions(size, 'standard', false, 'mouse'))
    for (let i = 0; i < count; i++) stream.append([i * 3, Math.sin(i / 5) * 20, 0.5])
    return stream
  }

  it('waits until enough settled points sit behind the live tail', () => {
    const size = 4
    const needed = INK_FREEZE_MIN_POINTS + INK_LIVE_TAIL_POINTS + 1
    expect(planInkFreeze(streamOf(needed - 10, size), 0, size)).toBeNull()
    expect(planInkFreeze(streamOf(needed + 20, size), 0, size)).not.toBeNull()
  })

  it('restarts the tail far enough back to cover chunk caps', () => {
    const size = 8
    const stream = streamOf(400, size)
    const plan = planInkFreeze(stream, 0, size)!
    expect(plan.end).toBe(stream.settledCount - 1 - INK_LIVE_TAIL_POINTS)
    expect(plan.nextStart).toBeGreaterThan(0)
    expect(plan.nextStart).toBeLessThan(plan.end)
    const overlap = stream.settledAt(plan.end).runningLength - stream.settledAt(plan.nextStart).runningLength
    expect(overlap).toBeGreaterThanOrEqual(inkChunkOverlapLength(size))
  })

  it('refuses to freeze when the chunk is shorter than the required overlap', () => {
    const size = 20
    const stream = new InkStrokePointStream(inkFreehandOptions(size, 'off', false, 'mouse'))
    for (let i = 0; i < 400; i++) stream.append([i < 5 ? i * 10 : 40 + i * 0.05, 0, 0.5])
    const end = stream.settledCount - 1 - INK_LIVE_TAIL_POINTS
    expect(end).toBeGreaterThan(INK_FREEZE_MIN_POINTS)
    expect(stream.settledAt(end).runningLength - stream.settledAt(1).runningLength).toBeLessThan(
      inkChunkOverlapLength(size),
    )
    expect(planInkFreeze(stream, 0, size)).toBeNull()
  })
})

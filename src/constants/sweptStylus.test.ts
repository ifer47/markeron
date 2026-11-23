import { afterEach, describe, expect, it } from 'vitest'
import type { Point } from '../composables/drawingTypes'
import {
  buildSweptPath,
  computeMinDistSq,
  connectingQuadPoints,
  dotRadius,
  ellipsePoints,
  HIGHLIGHTER_TAPER,
  INK_MIN_DIST_SQ,
  MIN_TAPER_RADIUS,
  nodeFromPoint,
  nodesFromPoints,
  normalizePressure,
  PEN_TAPER,
  planSweptFreeze,
  polylineLength,
  pressureAlphaAt,
  pruneNodes,
  nodesFromSmoothedPoints,
  roundCornerTips,
  SWEPT_FREEZE_MIN_NODES,
  SWEPT_TAIL_NODES,
  smoothPenPoint,
  SWEPT_STYLE,
  setInkTaperEnabled,
  SweptSampleCache,
  taperMetrics,
  taperNodes,
  taperRamps,
  taperStyleFor,
  usesPressureInk,
  type StylusNode,
} from './sweptStylus'

function nodes(points: Array<[number, number]>, r = 3): StylusNode[] {
  return points.map(([x, y]) => ({ x, y, r }))
}

function straight(count: number, step = 1): StylusNode[] {
  return nodes(Array.from({ length: count }, (_, i) => [i * step, 0] as [number, number]))
}

describe('normalizePressure', () => {
  it('defaults missing or zero to 0.5', () => {
    expect(normalizePressure(undefined)).toBe(0.5)
    expect(normalizePressure(null)).toBe(0.5)
    expect(normalizePressure(0)).toBe(0.5)
  })

  it('clamps into a usable range', () => {
    expect(normalizePressure(-1)).toBe(0.5)
    expect(normalizePressure(0.001)).toBe(0.05)
    expect(normalizePressure(5)).toBe(1)
  })
})

describe('usesPressureInk', () => {
  it('is true for pen and touch only', () => {
    expect(usesPressureInk('pen')).toBe(true)
    expect(usesPressureInk('touch')).toBe(true)
    expect(usesPressureInk('mouse')).toBe(false)
    expect(usesPressureInk(undefined)).toBe(false)
  })
})

describe('computeMinDistSq', () => {
  it('uses device-pixel base at reference viewport and dpr 1', () => {
    expect(computeMinDistSq(1440, 900, 1)).toBe(4)
  })

  it('shrinks CSS threshold on higher dpr', () => {
    expect(computeMinDistSq(1440, 900, 2)).toBe(1)
  })

  it('caps area scale so large viewports do not thin too hard', () => {
    expect(computeMinDistSq(2880, 1800, 1)).toBe(8)
  })

  it('keeps ink sampling far below one CSS pixel', () => {
    expect(INK_MIN_DIST_SQ).toBeLessThan(1)
  })
})

describe('node radii', () => {
  it('maps pressure onto a bounded width range for pen and stays uniform for mouse', () => {
    const style = SWEPT_STYLE
    const half = nodeFromPoint({ x: 0, y: 0, pressure: 0.5 }, 6, style, true)
    const full = nodeFromPoint({ x: 0, y: 0, pressure: 1 }, 6, style, true)
    const mouse = nodeFromPoint({ x: 0, y: 0, pressure: 0.1 }, 6, style, false)

    // 中压 = 鼠标宽度；两端夹在 55%–145%，轻压不再塌成发丝线。
    expect(half.r).toBeCloseTo(3, 5)
    expect(full.r).toBeCloseTo(3 * 1.45, 5)
    expect(mouse.r).toBeCloseTo(3, 5)
  })

  it('keeps a light touch above the hairline floor', () => {
    const style = SWEPT_STYLE
    expect(nodeFromPoint({ x: 0, y: 0 }, 0, style, false).r).toBe(0.5)
    // 压感下限 0.05：3 × (0.55 + 0.9 × 0.05) = 1.785
    expect(nodeFromPoint({ x: 0, y: 0, pressure: 0.05 }, 6, style, true).r).toBeCloseTo(1.785, 5)
  })

  it('uses the same radius for an ink tap as for a swept stroke', () => {
    const style = SWEPT_STYLE
    const pen = { x: 0, y: 0, pressure: 0.2 }
    expect(dotRadius(pen, 6, style, 'pen')).toBeCloseTo(nodeFromPoint(pen, 6, style, true).r, 5)
    expect(dotRadius(pen, 6, style, 'mouse')).toBeCloseTo(3, 5)
  })
})

describe('pruneNodes', () => {
  it('keeps every node when pruning is off', () => {
    const input = straight(100)
    expect(pruneNodes(input, { ...SWEPT_STYLE, pruneAngleDeg: 0 })).toHaveLength(input.length)
  })

  it('collapses a straight run to its endpoints', () => {
    const pruned = pruneNodes(straight(100), SWEPT_STYLE)
    // 保留前两个与最后两个，其余共线节点被剪掉
    expect(pruned).toHaveLength(4)
    expect(pruned[0]).toEqual({ x: 0, y: 0, r: 3 })
    expect(pruned[3].x).toBeCloseTo(99, 5)
  })

  it('keeps the corner when the direction changes sharply', () => {
    const input = nodes([
      ...Array.from({ length: 40 }, (_, i) => [i, 0] as [number, number]),
      ...Array.from({ length: 40 }, (_, i) => [40, i] as [number, number]),
    ])
    const pruned = pruneNodes(input, SWEPT_STYLE)
    expect(pruned.some((n) => n.x === 40 && n.y === 0)).toBe(true)
  })

  it('keeps nodes where the tip area jumps when area pruning is on', () => {
    const input = straight(60).map((n, i) => ({ ...n, r: i < 30 ? 1 : 6 }))
    const style = { ...SWEPT_STYLE, pruneAreaRatio: 0.7 }
    expect(pruneNodes(input, style).length).toBeGreaterThan(4)
  })

  it('ships with area pruning off so pressure ramps never step', () => {
    expect(SWEPT_STYLE.pruneAreaRatio).toBe(0)
  })

  it('only prunes near-straight runs, never real curvature', () => {
    expect(SWEPT_STYLE.pruneAngleDeg).toBeGreaterThan(0)
    expect(SWEPT_STYLE.pruneAngleDeg).toBeLessThanOrEqual(5)
  })

  it('keeps a dense gentle curve instead of flattening it to a chord', () => {
    // 慢速书写的采样间隔很小，每个点只转 ~0.6°；只比相邻两点时整段圆弧会被弦代替。
    const arc = nodes(
      Array.from({ length: 300 }, (_, i) => {
        const t = (i / 299) * Math.PI
        return [100 * Math.cos(t), 100 * Math.sin(t)] as [number, number]
      }),
    )
    const pruned = pruneNodes(arc, SWEPT_STYLE)

    expect(pruned.length).toBeGreaterThan(20)
    // 每个保留节点都还在圆弧上。
    for (const node of pruned) expect(Math.hypot(node.x, node.y)).toBeCloseTo(100, 6)
  })

  it('never reorders or duplicates the endpoints', () => {
    const pruned = pruneNodes(straight(200), SWEPT_STYLE)
    expect(pruned[0].x).toBe(0)
    expect(pruned[pruned.length - 1].x).toBeCloseTo(199, 5)
    for (let i = 1; i < pruned.length; i++) expect(pruned[i].x).toBeGreaterThanOrEqual(pruned[i - 1].x)
  })
})

describe('smoothPenPoint', () => {
  it('returns raw samples when both filters are off', () => {
    const style = { ...SWEPT_STYLE, positionStreamline: 0, pressureAlpha: 0 }
    const raw = { x: 10, y: 20, pressure: 0.8 }
    expect(smoothPenPoint({ x: 0, y: 0, pressure: 0.2 }, raw, style)).toEqual(raw)
  })

  it('pulls position and pressure towards the previous sample once warm', () => {
    const style = SWEPT_STYLE
    const out = smoothPenPoint(
      { x: 0, y: 0, pressure: 0.2 },
      { x: 10, y: 10, pressure: 0.8 },
      style,
      style.pressureWarmupSamples,
    )
    expect(out.x).toBeCloseTo(10 * (1 - style.positionStreamline), 5)
    expect(out.y).toBeCloseTo(10 * (1 - style.positionStreamline), 5)
    // 压感也被滤波：介于两者之间且偏向旧值
    expect(out.pressure).toBeGreaterThan(0.2)
    expect(out.pressure).toBeLessThan(0.8)
  })

  it('warms the pressure filter up so a stroke starts at the real width', () => {
    const style = SWEPT_STYLE
    const prev = { x: 0, y: 0, pressure: 0.2 }
    const raw = { x: 10, y: 0, pressure: 0.8 }
    const steady = smoothPenPoint(prev, raw, style, style.pressureWarmupSamples).pressure ?? 0
    const first = smoothPenPoint(prev, raw, style, 1).pressure ?? 0

    // 第 1 个采样几乎直接采用真实压感，随后才回到稳态滤波。
    expect(smoothPenPoint(prev, raw, style, 0).pressure).toBeCloseTo(0.8, 5)
    expect(first).toBeGreaterThan(steady)
    expect(first).toBeGreaterThan(0.6)
    expect(pressureAlphaAt(style.pressureWarmupSamples - 1, style)).toBeGreaterThan(style.pressureAlpha)
    expect(pressureAlphaAt(style.pressureWarmupSamples, style)).toBe(style.pressureAlpha)
  })

  it('ships with all filters enabled', () => {
    expect(SWEPT_STYLE.positionStreamline).toBeGreaterThan(0)
    expect(SWEPT_STYLE.pressureAlpha).toBeGreaterThan(0)
    expect(SWEPT_STYLE.pressureWarmupSamples).toBeGreaterThan(0)
  })
})

describe('buildSweptPath', () => {
  const points = (list: Array<[number, number, number]>): Point[] =>
    list.map(([x, y, pressure]) => ({ x, y, pressure }))

  it('returns an empty path for no nodes', () => {
    expect(buildSweptPath([])).toBeInstanceOf(Path2D)
  })

  it('builds a single disc', () => {
    expect(buildSweptPath(nodes([[5, 5]], 2))).toBeInstanceOf(Path2D)
  })

  it('builds a stroke path for two nodes', () => {
    expect(
      buildSweptPath(
        nodes(
          [
            [0, 0],
            [10, 0],
          ],
          2,
        ),
      ),
    ).toBeInstanceOf(Path2D)
  })

  it('keeps the swept ribbon inside the tip bounds', () => {
    const style = SWEPT_STYLE
    const pruned = pruneNodes(
      nodesFromPoints(
        points([
          [0, 0, 0.5],
          [10, 0, 0.5],
          [20, 0, 0.5],
        ]),
        6,
        style,
        'pen',
      ),
      style,
    )
    const bounds = sweptBounds(pruned)
    // 半径 3 的胶囊：y 方向 ±3，x 方向 -3~23
    expect(bounds.minY).toBeCloseTo(-3, 5)
    expect(bounds.maxY).toBeCloseTo(3, 5)
    expect(bounds.minX).toBeCloseTo(-3, 5)
    expect(bounds.maxX).toBeCloseTo(23, 5)
  })

  it('varies radius with pressure for pen, not for mouse', () => {
    const style = SWEPT_STYLE
    const penBounds = sweptBounds(
      nodesFromPoints(
        points([
          [0, 0, 1],
          [20, 0, 1],
        ]),
        6,
        style,
        'pen',
      ),
    )
    const mouseBounds = sweptBounds(
      nodesFromPoints(
        points([
          [0, 0, 0.2],
          [20, 0, 0.2],
        ]),
        6,
        style,
        'mouse',
      ),
    )
    expect(penBounds.maxY).toBeCloseTo(3 * 1.45, 5)
    expect(mouseBounds.maxY).toBeCloseTo(3, 5)
  })

  it('joins two tips with tangent points at each radius', () => {
    const a = { x: 0, y: 0, r: 4 }
    const b = { x: 10, y: 0, r: 2 }
    const quad = connectingQuadPoints(a, b)!
    expect(quad).toHaveLength(4)
    expect(Math.hypot(quad[0].x - a.x, quad[0].y - a.y)).toBeCloseTo(a.r, 5)
    expect(Math.hypot(quad[1].x - b.x, quad[1].y - b.y)).toBeCloseTo(b.r, 5)
    // 切线：圆心到切点的半径垂直于切线本身
    const along = { x: quad[1].x - quad[0].x, y: quad[1].y - quad[0].y }
    const radius = { x: quad[0].x - a.x, y: quad[0].y - a.y }
    expect(along.x * radius.x + along.y * radius.y).toBeCloseTo(0, 5)
  })

  it('skips the hull when one tip contains the other', () => {
    expect(connectingQuadPoints({ x: 0, y: 0, r: 10 }, { x: 1, y: 0, r: 1 })).toBeNull()
  })

  it('winds every hull the same way as the tip discs, whichever way the stroke runs', () => {
    // 非零填充：圆盘与四边形必须同向，否则重叠区会被挖空（白洞）
    const disc = polygonArea(ellipsePoints({ x: 0, y: 0, r: 3 }, 64))
    const cases: Array<[StylusNode, StylusNode]> = [
      [
        { x: 0, y: 0, r: 3 },
        { x: 10, y: 0, r: 3 },
      ], // 右
      [
        { x: 0, y: 0, r: 3 },
        { x: -10, y: 0, r: 3 },
      ], // 左
      [
        { x: 0, y: 0, r: 3 },
        { x: 0, y: 10, r: 3 },
      ], // 下
      [
        { x: 0, y: 0, r: 3 },
        { x: 0, y: -10, r: 3 },
      ], // 上
      [
        { x: 0, y: 0, r: 4 },
        { x: 9, y: -7, r: 1.5 },
      ], // 斜向 + 变宽
      [
        { x: 0, y: 0, r: 1.5 },
        { x: -9, y: 7, r: 6 },
      ], // 斜向 + 变细
    ]
    for (const [a, b] of cases) {
      const quad = connectingQuadPoints(a, b)
      expect(quad).not.toBeNull()
      const area = polygonArea(quad!)
      expect(Math.sign(area)).toBe(Math.sign(disc))
    }
  })

  it('keeps two tangent points on each tip however the quad is ordered', () => {
    const cases: Array<[StylusNode, StylusNode]> = [
      [
        { x: 0, y: 0, r: 3 },
        { x: 10, y: 0, r: 3 },
      ],
      [
        { x: 0, y: 0, r: 3 },
        { x: -10, y: 0, r: 3 },
      ],
      [
        { x: 0, y: 0, r: 4 },
        { x: 9, y: -7, r: 1.5 },
      ],
    ]
    for (const [a, b] of cases) {
      const quad = connectingQuadPoints(a, b)!
      expect(new Set(quad.map((p) => `${p.x.toFixed(3)},${p.y.toFixed(3)}`)).size).toBe(4)
      const onA = quad.filter((p) => Math.abs(Math.hypot(p.x - a.x, p.y - a.y) - a.r) < 1e-6)
      const onB = quad.filter((p) => Math.abs(Math.hypot(p.x - b.x, p.y - b.y) - b.r) < 1e-6)
      expect(onA).toHaveLength(2)
      expect(onB).toHaveLength(2)
    }
  })

  it('never builds a self-intersecting (bow-tie) hull', () => {
    // 自相交会让非零填充把中间挖空：相邻边必须首尾相接且同向
    const quad = connectingQuadPoints({ x: 0, y: 0, r: 3 }, { x: 10, y: 4, r: 2 })!
    const cross = (o: { x: number; y: number }, p: { x: number; y: number }, q: { x: number; y: number }) =>
      (p.x - o.x) * (q.y - o.y) - (p.y - o.y) * (q.x - o.x)
    const signs = [0, 1, 2, 3].map((i) => Math.sign(cross(quad[i], quad[(i + 1) % 4], quad[(i + 2) % 4])))
    expect(new Set(signs).size).toBe(1)
  })

  it('places every ellipse sample at the tip radius', () => {
    for (const p of ellipsePoints({ x: 3, y: -2, r: 5 }, 16)) {
      expect(Math.hypot(p.x - 3, p.y + 2)).toBeCloseTo(5, 5)
    }
  })
})

describe('planSweptFreeze', () => {
  it('waits until enough nodes sit behind the live tail', () => {
    expect(planSweptFreeze(SWEPT_FREEZE_MIN_NODES + SWEPT_TAIL_NODES, 0)).toBeNull()
  })

  it('freezes a chunk and restarts the tail behind the seam', () => {
    const count = SWEPT_FREEZE_MIN_NODES + SWEPT_TAIL_NODES + 10
    const plan = planSweptFreeze(count, 0)
    expect(plan).not.toBeNull()
    expect(plan!.end).toBe(count - 1 - SWEPT_TAIL_NODES)
    expect(plan!.nextStart).toBeGreaterThan(0)
    expect(plan!.nextStart).toBeLessThan(plan!.end)
  })

  it('stops once the remaining tail cannot fill another chunk', () => {
    const count = SWEPT_FREEZE_MIN_NODES + SWEPT_TAIL_NODES + 10
    const first = planSweptFreeze(count, 0)!
    expect(planSweptFreeze(count, first.nextStart)).toBeNull()
  })
})

/** Shoelace area: positive = clockwise in screen space (y down). */
function polygonArea(points: { x: number; y: number }[]): number {
  let sum = 0
  for (let i = 0; i < points.length; i++) {
    const a = points[i]
    const b = points[(i + 1) % points.length]
    sum += a.x * b.y - b.x * a.y
  }
  return sum / 2
}

/** Bounds of the union, sampled from the same primitives the path is built from. */
function sweptBounds(input: StylusNode[]): { minX: number; minY: number; maxX: number; maxY: number } {
  const all: { x: number; y: number }[] = []
  for (let i = 0; i < input.length; i++) {
    all.push(...ellipsePoints(input[i], 64))
    if (i > 0) {
      const quad = connectingQuadPoints(input[i - 1], input[i])
      if (quad) all.push(...quad)
    }
  }
  return {
    minX: Math.min(...all.map((p) => p.x)),
    minY: Math.min(...all.map((p) => p.y)),
    maxX: Math.max(...all.map((p) => p.x)),
    maxY: Math.max(...all.map((p) => p.y)),
  }
}

describe('SweptSampleCache', () => {
  /** Hand-drawn-ish input with pressure noise. */
  function scribble(count: number): Point[] {
    return Array.from({ length: count }, (_, i) => ({
      x: 200 + Math.sin(i * 0.21) * 90 + Math.sin(i * 0.77) * 6,
      y: i * 2.5,
      pressure: 0.5 + Math.sin(i * 0.37) * 0.3,
    }))
  }

  it('reproduces nodesFromSmoothedPoints exactly, sample for sample', () => {
    const points = scribble(400)
    const cache = new SweptSampleCache(6, SWEPT_STYLE, 'pen')
    cache.sync(points)
    const expected = nodesFromSmoothedPoints(points, 6, SWEPT_STYLE, 'pen')
    expect(cache.nodes(points, 0)).toEqual(expected)
  })

  it('keeps every slice on the same phase as the whole-stroke render', () => {
    // This is the invariant that makes the live preview and the committed stroke agree:
    // the chunked slices, concatenated, must equal the final outline sample for sample.
    const points = scribble(400)
    const cache = new SweptSampleCache(6, SWEPT_STYLE, 'pen')
    cache.sync(points)
    const expected = nodesFromSmoothedPoints(points, 6, SWEPT_STYLE, 'pen')

    const sliced: StylusNode[] = []
    for (let start = 0; start < points.length; start += 64) {
      const end = Math.min(start + 63, points.length - 1)
      sliced.push(...cache.nodes(points, start, end))
    }
    expect(sliced).toEqual(expected)
  })

  it('catches up incrementally without changing earlier samples', () => {
    const points = scribble(150)
    const cache = new SweptSampleCache(4, SWEPT_STYLE, 'mouse')
    let previous: StylusNode[] = []

    for (let len = 1; len <= points.length; len++) {
      const prefix = points.slice(0, len)
      cache.sync(prefix)
      const current = cache.nodes(prefix, 0)
      // Each new frame must reproduce the prefix outline exactly…
      expect(current).toEqual(nodesFromSmoothedPoints(prefix, 4, SWEPT_STYLE, 'mouse'))
      // …and only the two samples nearest the tip may move as it grows.
      const settled = cache.nodes(prefix, 0, Math.max(0, prefix.length - 3)).length
      if (settled > 0 && settled <= previous.length) {
        expect(current.slice(0, settled)).toEqual(previous.slice(0, settled))
      }
      previous = current
      // Re-syncing the same samples must be a no-op.
      cache.sync(prefix)
      expect(cache.nodes(prefix, 0)).toEqual(current)
    }
  })

  it('leaves the tip unsmoothed so the stroke reaches the pointer', () => {
    const points: Point[] = [
      { x: 0, y: 0, pressure: 0.5 },
      { x: 10, y: 0, pressure: 0.5 },
      { x: 30, y: 0, pressure: 0.5 },
    ]
    const cache = new SweptSampleCache(6, SWEPT_STYLE, 'pen')
    cache.sync(points)
    const out = cache.nodes(points, 0)
    expect(out[out.length - 1].x).toBe(30)
    // The middle sample is lagged by the EMA, the tip is not.
    expect(out[1].x).toBeLessThan(10)
  })
})

describe('roundCornerTips', () => {
  const p = (x: number, y: number): Point => ({ x, y, pressure: 0.5 })

  it('leaves a straight run untouched', () => {
    const out = roundCornerTips(p(0, 0), p(10, 0), p(20, 0), SWEPT_STYLE)
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ x: 10, y: 0 })
  })

  it('leaves a turn below the threshold untouched', () => {
    // ~3.4° turn, under the 8° default.
    const out = roundCornerTips(p(0, 0), p(20, 0), p(40, 1.2), SWEPT_STYLE)
    expect(out).toHaveLength(1)
  })

  it('cuts a sharp turn into an arc whose ends sit on both segments', () => {
    const out = roundCornerTips(p(0, 0), p(20, 0), p(20, 20), SWEPT_STYLE)
    // 90° turn / 8° per step → at least 12 sub-segments.
    expect(out.length).toBeGreaterThanOrEqual(13)

    const cut = Math.min(20 * SWEPT_STYLE.cornerCutRatio, SWEPT_STYLE.cornerCutMaxPx)
    expect(out[0].x).toBeCloseTo(20 - cut, 6)
    expect(out[0].y).toBeCloseTo(0, 6)
    expect(out[out.length - 1].x).toBeCloseTo(20, 6)
    expect(out[out.length - 1].y).toBeCloseTo(cut, 6)

    // Every interpolated tip stays inside the corner, never beyond the sample.
    for (const tip of out) {
      expect(tip.x).toBeLessThanOrEqual(20 + 1e-9)
      expect(tip.y).toBeGreaterThanOrEqual(-1e-9)
    }
  })

  it('caps the cut so long segments cannot swallow the stroke', () => {
    const out = roundCornerTips(p(0, 0), p(200, 0), p(200, 200), SWEPT_STYLE)
    const first = out[0]
    expect(200 - first.x).toBeCloseTo(SWEPT_STYLE.cornerCutMaxPx, 6)
  })

  it('never consumes more than half of a short segment', () => {
    const out = roundCornerTips(p(0, 0), p(4, 0), p(4, 4), SWEPT_STYLE)
    expect(out[0].x).toBeCloseTo(2, 6)
  })

  it('can be switched off', () => {
    const out = roundCornerTips(p(0, 0), p(20, 0), p(20, 20), { ...SWEPT_STYLE, cornerAngleDeg: 0 })
    expect(out).toHaveLength(1)
  })

  it('bounds the turn between neighbouring tips', () => {
    // A quadratic Bézier sweeps its tangent non-uniformly (tightest at the control
    // point), so the worst segment turns about twice the per-step average — 0.08 px
    // of chord deviation at the 8 px cap, i.e. below the antialiasing floor.
    const out = roundCornerTips(p(0, 0), p(20, 0), p(0, 20), SWEPT_STYLE)
    let worst = 0
    for (let i = 2; i < out.length; i++) {
      const a = Math.atan2(out[i - 1].y - out[i - 2].y, out[i - 1].x - out[i - 2].x)
      const b = Math.atan2(out[i].y - out[i - 1].y, out[i].x - out[i - 1].x)
      let d = (Math.abs(b - a) * 180) / Math.PI
      if (d > 180) d = 360 - d
      worst = Math.max(worst, d)
    }
    expect(worst).toBeLessThanOrEqual(2 * SWEPT_STYLE.cornerAngleDeg)
  })
})

describe('nodesFromSmoothedPoints corner rounding', () => {
  it('adds tips only where the stroke turns', () => {
    const straightLine: Point[] = Array.from({ length: 40 }, (_, i) => ({ x: i * 4, y: 0, pressure: 0.5 }))
    expect(nodesFromSmoothedPoints(straightLine, 6, SWEPT_STYLE, 'pen')).toHaveLength(straightLine.length)

    const zigzag: Point[] = Array.from({ length: 40 }, (_, i) => ({
      x: i * 4,
      y: i % 2 === 0 ? 0 : 30,
      pressure: 0.5,
    }))
    expect(nodesFromSmoothedPoints(zigzag, 6, SWEPT_STYLE, 'pen').length).toBeGreaterThan(zigzag.length * 3)
  })

  it('keeps the tip on the pointer sample', () => {
    const points: Point[] = [
      { x: 0, y: 0, pressure: 0.5 },
      { x: 20, y: 0, pressure: 0.5 },
      { x: 20, y: 20, pressure: 0.5 },
      { x: 40, y: 20, pressure: 0.5 },
    ]
    const out = nodesFromSmoothedPoints(points, 6, SWEPT_STYLE, 'pen')
    expect(out[out.length - 1]).toMatchObject({ x: 40, y: 20 })
  })
})

describe('taperRamps', () => {
  const slow = { speed: 0, turn: 0, entrySpeed: 0 }
  const fast = { speed: 1, turn: 0, entrySpeed: 1 }

  it('scales both ends with the pen width on a long stroke', () => {
    const ramps = taperRamps(100, 4, PEN_TAPER, slow)
    expect(ramps.start).toBe(0)
    expect(ramps.belly).toBeCloseTo(4 * PEN_TAPER.endLength * (1 + 0.25), 6)
    expect(ramps.thread).toBeCloseTo(4 * PEN_TAPER.endLength * (1 - 0.25), 6)
  })

  it('stretches the 出锋 and grows the 露锋 with speed', () => {
    const slowRamps = taperRamps(200, 4, PEN_TAPER, slow)
    const fastRamps = taperRamps(200, 4, PEN_TAPER, fast)
    expect(fastRamps.belly / slowRamps.belly).toBeCloseTo(1 + PEN_TAPER.speedLengthGain, 6)
    // 慢速落笔是藏锋，根本没有入口斜坡。
    expect(fastRamps.start / slowRamps.belly).toBeCloseTo(PEN_TAPER.startLength / PEN_TAPER.endLength / 1.25, 6)
  })

  it('keeps an entry ramp far shorter than the exit', () => {
    const ramps = taperRamps(200, 4, PEN_TAPER, fast)
    expect(ramps.start).toBeCloseTo(4 * PEN_TAPER.startLength, 6)
    expect(ramps.start).toBeLessThan(ramps.thread)
  })

  it('caps the ramps so a short tick keeps a full-width body', () => {
    const ramps = taperRamps(6, 4, PEN_TAPER, fast)
    expect(ramps.start + ramps.belly).toBeCloseTo(6 * PEN_TAPER.maxLengthRatio, 6)
  })

  it('does not taper a zero-length stroke', () => {
    expect(taperRamps(0, 4, PEN_TAPER)).toEqual({ start: 0, belly: 0, thread: 0 })
  })
})

describe('taperMetrics', () => {
  const line = (spacing: number, count = 12): StylusNode[] =>
    Array.from({ length: count }, (_, i) => ({ x: i * spacing, y: 0, r: 2 }))

  it('maps slow presses to 0 and fast flicks to 1', () => {
    expect(taperMetrics(line(0.5)).speed).toBe(0)
    expect(taperMetrics(line(3)).speed).toBeCloseTo(0.5, 6)
    expect(taperMetrics(line(10)).speed).toBe(1)
  })

  it('reads the entry speed from the first samples', () => {
    // 起笔慢、收笔快：藏锋落笔 + 长出锋。
    const nodes: StylusNode[] = Array.from({ length: 20 }, (_, i) => ({
      x: i < 10 ? i * 0.4 : 4 + (i - 10) * 9,
      y: 0,
      r: 2,
    }))
    const metrics = taperMetrics(nodes)
    expect(metrics.entrySpeed).toBe(0)
    expect(metrics.speed).toBe(1)
  })

  it('reports the signed turn of the exit', () => {
    // 屏幕坐标 y 向下：向上拐是负角。
    const up: StylusNode[] = [
      { x: 0, y: 0, r: 2 },
      { x: 10, y: 0, r: 2 },
      { x: 20, y: -10, r: 2 },
      { x: 30, y: -20, r: 2 },
    ]
    expect(taperMetrics(up).turn).toBeCloseTo(-Math.PI / 4, 5)
    expect(taperMetrics(up.map((node) => ({ ...node, y: -node.y }))).turn).toBeCloseTo(Math.PI / 4, 5)
  })

  it('has no direction to report on a tap', () => {
    expect(taperMetrics([{ x: 0, y: 0, r: 2 }])).toEqual({ speed: 0, turn: 0, entrySpeed: 0 })
  })
})

describe('taperNodes', () => {
  const lineWidth = 4
  const half = lineWidth / 2

  it('picks a different ramp for the highlighter', () => {
    expect(taperStyleFor('highlighter')).toBe(HIGHLIGHTER_TAPER)
    expect(taperStyleFor('pen')).toBe(PEN_TAPER)
    expect(taperStyleFor(undefined)).toBe(PEN_TAPER)
  })

  it('paints a locked line (a shape) with no 锋 at all', () => {
    setInkTaperEnabled(true)
    expect(taperStyleFor('pen', true).endLength).toBe(0)
    expect(taperStyleFor('highlighter', true).endLength).toBe(0)

    const input = nodesFromSmoothedPoints(
      [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
      ],
      lineWidth,
      SWEPT_STYLE,
      'mouse',
    )
    expect(taperNodes(input, lineWidth, polylineLength(input), taperStyleFor('pen', true))).toBe(input)
  })

  const straight = (): StylusNode[] =>
    nodesFromSmoothedPoints(
      [
        { x: 0, y: 0 },
        { x: 50, y: 0 },
        { x: 100, y: 0 },
      ],
      lineWidth,
      SWEPT_STYLE,
      'mouse',
    )
  const slow = { speed: 0, turn: 0, entrySpeed: 0 }
  const fastEntry = { speed: 0, turn: 0, entrySpeed: 1 }

  it('keeps a slow 藏锋 landing blunt', () => {
    const input = straight()
    const tapered = taperNodes(input, lineWidth, polylineLength(input), PEN_TAPER, { metrics: slow })

    // 笔尖压住再走：起笔是满宽的。
    expect(tapered[0].r).toBeCloseTo(half, 5)
    expect(tapered[tapered.length - 1].r).toBeCloseTo(half * PEN_TAPER.endTipScale, 5)
  })

  it('thins a fast 露锋 landing into a short tip', () => {
    const input = straight()
    const tapered = taperNodes(input, lineWidth, polylineLength(input), PEN_TAPER, {
      metrics: fastEntry,
    })

    // 尖起只占一小段：第一个采样点收细，但入口斜坡远短于出口。
    expect(tapered[0].r).toBeCloseTo(half * PEN_TAPER.startTipScale, 5)
    const entryEnd = tapered.findIndex((node) => Math.abs(node.r - half) < 1e-6)
    expect(entryEnd).toBeGreaterThan(0)
    expect(tapered[entryEnd].x).toBeLessThan(polylineLength(input) * 0.2)
  })

  it('ramps the radius between the two tips with a full-width belly', () => {
    const input = straight()
    const tapered = taperNodes(input, lineWidth, polylineLength(input), PEN_TAPER, {
      metrics: fastEntry,
    })

    // 两端都收细，中间保持满宽（一撇笔，而不是中间粗两头尖的叶子）。
    expect(Math.max(...tapered.map((node) => node.r))).toBeCloseTo(half, 5)
    const peak = tapered.reduce((best, node, index) => (node.r > tapered[best].r ? index : best), 0)
    for (let i = 1; i <= peak; i++) {
      expect(tapered[i].r).toBeGreaterThanOrEqual(tapered[i - 1].r - 1e-9)
    }
    for (let i = peak + 1; i < tapered.length; i++) {
      expect(tapered[i].r).toBeLessThanOrEqual(tapered[i - 1].r + 1e-9)
    }
  })

  it('densifies a sparse two-point stroke so only the exit tapers', () => {
    const input = nodesFromSmoothedPoints(
      [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
      ],
      lineWidth,
      SWEPT_STYLE,
      'mouse',
    )
    const tapered = taperNodes(input, lineWidth, polylineLength(input), PEN_TAPER)

    // 出锋长 3.2 × 4 = 12.8px，采样点必须足够密才画得出弧线，而不是整条线段都在变细。
    expect(tapered.length).toBeGreaterThan(input.length + 10)
    expect(Math.max(...tapered.map((n) => n.r))).toBeCloseTo(half, 5)
    expect(tapered[0].r).toBeCloseTo(half, 5)
    expect(tapered[tapered.length - 1].r).toBeLessThan(half)
  })

  it('never paints below the hairline tip radius', () => {
    const input = nodesFromSmoothedPoints(
      [
        { x: 0, y: 0 },
        { x: 4, y: 0 },
      ],
      0.2,
      SWEPT_STYLE,
      'mouse',
    )
    const tapered = taperNodes(input, 0.2, polylineLength(input), PEN_TAPER)
    expect(Math.min(...tapered.map((n) => n.r))).toBeGreaterThanOrEqual(MIN_TAPER_RADIUS - 1e-9)
  })

  it('only tapers a slice that ends at the lifted tip', () => {
    const input = nodesFromSmoothedPoints(
      [
        { x: 0, y: 0 },
        { x: 50, y: 0 },
        { x: 100, y: 0 },
      ],
      lineWidth,
      SWEPT_STYLE,
      'mouse',
    )
    const tailOnly = taperNodes(input, lineWidth, polylineLength(input), PEN_TAPER, {
      taperStart: false,
      metrics: fastEntry,
    })
    expect(tailOnly[0].r).toBeCloseTo(half, 5)
    expect(tailOnly[tailOnly.length - 1].r).toBeCloseTo(half * PEN_TAPER.endTipScale, 5)
  })

  it('leaves a covered slice at full width', () => {
    const input = nodesFromSmoothedPoints(
      [
        { x: 0, y: 0 },
        { x: 50, y: 0 },
        { x: 100, y: 0 },
      ],
      lineWidth,
      SWEPT_STYLE,
      'mouse',
    )
    // 冻结块的末端藏在实时尾部下方，必须是满宽圆头，不能留缺口。
    expect(taperNodes(input, lineWidth, polylineLength(input), PEN_TAPER, { taperEnd: false, metrics: slow })).toBe(
      input,
    )
  })

  it('skews the tail off the centreline', () => {
    const input: StylusNode[] = Array.from({ length: 40 }, (_, i) => ({ x: i * 2, y: 0, r: half }))
    const total = polylineLength(input)
    const offsetOf = (nodes: StylusNode[]) => Math.max(...nodes.map((node) => Math.abs(node.y)))

    // 尾巴向肩部一侧偏斜，形成月牙而不是对称的针尖。
    const skewed = taperNodes(input, lineWidth, total, PEN_TAPER)
    expect(offsetOf(skewed)).toBeGreaterThan(0.1)

    // 完全对称时中心线不动。
    const symmetric = taperNodes(input, lineWidth, total, { ...PEN_TAPER, skew: 0 })
    expect(offsetOf(symmetric)).toBe(0)

    // 反向弯曲时偏到另一侧。
    const flipped = taperNodes(input, lineWidth, total, PEN_TAPER, {
      metrics: { speed: 0, turn: -Math.PI, entrySpeed: 0 },
    })
    const peak = (nodes: StylusNode[]) =>
      nodes.reduce((best, node) => (Math.abs(node.y) > Math.abs(best.y) ? node : best))
    expect(Math.sign(peak(flipped).y)).toBe(-Math.sign(peak(skewed).y))
  })

  it('sharpens and lengthens the 锋 for a fast lift', () => {
    const input: StylusNode[] = Array.from({ length: 40 }, (_, i) => ({ x: i * 2, y: 0, r: half }))
    const total = polylineLength(input)
    const radiusAt = (nodes: StylusNode[], x: number) =>
      nodes.reduce((best, node) => (Math.abs(node.x - x) < Math.abs(best.x - x) ? node : best)).r

    // 同一位置，快速挑笔更细：锋更长。
    const slowExit = taperNodes(input, lineWidth, total, PEN_TAPER, {
      metrics: { speed: 0, turn: 0, entrySpeed: 0 },
    })
    const fastExit = taperNodes(input, lineWidth, total, PEN_TAPER, {
      metrics: { speed: 1, turn: 0, entrySpeed: 0 },
    })
    expect(radiusAt(fastExit, total - 8)).toBeLessThan(radiusAt(slowExit, total - 8))
    expect(radiusAt(fastExit, total * 0.4)).toBeCloseTo(radiusAt(slowExit, total * 0.4), 5)
  })

  it('leaves a single-sample tap round', () => {
    const tap: StylusNode[] = [{ x: 0, y: 0, r: 2 }]
    expect(taperNodes(tap, lineWidth, 0, PEN_TAPER)).toEqual(tap)
  })

  describe('global switch', () => {
    afterEach(() => setInkTaperEnabled(true))

    it('paints a uniform ribbon when the setting is off', () => {
      const input = nodesFromSmoothedPoints(
        [
          { x: 0, y: 0 },
          { x: 100, y: 0 },
        ],
        lineWidth,
        SWEPT_STYLE,
        'mouse',
      )
      setInkTaperEnabled(false)
      const style = taperStyleFor('pen')
      expect(style.endLength).toBe(0)
      // 关闭时连数组都不重建，直接复用原始节点。
      expect(taperNodes(input, lineWidth, polylineLength(input), style)).toBe(input)
      expect(taperStyleFor('highlighter').endTipScale).toBe(1)
    })
  })
})

describe('SweptSampleCache length', () => {
  it('reports the whole-stroke arc length for the live ramps', () => {
    const points: Point[] = Array.from({ length: 12 }, (_, i) => ({ x: i * 10, y: 0 }))
    const cache = new SweptSampleCache(4, SWEPT_STYLE, 'mouse')
    cache.sync(points)
    // 直线上的平滑位移只做插值，累计弧长与原始采样一致。
    expect(cache.length(points)).toBeCloseTo(polylineLength(points), 5)
  })
})

describe('taperNodes live slices', () => {
  const points: Point[] = Array.from({ length: 300 }, (_, i) => ({ x: i * 2, y: Math.sin(i / 12) * 20 }))
  const nodes = nodesFromSmoothedPoints(points, 4, SWEPT_STYLE, 'mouse')
  const total = polylineLength(nodes)
  const committed = taperNodes(nodes, 4, total, PEN_TAPER)
  const committedAt = new Map(committed.map((node) => [`${node.x},${node.y}`, node.r]))

  it('freezes a chunk without a ramp at its covered end', () => {
    const chunk = taperNodes(nodes.slice(0, 260), 4, total, PEN_TAPER, {
      taperStart: true,
      taperEnd: false,
    })
    // 冻结块的末端藏在实时尾部下方，必须是满宽圆头，不能留缺口。
    expect(chunk[chunk.length - 1].r).toBeCloseTo(2, 6)
    for (const node of chunk) {
      const painted = committedAt.get(`${node.x},${node.y}`)
      if (painted !== undefined) expect(node.r).toBeCloseTo(painted, 6)
    }
  })

  it('tapers the live tail exactly like the committed ribbon', () => {
    const tail = taperNodes(nodes.slice(200), 4, total, PEN_TAPER, {
      taperStart: false,
      taperEnd: true,
    })
    // 尾部起点是冻结块的接缝，必须和冻结块一样保持满宽；其余节点必须与落笔后的轮廓逐点一致。
    expect(tail[0].r).toBeCloseTo(2, 6)
    expect(tail[tail.length - 1].r).toBeCloseTo(committed[committed.length - 1].r, 6)
    for (const node of tail) {
      const painted = committedAt.get(`${node.x},${node.y}`)
      if (painted !== undefined) expect(node.r).toBeCloseTo(painted, 6)
    }
  })
})

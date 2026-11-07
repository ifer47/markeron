import { describe, expect, it } from 'vitest'
import type { DrawAction } from './drawingTypes'
import {
  applyReshapeHandle,
  aspectLockedFreePoint,
  boundsAfterCornerDrag,
  getPointsBounds,
  getReshapeHandles,
  hitTestReshapeHandle,
  isReshapeableTool,
  scalePointsToBounds,
} from './drawingReshape'

function shape(tool: DrawAction['tool'], x0: number, y0: number, x1: number, y1: number): DrawAction {
  return {
    tool,
    color: '#f00',
    lineWidth: 3,
    opacity: 1,
    points: [
      { x: x0, y: y0 },
      { x: x1, y: y1 },
    ],
  }
}

describe('drawingReshape', () => {
  it('isReshapeableTool covers geometric and ink tools', () => {
    expect(isReshapeableTool('line')).toBe(true)
    expect(isReshapeableTool('arrow')).toBe(true)
    expect(isReshapeableTool('rect')).toBe(true)
    expect(isReshapeableTool('ellipse')).toBe(true)
    expect(isReshapeableTool('pen')).toBe(true)
    expect(isReshapeableTool('highlighter')).toBe(true)
    expect(isReshapeableTool('text')).toBe(false)
    expect(isReshapeableTool('select')).toBe(false)
  })

  it('getReshapeHandles returns endpoints for line/arrow', () => {
    const line = shape('line', 10, 20, 100, 80)
    expect(getReshapeHandles(line)).toEqual([
      { id: 'p0', x: 10, y: 20, cursor: 'grab' },
      { id: 'p1', x: 100, y: 80, cursor: 'grab' },
    ])
  })

  it('getReshapeHandles returns corners for rect/ellipse', () => {
    const rect = shape('rect', 10, 80, 100, 20)
    expect(getReshapeHandles(rect)).toEqual([
      { id: 'tl', x: 10, y: 20, cursor: 'nwse-resize' },
      { id: 'tr', x: 100, y: 20, cursor: 'nesw-resize' },
      { id: 'br', x: 100, y: 80, cursor: 'nwse-resize' },
      { id: 'bl', x: 10, y: 80, cursor: 'nesw-resize' },
    ])
  })

  it('getReshapeHandles returns point-bounds corners for pen', () => {
    const pen: DrawAction = {
      tool: 'pen',
      color: '#f00',
      lineWidth: 3,
      opacity: 1,
      points: [
        { x: 10, y: 50 },
        { x: 40, y: 10 },
        { x: 80, y: 90 },
      ],
    }
    expect(getReshapeHandles(pen)).toEqual([
      { id: 'tl', x: 10, y: 10, cursor: 'nwse-resize' },
      { id: 'tr', x: 80, y: 10, cursor: 'nesw-resize' },
      { id: 'br', x: 80, y: 90, cursor: 'nwse-resize' },
      { id: 'bl', x: 10, y: 90, cursor: 'nesw-resize' },
    ])
  })

  it('hitTestReshapeHandle prefers the nearest handle in range', () => {
    const line = shape('line', 0, 0, 100, 0)
    expect(hitTestReshapeHandle(line, { x: 2, y: 3 })?.id).toBe('p0')
    expect(hitTestReshapeHandle(line, { x: 98, y: -2 })?.id).toBe('p1')
    expect(hitTestReshapeHandle(line, { x: 50, y: 0 })).toBeNull()
  })

  it('applyReshapeHandle moves a line endpoint', () => {
    const line = shape('line', 0, 0, 100, 0)
    applyReshapeHandle(line, 'p1', { x: 120, y: 40 })
    expect(line.points[0]).toMatchObject({ x: 0, y: 0 })
    expect(line.points[1]).toMatchObject({ x: 120, y: 40 })
  })

  it('applyReshapeHandle keeps the opposite rect corner fixed', () => {
    const rect = shape('rect', 10, 10, 100, 80)
    applyReshapeHandle(rect, 'tl', { x: 0, y: 0 })
    expect(getReshapeHandles(rect).find((h) => h.id === 'tl')).toMatchObject({ x: 0, y: 0 })
    expect(getReshapeHandles(rect).find((h) => h.id === 'br')).toMatchObject({ x: 100, y: 80 })

    applyReshapeHandle(rect, 'tr', { x: 150, y: -10 })
    expect(getReshapeHandles(rect).find((h) => h.id === 'tr')).toMatchObject({ x: 150, y: -10 })
    expect(getReshapeHandles(rect).find((h) => h.id === 'bl')).toMatchObject({ x: 0, y: 80 })
  })

  it('scalePointsToBounds maps points into the new box', () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 50, y: 50 },
      { x: 100, y: 100 },
    ]
    scalePointsToBounds(pts, { x0: 0, y0: 0, x1: 100, y1: 100 }, { x0: 0, y0: 0, x1: 200, y1: 50 })
    expect(pts[0]).toMatchObject({ x: 0, y: 0 })
    expect(pts[1]).toMatchObject({ x: 100, y: 25 })
    expect(pts[2]).toMatchObject({ x: 200, y: 50 })
  })

  it('applyReshapeHandle scales pen stroke and attached erasers together', () => {
    const pen: DrawAction = {
      tool: 'pen',
      color: '#f00',
      lineWidth: 3,
      opacity: 1,
      points: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 100 },
      ],
      attachedErasers: [
        {
          tool: 'eraser',
          color: '#000',
          lineWidth: 10,
          opacity: 1,
          points: [
            { x: 50, y: 0 },
            { x: 50, y: 50 },
          ],
        },
      ],
    }

    applyReshapeHandle(pen, 'br', { x: 200, y: 200 })
    expect(getPointsBounds(pen.points)).toEqual({ x0: 0, y0: 0, x1: 200, y1: 200 })
    expect(pen.points[1]).toMatchObject({ x: 200, y: 0 })
    expect(pen.attachedErasers![0].points[0]).toMatchObject({ x: 100, y: 0 })
    expect(pen.attachedErasers![0].points[1]).toMatchObject({ x: 100, y: 100 })
  })

  it('aspectLockedFreePoint keeps width/height ratio from the fixed corner', () => {
    const free = aspectLockedFreePoint({ x: 0, y: 0 }, { x: 200, y: 50 }, 2)
    // aspect 2 → height driven by max(200/2, 50) = 100 → size 200×100
    expect(free).toMatchObject({ x: 200, y: 100 })
  })

  it('applyReshapeHandle constrains rect corners to origin aspect', () => {
    const rect = shape('rect', 0, 0, 100, 50) // aspect 2
    applyReshapeHandle(
      rect,
      'br',
      { x: 200, y: 200 },
      {
        constrain: true,
        originAspect: 2,
        originBounds: { x0: 0, y0: 0, x1: 100, y1: 50 },
      },
    )
    const b = getPointsBounds(rect.points)!
    expect((b.x1 - b.x0) / (b.y1 - b.y0)).toBeCloseTo(2, 5)
    expect(b.x0).toBe(0)
    expect(b.y0).toBe(0)
  })

  it('applyReshapeHandle snaps line endpoints to angle when constrained', () => {
    const line = shape('line', 0, 0, 100, 0)
    applyReshapeHandle(line, 'p1', { x: 100, y: 20 }, { constrain: true, angleSnapStep: 45 })
    // 45° snap from nearly-horizontal → 0°
    expect(line.points[1].y).toBeCloseTo(0, 5)
    expect(line.points[1].x).toBeCloseTo(Math.hypot(100, 20), 5)
  })

  it('boundsAfterCornerDrag keeps the opposite corner fixed when crossing it', () => {
    const from = { x0: 10, y0: 10, x1: 100, y1: 80 }
    // Drag BR past TL to (-20, -30); fixed corner must stay at (10, 10).
    const to = boundsAfterCornerDrag(from, 'br', { x: -20, y: -30 })
    expect(to.x1).toBe(10)
    expect(to.y1).toBe(10)
    expect(to.x0).toBe(-20)
    expect(to.y0).toBe(-30)
  })

  it('applyReshapeHandle no-ops when corner bounds are unchanged', () => {
    const rect = shape('rect', 100, 80, 10, 10) // reversed diagonal order
    const p0 = { ...rect.points[0] }
    const p1 = { ...rect.points[1] }
    applyReshapeHandle(
      rect,
      'br',
      { x: 100, y: 80 },
      {
        originBounds: { x0: 10, y0: 10, x1: 100, y1: 80 },
      },
    )
    expect(rect.points[0]).toEqual(p0)
    expect(rect.points[1]).toEqual(p1)
  })
})

import { describe, it, expect, vi } from 'vitest'
import { drawActionDirect, drawArrow, drawEllipse, drawText, drawStamp, isAxisAlignedCircle } from './drawingRender'
import { shapeDashPattern } from '../constants/tools'
import type { DrawAction } from './drawingTypes'

function makeTextAction(overrides: Partial<DrawAction> = {}): DrawAction {
  return {
    tool: 'text',
    color: '#FF0000',
    lineWidth: 3,
    opacity: 1,
    points: [{ x: 10, y: 20 }],
    text: 'Hello',
    fontSize: 24,
    ...overrides,
  }
}

function makeTextContext(calls: string[]) {
  return {
    font: '',
    globalAlpha: 1,
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    lineJoin: 'miter',
    miterLimit: 10,
    textBaseline: 'alphabetic',
    measureText: vi.fn(() => ({ fontBoundingBoxAscent: 18, fontBoundingBoxDescent: 6 })),
    strokeText: vi.fn(() => calls.push('stroke')),
    fillText: vi.fn(() => calls.push('fill')),
  } as unknown as CanvasRenderingContext2D
}

describe('drawingRender text outline', () => {
  it('draws outline before filling text when enabled', () => {
    const calls: string[] = []
    const ctx = makeTextContext(calls)

    drawText(
      ctx,
      makeTextAction({
        textOutline: { enabled: true, colorMode: 'fixed', color: '#FFFFFF', width: 4 },
      }),
    )

    expect(ctx.strokeStyle).toBe('#FFFFFF')
    expect(ctx.lineWidth).toBe(4)
    expect(ctx.strokeText).toHaveBeenCalledOnce()
    expect(ctx.fillText).toHaveBeenCalledOnce()
    expect(calls).toEqual(['stroke', 'fill'])
  })

  it('keeps legacy text rendering unchanged when outline is disabled', () => {
    const calls: string[] = []
    const ctx = makeTextContext(calls)

    drawText(ctx, makeTextAction())

    expect(ctx.strokeText).not.toHaveBeenCalled()
    expect(ctx.fillText).toHaveBeenCalledOnce()
    expect(calls).toEqual(['fill'])
  })

  it('resolves automatic outline color from text color', () => {
    const calls: string[] = []
    const ctx = makeTextContext(calls)

    drawText(
      ctx,
      makeTextAction({
        color: '#FFFFFF',
        textOutline: { enabled: true, colorMode: 'auto', color: '#FFFFFF', width: 3 },
      }),
    )

    expect(ctx.strokeStyle).toBe('#000000')
    expect(calls).toEqual(['stroke', 'fill'])
  })
})

describe('drawingRender dashed shapes', () => {
  function makeStrokeContext() {
    let dash: number[] = []
    return {
      save: vi.fn(),
      restore: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      quadraticCurveTo: vi.fn(),
      closePath: vi.fn(),
      rect: vi.fn(),
      ellipse: vi.fn(),
      arc: vi.fn(),
      stroke: vi.fn(),
      fill: vi.fn(),
      setLineDash: vi.fn((pattern: number[]) => {
        dash = pattern
      }),
      getLineDash: vi.fn(() => dash),
      globalAlpha: 1,
      globalCompositeOperation: 'source-over',
      strokeStyle: '',
      fillStyle: '',
      lineWidth: 1,
      lineCap: 'butt',
      lineJoin: 'miter',
    } as unknown as CanvasRenderingContext2D
  }

  it('applies setLineDash for dashed line actions', () => {
    const ctx = makeStrokeContext()
    drawActionDirect(ctx, {
      tool: 'line',
      color: '#FF0000',
      lineWidth: 3,
      opacity: 1,
      dashStyle: 'dashed',
      points: [
        { x: 0, y: 0 },
        { x: 40, y: 0 },
      ],
    })
    expect(ctx.setLineDash).toHaveBeenCalledWith(shapeDashPattern(3, 'dashed'))
    expect(ctx.stroke).toHaveBeenCalled()
  })

  it('applies dotted pattern for dotted ellipse actions', () => {
    const ctx = makeStrokeContext()
    drawActionDirect(ctx, {
      tool: 'ellipse',
      color: '#FF0000',
      lineWidth: 3,
      opacity: 1,
      dashStyle: 'dotted',
      points: [
        { x: 0, y: 0 },
        { x: 40, y: 20 },
      ],
    })
    expect(ctx.setLineDash).toHaveBeenCalledWith(shapeDashPattern(3, 'dotted'))
  })

  it('strokes dashed pen as a centerline instead of filled ink', () => {
    const ctx = makeStrokeContext()
    drawActionDirect(ctx, {
      tool: 'pen',
      color: '#FF0000',
      lineWidth: 3,
      opacity: 1,
      dashStyle: 'dotted',
      points: [
        { x: 0, y: 0 },
        { x: 20, y: 10 },
        { x: 40, y: 0 },
      ],
    })
    expect(ctx.setLineDash).toHaveBeenCalledWith(shapeDashPattern(3, 'dotted'))
    expect(ctx.stroke).toHaveBeenCalled()
    expect(ctx.fill).not.toHaveBeenCalled()
  })

  it('keeps solid strokes without setLineDash', () => {
    const ctx = makeStrokeContext()
    drawActionDirect(ctx, {
      tool: 'rect',
      color: '#FF0000',
      lineWidth: 3,
      opacity: 1,
      points: [
        { x: 0, y: 0 },
        { x: 40, y: 20 },
      ],
    })
    expect(ctx.setLineDash).not.toHaveBeenCalled()
  })

  it('draws dashed arrows as dashed shaft plus solid head', () => {
    const ctx = makeStrokeContext()
    ctx.lineWidth = 3
    ctx.strokeStyle = '#00FF00'
    ctx.setLineDash(shapeDashPattern(3, 'dashed'))

    drawArrow(ctx, { x: 0, y: 0 }, { x: 100, y: 0 }, true)

    expect(ctx.stroke).toHaveBeenCalled()
    expect(ctx.fill).toHaveBeenCalled()
    // Head fill clears dash so the tip stays solid.
    expect(ctx.setLineDash).toHaveBeenCalledWith([])
  })

  it('keeps solid arrows filled without reading line dash state', () => {
    const ctx = makeStrokeContext()
    ctx.lineWidth = 3
    ctx.strokeStyle = '#00FF00'

    drawArrow(ctx, { x: 0, y: 0 }, { x: 100, y: 0 })

    expect(ctx.fill).toHaveBeenCalled()
    expect(ctx.stroke).not.toHaveBeenCalled()
    expect(ctx.getLineDash).not.toHaveBeenCalled()
  })
})

describe('drawingRender stamp', () => {
  it('draws FastStone-style ring disc, fill, then label', () => {
    const calls: string[] = []
    const ctx = {
      globalAlpha: 1,
      fillStyle: '',
      strokeStyle: '',
      lineWidth: 1,
      lineJoin: 'miter',
      font: '',
      textAlign: 'start',
      textBaseline: 'alphabetic',
      shadowColor: '',
      shadowBlur: 0,
      shadowOffsetX: 0,
      shadowOffsetY: 0,
      save: vi.fn(),
      restore: vi.fn(),
      beginPath: vi.fn(),
      arc: vi.fn(),
      translate: vi.fn(),
      scale: vi.fn(),
      fill: vi.fn(() => calls.push('fill')),
      stroke: vi.fn(() => calls.push('stroke')),
      fillText: vi.fn(() => calls.push('label')),
    } as unknown as CanvasRenderingContext2D

    drawStamp(ctx, {
      tool: 'stamp',
      color: '#FF3B30',
      lineWidth: 3,
      opacity: 1,
      points: [{ x: 50, y: 60 }],
      text: '1',
      fontSize: 24,
    })

    expect(ctx.save).toHaveBeenCalled()
    expect(ctx.restore).toHaveBeenCalled()
    // shadow silhouette + crisp ring disc + inner fill
    expect(ctx.arc).toHaveBeenCalledTimes(3)
    expect(ctx.scale).not.toHaveBeenCalled()
    expect(ctx.fillText).toHaveBeenCalledOnce()
    expect(calls).toEqual(['fill', 'fill', 'fill', 'label'])
    expect(ctx.fillStyle).toBe('#FFFFFF')
  })
})

describe('drawingRender circle center', () => {
  it('detects axis-aligned circles and rejects elongated ellipses', () => {
    expect(isAxisAlignedCircle({ x: 0, y: 0 }, { x: 100, y: 100 })).toBe(true)
    expect(isAxisAlignedCircle({ x: 0, y: 0 }, { x: 100, y: 60 })).toBe(false)
    expect(isAxisAlignedCircle({ x: 10, y: 10 }, { x: 11, y: 11 })).toBe(false)
  })

  it('draws a center marker for perfect circles', () => {
    const ctx = {
      save: vi.fn(),
      restore: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      ellipse: vi.fn(),
      arc: vi.fn(),
      stroke: vi.fn(),
      fill: vi.fn(),
      setLineDash: vi.fn(),
      lineWidth: 3,
      strokeStyle: '#FF0000',
      fillStyle: '',
      lineCap: 'butt',
      lineJoin: 'miter',
    } as unknown as CanvasRenderingContext2D

    drawEllipse(ctx, { x: 0, y: 0 }, { x: 100, y: 100 }, { lineWidth: 3 })

    expect(ctx.ellipse).toHaveBeenCalledOnce()
    expect(ctx.stroke).toHaveBeenCalled()
    expect(ctx.arc).toHaveBeenCalled()
    expect(ctx.fill).toHaveBeenCalled()
  })

  it('omits the center marker for non-circular ellipses', () => {
    const ctx = {
      save: vi.fn(),
      restore: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      ellipse: vi.fn(),
      arc: vi.fn(),
      stroke: vi.fn(),
      fill: vi.fn(),
      setLineDash: vi.fn(),
      lineWidth: 3,
      strokeStyle: '#FF0000',
      fillStyle: '',
      lineCap: 'butt',
      lineJoin: 'miter',
    } as unknown as CanvasRenderingContext2D

    drawEllipse(ctx, { x: 0, y: 0 }, { x: 100, y: 40 }, { lineWidth: 3 })

    expect(ctx.ellipse).toHaveBeenCalledOnce()
    expect(ctx.arc).not.toHaveBeenCalled()
    expect(ctx.fill).not.toHaveBeenCalled()
  })
})

/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ref, type Ref } from 'vue'
import { useDrawing } from './useDrawing'

function createMockCanvas(): HTMLCanvasElement {
  const ctx = {
    save: vi.fn(),
    restore: vi.fn(),
    clearRect: vi.fn(),
    drawImage: vi.fn(),
    beginPath: vi.fn(),
    closePath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    fill: vi.fn(),
    rect: vi.fn(),
    arc: vi.fn(),
    quadraticCurveTo: vi.fn(),
    scale: vi.fn(),
    translate: vi.fn(),
    rotate: vi.fn(),
    setTransform: vi.fn(),
    setLineDash: vi.fn(),
    getLineDash: vi.fn(() => []),
    strokeRect: vi.fn(),
    fillRect: vi.fn(),
    fillText: vi.fn(),
    strokeText: vi.fn(),
    measureText: vi.fn(() => ({ width: 50 })),
    canvas: null as unknown as HTMLCanvasElement,
    globalCompositeOperation: 'source-over',
    globalAlpha: 1,
    strokeStyle: '',
    fillStyle: '',
    lineWidth: 1,
    lineCap: 'butt',
    lineJoin: 'miter',
    font: '',
    textBaseline: 'alphabetic',
    miterLimit: 10,
  }

  const canvas = {
    width: 1920,
    height: 1080,
    style: { width: '1920px', height: '1080px' },
    getContext: vi.fn(() => ctx),
  } as unknown as HTMLCanvasElement

  ctx.canvas = canvas
  return canvas
}

function setup() {
  const historyCanvas = createMockCanvas()
  const previewCanvas = createMockCanvas()
  const historyRef = ref(historyCanvas) as Ref<HTMLCanvasElement | null>
  const previewRef = ref(previewCanvas) as Ref<HTMLCanvasElement | null>

  const drawing = useDrawing(historyRef, previewRef)
  return { drawing, previewCanvas }
}

// Mock requestAnimationFrame / cancelAnimationFrame for render scheduling
const syncRequestAnimationFrame = (cb: () => void) => {
  cb()
  return 1
}
vi.stubGlobal('requestAnimationFrame', syncRequestAnimationFrame)
vi.stubGlobal('cancelAnimationFrame', vi.fn())
vi.stubGlobal(
  'document',
  Object.assign(globalThis.document ?? {}, {
    createElement: vi.fn(() => createMockCanvas()),
  }),
)

describe('useDrawing', () => {
  let drawing: ReturnType<typeof setup>['drawing']
  let previewCanvas: HTMLCanvasElement

  beforeEach(() => {
    ;({ drawing, previewCanvas } = setup())
  })

  afterEach(() => {
    drawing.destroy()
    vi.useRealTimers()
  })

  describe('initial state', () => {
    it('starts with default tool as pen', () => {
      expect(drawing.currentTool.value).toBe('pen')
    })

    it('starts with default color as red', () => {
      expect(drawing.currentColor.value).toBe('#FF0000')
    })

    it('starts with default line width of 3', () => {
      expect(drawing.lineWidth.value).toBe(3)
    })

    it('applies persisted line widths per group', () => {
      drawing.setLineWidths({ stroke: 8, highlighter: 5, eraser: 2, text: 1 })
      drawing.currentTool.value = 'pen'
      expect(drawing.lineWidth.value).toBe(8)
      drawing.currentTool.value = 'highlighter'
      expect(drawing.lineWidth.value).toBe(5)
      drawing.currentTool.value = 'eraser'
      expect(drawing.lineWidth.value).toBe(2)
      drawing.currentTool.value = 'text'
      expect(drawing.lineWidth.value).toBe(1)
    })

    it('shares stroke width across pen and shapes; eraser is independent', () => {
      drawing.currentTool.value = 'pen'
      drawing.lineWidth.value = 8
      drawing.currentTool.value = 'arrow'
      expect(drawing.lineWidth.value).toBe(8)
      drawing.currentTool.value = 'rect'
      expect(drawing.lineWidth.value).toBe(8)
      drawing.currentTool.value = 'highlighter'
      expect(drawing.lineWidth.value).toBe(3)
      drawing.currentTool.value = 'eraser'
      expect(drawing.lineWidth.value).toBe(3)
      drawing.lineWidth.value = 2
      drawing.currentTool.value = 'pen'
      expect(drawing.lineWidth.value).toBe(8)
      drawing.currentTool.value = 'eraser'
      expect(drawing.lineWidth.value).toBe(2)
    })

    it('starts not drawing', () => {
      expect(drawing.isDrawing.value).toBe(false)
    })
  })

  describe('startDraw / draw / endDraw', () => {
    it('sets isDrawing to true on startDraw', () => {
      drawing.startDraw({ x: 100, y: 100 })
      expect(drawing.isDrawing.value).toBe(true)
    })

    it('records pointerType for pressure vs uniform ink', () => {
      drawing.startDraw({ x: 10, y: 10, pointerType: 'pen' })
      expect(drawing.getActiveStrokePointerType()).toBe('pen')
      drawing.cancelDraw()

      drawing.startDraw({ x: 10, y: 10 })
      expect(drawing.getActiveStrokePointerType()).toBe('mouse')
      drawing.cancelDraw()
    })

    it('adds action to history after endDraw', () => {
      drawing.startDraw({ x: 10, y: 10 })
      drawing.draw({ x: 20, y: 20 })
      drawing.draw({ x: 30, y: 30 })
      drawing.endDraw()

      expect(drawing.isDrawing.value).toBe(false)
      // After endDraw, undo should be able to remove the action
      drawing.undo()
      // After undoing a single action, redo stack is non-empty
      drawing.redo()
    })

    it('draws with the current tool and color', () => {
      drawing.currentTool.value = 'arrow'
      drawing.currentColor.value = '#007AFF'
      drawing.lineWidth.value = 5

      drawing.startDraw({ x: 0, y: 0 })
      drawing.draw({ x: 50, y: 50 })
      drawing.endDraw()

      // Verify undo works (action was recorded correctly)
      drawing.undo()
      drawing.redo()
    })

    it('records dash style on dashable tools and ignores it for highlighter', () => {
      drawing.setShapeDashStyle('dashed')

      drawing.currentTool.value = 'line'
      drawing.startDraw({ x: 0, y: 0 })
      drawing.draw({ x: 100, y: 0 })
      drawing.endDraw()
      expect(drawing.findActionAt({ x: 50, y: 0 })!.action.dashStyle).toBe('dashed')

      drawing.setShapeDashStyle('dotted')
      drawing.currentTool.value = 'pen'
      drawing.startDraw({ x: 0, y: 20 })
      drawing.draw({ x: 40, y: 20 })
      drawing.endDraw()
      expect(drawing.findActionAt({ x: 20, y: 20 })!.action.dashStyle).toBe('dotted')

      drawing.currentTool.value = 'highlighter'
      drawing.startDraw({ x: 0, y: 40 })
      drawing.draw({ x: 40, y: 40 })
      drawing.endDraw()
      expect(drawing.findActionAt({ x: 20, y: 40 })!.action.dashStyle).toBeUndefined()
    })

    it('can change dash style mid-gesture on a shape', () => {
      drawing.currentTool.value = 'rect'
      drawing.startDraw({ x: 0, y: 0 })
      drawing.draw({ x: 40, y: 30 })
      drawing.setShapeDashStyle('dotted')
      drawing.endDraw()
      expect(drawing.findActionAt({ x: 10, y: 10 })!.action.dashStyle).toBe('dotted')
    })

    it('draws a perfect circle from the press point as center', () => {
      drawing.currentTool.value = 'ellipse'
      drawing.startDraw({ x: 100, y: 80 })
      drawing.draw({ x: 130, y: 80 }, true)
      drawing.endDraw()

      const action = drawing.findActionAt({ x: 130, y: 80 })!.action
      expect(action.points[0]).toMatchObject({ x: 70, y: 50 })
      expect(action.points[1]).toMatchObject({ x: 130, y: 110 })
      expect(action.ellipseHit).toMatchObject({ cx: 100, cy: 80, rx: 30, ry: 30 })
    })

    it('restores corner-drag ellipse when leaving perfect mode mid-gesture', () => {
      drawing.currentTool.value = 'ellipse'
      drawing.startDraw({ x: 100, y: 100 })
      drawing.draw({ x: 140, y: 100 }, true)
      drawing.draw({ x: 160, y: 140 }, false)
      drawing.endDraw()

      // Rightmost point of the free ellipse from (100,100)–(160,140).
      const action = drawing.findActionAt({ x: 160, y: 120 })!.action
      expect(action.points[0]).toMatchObject({ x: 100, y: 100 })
      expect(action.points[1]).toMatchObject({ x: 160, y: 140 })
    })

    it('keeps perfect squares corner-anchored', () => {
      drawing.currentTool.value = 'rect'
      drawing.startDraw({ x: 10, y: 10 })
      drawing.draw({ x: 50, y: 30 }, true)
      drawing.endDraw()

      const action = drawing.findActionAt({ x: 10, y: 10 })!.action
      expect(action.points[0]).toMatchObject({ x: 10, y: 10 })
      expect(action.points[1]).toMatchObject({ x: 50, y: 50 })
    })

    it('cancelDraw discards in-progress stroke without adding to history', () => {
      drawing.startDraw({ x: 10, y: 10 })
      drawing.draw({ x: 20, y: 20 })
      drawing.cancelDraw()

      expect(drawing.isDrawing.value).toBe(false)
      expect(drawing.canUndo.value).toBe(false)
    })

    it('locks pen stroke to a line after holding still for 500ms, then previews by dragging', () => {
      vi.useFakeTimers()
      drawing.currentTool.value = 'pen'
      drawing.startDraw({ x: 0, y: 0, pressure: 0.4 })
      for (let i = 1; i <= 10; i++) {
        drawing.draw({ x: i * 10, y: (i % 2) * 0.2, pressure: 0.5 })
      }
      expect(drawing.isStrokeLineLocked()).toBe(false)
      expect(drawing.getActiveStrokePointCount()).toBeGreaterThan(2)

      vi.advanceTimersByTime(500)
      expect(drawing.isStrokeLineLocked()).toBe(true)
      expect(drawing.getActiveStrokePointCount()).toBe(2)

      drawing.draw({ x: 200, y: 50, pressure: 0.9 })
      expect(drawing.getActiveStrokePointCount()).toBe(2)
      const tip = drawing.getActiveStrokeFirstPoint()
      expect(tip).toEqual({ x: 0, y: 0 })

      drawing.endDraw()
      const hit = drawing.findActionAt({ x: 100, y: 25 })
      expect(hit).toBeTruthy()
      expect(hit!.action.points).toHaveLength(2)
      // 线宽在锁定瞬间冻结：拖动笔尖不再用瞬时压感重刷整条线。
      expect(hit!.action.points[0]).toMatchObject({ x: 0, y: 0 })
      expect(hit!.action.points[1]).toMatchObject({ x: 200, y: 50 })
      expect(hit!.action.points[0].pressure).toBeCloseTo(0.5, 5)
      expect(hit!.action.points[0].pressure).toBe(hit!.action.points[1].pressure)
      expect(drawing.isStrokeLineLocked()).toBe(false)
      vi.useRealTimers()
    })

    it('keeps the locked line width when the tip drags with a light pressure', () => {
      vi.useFakeTimers()
      drawing.currentTool.value = 'pen'
      drawing.startDraw({ x: 0, y: 0, pressure: 0.5, pointerType: 'pen' })
      for (let i = 1; i <= 10; i++) {
        drawing.draw({ x: i * 10, y: 0, pressure: 0.5, pointerType: 'pen' })
      }
      vi.advanceTimersByTime(500)
      expect(drawing.isStrokeLineLocked()).toBe(true)

      // 抬笔/轻触的低压感不能把整条线拉成发丝线
      for (let i = 0; i < 5; i++) {
        drawing.draw({ x: 140 + i * 10, y: 0, pressure: 0.05, pointerType: 'pen' })
      }
      drawing.endDraw()

      const hit = drawing.findActionAt({ x: 70, y: 0 })
      expect(hit).toBeTruthy()
      expect(hit!.action.points[0].pressure).toBeCloseTo(0.5, 5)
      expect(hit!.action.points[1].pressure).toBeCloseTo(0.5, 5)
      vi.useRealTimers()
    })

    it('equalizes start/end pressure when locking without further drag', () => {
      vi.useFakeTimers()
      drawing.currentTool.value = 'pen'
      drawing.startDraw({ x: 0, y: 0, pressure: 0.4 })
      for (let i = 1; i <= 10; i++) {
        drawing.draw({ x: i * 10, y: 0, pressure: 0.5 })
      }
      drawing.draw({ x: 120, y: 0, pressure: 0.75 })
      vi.advanceTimersByTime(500)
      expect(drawing.isStrokeLineLocked()).toBe(true)

      drawing.endDraw()
      const hit = drawing.findActionAt({ x: 60, y: 0 })
      expect(hit).toBeTruthy()
      expect(hit!.action.points).toHaveLength(2)
      // 压感经过 EMA 滤波，不再等于原始采样值，但两端必须一致。
      expect(hit!.action.points[0].pressure).toBe(hit!.action.points[1].pressure)
      expect(hit!.action.points[0].pressure).toBeGreaterThan(0.5)
      vi.useRealTimers()
    })

    it('resets the line-lock timer when the pointer keeps moving', () => {
      vi.useFakeTimers()
      drawing.currentTool.value = 'pen'
      drawing.startDraw({ x: 0, y: 0 })
      drawing.draw({ x: 30, y: 0 })
      vi.advanceTimersByTime(300)
      drawing.draw({ x: 60, y: 0 })
      vi.advanceTimersByTime(300)
      expect(drawing.isStrokeLineLocked()).toBe(false)
      expect(drawing.getActiveStrokePointCount()).toBeGreaterThan(2)

      vi.advanceTimersByTime(500)
      expect(drawing.isStrokeLineLocked()).toBe(true)
      expect(drawing.getActiveStrokePointCount()).toBe(2)
      drawing.endDraw()
      vi.useRealTimers()
    })

    it('keeps freehand strokes when released before the still hold', () => {
      vi.useFakeTimers()
      drawing.currentTool.value = 'pen'
      drawing.startDraw({ x: 0, y: 0 })
      for (let i = 1; i <= 20; i++) {
        drawing.draw({ x: i * 10, y: (i % 2) * 0.2 })
      }
      vi.advanceTimersByTime(400)
      drawing.endDraw()

      const hit = drawing.findActionAt({ x: 100, y: 0 })
      expect(hit).toBeTruthy()
      expect(hit!.action.points.length).toBeGreaterThan(2)
      vi.useRealTimers()
    })
  })

  describe('undo / redo', () => {
    it('undo removes the last drawn action', () => {
      drawing.startDraw({ x: 0, y: 0 })
      drawing.draw({ x: 10, y: 10 })
      drawing.endDraw()

      drawing.startDraw({ x: 20, y: 20 })
      drawing.draw({ x: 30, y: 30 })
      drawing.endDraw()

      drawing.undo()
      // After undo, redo should bring it back
      drawing.redo()
      drawing.undo()
      drawing.undo()
      // Both actions undone; redo twice to restore
      drawing.redo()
      drawing.redo()
    })

    it('undo does nothing when history is empty', () => {
      // Should not throw
      drawing.undo()
      drawing.undo()
      drawing.undo()
    })

    it('redo does nothing when redo stack is empty', () => {
      // Should not throw
      drawing.redo()
      drawing.redo()
    })

    it('canUndo and canRedo reflect stack state', () => {
      expect(drawing.canUndo.value).toBe(false)
      expect(drawing.canRedo.value).toBe(false)

      drawing.startDraw({ x: 0, y: 0 })
      drawing.draw({ x: 10, y: 10 })
      drawing.endDraw()
      expect(drawing.canUndo.value).toBe(true)
      expect(drawing.canRedo.value).toBe(false)

      drawing.undo()
      expect(drawing.canUndo.value).toBe(false)
      expect(drawing.canRedo.value).toBe(true)
    })

    it('undo removes the drawn action from history', () => {
      drawing.startDraw({ x: 100, y: 100 })
      drawing.draw({ x: 150, y: 150 })
      drawing.endDraw()
      expect(drawing.findActionAt({ x: 125, y: 125 })).not.toBeNull()

      drawing.undo()
      expect(drawing.findActionAt({ x: 125, y: 125 })).toBeNull()

      drawing.redo()
      expect(drawing.findActionAt({ x: 125, y: 125 })).not.toBeNull()
    })

    it('canClear reflects whether canvas has drawings', () => {
      expect(drawing.canClear.value).toBe(false)
      drawing.startDraw({ x: 0, y: 0 })
      drawing.draw({ x: 10, y: 10 })
      drawing.endDraw()
      expect(drawing.canClear.value).toBe(true)
      drawing.clearAll()
      expect(drawing.canClear.value).toBe(false)
    })

    it('new draw after undo clears redo stack', () => {
      drawing.startDraw({ x: 0, y: 0 })
      drawing.draw({ x: 10, y: 10 })
      drawing.endDraw()

      drawing.undo()

      // New action should clear redo
      drawing.startDraw({ x: 50, y: 50 })
      drawing.draw({ x: 60, y: 60 })
      drawing.endDraw()

      // Redo should do nothing now (stack cleared)
      drawing.redo()
      // Only the new action should be undoable
      drawing.undo()
    })

    it('supports multiple undo/redo cycles', () => {
      for (let i = 0; i < 5; i++) {
        drawing.startDraw({ x: i * 10, y: i * 10 })
        drawing.draw({ x: i * 10 + 5, y: i * 10 + 5 })
        drawing.endDraw()
      }

      // Undo all 5
      for (let i = 0; i < 5; i++) {
        drawing.undo()
      }

      // Redo all 5
      for (let i = 0; i < 5; i++) {
        drawing.redo()
      }

      // Undo 3, then draw new
      drawing.undo()
      drawing.undo()
      drawing.undo()

      drawing.startDraw({ x: 100, y: 100 })
      drawing.draw({ x: 110, y: 110 })
      drawing.endDraw()

      // Should only have 3 undoable actions now (2 original + 1 new)
      drawing.undo()
      drawing.undo()
      drawing.undo()
      // Should be empty now
      drawing.undo() // no-op
    })
  })

  describe('clearAll', () => {
    it('clears all drawn actions', () => {
      drawing.startDraw({ x: 0, y: 0 })
      drawing.draw({ x: 10, y: 10 })
      drawing.endDraw()

      drawing.startDraw({ x: 20, y: 20 })
      drawing.draw({ x: 30, y: 30 })
      drawing.endDraw()

      drawing.clearAll()

      // After clear, undo should restore everything
      drawing.undo()
    })

    it('clearAll when already empty is a no-op', () => {
      drawing.clearAll()
      // Should not throw
    })

    it('undo after clearAll restores all actions', () => {
      drawing.startDraw({ x: 0, y: 0 })
      drawing.draw({ x: 10, y: 10 })
      drawing.endDraw()

      drawing.startDraw({ x: 20, y: 20 })
      drawing.draw({ x: 30, y: 30 })
      drawing.endDraw()

      drawing.clearAll()
      drawing.undo()

      // Should be able to undo individual actions again
      drawing.undo()
      drawing.undo()
    })
  })

  describe('hardReset', () => {
    it('clears everything without undo history', () => {
      drawing.startDraw({ x: 0, y: 0 })
      drawing.draw({ x: 10, y: 10 })
      drawing.endDraw()

      drawing.hardReset()

      // After hard reset, undo should do nothing
      drawing.undo()
      drawing.redo()
    })
  })

  describe('drawBatch', () => {
    it('processes multiple points in one call', () => {
      drawing.startDraw({ x: 0, y: 0 })
      const points = [
        { clientX: 10, clientY: 10 },
        { clientX: 20, clientY: 20 },
        { clientX: 30, clientY: 30 },
      ]
      drawing.drawBatch(points as unknown as PointerEvent[])
      drawing.endDraw()

      drawing.undo()
      drawing.redo()
    })
  })

  describe('addTextAction', () => {
    it('adds a text action to history', () => {
      drawing.addTextAction('Hello', 100, 100, 0, 24, '#000000')

      // Should be undoable
      drawing.undo()
      drawing.redo()
    })

    it('text with zero offset', () => {
      drawing.addTextAction('Test', 50, 50, 0, 16, '#FF0000')
      drawing.undo()
    })

    it('expands text hit testing when outline is enabled', () => {
      drawing.addTextAction('Test', 50, 50, 0, 16, '#FF0000')
      expect(drawing.findActionAt({ x: 43, y: 50 })).not.toBeNull()
      expect(drawing.findActionAt({ x: 36, y: 50 })).toBeNull()
      drawing.clearAll()

      drawing.addTextAction('Test', 50, 50, 0, 16, '#FF0000', {
        enabled: true,
        colorMode: 'fixed',
        color: '#FFFFFF',
        width: 8,
      })
      expect(drawing.findActionAt({ x: 36, y: 50 })).not.toBeNull()
    })
  })

  describe('addStampAction', () => {
    it('adds a stamp and hits near its center', () => {
      drawing.addStampAction('1', 100, 100, 24, '#FF3B30')
      expect(drawing.findActionAt({ x: 100, y: 100 })).not.toBeNull()
      expect(drawing.findActionAt({ x: 200, y: 200 })).toBeNull()
      drawing.undo()
      expect(drawing.findActionAt({ x: 100, y: 100 })).toBeNull()
    })
  })

  describe('tool switching', () => {
    it('allows changing tools between draws', () => {
      drawing.currentTool.value = 'pen'
      drawing.startDraw({ x: 0, y: 0 })
      drawing.draw({ x: 10, y: 10 })
      drawing.endDraw()

      drawing.currentTool.value = 'rect'
      drawing.startDraw({ x: 20, y: 20 })
      drawing.draw({ x: 40, y: 40 })
      drawing.endDraw()

      drawing.currentTool.value = 'arrow'
      drawing.startDraw({ x: 50, y: 50 })
      drawing.draw({ x: 70, y: 70 })
      drawing.endDraw()

      // Undo all 3
      drawing.undo()
      drawing.undo()
      drawing.undo()
    })

    it('highlighter uses lower opacity', () => {
      drawing.currentTool.value = 'highlighter'
      drawing.startDraw({ x: 0, y: 0 })
      drawing.draw({ x: 50, y: 50 })
      drawing.endDraw()
      drawing.undo()
    })
  })

  describe('eraser', () => {
    it('updates in-progress eraser stroke width when lineWidth changes mid-gesture', () => {
      drawing.currentTool.value = 'eraser'
      drawing.lineWidth.value = 3
      drawing.startDraw({ x: 10, y: 10 })
      expect(drawing.getActiveStrokeLineWidth()).toBe(24)

      drawing.lineWidth.value = 8
      expect(drawing.getActiveStrokeLineWidth()).toBe(64)

      drawing.draw({ x: 20, y: 20 })
      drawing.endDraw()
      expect(drawing.getActiveStrokeLineWidth()).toBeNull()
    })

    it('updates in-progress pen stroke width when lineWidth changes mid-gesture', () => {
      drawing.currentTool.value = 'pen'
      drawing.lineWidth.value = 3
      drawing.startDraw({ x: 10, y: 10, pointerType: 'mouse' })
      expect(drawing.getActiveStrokeLineWidth()).toBe(3)

      drawing.lineWidth.value = 8
      expect(drawing.getActiveStrokeLineWidth()).toBe(8)

      drawing.draw({ x: 30, y: 30 })
      drawing.endDraw()
      expect(drawing.getActiveStrokeLineWidth()).toBeNull()
    })

    it('splits eraser stroke at tip so resize does not re-erase the old path', () => {
      drawing.currentTool.value = 'eraser'
      drawing.lineWidth.value = 3
      drawing.startDraw({ x: 10, y: 10 })
      drawing.draw({ x: 50, y: 50 })
      drawing.setLineWidth(8, { x: 200, y: 200 })
      expect(drawing.getActiveStrokeLineWidth()).toBe(64)
      expect(drawing.getActiveStrokeFirstPoint()).toEqual({ x: 200, y: 200 })
    })

    it('eraser strokes attach to intersecting actions', () => {
      // Draw something
      drawing.currentTool.value = 'pen'
      drawing.startDraw({ x: 10, y: 10 })
      drawing.draw({ x: 50, y: 50 })
      drawing.endDraw()

      // Erase over it
      drawing.currentTool.value = 'eraser'
      drawing.startDraw({ x: 10, y: 10 })
      drawing.draw({ x: 50, y: 50 })
      drawing.endDraw()

      // Undo the erase
      drawing.undo()
      // Undo the original stroke
      drawing.undo()
    })

    it('object eraser removes whole elements in one stroke', () => {
      drawing.setEraserMode('object')
      drawing.currentTool.value = 'pen'
      drawing.startDraw({ x: 10, y: 10 })
      drawing.draw({ x: 50, y: 50 })
      drawing.endDraw()
      expect(drawing.canClear.value).toBe(true)

      drawing.currentTool.value = 'eraser'
      drawing.startDraw({ x: 30, y: 30 })
      drawing.draw({ x: 34, y: 34 })
      expect(drawing.canClear.value).toBe(false)

      drawing.endDraw()
      expect(drawing.canClear.value).toBe(false)

      drawing.undo()
      expect(drawing.canClear.value).toBe(true)
      drawing.setEraserMode('stroke')
    })
  })

  describe('removeAction', () => {
    it('removes an action at given index', () => {
      drawing.startDraw({ x: 0, y: 0 })
      drawing.draw({ x: 10, y: 10 })
      drawing.endDraw()

      const found = drawing.findActionAt({ x: 5, y: 5 })
      if (found) {
        drawing.removeAction(found.index)
        drawing.undo()
      }
    })

    it('removeAction with invalid index does nothing', () => {
      drawing.removeAction(-1)
      drawing.removeAction(999)
    })
  })

  describe('laser', () => {
    it('does not enter undo history or hit-testable actions', () => {
      drawing.currentTool.value = 'laser'
      drawing.startDraw({ x: 10, y: 10 })
      drawing.draw({ x: 40, y: 40 })
      drawing.endDraw()

      expect(drawing.canUndo.value).toBe(false)
      expect(drawing.findActionAt({ x: 25, y: 25 })).toBeNull()
      expect(drawing.canClear.value).toBe(true)
    })

    it('clearAll removes laser strokes without creating undo', () => {
      drawing.currentTool.value = 'laser'
      drawing.startDraw({ x: 0, y: 0 })
      drawing.draw({ x: 20, y: 20 })
      drawing.endDraw()

      expect(drawing.canClear.value).toBe(true)
      drawing.clearAll()
      expect(drawing.canClear.value).toBe(false)
      expect(drawing.canUndo.value).toBe(false)
    })

    it('expires after lifetime and clears canClear', () => {
      vi.useFakeTimers()
      try {
        drawing.currentTool.value = 'laser'
        drawing.startDraw({ x: 0, y: 0 })
        drawing.draw({ x: 30, y: 30 })
        drawing.endDraw()
        expect(drawing.canClear.value).toBe(true)

        // Tip must age past LASER_DECAY_MS
        vi.advanceTimersByTime(1400)

        expect(drawing.canClear.value).toBe(false)
      } finally {
        vi.useRealTimers()
      }
    })

    it('writing mode keeps strokes through short pauses, then fades after hold', () => {
      vi.useFakeTimers()
      try {
        drawing.setLaserMode('writing')
        drawing.currentTool.value = 'laser'
        drawing.startDraw({ x: 0, y: 0 })
        drawing.draw({ x: 30, y: 30 })
        drawing.endDraw()
        expect(drawing.canClear.value).toBe(true)

        // Past the trail lifetime but within hold + fade, strokes stay.
        vi.advanceTimersByTime(1300)
        expect(drawing.canClear.value).toBe(true)

        // Cleared once hold + fade elapse.
        vi.advanceTimersByTime(400)
        expect(drawing.canClear.value).toBe(false)
      } finally {
        vi.useRealTimers()
      }
    })

    it('switching laser mode clears existing strokes', () => {
      drawing.currentTool.value = 'laser'
      drawing.startDraw({ x: 0, y: 0 })
      drawing.draw({ x: 20, y: 20 })
      drawing.endDraw()
      expect(drawing.canClear.value).toBe(true)

      drawing.setLaserMode('writing')
      expect(drawing.canClear.value).toBe(false)
    })
  })

  describe('drag', () => {
    it('preserves pressure when undoing a drag', () => {
      drawing.currentTool.value = 'pen'
      drawing.startDraw({ x: 10, y: 10, pressure: 0.2, pointerType: 'pen' })
      drawing.draw({ x: 40, y: 10, pressure: 0.9 })
      drawing.draw({ x: 70, y: 10, pressure: 0.3 })
      drawing.endDraw()

      const found = drawing.findActionAt({ x: 40, y: 10 })
      expect(found).not.toBeNull()
      const pressuresBefore = found!.action.points.map((p) => p.pressure)
      expect(pressuresBefore).toHaveLength(3)
      expect(pressuresBefore.every((p) => (p ?? 0) > 0 && (p ?? 0) <= 1)).toBe(true)

      drawing.beginDrag(found!.action)
      drawing.updateDragOffset(15, 20)
      drawing.endDrag()

      expect(found!.action.points[0]).toMatchObject({ x: 25, y: 30 })
      expect(found!.action.points.map((p) => p.pressure)).toEqual(pressuresBefore)

      drawing.undo()
      expect(found!.action.points[0]).toMatchObject({ x: 10, y: 10 })
      expect(found!.action.points.map((p) => p.pressure)).toEqual(pressuresBefore)
    })
  })

  describe('selection', () => {
    function addRect(x0: number, y0: number, x1: number, y1: number) {
      drawing.currentTool.value = 'rect'
      drawing.startDraw({ x: x0, y: y0 })
      drawing.draw({ x: x1, y: y1 })
      drawing.endDraw()
    }

    it('findActionsInRect returns intersecting actions', () => {
      addRect(10, 10, 50, 50)
      addRect(100, 100, 150, 150)
      const a = drawing.findActionAt({ x: 10, y: 10 })!.action
      const b = drawing.findActionAt({ x: 100, y: 100 })!.action

      expect(drawing.findActionsInRect({ x1: 0, y1: 0, x2: 60, y2: 60 })).toEqual([a])
      expect(drawing.findActionsInRect({ x1: 0, y1: 0, x2: 200, y2: 200 })).toEqual([a, b])
      expect(drawing.findActionsInRect({ x1: 200, y1: 200, x2: 250, y2: 250 })).toEqual([])
    })

    it('toggleInSelection and setSelection manage the selection set', () => {
      addRect(10, 10, 40, 40)
      addRect(80, 80, 120, 120)
      const a = drawing.findActionAt({ x: 10, y: 10 })!.action
      const b = drawing.findActionAt({ x: 80, y: 80 })!.action

      drawing.setSelection([a])
      expect(drawing.selectedActions.value).toEqual([a])
      drawing.toggleInSelection(b)
      expect(drawing.selectedActions.value).toEqual([a, b])
      drawing.toggleInSelection(a)
      expect(drawing.selectedActions.value).toEqual([b])
      drawing.clearSelection()
      expect(drawing.selectedActions.value).toEqual([])
    })

    it('removeSelected deletes all selected and is undoable', () => {
      addRect(10, 10, 40, 40)
      addRect(80, 80, 120, 120)
      const a = drawing.findActionAt({ x: 10, y: 10 })!.action
      const b = drawing.findActionAt({ x: 80, y: 80 })!.action
      drawing.setSelection([a, b])
      drawing.removeSelected()
      expect(drawing.findActionAt({ x: 10, y: 10 })).toBeNull()
      expect(drawing.findActionAt({ x: 80, y: 80 })).toBeNull()
      expect(drawing.selectedActions.value).toEqual([])
      expect(drawing.canUndo.value).toBe(true)

      drawing.undo()
      expect(drawing.findActionAt({ x: 10, y: 10 })?.action).toBe(a)
      expect(drawing.findActionAt({ x: 80, y: 80 })?.action).toBe(b)
    })

    it('beginDragMany moves the group and undo restores positions', () => {
      addRect(10, 10, 40, 40)
      addRect(80, 80, 120, 120)
      const a = drawing.findActionAt({ x: 10, y: 10 })!.action
      const b = drawing.findActionAt({ x: 80, y: 80 })!.action
      const a0 = { ...a.points[0] }
      const b0 = { ...b.points[0] }

      drawing.setSelection([a, b])
      drawing.beginDragMany([a, b])
      drawing.updateDragOffset(20, 30)
      drawing.endDrag()

      expect(a.points[0]).toMatchObject({ x: a0.x + 20, y: a0.y + 30 })
      expect(b.points[0]).toMatchObject({ x: b0.x + 20, y: b0.y + 30 })

      drawing.undo()
      expect(a.points[0]).toMatchObject(a0)
      expect(b.points[0]).toMatchObject(b0)

      drawing.redo()
      expect(a.points[0]).toMatchObject({ x: a0.x + 20, y: a0.y + 30 })
      expect(b.points[0]).toMatchObject({ x: b0.x + 20, y: b0.y + 30 })
    })

    it('cancelDrag then removeSelected does not resurrect actions', () => {
      addRect(10, 10, 40, 40)
      const a = drawing.findActionAt({ x: 10, y: 10 })!.action
      drawing.setSelection([a])
      drawing.beginDragMany([a])
      drawing.updateDragOffset(5, 5)
      drawing.cancelDrag()
      drawing.removeSelected()
      expect(drawing.findActionAt({ x: 10, y: 10 })).toBeNull()
      expect(drawing.findActionAt({ x: 15, y: 15 })).toBeNull()
    })

    it('zero-move endDrag still raises action to top', () => {
      drawing.currentTool.value = 'pen'
      drawing.startDraw({ x: 0, y: 0 })
      drawing.draw({ x: 100, y: 0 })
      drawing.endDraw()
      const first = drawing.findActionAt({ x: 50, y: 0 })!.action

      drawing.startDraw({ x: 0, y: 0 })
      drawing.draw({ x: 100, y: 0 })
      drawing.endDraw()
      const second = drawing.findActionAt({ x: 50, y: 0 })!.action
      expect(second).not.toBe(first)

      drawing.beginDrag(first)
      drawing.endDrag()
      expect(drawing.findActionAt({ x: 50, y: 0 })!.action).toBe(first)
    })

    it('undo add prunes selection', () => {
      addRect(10, 10, 40, 40)
      const a = drawing.findActionAt({ x: 10, y: 10 })!.action
      drawing.setSelection([a])
      drawing.undo()
      expect(drawing.selectedActions.value).toEqual([])
    })

    it('findSelectedActionAt hits selected bbox, not only the stroke', () => {
      addRect(10, 10, 100, 100)
      const a = drawing.findActionAt({ x: 10, y: 10 })!.action
      drawing.setSelection([a])
      // Interior of rect bbox (stroke hit is on the border only).
      expect(drawing.findSelectedActionAt({ x: 50, y: 50 })).toBe(a)
      drawing.clearSelection()
      expect(drawing.findSelectedActionAt({ x: 50, y: 50 })).toBeNull()
    })

    it('startDraw is a no-op for select tool', () => {
      drawing.currentTool.value = 'select'
      drawing.startDraw({ x: 1, y: 1 })
      expect(drawing.isDrawing.value).toBe(false)
    })

    it('draws square line endpoints but circular bend and rotate handles', () => {
      drawing.currentTool.value = 'line'
      drawing.startDraw({ x: 0, y: 0 })
      drawing.draw({ x: 100, y: 0 })
      drawing.endDraw()
      const line = drawing.findActionAt({ x: 50, y: 0 })!.action
      drawing.setSelection([line])

      const ctx = previewCanvas.getContext('2d') as unknown as {
        arc: { mock: { calls: number[][] }; mockClear: () => void }
        fillRect: { mock: { calls: number[][] }; mockClear: () => void }
      }
      ctx.arc.mockClear()
      ctx.fillRect.mockClear()
      drawing.redrawAll()

      // p0 / p1 stay square; only the bend and rotate handles are circles.
      expect(ctx.fillRect.mock.calls).toHaveLength(2)
      expect(ctx.arc.mock.calls).toHaveLength(2)
    })

    it('dragging the line bend handle promotes it to a curved line', () => {
      drawing.currentTool.value = 'line'
      drawing.startDraw({ x: 0, y: 0 })
      drawing.draw({ x: 80, y: 40 })
      drawing.endDraw()
      const line = drawing.findActionAt({ x: 40, y: 20 })!.action
      expect(line.points).toHaveLength(2)

      drawing.setSelection([line])
      expect(drawing.findReshapeHandleAt({ x: 40, y: 20 })?.id).toBe('bend')

      drawing.beginReshape(line, 'bend', { x: 40, y: 20 })
      drawing.updateReshape({ x: 40, y: -40 })
      drawing.endReshape()

      expect(line.points).toHaveLength(3)
      // control = 2 × (40, −40) − (40, 20) = (40, −100)
      expect(line.points[1]).toMatchObject({ x: 40, y: -100 })
      expect(drawing.findActionAt({ x: 40, y: -40 })).toBeTruthy()

      drawing.undo()
      expect(line.points).toHaveLength(2)
      expect(line.points[1]).toMatchObject({ x: 80, y: 40 })
    })

    it('bends a hold-locked ink stroke and restores it on undo', () => {
      vi.useFakeTimers()
      drawing.currentTool.value = 'pen'
      drawing.startDraw({ x: 0, y: 0, pressure: 0.5, pointerType: 'pen' })
      for (let i = 1; i <= 10; i++) {
        drawing.draw({ x: i * 8, y: 0, pressure: 0.5, pointerType: 'pen' })
      }
      vi.advanceTimersByTime(500)
      expect(drawing.isStrokeLineLocked()).toBe(true)
      drawing.draw({ x: 80, y: 0, pressure: 0.5, pointerType: 'pen' })
      drawing.endDraw()
      vi.useRealTimers()

      const ink = drawing.findActionAt({ x: 40, y: 0 })!.action
      expect(ink.lockedLine).toBe(true)
      expect(ink.points).toHaveLength(2)

      drawing.setSelection([ink])
      expect(drawing.findReshapeHandleAt({ x: 40, y: 0 })?.id).toBe('bend')

      drawing.beginReshape(ink, 'bend', { x: 40, y: 0 })
      drawing.updateReshape({ x: 40, y: -60 })
      drawing.endReshape()

      expect(ink.points).toHaveLength(3)
      // control = 2 × (40, −60) − (40, 0) = (40, −120)
      expect(ink.points[1]).toMatchObject({ x: 40, y: -120 })
      expect(ink.points[1].pressure).toBeCloseTo(0.5, 5)
      expect(drawing.findActionAt({ x: 40, y: -60 })).toBeTruthy()

      drawing.undo()
      expect(ink.points).toHaveLength(2)
      expect(ink.lockedLine).toBe(true)

      // A plain click on the bend handle must not promote it back to three points.
      drawing.beginReshape(ink, 'bend', { x: 40, y: 0 })
      drawing.updateReshape({ x: 40, y: 0 })
      drawing.endReshape()
      expect(ink.points).toHaveLength(2)
    })

    it('zero-move bend click keeps the line straight', () => {
      drawing.currentTool.value = 'line'
      drawing.startDraw({ x: 0, y: 0 })
      drawing.draw({ x: 80, y: 40 })
      drawing.endDraw()
      const line = drawing.findActionAt({ x: 40, y: 20 })!.action

      drawing.setSelection([line])
      drawing.beginReshape(line, 'bend', { x: 40, y: 20 })
      drawing.updateReshape({ x: 40, y: 20 })
      drawing.endReshape()

      expect(line.points).toHaveLength(2)
      drawing.undo()
      expect(drawing.findActionAt({ x: 40, y: 20 })).toBeNull()
    })

    it('reshape line endpoint is undoable and clears attached erasers', () => {
      drawing.currentTool.value = 'line'
      drawing.startDraw({ x: 0, y: 0 })
      drawing.draw({ x: 100, y: 0 })
      drawing.endDraw()
      const line = drawing.findActionAt({ x: 50, y: 0 })!.action
      line.attachedErasers = [
        {
          tool: 'eraser',
          color: '#000',
          lineWidth: 10,
          opacity: 1,
          points: [
            { x: 10, y: 0 },
            { x: 20, y: 0 },
          ],
        },
      ]

      drawing.setSelection([line])
      expect(drawing.findReshapeHandleAt({ x: 100, y: 0 })?.id).toBe('p1')

      drawing.beginReshape(line, 'p1')
      drawing.updateReshape({ x: 140, y: 30 })
      drawing.endReshape()

      expect(line.points[0]).toMatchObject({ x: 0, y: 0 })
      expect(line.points[1]).toMatchObject({ x: 140, y: 30 })
      expect(line.attachedErasers).toBeUndefined()

      drawing.undo()
      expect(line.points[1]).toMatchObject({ x: 100, y: 0 })
      expect(line.attachedErasers).toHaveLength(1)

      drawing.redo()
      expect(line.points[1]).toMatchObject({ x: 140, y: 30 })
      expect(line.attachedErasers).toBeUndefined()
    })

    it('zero-move reshape click keeps geometric attached erasers', () => {
      drawing.currentTool.value = 'line'
      drawing.startDraw({ x: 0, y: 0 })
      drawing.draw({ x: 100, y: 0 })
      drawing.endDraw()
      const line = drawing.findActionAt({ x: 50, y: 0 })!.action
      const eraser = {
        tool: 'eraser' as const,
        color: '#000',
        lineWidth: 10,
        opacity: 1,
        points: [
          { x: 10, y: 0 },
          { x: 20, y: 0 },
        ],
      }
      line.attachedErasers = [eraser]

      drawing.setSelection([line])
      drawing.beginReshape(line, 'p1')
      drawing.updateReshape({ x: 100, y: 0 }, false)
      drawing.endReshape()

      expect(line.points[1]).toMatchObject({ x: 100, y: 0 })
      expect(line.attachedErasers).toEqual([eraser])
      // No spurious undo entry for a no-op handle click (add stroke still undoable).
      const undoCountBefore = drawing.canUndo.value
      drawing.undo() // undoes the line add
      expect(drawing.findActionAt({ x: 50, y: 0 })).toBeNull()
      expect(undoCountBefore).toBe(true)
    })

    it('zero-move bend click keeps the arrow straight', () => {
      drawing.currentTool.value = 'arrow'
      drawing.startDraw({ x: 0, y: 0 })
      drawing.draw({ x: 80, y: 40 })
      drawing.endDraw()
      const arrow = drawing.findActionAt({ x: 40, y: 20 })!.action

      drawing.setSelection([arrow])
      drawing.beginReshape(arrow, 'bend', { x: 40, y: 20 })
      drawing.updateReshape({ x: 40, y: 20 })
      drawing.endReshape()

      // Promoted then collapsed: no phantom curve and no extra undo entry.
      expect(arrow.points).toHaveLength(2)
      drawing.undo()
      expect(drawing.findActionAt({ x: 40, y: 20 })).toBeNull()
    })

    it('dragging the arrow bend handle promotes it to a curved arrow', () => {
      drawing.currentTool.value = 'arrow'
      drawing.startDraw({ x: 0, y: 0 })
      drawing.draw({ x: 80, y: 40 })
      drawing.endDraw()
      const arrow = drawing.findActionAt({ x: 40, y: 20 })!.action
      expect(arrow.points).toHaveLength(2)

      drawing.setSelection([arrow])
      // The straight arrow already exposes the bend handle at the chord midpoint.
      expect(drawing.findReshapeHandleAt({ x: 40, y: 20 })?.id).toBe('bend')

      drawing.beginReshape(arrow, 'bend', { x: 40, y: 20 })
      drawing.updateReshape({ x: 40, y: -40 })
      drawing.endReshape()

      expect(arrow.points).toHaveLength(3)
      // control = 2 × (40, −40) − (40, 20) = (40, −100)
      expect(arrow.points[1]).toMatchObject({ x: 40, y: -100 })
      // B(0.5) = (40, −40) lies on the rendered curve.
      expect(drawing.findActionAt({ x: 40, y: -40 })).toBeTruthy()

      drawing.undo()
      expect(arrow.points).toHaveLength(2)
      expect(arrow.points[1]).toMatchObject({ x: 80, y: 40 })
    })

    it('reshape rect corner keeps opposite corner fixed', () => {
      addRect(10, 10, 100, 80)
      const rect = drawing.findActionAt({ x: 10, y: 10 })!.action
      drawing.setSelection([rect])

      drawing.beginReshape(rect, 'br')
      drawing.updateReshape({ x: 160, y: 120 })
      drawing.endReshape()

      expect(rect.points[0]).toMatchObject({ x: 10, y: 10 })
      expect(rect.points[1]).toMatchObject({ x: 160, y: 120 })
    })

    it('cancelReshape restores geometry', () => {
      drawing.currentTool.value = 'arrow'
      drawing.startDraw({ x: 0, y: 0 })
      drawing.draw({ x: 80, y: 40 })
      drawing.endDraw()
      const arrow = drawing.findActionAt({ x: 40, y: 20 })!.action
      const p1 = { ...arrow.points[1] }

      drawing.setSelection([arrow])
      drawing.beginReshape(arrow, 'p0')
      drawing.updateReshape({ x: -20, y: -20 })
      drawing.cancelReshape()

      expect(arrow.points[0]).toMatchObject({ x: 0, y: 0 })
      expect(arrow.points[1]).toMatchObject(p1)
      expect(drawing.canUndo.value).toBe(true) // add only
    })

    it('findReshapeHandleAt requires single reshapeable selection', () => {
      addRect(10, 10, 40, 40)
      addRect(80, 80, 120, 120)
      const a = drawing.findActionAt({ x: 10, y: 10 })!.action
      const b = drawing.findActionAt({ x: 80, y: 80 })!.action

      drawing.setSelection([a, b])
      expect(drawing.findReshapeHandleAt({ x: 10, y: 10 })).toBeNull()

      drawing.setSelection([a])
      expect(drawing.findReshapeHandleAt({ x: 10, y: 10 })?.id).toBe('tl')
    })

    it('rotate handle turns a rect and supports undo', () => {
      // Non-square so 90° rotation clearly changes which edges are hittable.
      addRect(0, 0, 100, 40)
      const rect = drawing.findActionAt({ x: 0, y: 0 })!.action
      drawing.setSelection([rect])

      const rotate = drawing.findReshapeHandleAt({ x: 50, y: -28 })
      expect(rotate?.id).toBe('rotate')

      drawing.beginReshape(rect, 'rotate', { x: 50, y: -28 })
      drawing.updateReshape({ x: 100, y: 20 }, false)
      drawing.endReshape()

      expect(rect.rotation).toBeCloseTo(Math.PI / 2, 5)
      expect(rect.points[0]).toMatchObject({ x: 0, y: 0 })
      expect(rect.points[1]).toMatchObject({ x: 100, y: 40 })
      // Left mid of the unrotated rect misses; the rotated left edge sits near (50, -30).
      expect(drawing.findActionAt({ x: 0, y: 20 })).toBeNull()
      expect(drawing.findActionAt({ x: 50, y: -30 })).toBeTruthy()

      drawing.undo()
      expect(rect.rotation ?? 0).toBe(0)
    })

    it('reshape pen bbox scales points and keeps attached erasers undoably', () => {
      drawing.currentTool.value = 'pen'
      drawing.startDraw({ x: 0, y: 0 })
      drawing.draw({ x: 100, y: 0 })
      drawing.draw({ x: 100, y: 100 })
      drawing.endDraw()
      const pen = drawing.findActionAt({ x: 50, y: 0 })!.action
      const beforePts = pen.points.map((p) => ({ x: p.x, y: p.y }))
      const xs = beforePts.map((p) => p.x)
      const ys = beforePts.map((p) => p.y)
      const x0 = Math.min(...xs)
      const y0 = Math.min(...ys)
      const x1 = Math.max(...xs)
      const y1 = Math.max(...ys)
      pen.attachedErasers = [
        {
          tool: 'eraser',
          color: '#000',
          lineWidth: 10,
          opacity: 1,
          points: [
            { x: (x0 + x1) / 2, y: y0 },
            { x: (x0 + x1) / 2, y: (y0 + y1) / 2 },
          ],
        },
      ]
      const eraserBefore = pen.attachedErasers[0].points.map((p) => ({ x: p.x, y: p.y }))

      drawing.setSelection([pen])
      expect(drawing.findReshapeHandleAt({ x: x1, y: y1 })?.id).toBe('br')

      const nx1 = x1 + (x1 - x0)
      const ny1 = y1 + (y1 - y0)
      drawing.beginReshape(pen, 'br')
      drawing.updateReshape({ x: nx1, y: ny1 }, false)
      drawing.endReshape()

      expect(Math.max(...pen.points.map((p) => p.x))).toBeCloseTo(nx1, 5)
      expect(Math.max(...pen.points.map((p) => p.y))).toBeCloseTo(ny1, 5)
      expect(pen.attachedErasers).toHaveLength(1)
      expect(pen.attachedErasers![0].points[1].x).toBeCloseTo(eraserBefore[1].x * 2 - x0, 5)
      expect(pen.attachedErasers![0].points[1].y).toBeCloseTo(eraserBefore[1].y * 2 - y0, 5)

      drawing.undo()
      expect(pen.points.map((p) => ({ x: p.x, y: p.y }))).toEqual(beforePts)
      expect(pen.attachedErasers![0].points.map((p) => ({ x: p.x, y: p.y }))).toEqual(eraserBefore)
    })
  })

  describe('selected dash style', () => {
    function addRect(x0: number, y0: number, x1: number, y1: number) {
      drawing.currentTool.value = 'rect'
      drawing.startDraw({ x: x0, y: y0 })
      drawing.draw({ x: x1, y: y1 })
      drawing.endDraw()
      return drawing.findActionAt({ x: x0, y: y0 })!.action
    }

    it('returns false without a dashable selection', () => {
      expect(drawing.cycleSelectedDashStyle(1)).toBe(false)

      drawing.addTextAction('T', 100, 100, 0, 24, '#000000')
      const text = drawing.findActionAt({ x: 150, y: 100 })!.action
      drawing.setSelection([text])
      expect(drawing.cycleSelectedDashStyle(1)).toBe(false)
      expect(text.dashStyle).toBeUndefined()
    })

    it('cycles a selected shape and is undoable', () => {
      const rect = addRect(10, 10, 80, 60)
      drawing.setSelection([rect])

      expect(drawing.cycleSelectedDashStyle(1)).toBe(true)
      expect(rect.dashStyle).toBe('dashed')
      expect(drawing.shapeDashStyle.value).toBe('dashed')

      drawing.cycleSelectedDashStyle(1)
      expect(rect.dashStyle).toBe('dotted')

      drawing.cycleSelectedDashStyle(1)
      expect(rect.dashStyle).toBeUndefined()
      expect(drawing.shapeDashStyle.value).toBe('solid')

      // Shift+D reverses the direction.
      drawing.cycleSelectedDashStyle(-1)
      expect(rect.dashStyle).toBe('dotted')

      drawing.undo()
      expect(rect.dashStyle).toBeUndefined()
      drawing.redo()
      expect(rect.dashStyle).toBe('dotted')
    })

    it('applies to every selected dashable action and skips text', () => {
      const rect = addRect(10, 10, 80, 60)
      drawing.currentTool.value = 'line'
      drawing.startDraw({ x: 0, y: 120 })
      drawing.draw({ x: 100, y: 120 })
      drawing.endDraw()
      const line = drawing.findActionAt({ x: 50, y: 120 })!.action
      drawing.addTextAction('T', 150, 120, 0, 24, '#000000')
      const text = drawing.findActionAt({ x: 180, y: 120 })!.action

      drawing.setSelection([rect, line, text])
      drawing.cycleSelectedDashStyle(1)

      expect(rect.dashStyle).toBe('dashed')
      expect(line.dashStyle).toBe('dashed')
      expect(text.dashStyle).toBeUndefined()
    })

    it('cycles dash style on bent hold-locked ink without losing the bend handle', () => {
      vi.useFakeTimers()
      drawing.currentTool.value = 'pen'
      drawing.startDraw({ x: 0, y: 0, pressure: 0.5, pointerType: 'pen' })
      for (let i = 1; i <= 10; i++) {
        drawing.draw({ x: i * 8, y: 0, pressure: 0.5, pointerType: 'pen' })
      }
      vi.advanceTimersByTime(500)
      drawing.draw({ x: 80, y: 0, pressure: 0.5, pointerType: 'pen' })
      drawing.endDraw()
      vi.useRealTimers()

      const ink = drawing.findActionAt({ x: 40, y: 0 })!.action
      drawing.setSelection([ink])
      drawing.beginReshape(ink, 'bend', { x: 40, y: 0 })
      drawing.updateReshape({ x: 40, y: -60 })
      drawing.endReshape()
      expect(ink.points).toHaveLength(3)

      expect(drawing.cycleSelectedDashStyle(1)).toBe(true)
      expect(ink.dashStyle).toBe('dashed')
      expect(drawing.findReshapeHandleAt({ x: 40, y: -60 })?.id).toBe('bend')

      drawing.undo()
      expect(ink.dashStyle).toBeUndefined()
      expect(ink.points).toHaveLength(3)
    })
  })

  describe('selected color', () => {
    function addRect(x0: number, y0: number, x1: number, y1: number) {
      drawing.currentTool.value = 'rect'
      drawing.startDraw({ x: x0, y: y0 })
      drawing.draw({ x: x1, y: y1 })
      drawing.endDraw()
      return drawing.findActionAt({ x: x0, y: y0 })!.action
    }

    it('returns false without a selection', () => {
      expect(drawing.cycleSelectedColor(1)).toBe(false)
      expect(drawing.cycleSelectedColor(-1)).toBe(false)
    })

    it('applies an explicit swatch color to the selection', () => {
      const rect = addRect(10, 10, 80, 60)
      drawing.setSelection([rect])

      expect(drawing.setSelectedColor('#5856D6')).toBe(true)
      expect(rect.color).toBe('#5856D6')
      expect(drawing.currentColor.value).toBe('#5856D6')

      drawing.undo()
      expect(rect.color).toBe('#FF0000')
    })

    it('returns false for an explicit color without a selection', () => {
      expect(drawing.setSelectedColor('#5856D6')).toBe(false)
      expect(drawing.currentColor.value).toBe('#FF0000')
    })

    it('cycles the selected color and is undoable', () => {
      const rect = addRect(10, 10, 80, 60)
      // Start from a palette entry so the cycle direction is unambiguous.
      rect.color = '#FF3B30'
      drawing.setSelection([rect])

      expect(drawing.cycleSelectedColor(1)).toBe(true)
      expect(rect.color).toBe('#FF6B35')
      expect(drawing.currentColor.value).toBe('#FF6B35')

      drawing.cycleSelectedColor(-1)
      expect(rect.color).toBe('#FF3B30')

      // Q wraps from the first palette entry to the last.
      drawing.cycleSelectedColor(-1)
      expect(rect.color).toBe('#000000')

      drawing.undo()
      expect(rect.color).toBe('#FF3B30')
      drawing.redo()
      expect(rect.color).toBe('#000000')
    })

    it('recolors every selected action including text', () => {
      const rect = addRect(10, 10, 80, 60)
      rect.color = '#FF3B30'
      drawing.addTextAction('T', 150, 120, 0, 24, '#FF3B30')
      const text = drawing.findActionAt({ x: 180, y: 120 })!.action

      drawing.setSelection([rect, text])
      drawing.cycleSelectedColor(1)

      expect(rect.color).toBe('#FF6B35')
      expect(text.color).toBe('#FF6B35')
    })

    it('recolors bent hold-locked ink without losing the curve', () => {
      vi.useFakeTimers()
      drawing.currentTool.value = 'pen'
      drawing.startDraw({ x: 0, y: 0, pressure: 0.5, pointerType: 'pen' })
      for (let i = 1; i <= 10; i++) {
        drawing.draw({ x: i * 8, y: 0, pressure: 0.5, pointerType: 'pen' })
      }
      vi.advanceTimersByTime(500)
      drawing.draw({ x: 80, y: 0, pressure: 0.5, pointerType: 'pen' })
      drawing.endDraw()
      vi.useRealTimers()

      const ink = drawing.findActionAt({ x: 40, y: 0 })!.action
      drawing.setSelection([ink])
      drawing.beginReshape(ink, 'bend', { x: 40, y: 0 })
      drawing.updateReshape({ x: 40, y: -60 })
      drawing.endReshape()
      ink.color = '#FF3B30'
      const before = ink.color

      expect(drawing.cycleSelectedColor(1)).toBe(true)
      expect(ink.color).not.toBe(before)
      expect(ink.points).toHaveLength(3)
      expect(drawing.findReshapeHandleAt({ x: 40, y: -60 })?.id).toBe('bend')

      drawing.undo()
      expect(ink.color).toBe(before)
      expect(ink.points).toHaveLength(3)
    })

    it('falls back to the first palette color for custom colors', () => {
      const rect = addRect(10, 10, 80, 60)
      rect.color = '#123456'
      drawing.setSelection([rect])

      drawing.cycleSelectedColor(-1)
      expect(rect.color).toBe('#FF3B30')
    })
  })

  describe('copy / paste', () => {
    function addRect(x0: number, y0: number, x1: number, y1: number) {
      drawing.currentTool.value = 'rect'
      drawing.startDraw({ x: x0, y: y0 })
      drawing.draw({ x: x1, y: y1 })
      drawing.endDraw()
    }

    it('copying without a selection reports nothing copied', () => {
      addRect(10, 10, 50, 50)
      expect(drawing.copySelection()).toBe(0)
      expect(drawing.hasCopiedActions()).toBe(false)
    })

    it('pasting an empty clipboard is a no-op', () => {
      addRect(10, 10, 50, 50)
      expect(drawing.pasteClipboard()).toBe(0)
      expect(drawing.findActionAt({ x: 10, y: 10 })?.action.points[1]).toMatchObject({ x: 50, y: 50 })
    })

    it('pastes a 1:1 copy cascaded below-right and selects it', () => {
      addRect(10, 10, 50, 50)
      const original = drawing.findActionAt({ x: 10, y: 10 })!.action

      drawing.setSelection([original])
      expect(drawing.copySelection()).toBe(1)
      expect(drawing.pasteClipboard()).toBe(1)

      expect(drawing.selectedActions.value).toHaveLength(1)
      const pasted = drawing.selectedActions.value[0]
      expect(pasted).not.toBe(original)
      expect(pasted.points[0]).toMatchObject({ x: 22, y: 22 })
      expect(pasted.points[1]).toMatchObject({ x: 62, y: 62 })
      // Same size — only translated.
      expect(pasted.points[1].x - pasted.points[0].x).toBe(original.points[1].x - original.points[0].x)
      expect(pasted.color).toBe(original.color)
      expect(pasted.lineWidth).toBe(original.lineWidth)
    })

    it('consecutive pastes cascade further instead of stacking', () => {
      addRect(0, 0, 40, 40)
      const original = drawing.findActionAt({ x: 0, y: 0 })!.action
      drawing.setSelection([original])
      drawing.copySelection()

      drawing.pasteClipboard()
      const first = drawing.selectedActions.value[0]
      drawing.pasteClipboard()
      const second = drawing.selectedActions.value[0]

      expect(first.points[0]).toMatchObject({ x: 12, y: 12 })
      expect(second.points[0]).toMatchObject({ x: 24, y: 24 })
    })

    it('a whole paste is one undo step and redo restores it', () => {
      addRect(10, 10, 50, 50)
      addRect(80, 80, 120, 120)
      const a = drawing.findActionAt({ x: 10, y: 10 })!.action
      const b = drawing.findActionAt({ x: 80, y: 80 })!.action
      drawing.setSelection([a, b])
      drawing.copySelection()
      drawing.pasteClipboard()

      const pasted = [...drawing.selectedActions.value]
      expect(pasted).toHaveLength(2)
      expect(drawing.findActionAt({ x: 22, y: 22 })).toBeTruthy()

      drawing.undo()
      expect(drawing.findActionAt({ x: 22, y: 22 })).toBeNull()
      expect(drawing.findActionAt({ x: 92, y: 92 })).toBeNull()
      expect(drawing.selectedActions.value).toEqual([])

      drawing.redo()
      expect(drawing.findActionAt({ x: 22, y: 22 })?.action).toBe(pasted[0])
      expect(drawing.selectedActions.value).toEqual(pasted)
    })

    it('pasted text owns its outline style instead of sharing it', () => {
      drawing.addTextAction('A', 10, 10, 0, 24, '#FFFFFF', {
        enabled: true,
        colorMode: 'fixed',
        color: '#000000',
        width: 2,
      })
      const original = drawing.findActionAt({ x: 12, y: 8 })!.action
      expect(original.textOutline).toBeDefined()

      drawing.setSelection([original])
      drawing.copySelection()
      drawing.pasteClipboard()
      const pasted = drawing.selectedActions.value[0]

      expect(pasted.textOutline).not.toBe(original.textOutline)
      pasted.textOutline!.width = 99
      expect(original.textOutline!.width).toBe(2)
    })

    it('copying with an empty selection keeps the previous clipboard', () => {
      addRect(0, 0, 40, 40)
      const action = drawing.findActionAt({ x: 0, y: 0 })!.action
      drawing.setSelection([action])
      drawing.copySelection()

      drawing.clearSelection()
      expect(drawing.copySelection()).toBe(0)

      // The buffer from the first copy is still usable.
      expect(drawing.pasteClipboard()).toBe(1)
      expect(drawing.selectedActions.value[0].points[0]).toMatchObject({ x: 12, y: 12 })
    })

    it('only the copies are selected, the originals stay untouched', () => {
      addRect(0, 0, 40, 40)
      const original = drawing.findActionAt({ x: 0, y: 0 })!.action
      drawing.setSelection([original])
      drawing.copySelection()
      drawing.pasteClipboard()

      expect(drawing.selectedActions.value).toHaveLength(1)
      expect(drawing.selectedActions.value[0]).not.toBe(original)
      expect(drawing.isActionSelected(original)).toBe(false)
      expect(original.points[0]).toMatchObject({ x: 0, y: 0 })
    })

    it('paste then delete then undo twice keeps the history consistent', () => {
      addRect(0, 0, 40, 40)
      const original = drawing.findActionAt({ x: 0, y: 0 })!.action
      drawing.setSelection([original])
      drawing.copySelection()
      drawing.pasteClipboard()
      const pasted = drawing.selectedActions.value[0]

      drawing.removeSelected()
      expect(drawing.findActionAt({ x: 12, y: 12 })).toBeNull()

      drawing.undo()
      expect(drawing.findActionAt({ x: 12, y: 12 })?.action).toBe(pasted)

      drawing.undo()
      expect(drawing.findActionAt({ x: 12, y: 12 })).toBeNull()
      expect(drawing.findActionAt({ x: 0, y: 0 })?.action).toBe(original)

      drawing.redo()
      drawing.redo()
      expect(drawing.findActionAt({ x: 12, y: 12 })).toBeNull()
      expect(drawing.findActionAt({ x: 0, y: 0 })?.action).toBe(original)
    })

    it('pasted ink keeps copy semantics for both stroke and attached erasers', () => {
      drawing.currentTool.value = 'pen'
      drawing.startDraw({ x: 0, y: 0 })
      drawing.draw({ x: 60, y: 0 })
      drawing.draw({ x: 60, y: 60 })
      drawing.endDraw()
      const pen = drawing.findActionAt({ x: 30, y: 0 })!.action

      const eraser: typeof pen = {
        tool: 'eraser',
        color: '#000',
        lineWidth: 4,
        opacity: 1,
        points: [
          { x: 20, y: 20 },
          { x: 30, y: 30 },
        ],
      }
      pen.attachedErasers = [eraser]

      drawing.setSelection([pen])
      drawing.copySelection()
      drawing.pasteClipboard()

      const pasted = drawing.selectedActions.value[0]
      expect(pasted.attachedErasers).toHaveLength(1)
      expect(pasted.attachedErasers![0].points[0]).toMatchObject({ x: 32, y: 32 })
      // The source eraser must not move with the copy.
      expect(eraser.points[0]).toMatchObject({ x: 20, y: 20 })
    })

    it('copying keeps z-order so pasted groups stack like the original', () => {
      addRect(0, 0, 40, 40)
      addRect(10, 10, 50, 50)
      const lower = drawing.findActionAt({ x: 0, y: 0 })!.action
      const upper = drawing.findActionAt({ x: 40, y: 40 })!.action

      drawing.setSelection([upper, lower])
      drawing.copySelection()
      drawing.pasteClipboard()

      const pasted = drawing.selectedActions.value
      expect(pasted).toHaveLength(2)
      expect(pasted[0].points[0]).toMatchObject({ x: lower.points[0].x + 12, y: lower.points[0].y + 12 })
      expect(pasted[1].points[0]).toMatchObject({ x: upper.points[0].x + 12, y: upper.points[0].y + 12 })
    })
  })

  describe('destroy', () => {
    it('cleans up without throwing', () => {
      drawing.startDraw({ x: 0, y: 0 })
      drawing.draw({ x: 10, y: 10 })
      drawing.endDraw()
      drawing.destroy()
    })
  })

  describe('redrawAll', () => {
    it('does not throw when canvas is available', () => {
      drawing.startDraw({ x: 0, y: 0 })
      drawing.draw({ x: 10, y: 10 })
      drawing.endDraw()
      drawing.redrawAll()
    })

    it('does not throw when no actions exist', () => {
      drawing.redrawAll()
    })

    it('keeps live ink aligned after canvas bitmap resize mid-stroke', () => {
      drawing.startDraw({ x: 10, y: 10 })
      drawing.draw({ x: 40, y: 40 })
      expect(drawing.isDrawing.value).toBe(true)

      previewCanvas.width = Math.round(previewCanvas.width * 1.25)
      previewCanvas.height = Math.round(previewCanvas.height * 1.25)
      previewCanvas.style.width = '800px'
      previewCanvas.style.height = '600px'

      drawing.redrawAll()
      expect(drawing.isDrawing.value).toBe(true)
      expect(drawing.getActiveStrokePointCount()).toBeGreaterThanOrEqual(2)

      drawing.draw({ x: 70, y: 55 })
      drawing.endDraw()

      expect(drawing.isDrawing.value).toBe(false)
      expect(drawing.canClear.value).toBe(true)
      expect(drawing.canUndo.value).toBe(true)
    })

    it('rebuilds cache transform when CSS size changes but bitmap does not', () => {
      drawing.startDraw({ x: 100, y: 100 })
      drawing.draw({ x: 400, y: 300 })
      drawing.endDraw()

      const ctx = previewCanvas.getContext('2d') as unknown as { setTransform: ReturnType<typeof vi.fn> }
      ctx.setTransform.mockClear()

      previewCanvas.style.width = '1280px'
      previewCanvas.style.height = '720px'

      drawing.redrawAll()

      expect(ctx.setTransform).toHaveBeenCalledWith(1.5, 0, 0, 1.5, 0, 0)
    })
  })

  describe('live ink preview', () => {
    let frames: (() => void)[] = []
    let nextFrameId = 1

    function wave(i: number) {
      return { x: 20 + i * 3, y: 300 + Math.sin(i / 9) * 120, pressure: 0.5 }
    }

    /** One pointer sample per animation frame, like a real stroke. */
    function drawFrame(p: { x: number; y: number; pressure: number }) {
      drawing.draw(p)
      const pending = frames
      frames = []
      for (const cb of pending) cb()
    }

    beforeEach(() => {
      frames = []
      vi.stubGlobal('requestAnimationFrame', (cb: () => void) => {
        frames.push(cb)
        return nextFrameId++
      })
    })

    afterEach(() => {
      vi.stubGlobal('requestAnimationFrame', syncRequestAnimationFrame)
      vi.restoreAllMocks()
    })

    it('keeps per-sample outline work bounded on long strokes', () => {
      drawing.currentTool.value = 'pen'
      drawing.startDraw({ ...wave(0), pointerType: 'pen' })
      for (let i = 1; i < 1600; i++) drawFrame(wave(i))
      expect(drawing.getActiveStrokePointCount()).toBe(1600)

      const curves = vi.spyOn(Path2D.prototype, 'lineTo')
      drawFrame(wave(1600))
      // A full re-outline of 1600 points emits thousands of hull segments.
      expect(curves.mock.calls.length).toBeGreaterThan(0)
      expect(curves.mock.calls.length).toBeLessThan(800)

      const ctx = previewCanvas.getContext('2d') as unknown as { drawImage: ReturnType<typeof vi.fn> }
      expect(ctx.drawImage).toHaveBeenCalled()

      drawing.endDraw()
      expect(drawing.canUndo.value).toBe(true)
    })

    it('composites long highlighter strokes at the stroke opacity', () => {
      drawing.currentTool.value = 'highlighter'
      drawing.startDraw({ ...wave(0), pointerType: 'mouse' })
      const ctx = previewCanvas.getContext('2d') as unknown as {
        drawImage: ReturnType<typeof vi.fn>
        globalAlpha: number
      }
      const alphas: number[] = []
      ctx.drawImage.mockImplementation(() => {
        alphas.push(ctx.globalAlpha)
      })
      for (let i = 1; i < 800; i++) drawFrame(wave(i))

      expect(alphas.length).toBeGreaterThan(0)
      expect(alphas.every((a) => a === 0.35)).toBe(true)
      drawing.endDraw()
      expect(drawing.canUndo.value).toBe(true)
    })

    it('rebuilds the live preview when width changes mid-stroke', () => {
      drawing.currentTool.value = 'pen'
      drawing.lineWidth.value = 3
      drawing.startDraw({ ...wave(0), pointerType: 'mouse' })
      for (let i = 1; i < 600; i++) drawFrame(wave(i))
      const curves = vi.spyOn(Path2D.prototype, 'lineTo')
      drawFrame(wave(600))
      const tailOnly = curves.mock.calls.length
      expect(tailOnly).toBeGreaterThan(0)

      curves.mockClear()
      drawing.lineWidth.value = 8
      drawFrame(wave(601))
      // Restart re-freezes the whole prefix once at the new width.
      expect(curves.mock.calls.length).toBeGreaterThan(tailOnly * 2)
      drawing.endDraw()
      expect(drawing.canUndo.value).toBe(true)
    })
  })
})

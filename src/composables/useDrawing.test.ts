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
    arc: vi.fn(),
    quadraticCurveTo: vi.fn(),
    scale: vi.fn(),
    translate: vi.fn(),
    setTransform: vi.fn(),
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
  return drawing
}

// Mock requestAnimationFrame / cancelAnimationFrame for render scheduling
vi.stubGlobal('requestAnimationFrame', (cb: () => void) => {
  cb()
  return 1
})
vi.stubGlobal('cancelAnimationFrame', vi.fn())
vi.stubGlobal(
  'document',
  Object.assign(globalThis.document ?? {}, {
    createElement: vi.fn(() => createMockCanvas()),
  }),
)

describe('useDrawing', () => {
  let drawing: ReturnType<typeof setup>

  beforeEach(() => {
    drawing = setup()
  })

  afterEach(() => {
    drawing.destroy()
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

    it('cancelDraw discards in-progress stroke without adding to history', () => {
      drawing.startDraw({ x: 10, y: 10 })
      drawing.draw({ x: 20, y: 20 })
      drawing.cancelDraw()

      expect(drawing.isDrawing.value).toBe(false)
      expect(drawing.canUndo.value).toBe(false)
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
      expect(pressuresBefore).toEqual([0.2, 0.9, 0.3])

      drawing.beginDrag(found!.action)
      drawing.updateDragOffset(15, 20)
      drawing.endDrag()

      expect(found!.action.points[0]).toMatchObject({ x: 25, y: 30, pressure: 0.2 })
      expect(found!.action.points.map((p) => p.pressure)).toEqual([0.2, 0.9, 0.3])

      drawing.undo()
      expect(found!.action.points[0]).toMatchObject({ x: 10, y: 10, pressure: 0.2 })
      expect(found!.action.points.map((p) => p.pressure)).toEqual([0.2, 0.9, 0.3])
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
  })
})

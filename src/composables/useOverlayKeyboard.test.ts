import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ref } from 'vue'
import { createKeyDownHandler, type KeyboardContext, type KeyboardActions } from './useOverlayKeyboard'
import type { Tool } from './drawingTypes'

function createContext(overrides: Partial<KeyboardContext> = {}): KeyboardContext {
  return {
    active: ref(true),
    showSettings: ref(false),
    showQuickColors: ref(false),
    quickColorsPos: ref({ x: 100, y: 100 }),
    textBoxPos: ref(null),
    currentTool: ref<Tool>('pen'),
    isDrawing: ref(false),
    lastPointerX: () => 200,
    lastPointerY: () => 200,
    mousePos: ref({ x: 0, y: 0 }),
    ...overrides,
  }
}

function createActions(): KeyboardActions & { calls: Record<string, unknown[][]> } {
  const calls: Record<string, unknown[][]> = {}
  const make = (name: string) => {
    calls[name] = []
    return (...args: unknown[]) => {
      calls[name].push(args)
    }
  }

  return {
    calls,
    cycleColor: make('cycleColor') as KeyboardActions['cycleColor'],
    showToolTip: make('showToolTip') as KeyboardActions['showToolTip'],
    undo: make('undo') as KeyboardActions['undo'],
    redo: make('redo') as KeyboardActions['redo'],
    clearAll: make('clearAll') as KeyboardActions['clearAll'],
    exitDrawing: make('exitDrawing') as KeyboardActions['exitDrawing'],
    copyScreen: make('copyScreen') as KeyboardActions['copyScreen'],
    setSettingsVisible: make('setSettingsVisible') as KeyboardActions['setSettingsVisible'],
    toggleSettingsVisible: make('toggleSettingsVisible') as KeyboardActions['toggleSettingsVisible'],
    commitCurrentTextBox: make('commitCurrentTextBox') as KeyboardActions['commitCurrentTextBox'],
  }
}

function key(key: string, mods: Partial<KeyboardEvent> = {}): KeyboardEvent {
  return {
    key,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    metaKey: false,
    preventDefault: vi.fn(),
    ...mods,
  } as unknown as KeyboardEvent
}

describe('useOverlayKeyboard', () => {
  let ctx: KeyboardContext
  let actions: ReturnType<typeof createActions>
  let handler: (e: KeyboardEvent) => void

  beforeEach(() => {
    ctx = createContext()
    actions = createActions()
    handler = createKeyDownHandler(ctx, actions)
  })

  it('does nothing when not active', () => {
    ctx.active.value = false
    handler(key('1'))
    expect(actions.calls.showToolTip).toHaveLength(0)
  })

  describe('tool switching', () => {
    it('key 1 selects pen', () => {
      handler(key('1'))
      expect(ctx.currentTool.value).toBe('pen')
      expect(actions.calls.showToolTip[0]).toEqual(['pen'])
    })

    it('key 2 selects highlighter', () => {
      handler(key('2'))
      expect(ctx.currentTool.value).toBe('highlighter')
    })

    it('key 3 selects arrow', () => {
      handler(key('3'))
      expect(ctx.currentTool.value).toBe('arrow')
    })

    it('key 4 selects rect', () => {
      handler(key('4'))
      expect(ctx.currentTool.value).toBe('rect')
    })

    it('key 5 selects ellipse', () => {
      handler(key('5'))
      expect(ctx.currentTool.value).toBe('ellipse')
    })

    it('key 6 selects line', () => {
      handler(key('6'))
      expect(ctx.currentTool.value).toBe('line')
    })

    it('key 7 selects eraser', () => {
      handler(key('7'))
      expect(ctx.currentTool.value).toBe('eraser')
    })

    it('key T selects text', () => {
      handler(key('t'))
      expect(ctx.currentTool.value).toBe('text')
      expect(actions.calls.showToolTip[0]).toEqual(['text'])
    })

    it('tool switch hides settings panel', () => {
      handler(key('3'))
      expect(actions.calls.setSettingsVisible[0]).toEqual([false])
    })
  })

  describe('undo / redo', () => {
    it('Ctrl+Z triggers undo', () => {
      handler(key('z', { ctrlKey: true }))
      expect(actions.calls.undo).toHaveLength(1)
    })

    it('Ctrl+Y triggers redo', () => {
      handler(key('y', { ctrlKey: true }))
      expect(actions.calls.redo).toHaveLength(1)
    })

    it('Ctrl+Shift+Z triggers redo', () => {
      handler(key('Z', { ctrlKey: true, shiftKey: true }))
      expect(actions.calls.redo).toHaveLength(1)
    })

    it('does not undo/redo when settings panel is open', () => {
      ctx.showSettings.value = true
      handler(key('z', { ctrlKey: true }))
      expect(actions.calls.undo).toHaveLength(0)
    })
  })

  describe('clear and exit', () => {
    it('Delete clears all', () => {
      handler(key('Delete'))
      expect(actions.calls.clearAll).toHaveLength(1)
    })

    it('Escape exits drawing', () => {
      handler(key('Escape'))
      expect(actions.calls.exitDrawing).toHaveLength(1)
    })

    it('does not clear/exit when settings panel is open', () => {
      ctx.showSettings.value = true
      handler(key('Delete'))
      handler(key('Escape'))
      expect(actions.calls.clearAll).toHaveLength(0)
      expect(actions.calls.exitDrawing).toHaveLength(0)
    })
  })

  describe('color cycling', () => {
    it('Q cycles color backward', () => {
      handler(key('q'))
      expect(actions.calls.cycleColor[0]).toEqual([-1])
    })

    it('E cycles color forward', () => {
      handler(key('e'))
      expect(actions.calls.cycleColor[0]).toEqual([1])
    })
  })

  describe('space toggles settings', () => {
    it('space toggles settings panel', () => {
      handler(key(' '))
      expect(actions.calls.toggleSettingsVisible).toHaveLength(1)
    })

    it('space updates mousePos from lastPointer', () => {
      handler(key(' '))
      expect(ctx.mousePos.value).toEqual({ x: 200, y: 200 })
    })
  })

  describe('copy screen', () => {
    it('Ctrl+C triggers copy', () => {
      handler(key('c', { ctrlKey: true }))
      expect(actions.calls.copyScreen).toHaveLength(1)
    })

    it('Ctrl+C works even when settings is open (before settings check)', () => {
      ctx.showSettings.value = true
      handler(key('c', { ctrlKey: true }))
      expect(actions.calls.copyScreen).toHaveLength(1)
    })
  })

  describe('quick colors mode', () => {
    beforeEach(() => {
      ctx.showQuickColors.value = true
    })

    it('Escape closes quick colors', () => {
      handler(key('Escape'))
      expect(ctx.showQuickColors.value).toBe(false)
    })

    it('Q/E cycles colors in quick color mode', () => {
      handler(key('q'))
      expect(actions.calls.cycleColor[0]).toEqual([-1])
      handler(key('e'))
      expect(actions.calls.cycleColor[1]).toEqual([1])
    })

    it('Space closes quick colors and opens settings', () => {
      handler(key(' '))
      expect(ctx.showQuickColors.value).toBe(false)
      expect(actions.calls.toggleSettingsVisible).toHaveLength(1)
    })

    it('Ctrl+C copies screen in quick color mode', () => {
      handler(key('c', { ctrlKey: true }))
      expect(actions.calls.copyScreen).toHaveLength(1)
    })
  })

  describe('text box mode', () => {
    beforeEach(() => {
      ctx.textBoxPos.value = { x: 50, y: 50 }
    })

    it('Escape cancels text box', () => {
      handler(key('Escape'))
      expect(actions.calls.commitCurrentTextBox[0]).toEqual([true])
    })

    it('other keys are ignored in text box mode', () => {
      handler(key('1'))
      handler(key('z', { ctrlKey: true }))
      expect(actions.calls.showToolTip).toHaveLength(0)
      expect(actions.calls.undo).toHaveLength(0)
    })
  })

  describe('Alt key prevention', () => {
    it('prevents default on Alt key', () => {
      const e = key('Alt')
      handler(e)
      expect(e.preventDefault).toHaveBeenCalled()
    })
  })
})

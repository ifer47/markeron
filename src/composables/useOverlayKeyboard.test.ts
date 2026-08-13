import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ref, type Ref } from 'vue'
import {
  createKeyDownHandler,
  resetCopyModifierState,
  invalidateCopyModifierForPointerInteraction,
  markPointerInteractionEnded,
  isCopyShortcut,
  type KeyboardContext,
  type KeyboardActions,
} from './useOverlayKeyboard'
import type { Tool } from './drawingTypes'

function createContext(overrides: Partial<KeyboardContext> = {}): KeyboardContext {
  return {
    active: ref(true),
    showToolbarPopup: ref(false),
    toolbarPinned: ref(false),
    showQuickColors: ref(false),
    quickColorsPos: ref({ x: 100, y: 100 }),
    textBoxPos: ref(null),
    currentTool: ref<Tool>('pen'),
    whiteboardMode: ref(false),
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
    showStampTip: make('showStampTip') as KeyboardActions['showStampTip'],
    cycleStampKind: make('cycleStampKind') as KeyboardActions['cycleStampKind'],
    resetStampCounter: make('resetStampCounter') as KeyboardActions['resetStampCounter'],
    cycleEraserMode: make('cycleEraserMode') as KeyboardActions['cycleEraserMode'],
    showEraserTip: make('showEraserTip') as KeyboardActions['showEraserTip'],
    cyclePenCursorStyle: make('cyclePenCursorStyle') as KeyboardActions['cyclePenCursorStyle'],
    showPenTip: make('showPenTip') as KeyboardActions['showPenTip'],
    cycleCrosshairCursorStyle: make('cycleCrosshairCursorStyle') as KeyboardActions['cycleCrosshairCursorStyle'],
    showCrosshairTip: make('showCrosshairTip') as KeyboardActions['showCrosshairTip'],
    undo: make('undo') as KeyboardActions['undo'],
    redo: make('redo') as KeyboardActions['redo'],
    removeSelected: make('removeSelected') as KeyboardActions['removeSelected'],
    hasSelection: () => false,
    clearSelection: make('clearSelection') as KeyboardActions['clearSelection'],
    exitDrawing: make('exitDrawing') as KeyboardActions['exitDrawing'],
    togglePenetrationMode: make('togglePenetrationMode') as KeyboardActions['togglePenetrationMode'],
    enterWhiteboardMode: make('enterWhiteboardMode') as KeyboardActions['enterWhiteboardMode'],
    exitWhiteboardMode: make('exitWhiteboardMode') as KeyboardActions['exitWhiteboardMode'],
    copyScreen: make('copyScreen') as KeyboardActions['copyScreen'],
    copyWhiteboard: make('copyWhiteboard') as KeyboardActions['copyWhiteboard'],
    toggleToolbarPopupVisible: make('toggleToolbarPopupVisible') as KeyboardActions['toggleToolbarPopupVisible'],
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

function copyChord(handler: (e: KeyboardEvent) => void, mods: Partial<KeyboardEvent> = { ctrlKey: true }) {
  handler(key('Control', mods))
  handler(key('c', mods))
}

describe('isCopyShortcut', () => {
  it('matches Ctrl+C and Cmd+C without Shift', () => {
    expect(isCopyShortcut(key('c', { ctrlKey: true }))).toBe(true)
    expect(isCopyShortcut(key('C', { ctrlKey: true }))).toBe(true)
  })

  it('rejects Shift+Ctrl+C and plain C', () => {
    expect(isCopyShortcut(key('c', { ctrlKey: true, shiftKey: true }))).toBe(false)
    expect(isCopyShortcut(key('c'))).toBe(false)
  })
})

describe('useOverlayKeyboard', () => {
  let ctx: KeyboardContext
  let actions: ReturnType<typeof createActions>
  let handler: (e: KeyboardEvent) => void

  beforeEach(() => {
    resetCopyModifierState()
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
    it('key 2 selects highlighter', () => {
      handler(key('2'))
      expect(ctx.currentTool.value).toBe('highlighter')
    })

    it('key 3 selects arrow', () => {
      handler(key('3'))
      expect(ctx.currentTool.value).toBe('arrow')
      expect(actions.calls.showCrosshairTip).toHaveLength(1)
    })

    it('key 4 selects rect', () => {
      handler(key('4'))
      expect(ctx.currentTool.value).toBe('rect')
      expect(actions.calls.showCrosshairTip).toHaveLength(1)
    })

    it('key 5 selects ellipse', () => {
      handler(key('5'))
      expect(ctx.currentTool.value).toBe('ellipse')
      expect(actions.calls.showCrosshairTip).toHaveLength(1)
    })

    it('key 6 selects line', () => {
      handler(key('6'))
      expect(ctx.currentTool.value).toBe('line')
      expect(actions.calls.showCrosshairTip).toHaveLength(1)
    })

    it('key 1 selects pen and shows pen tip', () => {
      ctx.currentTool.value = 'highlighter'
      handler(key('1'))
      expect(ctx.currentTool.value).toBe('pen')
      expect(actions.calls.showPenTip).toHaveLength(1)
      expect(actions.calls.showToolTip).toHaveLength(0)
      expect(actions.calls.cyclePenCursorStyle).toHaveLength(0)
    })

    it('key 1 while on pen cycles pen cursor style', () => {
      ctx.currentTool.value = 'pen'
      handler(key('1'))
      expect(ctx.currentTool.value).toBe('pen')
      expect(actions.calls.cyclePenCursorStyle).toHaveLength(1)
      expect(actions.calls.showPenTip).toHaveLength(0)
      expect(actions.calls.showToolTip).toHaveLength(0)
    })

    it('key 3 while on arrow cycles crosshair cursor style', () => {
      ctx.currentTool.value = 'arrow'
      handler(key('3'))
      expect(ctx.currentTool.value).toBe('arrow')
      expect(actions.calls.cycleCrosshairCursorStyle).toHaveLength(1)
      expect(actions.calls.showCrosshairTip).toHaveLength(0)
      expect(actions.calls.showToolTip).toHaveLength(0)
    })

    it('key 8 while on laser cycles crosshair cursor style', () => {
      ctx.currentTool.value = 'laser'
      handler(key('8'))
      expect(actions.calls.cycleCrosshairCursorStyle).toHaveLength(1)
    })

    it('key 7 selects eraser and shows eraser tip', () => {
      handler(key('7'))
      expect(ctx.currentTool.value).toBe('eraser')
      expect(actions.calls.showEraserTip).toHaveLength(1)
      expect(actions.calls.showToolTip).toHaveLength(0)
      expect(actions.calls.cycleEraserMode).toHaveLength(0)
    })

    it('key 7 while on eraser cycles eraser mode', () => {
      ctx.currentTool.value = 'eraser'
      handler(key('7'))
      expect(ctx.currentTool.value).toBe('eraser')
      expect(actions.calls.cycleEraserMode).toHaveLength(1)
      expect(actions.calls.showEraserTip).toHaveLength(0)
      expect(actions.calls.showToolTip).toHaveLength(0)
    })

    it('key 7 while erasing does not cycle mid-stroke', () => {
      ctx.currentTool.value = 'eraser'
      ctx.isDrawing.value = true
      handler(key('7'))
      expect(actions.calls.cycleEraserMode).toHaveLength(0)
      expect(ctx.currentTool.value).toBe('eraser')
    })

    it('ignores tool keys while a stroke is active', () => {
      ctx.currentTool.value = 'pen'
      ctx.isDrawing.value = true
      handler(key('2'))
      handler(key('t'))
      handler(key('n'))
      expect(ctx.currentTool.value).toBe('pen')
      expect(actions.calls.showToolTip).toHaveLength(0)
      expect(actions.calls.showStampTip).toHaveLength(0)
      expect(actions.calls.cycleStampKind).toHaveLength(0)
    })

    it('key 8 selects laser', () => {
      handler(key('8'))
      expect(ctx.currentTool.value).toBe('laser')
      expect(actions.calls.showCrosshairTip).toHaveLength(1)
      expect(actions.calls.showToolTip).toHaveLength(0)
    })

    it('key T selects text', () => {
      handler(key('t'))
      expect(ctx.currentTool.value).toBe('text')
      expect(actions.calls.showToolTip[0]).toEqual(['text'])
    })

    it('key V selects select tool', () => {
      handler(key('v'))
      expect(ctx.currentTool.value).toBe('select')
      expect(actions.calls.showToolTip[0]).toEqual(['select'])
    })

    it('ignores V while drawing', () => {
      ctx.isDrawing.value = true
      handler(key('v'))
      expect(ctx.currentTool.value).toBe('pen')
      expect(actions.calls.showToolTip).toHaveLength(0)
    })

    it('key N selects stamp and shows stamp tip', () => {
      handler(key('n'))
      expect(ctx.currentTool.value).toBe('stamp')
      expect(actions.calls.showStampTip).toHaveLength(1)
    })

    it('key N while on stamp cycles stamp kind', () => {
      ctx.currentTool.value = 'stamp'
      handler(key('N'))
      expect(ctx.currentTool.value).toBe('stamp')
      expect(actions.calls.cycleStampKind).toHaveLength(1)
      expect(actions.calls.showStampTip).toHaveLength(0)
    })

    it('Shift+N resets stamp counter and selects stamp', () => {
      handler(key('n', { shiftKey: true }))
      expect(ctx.currentTool.value).toBe('stamp')
      expect(actions.calls.resetStampCounter).toHaveLength(1)
      expect(actions.calls.cycleStampKind).toHaveLength(0)
    })

    it('ignores N / Shift+N when Ctrl or Meta is held', () => {
      handler(key('n', { ctrlKey: true }))
      handler(key('n', { metaKey: true, shiftKey: true }))
      expect(ctx.currentTool.value).toBe('pen')
      expect(actions.calls.showStampTip).toHaveLength(0)
      expect(actions.calls.resetStampCounter).toHaveLength(0)
    })

    it('tool switch keeps toolbar popup open', () => {
      ctx.showToolbarPopup.value = true
      handler(key('3'))
      expect(ctx.showToolbarPopup.value).toBe(true)
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

    // macOS WKWebView: Cmd+Shift+Z often reports lowercase 'z' with shiftKey set
    it('Mod+Shift+z (lowercase key) triggers redo, not undo', () => {
      handler(key('z', { ctrlKey: true, shiftKey: true }))
      expect(actions.calls.redo).toHaveLength(1)
      expect(actions.calls.undo).toHaveLength(0)
    })

    it('does not undo/redo when toolbar popup is open', () => {
      ctx.showToolbarPopup.value = true
      handler(key('z', { ctrlKey: true }))
      expect(actions.calls.undo).toHaveLength(0)
    })
  })

  describe('clear and exit', () => {
    it('Escape exits drawing', () => {
      handler(key('Escape'))
      expect(actions.calls.exitDrawing).toHaveLength(1)
    })

    it('Escape clears selection before exiting', () => {
      actions.hasSelection = () => true
      handler(key('Escape'))
      expect(actions.calls.clearSelection).toHaveLength(1)
      expect(actions.calls.exitDrawing).toHaveLength(0)
    })

    it('Delete removes selection when present', () => {
      actions.hasSelection = () => true
      handler(key('Delete'))
      expect(actions.calls.removeSelected).toHaveLength(1)
    })

    it('Backspace removes selection when present', () => {
      actions.hasSelection = () => true
      handler(key('Backspace'))
      expect(actions.calls.removeSelected).toHaveLength(1)
    })

    it('Delete does nothing without selection', () => {
      handler(key('Delete'))
      expect(actions.calls.removeSelected).toHaveLength(0)
    })

    it('X toggles penetration mode', () => {
      handler(key('x'))
      expect(actions.calls.togglePenetrationMode).toHaveLength(1)
    })

    it('X does not toggle penetration mode in whiteboard mode', () => {
      ctx.whiteboardMode.value = true
      handler(key('x'))
      expect(actions.calls.togglePenetrationMode).toHaveLength(0)
    })

    it('Escape exits whiteboard mode when active', () => {
      ctx.whiteboardMode.value = true
      handler(key('Escape'))
      expect(actions.calls.exitWhiteboardMode).toHaveLength(1)
      expect(actions.calls.exitDrawing).toHaveLength(0)
    })

    it('does not exit when toolbar popup is open', () => {
      ctx.showToolbarPopup.value = true
      handler(key('Escape'))
      expect(actions.calls.togglePenetrationMode).toHaveLength(0)
      expect(actions.calls.exitDrawing).toHaveLength(0)
      expect(actions.calls.exitWhiteboardMode).toHaveLength(0)
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

  describe('space toggles toolbar popup', () => {
    it('space toggles toolbar popup', () => {
      handler(key(' '))
      expect(actions.calls.toggleToolbarPopupVisible).toHaveLength(1)
    })

    it('space does nothing when toolbar is pinned', () => {
      ;(ctx.toolbarPinned as Ref<boolean>).value = true
      handler(key(' '))
      expect(actions.calls.toggleToolbarPopupVisible).toHaveLength(0)
    })

    it('space updates mousePos from lastPointer', () => {
      handler(key(' '))
      expect(ctx.mousePos.value).toEqual({ x: 200, y: 200 })
    })
  })

  describe('copy screen', () => {
    it('Ctrl+C triggers copy after physical modifier press while pointer idle', () => {
      copyChord(handler)
      expect(actions.calls.copyScreen).toHaveLength(1)
    })

    it('C with ctrlKey but no prior modifier keydown does not copy (issue #22)', () => {
      handler(key('c', { ctrlKey: true }))
      expect(actions.calls.copyScreen).toHaveLength(0)
    })

    it('Ctrl+C works even when toolbar popup is open (before popup check)', () => {
      ctx.showToolbarPopup.value = true
      copyChord(handler)
      expect(actions.calls.copyScreen).toHaveLength(1)
    })

    it('does not copy during pointer gesture even if modifier was pressed before', () => {
      handler(key('Control'))
      invalidateCopyModifierForPointerInteraction()
      handler(key('c', { ctrlKey: true }))
      expect(actions.calls.copyScreen).toHaveLength(0)
    })

    it('does not copy while drawing is active', () => {
      ctx.isDrawing.value = true
      copyChord(handler)
      expect(actions.calls.copyScreen).toHaveLength(0)
    })

    it('can copy immediately after pointer up once modifier is pressed again', () => {
      handler(key('Control'))
      invalidateCopyModifierForPointerInteraction()
      markPointerInteractionEnded()
      handler(key('Control'))
      handler(key('c', { ctrlKey: true }))
      expect(actions.calls.copyScreen).toHaveLength(1)
    })

    it('does not copy after pointer up if modifier still held from before draw', () => {
      handler(key('Control'))
      invalidateCopyModifierForPointerInteraction()
      markPointerInteractionEnded()
      handler(key('c', { ctrlKey: true }))
      expect(actions.calls.copyScreen).toHaveLength(0)
    })
  })

  describe('whiteboard copy', () => {
    it('Ctrl+C copies whiteboard when whiteboard mode is active', () => {
      ctx.whiteboardMode.value = true
      copyChord(handler)
      expect(actions.calls.copyWhiteboard).toHaveLength(1)
      expect(actions.calls.copyScreen).toHaveLength(0)
    })
  })

  describe('whiteboard mode', () => {
    it('W enters whiteboard mode', () => {
      handler(key('w'))
      expect(actions.calls.enterWhiteboardMode).toHaveLength(1)
    })

    it('W exits whiteboard mode when already active', () => {
      ctx.whiteboardMode.value = true
      handler(key('w'))
      expect(actions.calls.exitWhiteboardMode).toHaveLength(1)
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

    it('Space closes quick colors and opens toolbar popup', () => {
      handler(key(' '))
      expect(ctx.showQuickColors.value).toBe(false)
      expect(actions.calls.toggleToolbarPopupVisible).toHaveLength(1)
    })

    it('Ctrl+C copies screen in quick color mode when pointer idle', () => {
      copyChord(handler)
      expect(actions.calls.copyScreen).toHaveLength(1)
    })

    it('spurious C with ctrlKey only does not copy in quick color mode', () => {
      handler(key('c', { ctrlKey: true }))
      expect(actions.calls.copyScreen).toHaveLength(0)
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

    it('allows Ctrl+C after a no-op pointer gesture ends (text-tool click)', () => {
      ctx.textBoxPos.value = null
      invalidateCopyModifierForPointerInteraction()
      handler(key('Control', { ctrlKey: true }))
      handler(key('c', { ctrlKey: true }))
      expect(actions.calls.copyScreen).toHaveLength(0)
      markPointerInteractionEnded()
      handler(key('Control', { ctrlKey: true }))
      handler(key('c', { ctrlKey: true }))
      expect(actions.calls.copyScreen).toHaveLength(1)
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

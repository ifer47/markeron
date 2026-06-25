import type { Ref } from 'vue'
import type { Tool } from './drawingTypes'
import { isMacOS } from '../utils/platform'

const TOOL_KEYS: Tool[] = ['pen', 'highlighter', 'arrow', 'rect', 'ellipse', 'line', 'eraser']

export interface KeyboardContext {
  active: Ref<boolean>
  showSettings: Ref<boolean>
  showQuickColors: Ref<boolean>
  quickColorsPos: Ref<{ x: number; y: number }>
  textBoxPos: Ref<{ x: number; y: number } | null>
  currentTool: Ref<Tool>
  isDrawing: Ref<boolean>
  lastPointerX: () => number
  lastPointerY: () => number
  mousePos: Ref<{ x: number; y: number }>
}

export interface KeyboardActions {
  cycleColor: (direction: number) => void
  showToolTip: (tool: Tool) => void
  undo: () => void
  redo: () => void
  clearAll: () => void
  exitDrawing: () => void
  copyScreen: () => void
  setSettingsVisible: (visible: boolean) => void
  toggleSettingsVisible: () => void
  commitCurrentTextBox: (cancel?: boolean) => void
}

function modDown(e: KeyboardEvent): boolean {
  return e.ctrlKey || (isMacOS() && e.metaKey)
}

export function createKeyDownHandler(ctx: KeyboardContext, actions: KeyboardActions) {
  return function onKeyDown(e: KeyboardEvent) {
    if (!ctx.active.value) return

    // Prevent Alt key from triggering system menu focus
    if (e.key === 'Alt') {
      e.preventDefault()
    }

    // Quick color palette mode
    if (ctx.showQuickColors.value) {
      if (modDown(e) && !e.shiftKey && (e.key === 'c' || e.key === 'C')) {
        e.preventDefault()
        actions.copyScreen()
      } else if (e.key === 'Escape') {
        ctx.showQuickColors.value = false
      } else if (e.key === 'q' || e.key === 'Q') {
        actions.cycleColor(-1)
      } else if (e.key === 'e' || e.key === 'E') {
        actions.cycleColor(1)
      } else if (e.key === ' ') {
        e.preventDefault()
        ctx.mousePos.value = { ...ctx.quickColorsPos.value }
        ctx.showQuickColors.value = false
        actions.toggleSettingsVisible()
      }
      return
    }

    // Text box mode
    if (ctx.textBoxPos.value) {
      if (e.key === 'Escape') {
        actions.commitCurrentTextBox(true)
      }
      return
    }

    // Settings panel toggle
    if (e.key === ' ') {
      e.preventDefault()
      ctx.mousePos.value = { x: ctx.lastPointerX(), y: ctx.lastPointerY() }
      actions.toggleSettingsVisible()
      return
    }

    // Color cycling
    if (e.key === 'q' || e.key === 'Q') {
      actions.cycleColor(-1)
      return
    }
    if (e.key === 'e' || e.key === 'E') {
      actions.cycleColor(1)
      return
    }

    // Text tool
    if (e.key === 't' || e.key === 'T') {
      ctx.currentTool.value = 'text'
      actions.showToolTip('text')
      actions.setSettingsVisible(false)
      return
    }

    // Tool switching (1-7)
    if (e.key >= '1' && e.key <= '7') {
      const tool = TOOL_KEYS[parseInt(e.key) - 1]
      ctx.currentTool.value = tool
      actions.showToolTip(tool)
      actions.setSettingsVisible(false)
      return
    }

    // Copy screen
    if (modDown(e) && !e.shiftKey && (e.key === 'c' || e.key === 'C')) {
      e.preventDefault()
      actions.copyScreen()
      return
    }

    // Don't process edit shortcuts when settings panel is open
    if (ctx.showSettings.value) return

    // Undo/Redo/Clear/Exit
    if (modDown(e) && e.shiftKey && e.key === 'Z') {
      e.preventDefault()
      actions.redo()
    } else if (modDown(e) && e.key === 'z') {
      e.preventDefault()
      actions.undo()
    } else if (modDown(e) && e.key === 'y') {
      e.preventDefault()
      actions.redo()
    } else if (e.key === 'Delete') {
      actions.clearAll()
    } else if (e.key === 'Escape') {
      actions.exitDrawing()
    }
  }
}

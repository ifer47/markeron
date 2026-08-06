import type { Ref, ComputedRef } from 'vue'
import type { Tool } from './drawingTypes'
import { isMacOS } from '../utils/platform'
import { logActionEvent } from '../utils/diagnosticEvents'

const TOOL_KEYS: Tool[] = ['pen', 'highlighter', 'arrow', 'rect', 'ellipse', 'line', 'eraser', 'laser']

/** True while pointer is down for draw/drag — modifier keys serve drawing, not copy. */
let pointerGestureActive = false

/**
 * True only after a physical Meta/Control keydown while the pointer is idle.
 * Spurious macOS Mod+C after pen-up sends C with metaKey but no prior Meta keydown (issue #22).
 */
let copyModifierPhysicallyDown = false

export interface KeyboardContext {
  active: Ref<boolean>
  showToolbarPopup: Ref<boolean>
  toolbarPinned: Ref<boolean> | ComputedRef<boolean>
  showQuickColors: Ref<boolean>
  quickColorsPos: Ref<{ x: number; y: number }>
  textBoxPos: Ref<{ x: number; y: number } | null>
  currentTool: Ref<Tool>
  whiteboardMode: Ref<boolean>
  isDrawing: Ref<boolean>
  lastPointerX: () => number
  lastPointerY: () => number
  mousePos: Ref<{ x: number; y: number }>
}

export interface KeyboardActions {
  cycleColor: (direction: number) => void
  showToolTip: (tool: Tool) => void
  showStampTip?: () => void
  cycleStampKind?: () => void
  resetStampCounter?: () => void
  /** Press 7 again while eraser is selected: stroke ↔ object. */
  cycleEraserMode?: () => void
  /** Tip for eraser including current mode (first select). */
  showEraserTip?: () => void
  undo: () => void
  redo: () => void
  exitDrawing: () => void
  togglePenetrationMode: () => void
  enterWhiteboardMode: () => void
  exitWhiteboardMode: () => void
  copyScreen: () => void
  copyWhiteboard: () => void
  toggleToolbarPopupVisible: () => void
  commitCurrentTextBox: (cancel?: boolean) => void
}

function modDown(e: KeyboardEvent): boolean {
  return e.ctrlKey || (isMacOS() && e.metaKey)
}

/** Mod+C without Shift — used when the toolbar window has OS focus (overlay never sees the chord). */
export function isCopyShortcut(e: KeyboardEvent): boolean {
  if (!modDown(e) || e.shiftKey) return false
  return e.key === 'c' || e.key === 'C'
}

export function trackCopyModifierKeyDown(e: KeyboardEvent): void {
  if ((e.key === 'Control' || e.key === 'Meta') && !pointerGestureActive) {
    copyModifierPhysicallyDown = true
  }
}

export function trackCopyModifierKeyUp(e: KeyboardEvent): void {
  if (e.key === 'Control' || e.key === 'Meta') {
    copyModifierPhysicallyDown = false
  }
}

export function resetCopyModifierState(): void {
  copyModifierPhysicallyDown = false
  pointerGestureActive = false
}

/** Pointer down: modifier keys are reserved for draw/drag until pointer up. */
export function invalidateCopyModifierForPointerInteraction(): void {
  copyModifierPhysicallyDown = false
  pointerGestureActive = true
}

/** Pointer up: gesture ends; copy modifier must be freshly pressed (no timer). */
export function markPointerInteractionEnded(): void {
  pointerGestureActive = false
}

/** For tests: read whether copy modifier is considered physically held. */
export function isCopyModifierPhysicallyDown(): boolean {
  return copyModifierPhysicallyDown
}

/** For tests: read pointer gesture state. */
export function isPointerGestureActive(): boolean {
  return pointerGestureActive
}

function shouldTriggerKeyboardCopy(e: KeyboardEvent, ctx: KeyboardContext): boolean {
  if (ctx.isDrawing.value || pointerGestureActive) return false
  if (!isCopyShortcut(e)) return false
  return copyModifierPhysicallyDown
}

function triggerKeyboardCopy(ctx: KeyboardContext, actions: KeyboardActions): void {
  if (ctx.whiteboardMode.value) {
    actions.copyWhiteboard()
  } else {
    actions.copyScreen()
  }
}

export function createKeyDownHandler(ctx: KeyboardContext, actions: KeyboardActions) {
  return function onKeyDown(e: KeyboardEvent) {
    if (!ctx.active.value) return

    trackCopyModifierKeyDown(e)

    // Prevent Alt key from triggering system menu focus
    if (e.key === 'Alt') {
      e.preventDefault()
    }

    // Quick color palette mode
    if (ctx.showQuickColors.value) {
      if (shouldTriggerKeyboardCopy(e, ctx)) {
        e.preventDefault()
        actions.copyScreen()
      } else if (e.key === 'Escape') {
        logActionEvent('quick colors closed', { reason: 'keyboard' })
        ctx.showQuickColors.value = false
      } else if (e.key === 'q' || e.key === 'Q') {
        logActionEvent('color cycled', { reason: 'keyboard', direction: -1, context: 'quick-colors' })
        actions.cycleColor(-1)
      } else if (e.key === 'e' || e.key === 'E') {
        logActionEvent('color cycled', { reason: 'keyboard', direction: 1, context: 'quick-colors' })
        actions.cycleColor(1)
      } else if (e.key === ' ') {
        e.preventDefault()
        logActionEvent('toolbar popup toggled', { reason: 'keyboard', context: 'quick-colors' })
        ctx.mousePos.value = { ...ctx.quickColorsPos.value }
        ctx.showQuickColors.value = false
        actions.toggleToolbarPopupVisible()
      }
      return
    }

    // Text box mode
    if (ctx.textBoxPos.value) {
      if (e.key === 'Escape') {
        logActionEvent('text box cancelled', { reason: 'keyboard' })
        actions.commitCurrentTextBox(true)
      }
      return
    }

    // Toolbar popup toggle (Space) — skipped when toolbar is pinned always-on
    if (e.key === ' ') {
      if (ctx.toolbarPinned.value) return
      e.preventDefault()
      logActionEvent('toolbar popup toggled', { reason: 'keyboard' })
      ctx.mousePos.value = { x: ctx.lastPointerX(), y: ctx.lastPointerY() }
      actions.toggleToolbarPopupVisible()
      return
    }

    // Color cycling
    if (e.key === 'q' || e.key === 'Q') {
      logActionEvent('color cycled', { reason: 'keyboard', direction: -1 })
      actions.cycleColor(-1)
      return
    }
    if (e.key === 'e' || e.key === 'E') {
      logActionEvent('color cycled', { reason: 'keyboard', direction: 1 })
      actions.cycleColor(1)
      return
    }

    // Text tool
    if (e.key === 't' || e.key === 'T') {
      if (ctx.isDrawing.value) return
      logActionEvent('tool selected', { reason: 'keyboard', tool: 'text' })
      ctx.currentTool.value = 'text'
      actions.showToolTip('text')
      return
    }

    // Stamp tool — N selects; N again cycles number ↔ letter; Shift+N resets active counter.
    // Ignore Ctrl/Meta so we don't steal OS chords (⌘N / ⌘⇧N on macOS, Ctrl+N elsewhere).
    if ((e.key === 'n' || e.key === 'N') && !e.ctrlKey && !e.metaKey) {
      if (ctx.isDrawing.value) return
      if (e.shiftKey) {
        e.preventDefault()
        logActionEvent('stamp counter reset', { reason: 'keyboard' })
        ctx.currentTool.value = 'stamp'
        actions.resetStampCounter?.()
        return
      }
      if (ctx.currentTool.value === 'stamp') {
        logActionEvent('stamp kind cycled', { reason: 'keyboard' })
        actions.cycleStampKind?.()
      } else {
        logActionEvent('tool selected', { reason: 'keyboard', tool: 'stamp' })
        ctx.currentTool.value = 'stamp'
        actions.showStampTip?.()
      }
      return
    }

    // Tool switching (1-8). Eraser: press 7 again to cycle stroke ↔ object (like N on stamp).
    // Ignore all tool changes while a stroke is active — action.tool is fixed at pointer-down.
    if (e.key >= '1' && e.key <= '8') {
      if (ctx.isDrawing.value) return
      const tool = TOOL_KEYS[parseInt(e.key) - 1]
      if (tool === 'eraser' && ctx.currentTool.value === 'eraser') {
        actions.cycleEraserMode?.()
        return
      }
      logActionEvent('tool selected', { reason: 'keyboard', tool, key: e.key })
      ctx.currentTool.value = tool
      if (tool === 'eraser' && actions.showEraserTip) {
        actions.showEraserTip()
      } else {
        actions.showToolTip(tool)
      }
      return
    }

    // Whiteboard mode toggle
    if (e.key === 'w' || e.key === 'W') {
      if (ctx.whiteboardMode.value) {
        logActionEvent('whiteboard exit requested', { reason: 'keyboard' })
        actions.exitWhiteboardMode()
      } else {
        logActionEvent('whiteboard enter requested', { reason: 'keyboard' })
        actions.enterWhiteboardMode()
      }
      return
    }

    // Click-through (penetration) mode toggle — X (pairs with Ctrl+Shift+X); not in whiteboard
    if ((e.key === 'x' || e.key === 'X') && !modDown(e)) {
      if (ctx.whiteboardMode.value) return
      logActionEvent('toggle penetration requested', { reason: 'keyboard' })
      actions.togglePenetrationMode()
      return
    }

    // Copy: idle pointer + physical Mod keydown before C (issue #22)
    if (shouldTriggerKeyboardCopy(e, ctx)) {
      e.preventDefault()
      triggerKeyboardCopy(ctx, actions)
      return
    }

    // Don't process edit shortcuts when toolbar popup is open (space mode)
    if (ctx.showToolbarPopup.value && !ctx.toolbarPinned.value) return

    // Undo/Redo/Clear/Exit
    // macOS WKWebView often reports Cmd+Shift+Z as key 'z' (lowercase) even with shiftKey;
    // require !shiftKey on undo so Mod+Shift+Z never falls through as undo.
    const keyZ = e.key === 'z' || e.key === 'Z'
    const keyY = e.key === 'y' || e.key === 'Y'
    if (modDown(e) && e.shiftKey && keyZ) {
      e.preventDefault()
      logActionEvent('redo', { reason: 'keyboard', shortcut: 'mod+shift+z' })
      actions.redo()
    } else if (modDown(e) && !e.shiftKey && keyZ) {
      e.preventDefault()
      logActionEvent('undo', { reason: 'keyboard', shortcut: 'mod+z' })
      actions.undo()
    } else if (modDown(e) && !e.shiftKey && keyY) {
      e.preventDefault()
      logActionEvent('redo', { reason: 'keyboard', shortcut: 'mod+y' })
      actions.redo()
    } else if (e.key === 'Escape') {
      if (ctx.whiteboardMode.value) {
        logActionEvent('whiteboard exit requested', { reason: 'keyboard', shortcut: 'escape' })
        actions.exitWhiteboardMode()
      } else {
        logActionEvent('exit drawing requested', { reason: 'keyboard', shortcut: 'escape' })
        actions.exitDrawing()
      }
    }
  }
}

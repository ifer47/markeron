import type { Ref, ComputedRef } from 'vue'
import type { Tool } from './drawingTypes'
import { isMacOS } from '../utils/platform'
import { usesCrosshairCursor } from '../utils/crosshairCursor'
import { logActionEvent } from '../utils/diagnosticEvents'
import { EMPTY_SELECT_ALL_PRESS, noteSelectAllPress, type SelectAllPressState } from '../utils/selectAllDoublePress'

const TOOL_KEYS: Tool[] = ['pen', 'highlighter', 'arrow', 'rect', 'ellipse', 'line', 'eraser', 'laser']

/** True while pointer is down for draw/drag — modifier keys serve drawing, not copy/paste. */
let pointerGestureActive = false

/**
 * True only after a physical Meta/Control keydown while the pointer is idle.
 * Spurious macOS Mod+C after pen-up sends C with metaKey but no prior Meta keydown (issue #22).
 * The same guard gates Mod+V so a stray paste cannot follow pen-up either.
 */
let modifierPhysicallyDown = false

/** Plain V double-press → select every annotation. */
let selectAllPress: SelectAllPressState = { ...EMPTY_SELECT_ALL_PRESS }

export interface KeyboardContext {
  active: Ref<boolean>
  /** Click-through sub-state of a live session (Ctrl+Shift+X). */
  penetrationMode: Ref<boolean>
  /** Ink is kept on screen as a click-through layer (annotation already exited). */
  preservedMode: Ref<boolean>
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
  /** Press 1 again while pen is selected: pen icon ↔ dot. */
  cyclePenCursorStyle?: () => void
  /** Tip for pen including current cursor style (first select). */
  showPenTip?: () => void
  /** Re-press shape/laser key: crosshair ↔ dot. */
  cycleCrosshairCursorStyle?: () => void
  /** Tip for shape/laser including current crosshair style. */
  showCrosshairTip?: () => void
  /** Cycle solid → dashed → dotted (D) or reverse (Shift+D). */
  cycleShapeDash?: (direction: 1 | -1) => void
  /** Arrow-key nudge of the current selection (Shift = 10px). */
  nudgeSelected?: (dx: number, dy: number) => boolean
  /** Double-press V: select all, or clear when everything is selected. */
  selectAll?: () => void
  undo: () => void
  redo: () => void
  removeSelected?: () => void
  hasSelection?: () => boolean
  clearSelection?: () => void
  exitDrawing: () => void
  togglePenetrationMode: () => void
  enterWhiteboardMode: () => void
  exitWhiteboardMode: () => void
  copyScreen: () => void
  copyWhiteboard: () => void
  /** Copy the current selection into the vector clipboard; returns how many actions were copied. */
  copySelection?: () => number
  /** Paste the vector clipboard (already offset + selected by the drawing layer). */
  paste?: () => void
  toggleToolbarPopupVisible: () => void
  commitCurrentTextBox: (cancel?: boolean) => void
}

function modDown(e: KeyboardEvent): boolean {
  return e.ctrlKey || (isMacOS() && e.metaKey)
}

/** Unit arrow-key nudge vectors. */
const ARROW_NUDGE: Record<string, readonly [number, number] | undefined> = {
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
}

/** Mod+C without Shift — used when the toolbar window has OS focus (overlay never sees the chord). */
export function isCopyShortcut(e: KeyboardEvent): boolean {
  if (!modDown(e) || e.shiftKey) return false
  return e.key === 'c' || e.key === 'C'
}

/** Mod+V without Shift/Alt — Alt is left to OS-level "paste special" chords. */
export function isPasteShortcut(e: KeyboardEvent): boolean {
  if (!modDown(e) || e.shiftKey || e.altKey) return false
  return e.key === 'v' || e.key === 'V'
}

export function trackCopyModifierKeyDown(e: KeyboardEvent): void {
  if ((e.key === 'Control' || e.key === 'Meta') && !pointerGestureActive) {
    modifierPhysicallyDown = true
  }
}

export function trackCopyModifierKeyUp(e: KeyboardEvent): void {
  if (e.key === 'Control' || e.key === 'Meta') {
    modifierPhysicallyDown = false
  }
}

export function resetCopyModifierState(): void {
  modifierPhysicallyDown = false
  pointerGestureActive = false
  selectAllPress = { ...EMPTY_SELECT_ALL_PRESS }
}

/** For tests: clear the V double-press timer. */
export function resetSelectAllPress(): void {
  selectAllPress = { ...EMPTY_SELECT_ALL_PRESS }
}

/** Pointer down: modifier keys are reserved for draw/drag until pointer up. */
export function invalidateCopyModifierForPointerInteraction(): void {
  modifierPhysicallyDown = false
  pointerGestureActive = true
  // A pointer gesture between two V presses means the user is not double-pressing.
  selectAllPress = { ...EMPTY_SELECT_ALL_PRESS }
}

/** Pointer up: gesture ends; copy modifier must be freshly pressed (no timer). */
export function markPointerInteractionEnded(): void {
  pointerGestureActive = false
}

/** For tests: read whether copy modifier is considered physically held. */
export function isCopyModifierPhysicallyDown(): boolean {
  return modifierPhysicallyDown
}

/** For tests: read pointer gesture state. */
export function isPointerGestureActive(): boolean {
  return pointerGestureActive
}

function shouldTriggerKeyboardCopy(e: KeyboardEvent, ctx: KeyboardContext): boolean {
  if (ctx.isDrawing.value || pointerGestureActive) return false
  if (!isCopyShortcut(e)) return false
  return modifierPhysicallyDown
}

function triggerKeyboardCopy(ctx: KeyboardContext, actions: KeyboardActions): void {
  // A selection wins over the canvas: Mod+C on selected objects copies vectors
  // (so they can be pasted 1:1), not a bitmap of the whole screen.
  if ((actions.copySelection?.() ?? 0) > 0) return
  if (ctx.whiteboardMode.value) {
    actions.copyWhiteboard()
  } else {
    actions.copyScreen()
  }
}

function shouldTriggerKeyboardPaste(e: KeyboardEvent, ctx: KeyboardContext): boolean {
  if (ctx.isDrawing.value || pointerGestureActive) return false
  if (!isPasteShortcut(e)) return false
  return modifierPhysicallyDown
}

export function createKeyDownHandler(ctx: KeyboardContext, actions: KeyboardActions) {
  return function onKeyDown(e: KeyboardEvent) {
    if (!ctx.active.value) {
      // Click-through is still part of the session, so Esc only unwinds one level:
      // penetration → drawing (a second press then exits annotation). This runs only while
      // MarkerOn owns the keyboard — once the user clicks an app below, Esc belongs to it.
      if (ctx.penetrationMode.value && e.key === 'Escape' && !e.repeat) {
        e.preventDefault()
        logActionEvent('penetration exited', { reason: 'keyboard', shortcut: 'escape' })
        actions.togglePenetrationMode()
      } else if (ctx.preservedMode.value && e.key === 'Escape' && !e.repeat) {
        // Preserved ink is click-through, but the overlay can still own the keyboard right
        // after exiting. Esc there tucks the whole layer away (content stays in memory).
        e.preventDefault()
        logActionEvent('preserved layer dismissed', { reason: 'keyboard', shortcut: 'escape' })
        actions.exitDrawing()
      }
      return
    }

    trackCopyModifierKeyDown(e)

    // Only a plain V press can arm the double-press select-all timer. Any other
    // key, modifier chord, auto-repeat, or active stroke disarms it.
    const plainSelectAllKey =
      (e.key === 'v' || e.key === 'V') &&
      !modDown(e) &&
      !e.repeat &&
      !ctx.isDrawing.value &&
      !ctx.showQuickColors.value &&
      !ctx.textBoxPos.value
    if (!plainSelectAllKey) selectAllPress = { ...EMPTY_SELECT_ALL_PRESS }

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
        e.preventDefault()
        logActionEvent('quick colors closed', { reason: 'keyboard' })
        ctx.showQuickColors.value = false
      } else if (e.key === 'q' || e.key === 'Q') {
        e.preventDefault()
        logActionEvent('color cycled', { reason: 'keyboard', direction: -1, context: 'quick-colors' })
        actions.cycleColor(-1)
      } else if (e.key === 'e' || e.key === 'E') {
        e.preventDefault()
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
        e.preventDefault()
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
      e.preventDefault()
      logActionEvent('color cycled', { reason: 'keyboard', direction: -1 })
      actions.cycleColor(-1)
      return
    }
    if (e.key === 'e' || e.key === 'E') {
      e.preventDefault()
      logActionEvent('color cycled', { reason: 'keyboard', direction: 1 })
      actions.cycleColor(1)
      return
    }

    // Stroke dash cycle (pen, line, arrow, rect, ellipse): D forward, Shift+D reverse.
    // Ignore Ctrl/Meta so we don't steal OS chords (e.g. ⌘D / Ctrl+D).
    // Non-dashable tools no-op inside cycleShapeDash (no tip).
    if ((e.key === 'd' || e.key === 'D') && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault()
      actions.cycleShapeDash?.(e.shiftKey ? -1 : 1)
      return
    }

    // Select tool — press V again quickly to select every annotation.
    if ((e.key === 'v' || e.key === 'V') && !modDown(e)) {
      e.preventDefault()
      if (ctx.isDrawing.value || e.repeat) return
      const press = noteSelectAllPress(selectAllPress, performance.now())
      selectAllPress = press.next
      if (press.isDouble) {
        actions.selectAll?.()
        return
      }
      logActionEvent('tool selected', { reason: 'keyboard', tool: 'select' })
      ctx.currentTool.value = 'select'
      actions.showToolTip('select')
      return
    }

    // Text tool
    if (e.key === 't' || e.key === 'T') {
      e.preventDefault()
      if (ctx.isDrawing.value) return
      logActionEvent('tool selected', { reason: 'keyboard', tool: 'text' })
      ctx.currentTool.value = 'text'
      actions.showToolTip('text')
      return
    }

    // Stamp tool — N selects; N again cycles number ↔ letter; Shift+N resets active counter.
    // Ignore Ctrl/Meta so we don't steal OS chords (⌘N / ⌘⇧N on macOS, Ctrl+N elsewhere).
    if ((e.key === 'n' || e.key === 'N') && !e.ctrlKey && !e.metaKey) {
      e.preventDefault()
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

    // Tool switching (1-8). Pen/eraser/crosshair tools: re-press cycles style or mode.
    // Ignore all tool changes while a stroke is active — action.tool is fixed at pointer-down.
    if (e.key >= '1' && e.key <= '8') {
      e.preventDefault()
      if (ctx.isDrawing.value) return
      const tool = TOOL_KEYS[parseInt(e.key) - 1]
      if (tool === 'pen' && ctx.currentTool.value === 'pen') {
        actions.cyclePenCursorStyle?.()
        return
      }
      if (tool === 'eraser' && ctx.currentTool.value === 'eraser') {
        actions.cycleEraserMode?.()
        return
      }
      if (usesCrosshairCursor(tool) && ctx.currentTool.value === tool) {
        actions.cycleCrosshairCursorStyle?.()
        return
      }
      logActionEvent('tool selected', { reason: 'keyboard', tool, key: e.key })
      ctx.currentTool.value = tool
      if (tool === 'pen' && actions.showPenTip) {
        actions.showPenTip()
      } else if (tool === 'eraser' && actions.showEraserTip) {
        actions.showEraserTip()
      } else if (usesCrosshairCursor(tool) && actions.showCrosshairTip) {
        actions.showCrosshairTip()
      } else {
        actions.showToolTip(tool)
      }
      return
    }

    // Whiteboard mode toggle
    if (e.key === 'w' || e.key === 'W') {
      e.preventDefault()
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
      e.preventDefault()
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

    // Paste: same physical-modifier guard (issue #22), never mid-gesture.
    if (shouldTriggerKeyboardPaste(e, ctx)) {
      e.preventDefault()
      logActionEvent('paste requested', { reason: 'keyboard' })
      actions.paste?.()
      return
    }

    // Don't process edit shortcuts when toolbar popup is open (space mode)
    if (ctx.showToolbarPopup.value && !ctx.toolbarPinned.value) return

    // Arrow keys nudge the current selection (1px; Shift = 10px).
    const nudge = ARROW_NUDGE[e.key]
    if (nudge && !e.ctrlKey && !e.metaKey && !e.altKey) {
      if (!actions.hasSelection?.() || ctx.isDrawing.value) return
      e.preventDefault()
      const step = e.shiftKey ? 10 : 1
      if (actions.nudgeSelected?.(nudge[0] * step, nudge[1] * step)) {
        logActionEvent('selection nudged', { reason: 'keyboard', dx: nudge[0] * step, dy: nudge[1] * step })
      }
      return
    }

    // Delete / Backspace removes the current selection (select tool or leftover selection).
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault()
      if (actions.hasSelection?.()) {
        e.preventDefault()
        logActionEvent('selection deleted', { reason: 'keyboard', key: e.key })
        actions.removeSelected?.()
      }
      return
    }

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
      e.preventDefault()
      if (actions.hasSelection?.()) {
        logActionEvent('selection cleared', { reason: 'keyboard', shortcut: 'escape' })
        actions.clearSelection?.()
        return
      }
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

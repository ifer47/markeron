import type { TextOutlineStyle, Tool } from './drawingTypes'

export const OVERLAY_STATE_EVENT = 'overlay-state-sync'
export const TOOLBAR_ACTION_EVENT = 'toolbar-action'
export const OVERLAY_STATE_REQUEST_EVENT = 'overlay-state-request'
export const TOOLBAR_WINDOW_CLOSED_EVENT = 'toolbar-window-closed'
export const TOOLBAR_PANEL_HOVER_EVENT = 'toolbar-panel-hover'
export const TOOLBAR_DRAGGING_EVENT = 'toolbar-dragging'
/** Screen-space pointer position from overlay — used to probe toolbar hover across windows. */
export const OVERLAY_POINTER_SCREEN_EVENT = 'overlay-pointer-screen'
/** Raised when the pointer is released over the toolbar window (overlay may miss pointerup). */
export const TOOLBAR_POINTER_UP_EVENT = 'toolbar-pointer-up'
/** Measured standalone panel height — toolbar webview → overlay (separate JS heaps). */
export const TOOLBAR_PANEL_HEIGHT_EVENT = 'toolbar-panel-height'

export interface OverlayPointerScreen {
  x: number
  y: number
}

export interface OverlayStateSync {
  currentTool: Tool
  currentColor: string
  lineWidth: number
  textOutline: TextOutlineStyle
  whiteboardMode: boolean
  penetrationMode: boolean
  canUndo: boolean
  canRedo: boolean
  canClear: boolean
}

export type ToolbarAction =
  | { type: 'selectTool'; tool: Tool }
  | { type: 'selectColor'; color: string }
  | { type: 'updateLineWidth'; width: number }
  | { type: 'updateTextOutline'; textOutline: TextOutlineStyle }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'clearAll' }
  | { type: 'toggleWhiteboard' }
  | { type: 'copy' }
  | { type: 'copyShortcut' }
  | { type: 'paste' }
  | { type: 'togglePenetration' }
  | { type: 'togglePin' }
  | { type: 'exitDrawing' }

export function emitToolbarAction(action: ToolbarAction): void {
  void import('@tauri-apps/api/event').then(({ emit }) => emit(TOOLBAR_ACTION_EVENT, action))
}

export function emitOverlayState(state: OverlayStateSync): void {
  void import('@tauri-apps/api/event').then(({ emit }) => emit(OVERLAY_STATE_EVENT, state))
}

export function emitToolbarPanelHeight(height: number): void {
  void import('@tauri-apps/api/event').then(({ emit }) => emit(TOOLBAR_PANEL_HEIGHT_EVENT, Math.ceil(height)))
}

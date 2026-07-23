export type DragMode = 'off' | 'hover' | 'modifier'

export interface AppConfig {
  shortcuts: {
    toggleDrawing: string
    clearDrawing: string
    togglePenetration: string
  }
  general: {
    dragMode?: DragMode
    /** @deprecated Read for migration only; use dragMode */
    enableDragging?: boolean
    /** @deprecated Read for migration only; use dragMode */
    dragRequiresModifier?: boolean
    locale?: string
    preserveDrawings: boolean
    whiteboardPreserveDrawings: boolean
    angleSnapStep?: 15 | 30 | 45
    toolbarVisibility?: ToolbarVisibility
    defaultEntryMode?: DefaultEntryMode
    eraserMode?: EraserMode
    lineWidths?: {
      stroke: number
      highlighter: number
      eraser: number
      text: number
    }
    autoStart?: boolean
    theme?: 'dark' | 'light' | 'system'
  }
}

export type ToolbarVisibility = 'space' | 'always'
export type DefaultEntryMode = 'screen' | 'whiteboard'
export type EraserMode = 'stroke' | 'object'

export interface SaveResult {
  ok: boolean
  failed?: string[]
}

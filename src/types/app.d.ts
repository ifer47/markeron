export type DragMode = 'off' | 'hover' | 'modifier'

export interface ToolbarPositionConfig {
  left: number
  top: number
  coordSpace?: 'logical' | 'physical'
}

export interface AppConfig {
  configVersion?: number
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
    angleSnapStep?: number
    toolbarVisibility?: ToolbarVisibility
    defaultEntryMode?: DefaultEntryMode
    whiteboardBackground?: WhiteboardBackground
    eraserMode?: EraserMode
    laserMode?: LaserMode
    penCursorStyle?: PenCursorStyle
    crosshairCursorStyle?: CrosshairCursorStyle
    /** After one arrow/rect/ellipse/line stroke, switch back to pen. Default off. */
    autoRevertToPen?: boolean
    /**
     * 毛笔字效果: pen width follows nib speed, with a 露锋 entry and a 出锋 exit.
     * The config key predates the brush profile — it still gates both. Default on.
     */
    inkTaper?: boolean
    lineWidths?: {
      stroke: number
      highlighter: number
      eraser: number
      text: number
    }
    autoStart?: boolean
    theme?: 'dark' | 'light' | 'system'
  }
  /** Window/panel state that is not exposed as a settings toggle. */
  ui?: {
    toolbarPosition?: ToolbarPositionConfig
    toolbarWindowPosition?: ToolbarPositionConfig
  }
}

export type ToolbarVisibility = 'space' | 'always'
export type DefaultEntryMode = 'screen' | 'whiteboard'
export type WhiteboardBackground = 'white' | 'black'
export type EraserMode = 'stroke' | 'object'
export type LaserMode = 'trail' | 'writing'
export type PenCursorStyle = 'pen' | 'dot'
export type CrosshairCursorStyle = 'crosshair' | 'dot'

export interface SaveResult {
  ok: boolean
  failed?: string[]
}

export interface AppConfig {
  shortcuts: {
    toggleDrawing: string
    clearDrawing: string
  }
  general: {
    enableDragging: boolean
    locale?: string
    preserveDrawings: boolean
    whiteboardPreserveDrawings: boolean
    angleSnapStep?: 15 | 30 | 45
  }
}

export interface SaveResult {
  ok: boolean
  failed?: string[]
}

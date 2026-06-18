export interface AppConfig {
  shortcuts: {
    toggleDrawing: string
    clearDrawing: string
  }
  general: {
    enableDragging: boolean
    locale?: string
    preserveDrawings: boolean
  }
}

export interface SaveResult {
  ok: boolean
  failed?: string[]
}

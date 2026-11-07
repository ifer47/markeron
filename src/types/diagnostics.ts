export type DiagnosticLevel = 'info' | 'warn' | 'error'

export interface DiagnosticEvent {
  ts: number
  level: DiagnosticLevel
  category: string
  message: string
  detail?: Record<string, unknown>
}

export interface DiagnosticSummary {
  total: number
  errors: number
  warnings: number
  sessions: number
  actions: number
  pointers: number
  other: number
  /** Events from this process only (excludes hydrated history). */
  sinceLaunch: number
}

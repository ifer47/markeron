import { invoke } from '@tauri-apps/api/core'
import type { DiagnosticEvent, DiagnosticLevel } from '../types/diagnostics'

function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

export function logDiagnostic(
  category: string,
  message: string,
  detail?: Record<string, unknown>,
  level: DiagnosticLevel = 'info',
): void {
  if (!isTauriRuntime()) return
  const event: DiagnosticEvent = {
    ts: Date.now(),
    level,
    category,
    message,
    detail,
  }
  void invoke('append_diagnostic_event', { event }).catch(() => {})
}

export function logSessionEvent(
  message: string,
  detail?: Record<string, unknown>,
  level: DiagnosticLevel = 'info',
): void {
  logDiagnostic('session', message, detail, level)
}

export function logActionEvent(
  message: string,
  detail?: Record<string, unknown>,
  level: DiagnosticLevel = 'info',
): void {
  logDiagnostic('action', message, detail, level)
}

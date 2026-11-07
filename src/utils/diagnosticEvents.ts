import { invoke } from '@tauri-apps/api/core'
import type { DiagnosticEvent, DiagnosticLevel } from '../types/diagnostics'

const MAX_PRIORITY_EVENTS = 300
const MAX_POINTER_EVENTS = 50
const MAX_NOISE_EVENTS = 40

const priorityEvents: DiagnosticEvent[] = []
const pointerEvents: DiagnosticEvent[] = []
const noiseEvents: DiagnosticEvent[] = []

function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

function isPointerCategory(category: string): boolean {
  return category === 'pointer'
}

function isNoiseCategory(category: string): boolean {
  return category === 'console' || category === 'runtime'
}

function pushLocal(event: DiagnosticEvent): void {
  if (isPointerCategory(event.category)) {
    pointerEvents.push(event)
    if (pointerEvents.length > MAX_POINTER_EVENTS) {
      pointerEvents.splice(0, pointerEvents.length - MAX_POINTER_EVENTS)
    }
  } else if (isNoiseCategory(event.category)) {
    noiseEvents.push(event)
    if (noiseEvents.length > MAX_NOISE_EVENTS) {
      noiseEvents.splice(0, noiseEvents.length - MAX_NOISE_EVENTS)
    }
  } else {
    priorityEvents.push(event)
    if (priorityEvents.length > MAX_PRIORITY_EVENTS) {
      priorityEvents.splice(0, priorityEvents.length - MAX_PRIORITY_EVENTS)
    }
  }
}

export function logDiagnostic(
  category: string,
  message: string,
  detail?: Record<string, unknown>,
  level: DiagnosticLevel = 'info',
): void {
  const event: DiagnosticEvent = {
    ts: Date.now(),
    level,
    category,
    message,
    detail,
  }
  pushLocal(event)
  if (isTauriRuntime()) {
    void invoke('append_diagnostic_event', { event }).catch(() => {})
  }
}

export function getDiagnosticEvents(): DiagnosticEvent[] {
  return [...priorityEvents, ...pointerEvents, ...noiseEvents].sort((a, b) => a.ts - b.ts)
}

export function getDiagnosticEventCount(): number {
  return priorityEvents.length + pointerEvents.length + noiseEvents.length
}

export function clearDiagnosticEvents(): void {
  priorityEvents.length = 0
  pointerEvents.length = 0
  noiseEvents.length = 0
}

export type DiagnosticReason =
  | 'keyboard'
  | 'toolbar'
  | 'global-shortcut'
  | 'tray'
  | 'focus-loss'
  | 'activate'
  | 'unknown'

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

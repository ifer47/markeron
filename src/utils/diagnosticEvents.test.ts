/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { DiagnosticEvent } from '../types/diagnostics'

const invoke = vi.hoisted(() => vi.fn((_command: string, _args?: unknown): Promise<void> => Promise.resolve()))

vi.mock('@tauri-apps/api/core', () => ({ invoke }))

import { logActionEvent, logDiagnostic, logSessionEvent } from './diagnosticEvents'

function forwardedEvents(): DiagnosticEvent[] {
  return invoke.mock.calls.map((call) => (call[1] as { event: DiagnosticEvent }).event)
}

function enableTauriRuntime(): void {
  Object.defineProperty(window, '__TAURI_INTERNALS__', { value: {}, configurable: true })
}

describe('diagnosticEvents', () => {
  beforeEach(() => {
    invoke.mockClear()
    enableTauriRuntime()
  })

  it('forwards the event to the backend', () => {
    logDiagnostic('copy', 'copyScreen invoked', { reason: 'keyboard' })

    expect(invoke).toHaveBeenCalledTimes(1)
    const [command, args] = invoke.mock.calls[0] as [string, { event: DiagnosticEvent }]
    expect(command).toBe('append_diagnostic_event')
    expect(args.event).toMatchObject({
      category: 'copy',
      message: 'copyScreen invoked',
      level: 'info',
      detail: { reason: 'keyboard' },
    })
    expect(typeof args.event.ts).toBe('number')
  })

  it('logSessionEvent uses session category', () => {
    logSessionEvent('overlay mode changed', { from: 'hidden', to: 'drawing' })
    expect(forwardedEvents()[0]?.category).toBe('session')
  })

  it('logActionEvent uses action category', () => {
    logActionEvent('undo', { reason: 'keyboard' })
    expect(forwardedEvents()[0]?.category).toBe('action')
  })

  it('passes the requested level through', () => {
    logDiagnostic('copy', 'copy failed', undefined, 'error')
    expect(forwardedEvents()[0]?.level).toBe('error')
  })

  it('does not call the backend outside the Tauri runtime', () => {
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__
    logDiagnostic('copy', 'ignored')

    expect(invoke).not.toHaveBeenCalled()
  })
})

/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { DiagnosticEvent } from '../types/diagnostics'

const invoke = vi.hoisted(() => vi.fn((_command: string, _args?: unknown): Promise<void> => Promise.resolve()))

vi.mock('@tauri-apps/api/core', () => ({ invoke }))

function forwardedEvents(): DiagnosticEvent[] {
  return invoke.mock.calls.map((call) => (call[1] as { event: DiagnosticEvent }).event)
}

describe('installDiagnosticCapture', () => {
  beforeEach(() => {
    vi.resetModules()
    invoke.mockClear()
    Object.defineProperty(window, '__TAURI_INTERNALS__', { value: {}, configurable: true })
  })

  it('forwards console.error into diagnostic events', async () => {
    const { installDiagnosticCapture } = await import('./installDiagnosticCapture')
    installDiagnosticCapture()

    console.error('toolbar config failed', { code: 42 })

    const events = forwardedEvents()
    expect(events.some((e) => e.category === 'console' && e.level === 'error')).toBe(true)
    expect(events.some((e) => e.message.includes('toolbar config failed'))).toBe(true)
  })
})

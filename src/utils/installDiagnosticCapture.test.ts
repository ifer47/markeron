/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach, vi } from 'vitest'

describe('installDiagnosticCapture', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('forwards console.error into diagnostic events', async () => {
    const { clearDiagnosticEvents, getDiagnosticEvents } = await import('./diagnosticEvents')
    const { installDiagnosticCapture } = await import('./installDiagnosticCapture')
    clearDiagnosticEvents()
    installDiagnosticCapture()

    console.error('toolbar config failed', { code: 42 })

    const events = getDiagnosticEvents()
    expect(events.some((e) => e.category === 'console' && e.level === 'error')).toBe(true)
    expect(events.some((e) => e.message.includes('toolbar config failed'))).toBe(true)
  })
})

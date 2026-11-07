import { describe, it, expect, beforeEach } from 'vitest'
import {
  clearDiagnosticEvents,
  getDiagnosticEventCount,
  getDiagnosticEvents,
  logActionEvent,
  logDiagnostic,
  logSessionEvent,
} from './diagnosticEvents'

describe('diagnosticEvents', () => {
  beforeEach(() => {
    clearDiagnosticEvents()
  })

  it('stores and returns events', () => {
    logDiagnostic('copy', 'copyScreen invoked', { reason: 'keyboard' })
    expect(getDiagnosticEventCount()).toBe(1)
    expect(getDiagnosticEvents()[0]?.category).toBe('copy')
  })

  it('logSessionEvent uses session category', () => {
    logSessionEvent('overlay mode changed', { from: 'hidden', to: 'drawing' })
    expect(getDiagnosticEvents()[0]?.category).toBe('session')
  })

  it('logActionEvent uses action category', () => {
    logActionEvent('undo', { reason: 'keyboard' })
    expect(getDiagnosticEvents()[0]?.category).toBe('action')
  })

  it('keeps pointer ring small without dropping priority events', () => {
    for (let i = 0; i < 80; i++) {
      logDiagnostic('pointer', `stroke-${i}`)
    }
    for (let i = 0; i < 5; i++) {
      logDiagnostic('copy', `fail-${i}`, undefined, 'error')
    }
    expect(getDiagnosticEventCount()).toBe(55)
    const events = getDiagnosticEvents()
    expect(events.some((e) => e.message === 'stroke-0')).toBe(false)
    expect(events.some((e) => e.message === 'stroke-79')).toBe(true)
    expect(events.filter((e) => e.category === 'copy')).toHaveLength(5)
  })

  it('trims priority buffer independently', () => {
    for (let i = 0; i < 320; i++) {
      logDiagnostic('action', `event-${i}`)
    }
    expect(getDiagnosticEventCount()).toBe(300)
    expect(getDiagnosticEvents()[0]?.message).toBe('event-20')
  })
})

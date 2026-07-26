import { describe, expect, it } from 'vitest'
import { reconcileAutoStartState, resolveAutoStart } from './autoStart'

describe('autoStart', () => {
  it('defaults to enabled', () => {
    expect(resolveAutoStart()).toBe(true)
  })

  it('reads explicit preference', () => {
    expect(resolveAutoStart({ autoStart: false })).toBe(false)
  })

  it('keeps config when OS state is unknown', () => {
    expect(reconcileAutoStartState({ configEnabled: true, osEnabled: null })).toEqual({
      enabled: true,
      configOutOfSync: false,
    })
    expect(reconcileAutoStartState({ configEnabled: false, osEnabled: null })).toEqual({
      enabled: false,
      configOutOfSync: false,
    })
  })

  it('prefers OS state and flags config desync', () => {
    expect(reconcileAutoStartState({ configEnabled: true, osEnabled: false })).toEqual({
      enabled: false,
      configOutOfSync: true,
    })
    expect(reconcileAutoStartState({ configEnabled: false, osEnabled: true })).toEqual({
      enabled: true,
      configOutOfSync: true,
    })
  })

  it('is in sync when config matches OS', () => {
    expect(reconcileAutoStartState({ configEnabled: true, osEnabled: true })).toEqual({
      enabled: true,
      configOutOfSync: false,
    })
    expect(reconcileAutoStartState({ configEnabled: false, osEnabled: false })).toEqual({
      enabled: false,
      configOutOfSync: false,
    })
  })
})

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { resolveTheme, applyTheme, watchSystemTheme } from './useAppTheme'

const invoke = vi.fn()
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invoke(...args),
}))

function mockDocument() {
  const dataset: Record<string, string> = {}
  const style: Record<string, string> = {}
  const el = {
    dataset,
    style,
  }
  vi.stubGlobal('document', {
    documentElement: el,
  })
  return el
}

function mockMatchMedia(matchesDark: boolean) {
  const listeners: Array<(e: MediaQueryListEvent) => void> = []
  const mql = {
    matches: matchesDark,
    media: '(prefers-color-scheme: dark)',
    addEventListener: (_: string, cb: (e: MediaQueryListEvent) => void) => {
      listeners.push(cb)
    },
    removeEventListener: (_: string, cb: (e: MediaQueryListEvent) => void) => {
      const i = listeners.indexOf(cb)
      if (i >= 0) listeners.splice(i, 1)
    },
    dispatch(matches: boolean) {
      mql.matches = matches
      listeners.forEach((cb) => cb({ matches } as MediaQueryListEvent))
    },
  }
  vi.stubGlobal('matchMedia', () => mql)
  return mql
}

describe('useAppTheme', () => {
  beforeEach(() => {
    invoke.mockReset()
    invoke.mockResolvedValue(undefined)
    mockDocument()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('resolveTheme maps fixed preferences', () => {
    expect(resolveTheme('dark')).toBe('dark')
    expect(resolveTheme('light')).toBe('light')
  })

  it('resolveTheme system follows matchMedia', () => {
    mockMatchMedia(true)
    expect(resolveTheme('system')).toBe('dark')
    mockMatchMedia(false)
    expect(resolveTheme('system')).toBe('light')
  })

  it('applyTheme sets dataset and color-scheme and invokes Rust', async () => {
    mockMatchMedia(true)
    const el = mockDocument()
    const resolved = await applyTheme('light')
    expect(resolved).toBe('light')
    expect(el.dataset.theme).toBe('light')
    expect(el.style.colorScheme).toBe('light')
    expect(invoke).toHaveBeenCalledWith('apply_app_theme', { preference: 'light' })
  })

  it('watchSystemTheme re-applies when OS theme changes', async () => {
    const mql = mockMatchMedia(true)
    const el = mockDocument()
    const stop = watchSystemTheme(() => 'system')
    mql.dispatch(false)
    await Promise.resolve()
    expect(el.dataset.theme).toBe('light')
    expect(invoke).toHaveBeenCalledWith('apply_app_theme', { preference: 'system' })
    stop()
  })
})

import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))

describe('portable mode helpers', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  // Dynamic import + resetModules can be slow under full-suite load.
  it('caches successful resolvePortableMode result', { timeout: 15_000 }, async () => {
    const { invoke } = await import('@tauri-apps/api/core')
    vi.mocked(invoke).mockResolvedValue(true)

    const { resolvePortableMode, isPortableMode, isInstalledMode } = await import('./portable')
    await expect(resolvePortableMode()).resolves.toBe(true)
    await expect(resolvePortableMode()).resolves.toBe(true)
    await expect(isPortableMode()).resolves.toBe(true)
    await expect(isInstalledMode()).resolves.toBe(false)
    expect(invoke).toHaveBeenCalledTimes(1)
    expect(invoke).toHaveBeenCalledWith('is_portable')
  })

  it('returns null on failure without caching', { timeout: 15_000 }, async () => {
    const { invoke } = await import('@tauri-apps/api/core')
    vi.mocked(invoke).mockRejectedValue(new Error('no backend'))

    const { resolvePortableMode, isPortableMode, isInstalledMode } = await import('./portable')
    await expect(resolvePortableMode()).resolves.toBeNull()
    await expect(isPortableMode()).resolves.toBe(false)
    await expect(isInstalledMode()).resolves.toBe(false)
    expect(invoke).toHaveBeenCalledTimes(3)

    vi.mocked(invoke).mockResolvedValue(false)
    await expect(resolvePortableMode()).resolves.toBe(false)
    await expect(isInstalledMode()).resolves.toBe(true)
    expect(invoke).toHaveBeenCalledTimes(4)
  })
})

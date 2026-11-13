import { afterEach, describe, expect, it, vi } from 'vitest'
import { SPONSORS_REMOTE_URL, bundledSponsors, loadSponsors, normalizeSponsors } from './sponsors'

describe('normalizeSponsors', () => {
  it('keeps valid names and drops empty ones', () => {
    const result = normalizeSponsors({
      sponsors: [{ name: '  小文哥  ', plan: '  MarkerOn 支持者  ' }, { name: '   ' }, { name: '47', plan: '' }],
    })
    expect(result.sponsors).toEqual([{ name: '小文哥', plan: 'MarkerOn 支持者' }, { name: '47' }])
  })

  it('returns empty list for invalid payloads', () => {
    expect(normalizeSponsors(null).sponsors).toEqual([])
    expect(normalizeSponsors({}).sponsors).toEqual([])
    expect(normalizeSponsors({ sponsors: 'nope' }).sponsors).toEqual([])
  })

  it('exposes a non-empty bundled fallback and master raw URL', () => {
    expect(bundledSponsors.sponsors.length).toBeGreaterThan(0)
    expect(SPONSORS_REMOTE_URL).toContain('raw.githubusercontent.com/ifer47/markeron/master/')
  })
})

describe('loadSponsors', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('uses remote list when fetch succeeds', async () => {
    vi.resetModules()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ sponsors: [{ name: '远程赞助者' }] }),
      })),
    )

    const { loadSponsors: load } = await import('./sponsors')
    await expect(load()).resolves.toEqual([{ name: '远程赞助者' }])
  })

  it('falls back to bundled list when fetch fails', async () => {
    vi.resetModules()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network down')
      }),
    )

    const mod = await import('./sponsors')
    await expect(mod.loadSponsors()).resolves.toEqual(mod.bundledSponsors.sponsors)
  })
})

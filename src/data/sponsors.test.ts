import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  SPONSORS_AVATAR_REMOTE_BASE,
  SPONSORS_REMOTE_URL,
  bundledSponsors,
  normalizeSponsors,
  sponsorHue,
  sponsorMonogram,
} from './sponsors'

describe('normalizeSponsors', () => {
  it('keeps valid names and drops empty ones', () => {
    const result = normalizeSponsors({
      sponsors: [
        { name: '  测试赞助者甲  ', plan: '  MarkerOn 支持者  ' },
        { name: '   ' },
        { name: '测试赞助者乙', plan: '' },
      ],
    })
    expect(result.sponsors).toEqual([{ name: '测试赞助者甲', plan: 'MarkerOn 支持者' }, { name: '测试赞助者乙' }])
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

  it('resolves local avatar paths and rejects unsafe sources', () => {
    const result = normalizeSponsors({
      sponsors: [
        { name: '测试头像甲', avatar: ' https://example.com/a.png ' },
        { name: '测试头像乙', avatar: 'sponsors/__missing-avatar-for-test__.webp' },
        { name: '测试头像丙', avatar: 'javascript:alert(1)' },
        { name: '测试头像丁', avatar: '//evil.example/d.png' },
      ],
    })

    expect(result.sponsors[0]).toEqual({
      name: '测试头像甲',
      avatar: 'https://example.com/a.png',
      avatarUrl: 'https://example.com/a.png',
    })
    expect(result.sponsors[1].avatarUrl).toBe('/sponsors/__missing-avatar-for-test__.webp')
    expect(result.sponsors[2].avatar).toBeUndefined()
    expect(result.sponsors[2].avatarUrl).toBeUndefined()
    expect(result.sponsors[3].avatar).toBeUndefined()
  })

  it('builds a cache-busted GitHub raw URL for repo avatar filenames', () => {
    const result = normalizeSponsors({
      sponsors: [{ name: '测试远程头像', avatar: '__remote-avatar-test__.png' }],
    })

    const sponsor = result.sponsors[0]
    expect(sponsor.avatarUrl).toBeUndefined()
    expect(sponsor.avatarRemoteUrl).toContain(`${SPONSORS_AVATAR_REMOTE_BASE}__remote-avatar-test__.png?v=`)
  })

  it('builds a readable monogram and a stable hue', () => {
    expect(sponsorMonogram('47')).toBe('47')
    expect(sponsorMonogram('千里封冰')).toBe('千')
    expect(sponsorMonogram('😀abc')).toBe('😀')
    expect(sponsorMonogram('   ')).toBe('?')

    const hue = sponsorHue('千里封冰')
    expect(sponsorHue('千里封冰')).toBe(hue)
    expect(hue).toBeGreaterThanOrEqual(0)
    expect(hue).toBeLessThan(360)
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

  it('refreshSponsors bypasses the cached list', async () => {
    vi.resetModules()
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ sponsors: [{ name: '旧名单' }] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ sponsors: [{ name: '新名单' }] }),
      })
    vi.stubGlobal('fetch', fetchMock)

    const mod = await import('./sponsors')
    await expect(mod.loadSponsors()).resolves.toEqual([{ name: '旧名单' }])
    await expect(mod.refreshSponsors()).resolves.toEqual([{ name: '新名单' }])
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('refreshSponsors keeps the cached list when refresh fails', async () => {
    vi.resetModules()
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ sponsors: [{ name: '缓存名单' }] }),
      })
      .mockRejectedValueOnce(new Error('network down'))
    vi.stubGlobal('fetch', fetchMock)

    const mod = await import('./sponsors')
    await expect(mod.loadSponsors()).resolves.toEqual([{ name: '缓存名单' }])
    await expect(mod.refreshSponsors()).rejects.toThrow('network down')
    await expect(mod.loadSponsors()).resolves.toEqual([{ name: '缓存名单' }])
  })
})

import raw from './sponsors.json'

export interface SponsorEntry {
  name: string
  plan?: string
}

export interface SponsorsData {
  sponsors: SponsorEntry[]
}

/** Default branch raw URL — edit `sponsors.json` on master to update without a release. */
export const SPONSORS_REMOTE_URL = 'https://raw.githubusercontent.com/ifer47/markeron/master/src/data/sponsors.json'

/** Bundled fallback used offline / when remote fetch fails. */
export const bundledSponsors: SponsorsData = normalizeSponsors(raw)

let cachedSponsors: SponsorEntry[] | null = null
let inflight: Promise<SponsorEntry[]> | null = null

export function normalizeSponsors(data: unknown): SponsorsData {
  if (!data || typeof data !== 'object') {
    return { sponsors: [] }
  }

  const record = data as Record<string, unknown>
  if (!Array.isArray(record.sponsors)) {
    return { sponsors: [] }
  }

  const sponsors = record.sponsors
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return null
      const item = entry as Record<string, unknown>
      const name = typeof item.name === 'string' ? item.name.trim() : ''
      if (!name) return null
      const plan = typeof item.plan === 'string' ? item.plan.trim() : ''
      return plan ? { name, plan } : { name }
    })
    .filter((entry): entry is SponsorEntry => entry !== null)

  return { sponsors }
}

/**
 * Load sponsors at runtime from GitHub raw (`master`), falling back to the
 * bundled `sponsors.json` when offline or the request fails.
 */
export function loadSponsors(): Promise<SponsorEntry[]> {
  if (cachedSponsors) {
    return Promise.resolve(cachedSponsors)
  }
  if (inflight) {
    return inflight
  }

  inflight = (async () => {
    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 8000)
      const response = await fetch(SPONSORS_REMOTE_URL, {
        method: 'GET',
        cache: 'no-store',
        signal: controller.signal,
        headers: { Accept: 'application/json' },
      }).finally(() => clearTimeout(timer))

      if (!response.ok) {
        throw new Error(`sponsors fetch HTTP ${response.status}`)
      }

      const remote = normalizeSponsors(await response.json())
      if (remote.sponsors.length > 0) {
        cachedSponsors = remote.sponsors
        return cachedSponsors
      }
    } catch (error) {
      console.warn('[sponsors] remote fetch failed, using bundled list', error)
    }

    cachedSponsors = bundledSponsors.sponsors
    return cachedSponsors
  })().finally(() => {
    inflight = null
  })

  return inflight
}

/** Sync initial paint fallback. Prefer `loadSponsors()` for the live list. */
const sponsorsData = bundledSponsors
export default sponsorsData

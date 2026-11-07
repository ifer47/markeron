import raw from './sponsors.json'

export interface SponsorEntry {
  name: string
  plan?: string
}

export interface SponsorsData {
  sponsors: SponsorEntry[]
}

function normalizeSponsors(data: unknown): SponsorsData {
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

const sponsorsData = normalizeSponsors(raw)

export default sponsorsData

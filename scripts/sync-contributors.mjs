#!/usr/bin/env node
/**
 * Sync GitHub contributors into src/data/sponsors.json.
 *
 * This runs in GitHub Actions (authenticated GITHUB_TOKEN), so it does not use
 * the browser API rate limits/CORS. Existing entries keep their plan/avatar;
 * only missing human contributors are appended as `contributor`.
 */
import { readFile, writeFile } from 'node:fs/promises'

const repo = process.env.GITHUB_REPOSITORY || 'ifer47/markeron'
const token = process.env.GITHUB_TOKEN
if (!token) {
  console.error('GITHUB_TOKEN is required')
  process.exit(1)
}

const sponsorsPath = 'src/data/sponsors.json'
const response = await fetch(`https://api.github.com/repos/${repo}/contributors?per_page=100`, {
  headers: {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
  },
})

if (!response.ok) {
  console.error(`GitHub contributors API failed: HTTP ${response.status}`)
  process.exit(1)
}

const contributors = await response.json()
if (!Array.isArray(contributors)) {
  console.error('Unexpected contributors API response')
  process.exit(1)
}

const data = JSON.parse(await readFile(sponsorsPath, 'utf8'))
if (!data || !Array.isArray(data.sponsors)) {
  console.error(`${sponsorsPath} has no sponsors array`)
  process.exit(1)
}

const names = new Set(data.sponsors.map((sponsor) => String(sponsor?.name ?? '').toLowerCase()).filter(Boolean))
let added = 0

for (const contributor of contributors) {
  if (!contributor || typeof contributor !== 'object') continue
  const login = typeof contributor.login === 'string' ? contributor.login.trim() : ''
  if (!login || login.endsWith('[bot]') || contributor.type === 'Bot') continue
  if (names.has(login.toLowerCase())) continue

  const avatar = typeof contributor.avatar_url === 'string' ? contributor.avatar_url.trim() : ''
  const sponsor = { name: login, plan: 'contributor' }
  if (avatar) {
    sponsor.avatar = `${avatar}${avatar.includes('?') ? '&' : '?'}s=96`
  }

  data.sponsors.push(sponsor)
  names.add(login.toLowerCase())
  added += 1
  console.log(`+ ${login}`)
}

if (added === 0) {
  console.log('No new contributors')
  process.exit(0)
}

await writeFile(sponsorsPath, `${JSON.stringify(data, null, 2)}\n`)
console.log(`Added ${added} contributor(s)`)

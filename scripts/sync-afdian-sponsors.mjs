import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const API_SPONSOR = 'https://afdian.com/api/open/query-sponsor'
const API_ORDER = 'https://afdian.com/api/open/query-order'
const OUTPUT = join(ROOT, 'src/data/afdian-sponsors.json')
const ENV_LOCAL = join(ROOT, '.env.local')

function loadEnvLocal() {
  if (!existsSync(ENV_LOCAL)) return

  for (const line of readFileSync(ENV_LOCAL, 'utf8').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue

    const separator = trimmed.indexOf('=')
    if (separator === -1) continue

    const key = trimmed.slice(0, separator).trim()
    const value = trimmed.slice(separator + 1).trim()
    if (key && process.env[key] === undefined) {
      process.env[key] = value
    }
  }
}

/** @param {string} token @param {{ user_id: string, params: string, ts: number }} body */
export function signAfdianRequest(token, body) {
  const toSign = `${token}params${body.params}ts${body.ts}user_id${body.user_id}`
  return createHash('md5').update(toSign).digest('hex')
}

/** @param {string} userId @param {Record<string, unknown>} params */
export function buildAfdianRequest(userId, params) {
  return {
    user_id: userId,
    ts: Math.floor(Date.now() / 1000),
    params: JSON.stringify(params),
  }
}

/** @param {string} url @param {string} userId @param {string} token @param {number} page */
async function queryAfdianPage(url, userId, token, page) {
  const body = buildAfdianRequest(userId, { page })
  const signed = { ...body, sign: signAfdianRequest(token, body) }
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(signed),
  })
  return res.json()
}

/** @param {string} userId @param {string} token */
export async function querySponsorPage(userId, token, page) {
  return queryAfdianPage(API_SPONSOR, userId, token, page)
}

/** @param {string} userId @param {string} token */
export async function queryOrderPage(userId, token, page) {
  return queryAfdianPage(API_ORDER, userId, token, page)
}

/** Prefer order display name; fall back to sponsor profile name. */
/** @param {string | undefined} sponsorName @param {string | undefined} orderName */
export function resolveSponsorDisplayName(sponsorName, orderName) {
  const order = orderName?.trim() ?? ''
  if (order) return order
  return sponsorName?.trim() ?? ''
}

/** @param {string} userId @param {string} token */
export async function fetchAllAfdianSponsors(userId, token) {
  /** @type {Map<string, { name: string, amount: string, plan: string, remark: string, lastPayTime: number, nameTime: number, remarkTime: number }>} */
  const sponsors = new Map()

  let sponsorPage = 1
  let sponsorTotalPage = 1
  while (sponsorPage <= sponsorTotalPage) {
    const payload = await querySponsorPage(userId, token, sponsorPage)
    if (payload.ec !== 200) {
      throw new Error(payload.em || `Afdian sponsor API error (ec=${payload.ec})`)
    }

    sponsorTotalPage = payload.data?.total_page ?? 1
    for (const item of payload.data?.list ?? []) {
      const sponsorUserId = item.user?.user_id
      if (!sponsorUserId) continue

      sponsors.set(sponsorUserId, {
        name: item.user?.name?.trim() ?? '',
        amount: item.all_sum_amount?.trim() || '0',
        plan: item.current_plan?.name?.trim() ?? '',
        remark: '',
        lastPayTime: Number(item.last_pay_time) || 0,
        nameTime: 0,
        remarkTime: 0,
      })
    }
    sponsorPage += 1
  }

  let orderPage = 1
  let orderTotalPage = 1
  while (orderPage <= orderTotalPage) {
    const payload = await queryOrderPage(userId, token, orderPage)
    if (payload.ec !== 200) {
      throw new Error(payload.em || `Afdian order API error (ec=${payload.ec})`)
    }

    orderTotalPage = payload.data?.total_page ?? 1
    for (const order of payload.data?.list ?? []) {
      if (order.status !== 2) continue

      const sponsorUserId = order.user_id
      if (!sponsorUserId) continue

      const existing = sponsors.get(sponsorUserId)
      const createTime = Number(order.create_time) || 0
      const orderName = order.user_name?.trim() ?? ''
      const orderAmount = order.show_amount?.trim() || order.total_amount?.trim() || ''
      const orderPlan = order.plan_title?.trim() ?? ''
      const orderRemark = order.remark?.trim() ?? ''

      if (!existing) {
        sponsors.set(sponsorUserId, {
          name: orderName,
          amount: orderAmount || '0',
          plan: orderPlan,
          remark: orderRemark,
          lastPayTime: createTime,
          nameTime: orderName ? createTime : 0,
          remarkTime: orderRemark ? createTime : 0,
        })
        continue
      }

      // Latest paid order wins for display name / plan / amount.
      if (orderName && createTime >= existing.nameTime) {
        existing.name = resolveSponsorDisplayName(existing.name, orderName)
        existing.nameTime = createTime
      }
      if (createTime >= existing.lastPayTime) {
        if (orderPlan) existing.plan = orderPlan
        if (orderAmount) existing.amount = orderAmount
        existing.lastPayTime = createTime
      }
      if (orderRemark && createTime >= existing.remarkTime) {
        existing.remark = orderRemark
        existing.remarkTime = createTime
      }
    }
    orderPage += 1
  }

  return [...sponsors.values()]
    .map((entry) => ({
      name: entry.name,
      amount: entry.amount,
      plan: entry.plan,
      remark: entry.remark,
    }))
    .filter((entry) => entry.name)
    .sort((a, b) => Number(b.amount) - Number(a.amount) || a.name.localeCompare(b.name, 'zh-CN'))
}

async function main() {
  loadEnvLocal()

  const userId = process.env.AFDIAN_USER_ID?.trim()
  const token = process.env.AFDIAN_TOKEN?.trim()

  if (!userId || !token) {
    console.error(
      [
        'Missing AFDIAN_USER_ID or AFDIAN_TOKEN.',
        'Add them to .env.local in the project root, or set env vars before running.',
        'Get credentials from https://afdian.com/dashboard/dev',
      ].join('\n'),
    )
    process.exit(1)
  }

  const sponsors = await fetchAllAfdianSponsors(userId, token)
  const output = {
    syncedAt: new Date().toISOString(),
    sponsors,
  }

  writeFileSync(OUTPUT, `${JSON.stringify(output, null, 2)}\n`, 'utf8')
  console.log(`Synced ${sponsors.length} Afdian sponsor(s) -> ${OUTPUT}`)
}

const entryHref = process.argv[1] ? pathToFileURL(process.argv[1]).href : ''
if (import.meta.url === entryHref) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  })
}

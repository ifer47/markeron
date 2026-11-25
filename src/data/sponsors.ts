import raw from './sponsors.json'

/**
 * 赞助者头像：
 * - 本地图片放在 `src/assets/sponsors/`，文件名与 `sponsors.json` 里的 `name`
 *   一致即可自动匹配（不区分大小写，如 `loristoki.jpg` → `Loristoki`）。
 * - 打开致谢面板时会从 GitHub raw 预加载同名图片，加载成功后替换本地图片。
 *   所以换头像只需替换文件并 push，不用发版；离线时继续用打包的本地图片。
 * - 新赞助者可以没有本地图片，只在 `sponsors.json` 写
 *   `"avatar": "新文件.png"`，生成时也会走远程地址。
 *
 * `avatar` 字段支持：
 * - 仓库内文件名：`"千里封冰.png"`（推荐，远程可更新）
 * - 本地 key：`"千里封冰"`（对应同名图片）
 * - `public/` 路径：`"sponsors/foo.webp"` 或 `"/sponsors/foo.webp"`（随版本发布）
 * - 远程地址：`"https://..."`（需同步放宽 CSP 的 img-src）
 */
const avatarAssets = import.meta.glob('../assets/sponsors/*.{png,webp,jpg,jpeg,avif,svg}', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>

const SPONSORS_REMOTE_BASE = 'https://raw.githubusercontent.com/ifer47/markeron/master/'
export const SPONSORS_AVATAR_REMOTE_BASE = `${SPONSORS_REMOTE_BASE}src/assets/sponsors/`

/** 每次启动换一个版本号，绕开 raw 的几分钟缓存；同一会话内仍走浏览器缓存。 */
const AVATAR_CACHE_BUST = Date.now()

interface LocalAvatar {
  url: string
  fileName: string
}

function fileKey(path: string): string {
  const file = path.split('/').pop() ?? path
  return file.replace(/\.[^.]+$/, '').toLowerCase()
}

const localAvatars = new Map<string, LocalAvatar>(
  Object.entries(avatarAssets).map(([path, url]) => {
    const fileName = path.split('/').pop() ?? ''
    return [fileKey(path), { url, fileName }]
  }),
)

export interface SponsorEntry {
  name: string
  plan?: string
  /** 头像来源，见文件顶部注释；缺省时按 `name` 自动匹配本地图片。 */
  avatar?: string
  /** 本地打包 / 显式地址，先显示，离线也能用。 */
  avatarUrl?: string
  /** GitHub raw 地址，加载成功后替换 `avatarUrl`，push 即可生效。 */
  avatarRemoteUrl?: string
}

export interface SponsorsData {
  sponsors: SponsorEntry[]
}

/** Default branch raw URL — edit `sponsors.json` on master to update without a release. */
export const SPONSORS_REMOTE_URL = `${SPONSORS_REMOTE_BASE}src/data/sponsors.json`

/** Bundled fallback used offline / when remote fetch fails. */
export const bundledSponsors: SponsorsData = normalizeSponsors(raw)

let cachedSponsors: SponsorEntry[] | null = null
let inflight: Promise<SponsorEntry[]> | null = null

/** 只接受 https 远程地址或本地路径，其余协议（javascript:、data: 等）一律忽略。 */
function normalizeAvatarSource(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const raw = value.trim()
  if (!raw || raw.startsWith('//')) return undefined
  if (/^https:\/\//i.test(raw)) return raw
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) return undefined
  return raw
}

/** 显式的裸文件名（不带目录），用于拼 GitHub raw 地址。 */
function bareAvatarFileName(raw: string): string | undefined {
  if (/[/\\]/.test(raw) || raw.startsWith('.') || raw.includes('..')) return undefined
  if (!/\.[a-z0-9]+$/i.test(raw)) return undefined
  return raw
}

interface AvatarMatch {
  /** 本地包内地址，或显式 https / public 路径。 */
  url?: string
  /** 仓库 `src/assets/sponsors/` 下的文件名，用于生成 raw 地址。 */
  remoteFileName?: string
}

function resolveAvatarMatch(name: string, avatar?: string): AvatarMatch {
  const raw = normalizeAvatarSource(avatar)
  if (raw) {
    if (/^https:\/\//i.test(raw)) return { url: raw }

    const rawKey = raw.toLowerCase()
    const localKey = raw
      .replace(/^\.?\//, '')
      .replace(/\.[a-z0-9]+$/i, '')
      .toLowerCase()
    const local = localAvatars.get(rawKey) ?? localAvatars.get(localKey) ?? localAvatars.get(fileKey(raw))
    const explicitFileName = bareAvatarFileName(raw)
    const remoteFileName = explicitFileName ?? local?.fileName

    if (local) return { url: local.url, remoteFileName }
    // public/ 下的静态文件，例如 sponsors/foo.webp
    if (raw.includes('/')) return { url: `/${raw.replace(/^\.?\//, '')}` }
    if (remoteFileName) {
      // 远程文件名写错/还没打包时，仍用同名本地图兜底
      const fallback = localAvatars.get(name.toLowerCase())
      return { url: fallback?.url, remoteFileName }
    }
  }

  const byName = localAvatars.get(name.toLowerCase())
  if (!byName) return {}
  return { url: byName.url, remoteFileName: byName.fileName }
}

/** 把 `avatar` / `name` 解析成最终图片地址；没有匹配到本地文件时返回 undefined。 */
export function resolveSponsorAvatar(name: string, avatar?: string): string | undefined {
  return resolveAvatarMatch(name, avatar).url
}

function resolveRemoteAvatarUrl(fileName?: string): string | undefined {
  if (!fileName) return undefined
  return `${SPONSORS_AVATAR_REMOTE_BASE}${encodeURIComponent(fileName)}?v=${AVATAR_CACHE_BUST}`
}

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
      const avatar = normalizeAvatarSource(item.avatar)
      const match = resolveAvatarMatch(name, avatar)
      const remoteAvatarUrl = resolveRemoteAvatarUrl(match.remoteFileName)

      const sponsor: SponsorEntry = { name }
      if (plan) sponsor.plan = plan
      if (avatar) sponsor.avatar = avatar
      if (match.url) sponsor.avatarUrl = match.url
      if (remoteAvatarUrl) sponsor.avatarRemoteUrl = remoteAvatarUrl
      return sponsor
    })
    .filter((entry): entry is SponsorEntry => entry !== null)

  return { sponsors }
}

/** 无头像时的首字：两个 ASCII 字母/数字（如 "47"）全保留，其余取第一个字。 */
export function sponsorMonogram(name: string): string {
  const trimmed = name.trim()
  if (/^[A-Za-z0-9]{2}$/.test(trimmed)) return trimmed
  return Array.from(trimmed)[0] ?? '?'
}

/** 按名字生成稳定的色相，保证同一个赞助者的徽章颜色不变。 */
export function sponsorHue(name: string): number {
  let hash = 0
  for (const char of name) {
    hash = (hash * 31 + char.codePointAt(0)!) % 360
  }
  return hash
}

/** Fetch the remote list from GitHub raw; throws on failure. */
async function fetchRemoteSponsors(): Promise<SponsorEntry[]> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 8000)

  try {
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
    if (remote.sponsors.length === 0) {
      throw new Error('sponsors fetch returned an empty list')
    }
    return remote.sponsors
  } finally {
    clearTimeout(timer)
  }
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
      const remote = await fetchRemoteSponsors()
      cachedSponsors = remote
      return remote
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

/**
 * Refresh the remote list for an already-open panel. Unlike `loadSponsors()`,
 * this rejects on failure so callers can keep the currently displayed list
 * instead of replacing it with the bundled fallback.
 */
export function refreshSponsors(): Promise<SponsorEntry[]> {
  return fetchRemoteSponsors()
}

/** Sync initial paint fallback. Prefer `loadSponsors()` for the live list. */
const sponsorsData = bundledSponsors
export default sponsorsData

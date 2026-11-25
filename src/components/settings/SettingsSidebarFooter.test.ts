/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, nextTick, type App } from 'vue'

vi.mock('../../data/sponsors', () => {
  const sponsors = [{ name: '爱发电用户_W' }, { name: '47' }, { name: '千里封冰' }]
  return {
    bundledSponsors: { sponsors },
    loadSponsors: () => Promise.resolve(sponsors),
    sponsorHue: () => 220,
    sponsorMonogram: (name: string) => name.slice(0, 1),
  }
})

type FooterComponent = (typeof import('./SettingsSidebarFooter.vue'))['default']

let app: App | null = null
let host: HTMLDivElement
let Footer: FooterComponent
const originalOffsetHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight')

const SHAKE_MS = 480
const UNROLL_MS = 560
const SCROLL_START_MS = SHAKE_MS + UNROLL_MS
const LEAVE_CLOSE_DELAY_MS = 2000
const CLOSE_MS = 420

/** 滚动时长：clamp(120 * 48, 4200, 14000) = 5760ms */
const SCROLL_DURATION_MS = 5760
const HOLD_AFTER_SCROLL_MS = 2000
const GUARD_CLOSE_AT_MS = SCROLL_START_MS + SCROLL_DURATION_MS * 2 + HOLD_AFTER_SCROLL_MS

function panel() {
  return host.querySelector<HTMLElement>('.settings-sidebar-credits')
}

async function advance(ms: number) {
  await vi.advanceTimersByTimeAsync(ms)
  await nextTick()
}

async function openPanel() {
  const trigger = host.querySelector<HTMLButtonElement>('.settings-sidebar-footer__sponsors-btn')
  if (!trigger) throw new Error('sponsors button not found')
  trigger.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }))
  await nextTick()
}

function hover() {
  const el = panel()
  if (!el) throw new Error('credits panel not mounted')
  el.dispatchEvent(new MouseEvent('pointerenter'))
}

function leave() {
  const el = panel()
  if (!el) throw new Error('credits panel not mounted')
  el.dispatchEvent(new MouseEvent('pointerleave'))
}

beforeEach(async () => {
  vi.useFakeTimers()
  vi.stubGlobal('__APP_VERSION__', '9.9.9')
  // jsdom 不做布局，滚动距离固定给一个非零值
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get: () => 120,
  })
  host = document.createElement('div')
  document.body.appendChild(host)
  Footer = (await import('./SettingsSidebarFooter.vue')).default
  app = createApp(Footer)
  app.mount(host)
  await nextTick()
})

afterEach(() => {
  app?.unmount()
  app = null
  host.remove()
  document.body.innerHTML = ''
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  // 还原 jsdom 原生描述符，避免污染同文件其它用例
  if (originalOffsetHeight) {
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', originalOffsetHeight)
  } else {
    delete (HTMLElement.prototype as unknown as Record<string, unknown>).offsetHeight
  }
})

describe('致谢面板关闭时序', () => {
  it('展开动画期间 hover 后离开：离开计时不会被滚动兜底计时器吞掉', async () => {
    await openPanel()
    await advance(600) // t=600 处于 unroll
    hover()
    await advance(200) // t=800
    leave()
    await advance(600) // t=1400，beginScroll 已在 1040ms 执行

    // 离开后 2s 关闭：t=2800 进入关闭动画
    await advance(1500) // t=2900
    expect(panel()?.classList.contains('is-closing')).toBe(true)

    await advance(CLOSE_MS + 100) // t≈3400
    expect(panel()).toBeNull()
  })

  it('滚动开始后离开：同样在离开延迟后关闭', async () => {
    await openPanel()
    await advance(SCROLL_START_MS + 400) // t=1440
    hover()
    await advance(200) // t=1640
    leave()

    await advance(LEAVE_CLOSE_DELAY_MS + 100) // t≈3740
    expect(panel()?.classList.contains('is-closing')).toBe(true)

    await advance(CLOSE_MS + 100)
    expect(panel()).toBeNull()
  })

  it('兜底计时器不会早于离开延迟关闭', async () => {
    await openPanel()
    await advance(1000)
    hover()
    await advance(200)
    leave()

    // t=1200~3000 之间不应关闭
    await advance(1800)
    expect(panel()).not.toBeNull()
    expect(panel()?.classList.contains('is-closing')).toBe(false)
  })

  it('pointerleave 丢失时，任意一次指针移动都能自愈关闭', async () => {
    await openPanel()
    await advance(SCROLL_START_MS + 400)
    hover() // 只记录 enter，模拟 leave 未被派发
    await advance(200)

    document.body.dispatchEvent(new MouseEvent('pointermove', { bubbles: true }))
    await advance(LEAVE_CLOSE_DELAY_MS + 100)
    expect(panel()?.classList.contains('is-closing')).toBe(true)

    await advance(CLOSE_MS + 100)
    expect(panel()).toBeNull()
  })

  it('窗口失焦时立即关闭', async () => {
    await openPanel()
    await advance(SCROLL_START_MS + 400)
    hover()

    window.dispatchEvent(new Event('blur'))
    await advance(CLOSE_MS + 100)
    expect(panel()).toBeNull()
  })

  it('点击面板外关闭，点击面板内不关闭', async () => {
    await openPanel()
    await advance(SCROLL_START_MS + 400)

    const el = panel()
    if (!el) throw new Error('credits panel not mounted')
    el.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }))
    await advance(CLOSE_MS + 100)
    expect(panel()).not.toBeNull()

    document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }))
    await advance(CLOSE_MS + 100)
    expect(panel()).toBeNull()
  })

  it('无人交互时由兜底计时器关闭', async () => {
    await openPanel()
    await advance(5000)
    expect(panel()).not.toBeNull()

    await advance(GUARD_CLOSE_AT_MS)
    expect(panel()).toBeNull()
  })

  it('关闭后可以再次打开，且仍能正常关闭', async () => {
    await openPanel()
    await advance(SCROLL_START_MS + 400)
    document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }))
    await advance(CLOSE_MS + 100)
    expect(panel()).toBeNull()

    await openPanel()
    await advance(SHAKE_MS + 200) // 进入 unroll
    expect(panel()?.classList.contains('is-unrolled')).toBe(true)

    await advance(SCROLL_START_MS + 400)
    hover()
    await advance(200)
    leave()
    await advance(LEAVE_CLOSE_DELAY_MS + CLOSE_MS + 200)
    expect(panel()).toBeNull()
  })

  it('点击触发按钮不会误关已打开的面板', async () => {
    await openPanel()
    await advance(SCROLL_START_MS + 400)

    const trigger = host.querySelector<HTMLButtonElement>('.settings-sidebar-footer__sponsors-btn')
    if (!trigger) throw new Error('sponsors button not found')
    trigger.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }))
    await advance(CLOSE_MS + 200)

    expect(panel()).not.toBeNull()
    expect(panel()?.classList.contains('is-closing')).toBe(false)
  })
})

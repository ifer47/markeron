/** @vitest-environment jsdom */
import { describe, expect, it, vi, afterEach } from 'vitest'
import { createApp, nextTick, type App } from 'vue'
import HelpRow from './HelpRow.vue'

let app: App | null = null
const host = document.createElement('div')
document.body.appendChild(host)

function mount(props: Record<string, unknown>) {
  app = createApp(HelpRow, props)
  app.mount(host)
  return host
}

afterEach(() => {
  app?.unmount()
  app = null
  host.innerHTML = ''
  vi.restoreAllMocks()
})

describe('HelpRow', () => {
  it('splits modifier combos into key caps', async () => {
    mount({ label: '重做', keys: 'Ctrl+Shift+Z' })
    await nextTick()
    expect([...host.querySelectorAll('.help-kbd')].map((k) => k.textContent)).toEqual(['Ctrl', 'Shift', 'Z'])
  })

  it('keeps alternatives separated by a slash', async () => {
    mount({ label: '删除选中', keys: 'Delete / Backspace' })
    await nextTick()
    expect([...host.querySelectorAll('.help-kbd')].map((k) => k.textContent)).toEqual(['Delete', 'Backspace'])
    expect(host.querySelector('.help-keys-sep')?.textContent?.trim()).toBe('/')
    expect(host.querySelectorAll('.help-keys-plus')).toHaveLength(0)
  })

  it('expands arrow clusters into one cap each', async () => {
    mount({ label: '微移 10px', keys: 'Shift+↑↓←→' })
    await nextTick()
    expect([...host.querySelectorAll('.help-kbd')].map((k) => k.textContent)).toEqual(['Shift', '↑', '↓', '←', '→'])
  })

  it('keeps desc rows on a single line', async () => {
    mount({ label: '编辑文字', desc: '双击文字', tip: '提示' })
    await nextTick()
    expect(host.querySelectorAll('.help-kbd')).toHaveLength(0)
    expect(host.querySelector('.help-desc')?.textContent).toBe('双击文字')
    // 标签与说明是同一行的左右两列，不再上下堆叠
    const row = host.querySelector('.help-row')
    expect(row?.querySelector('.help-label')).not.toBeNull()
    expect(row?.querySelector('.help-desc')).not.toBeNull()
    expect(row?.classList.contains('help-row--block')).toBe(false)
  })

  it('shows the tip on hover and hides it on leave', async () => {
    mount({ label: '复制', keys: 'Ctrl+C', tip: '优先复制选中内容' })
    await nextTick()
    const label = host.querySelector('.help-label') as HTMLElement
    expect(label.classList.contains('help-label--tip')).toBe(true)
    expect(document.querySelector('[role="tooltip"]')).toBeNull()

    label.dispatchEvent(new MouseEvent('mouseenter'))
    await nextTick()
    expect(document.querySelector('[role="tooltip"]')?.textContent?.trim()).toBe('优先复制选中内容')

    label.dispatchEvent(new MouseEvent('mouseleave'))
    await nextTick()
    expect(document.querySelector('[role="tooltip"]')).toBeNull()
  })

  it('does not mark rows without tip as hoverable', async () => {
    mount({ label: '撤销', keys: 'Ctrl+Z' })
    await nextTick()
    expect(host.querySelector('.help-label--tip')).toBeNull()
  })
})

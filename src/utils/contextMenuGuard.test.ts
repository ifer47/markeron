/** @vitest-environment jsdom */
import { afterEach, describe, expect, it } from 'vitest'
import { installContextMenuGuard } from './contextMenuGuard'

function mount(html: string): HTMLElement {
  const host = document.createElement('div')
  host.innerHTML = html
  document.body.appendChild(host)
  return host.firstElementChild as HTMLElement
}

function dispatchContextMenu(target: Element): Event {
  const event = new Event('contextmenu', { bubbles: true, cancelable: true })
  target.dispatchEvent(event)
  return event
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('contextMenuGuard', () => {
  it('blocks the native context menu on app UI', () => {
    installContextMenuGuard()
    expect(dispatchContextMenu(mount('<div><span>x</span></div>')).defaultPrevented).toBe(true)
    expect(dispatchContextMenu(mount('<button>x</button>')).defaultPrevented).toBe(true)
  })

  it('blocks the browser menu on inputs too, so Reload cannot leak in', () => {
    installContextMenuGuard()
    expect(dispatchContextMenu(mount('<input />')).defaultPrevented).toBe(true)
    expect(dispatchContextMenu(mount('<textarea></textarea>')).defaultPrevented).toBe(true)
  })
})

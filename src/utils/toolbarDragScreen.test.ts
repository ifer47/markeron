import { describe, expect, it } from 'vitest'
import { isPointerEventScreenTrusted, resolvePointerScreenCss } from './toolbarDragScreen'

describe('isPointerEventScreenTrusted', () => {
  const windowAt = { x: 400, y: 200 }

  it('trusts screen coords that match window origin + client', () => {
    expect(isPointerEventScreenTrusted({ screenX: 450, screenY: 230, clientX: 50, clientY: 30 }, windowAt)).toBe(true)
  })

  it('rejects screen (0,0) when the pointer is not at the screen origin', () => {
    expect(isPointerEventScreenTrusted({ screenX: 0, screenY: 0, clientX: 50, clientY: 30 }, windowAt)).toBe(false)
  })

  it('trusts screen (0,0) when window+client are also at the origin', () => {
    expect(isPointerEventScreenTrusted({ screenX: 0, screenY: 0, clientX: 0, clientY: 0 }, { x: 0, y: 0 })).toBe(true)
  })

  it('rejects screen that merely mirrors client while the window is offset', () => {
    expect(isPointerEventScreenTrusted({ screenX: 50, screenY: 30, clientX: 50, clientY: 30 }, windowAt)).toBe(false)
  })

  it('still trusts event screen when it disagrees with a bad window.screenX (macOS)', () => {
    // Mouse reports real screen; window.screenX is stale/wrong.
    expect(
      isPointerEventScreenTrusted({ screenX: 900, screenY: 500, clientX: 50, clientY: 30 }, { x: 10, y: 10 }),
    ).toBe(true)
  })
})

describe('resolvePointerScreenCss', () => {
  const windowAt = { x: 400, y: 200 }

  it('returns event screen for trustworthy mouse samples', () => {
    expect(resolvePointerScreenCss({ screenX: 450, screenY: 230, clientX: 50, clientY: 30 }, windowAt)).toEqual({
      x: 450,
      y: 230,
    })
  })

  it('reconstructs from window origin + client when pen reports (0,0)', () => {
    expect(resolvePointerScreenCss({ screenX: 0, screenY: 0, clientX: 50, clientY: 30 }, windowAt)).toEqual({
      x: 450,
      y: 230,
    })
  })

  it('reconstructs when screen mirrors client (missing window origin)', () => {
    expect(resolvePointerScreenCss({ screenX: 50, screenY: 30, clientX: 50, clientY: 30 }, windowAt)).toEqual({
      x: 450,
      y: 230,
    })
  })

  it('keeps macOS mouse screen coords even if window origin is wrong', () => {
    expect(resolvePointerScreenCss({ screenX: 900, screenY: 500, clientX: 50, clientY: 30 }, { x: 10, y: 10 })).toEqual(
      { x: 900, y: 500 },
    )
  })

  it('does not jump to top-left for the reported stylus drag case', () => {
    const grab = { clientX: 24, clientY: 12 }
    const windowOrigin = { x: 640, y: 360 }
    const brokenPenMove = resolvePointerScreenCss({ screenX: 0, screenY: 0, ...grab }, windowOrigin)
    // Window top-left = screen - grabClient
    expect(brokenPenMove.x - grab.clientX).toBe(640)
    expect(brokenPenMove.y - grab.clientY).toBe(360)
  })
})

import { describe, expect, it } from 'vitest'
import { EMPTY_SELECT_ALL_PRESS, SELECT_ALL_DOUBLE_MS, noteSelectAllPress } from './selectAllDoublePress'

describe('noteSelectAllPress', () => {
  it('arms on the first press', () => {
    const { isDouble, next } = noteSelectAllPress(EMPTY_SELECT_ALL_PRESS, 1000)
    expect(isDouble).toBe(false)
    expect(next).toEqual({ lastAt: 1000 })
  })

  it('detects a second press inside the window', () => {
    const armed = noteSelectAllPress(EMPTY_SELECT_ALL_PRESS, 1000).next
    const { isDouble, next } = noteSelectAllPress(armed, 1000 + SELECT_ALL_DOUBLE_MS - 1)
    expect(isDouble).toBe(true)
    expect(next).toEqual(EMPTY_SELECT_ALL_PRESS)
  })

  it('treats a slow second press as a new first press', () => {
    const armed = noteSelectAllPress(EMPTY_SELECT_ALL_PRESS, 1000).next
    const { isDouble, next } = noteSelectAllPress(armed, 1000 + SELECT_ALL_DOUBLE_MS + 1)
    expect(isDouble).toBe(false)
    expect(next).toEqual({ lastAt: 1000 + SELECT_ALL_DOUBLE_MS + 1 })
  })

  it('starts a fresh pair after a double press', () => {
    const armed = noteSelectAllPress(EMPTY_SELECT_ALL_PRESS, 1000).next
    const doubled = noteSelectAllPress(armed, 1100).next
    const { isDouble } = noteSelectAllPress(doubled, 1200)
    expect(isDouble).toBe(false)
  })
})

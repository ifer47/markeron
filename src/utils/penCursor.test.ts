import { describe, expect, it } from 'vitest'
import { nextPenCursorStyle, resolvePenCursorStyle } from './penCursor'

describe('penCursor', () => {
  it('defaults to pen icon', () => {
    expect(resolvePenCursorStyle()).toBe('pen')
  })

  it('reads explicit penCursorStyle', () => {
    expect(resolvePenCursorStyle({ penCursorStyle: 'dot' })).toBe('dot')
    expect(resolvePenCursorStyle({ penCursorStyle: 'pen' })).toBe('pen')
  })

  it('cycles pen ↔ dot', () => {
    expect(nextPenCursorStyle('pen')).toBe('dot')
    expect(nextPenCursorStyle('dot')).toBe('pen')
  })
})

import { describe, expect, it } from 'vitest'
import { DEFAULT_INK_TAPER, resolveInkTaper } from './inkTaper'

describe('inkTaper', () => {
  it('defaults to on when the config predates the field', () => {
    expect(DEFAULT_INK_TAPER).toBe(true)
    expect(resolveInkTaper(undefined)).toBe(true)
    expect(resolveInkTaper({})).toBe(true)
  })

  it('resolves the persisted value', () => {
    expect(resolveInkTaper({ inkTaper: true })).toBe(true)
    expect(resolveInkTaper({ inkTaper: false })).toBe(false)
  })
})

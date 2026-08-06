import { describe, expect, it } from 'vitest'
import { nextEraserMode, resolveEraserMode } from './eraserMode'

describe('eraserMode', () => {
  it('defaults to stroke erasing', () => {
    expect(resolveEraserMode()).toBe('stroke')
  })

  it('reads explicit eraserMode', () => {
    expect(resolveEraserMode({ eraserMode: 'object' })).toBe('object')
  })

  it('cycles stroke ↔ object', () => {
    expect(nextEraserMode('stroke')).toBe('object')
    expect(nextEraserMode('object')).toBe('stroke')
  })
})

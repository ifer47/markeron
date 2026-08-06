import { describe, expect, it } from 'vitest'
import { DEFAULT_STROKE_SMOOTHING, resolveStrokeSmoothing, STROKE_SMOOTHING_OPTIONS } from './strokeSmoothing'

describe('resolveStrokeSmoothing', () => {
  it('defaults to standard', () => {
    expect(resolveStrokeSmoothing()).toBe(DEFAULT_STROKE_SMOOTHING)
    expect(resolveStrokeSmoothing({})).toBe('standard')
  })

  it('accepts known levels', () => {
    for (const level of STROKE_SMOOTHING_OPTIONS) {
      expect(resolveStrokeSmoothing({ strokeSmoothing: level })).toBe(level)
    }
  })
})

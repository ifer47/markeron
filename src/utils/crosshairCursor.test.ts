import { describe, expect, it } from 'vitest'
import { nextCrosshairCursorStyle, resolveCrosshairCursorStyle, usesCrosshairCursor } from './crosshairCursor'

describe('crosshairCursor', () => {
  it('defaults to crosshair', () => {
    expect(resolveCrosshairCursorStyle()).toBe('crosshair')
  })

  it('reads explicit crosshairCursorStyle', () => {
    expect(resolveCrosshairCursorStyle({ crosshairCursorStyle: 'dot' })).toBe('dot')
    expect(resolveCrosshairCursorStyle({ crosshairCursorStyle: 'crosshair' })).toBe('crosshair')
  })

  it('cycles crosshair ↔ dot', () => {
    expect(nextCrosshairCursorStyle('crosshair')).toBe('dot')
    expect(nextCrosshairCursorStyle('dot')).toBe('crosshair')
  })

  it('identifies shape and laser tools', () => {
    expect(usesCrosshairCursor('arrow')).toBe(true)
    expect(usesCrosshairCursor('laser')).toBe(true)
    expect(usesCrosshairCursor('pen')).toBe(false)
    expect(usesCrosshairCursor('highlighter')).toBe(false)
  })
})

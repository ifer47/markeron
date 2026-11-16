import { describe, expect, it } from 'vitest'
import { resolveModifierTempTool } from './modifierTempTool'

describe('resolveModifierTempTool', () => {
  it('maps modifier chords to temporary tools from pen', () => {
    expect(resolveModifierTempTool('pen', { mod: true, shift: true, alt: false })).toBe('arrow')
    expect(resolveModifierTempTool('pen', { mod: true, shift: false, alt: false })).toBe('rect')
    expect(resolveModifierTempTool('pen', { mod: false, shift: true, alt: false })).toBe('ellipse')
    expect(resolveModifierTempTool('pen', { mod: false, shift: false, alt: true })).toBe('line')
  })

  it('Alt alone still gives a temporary straight line from shape tools', () => {
    expect(resolveModifierTempTool('rect', { mod: false, shift: false, alt: true })).toBe('line')
    expect(resolveModifierTempTool('ellipse', { mod: false, shift: false, alt: true })).toBe('line')
    expect(resolveModifierTempTool('arrow', { mod: false, shift: false, alt: true })).toBe('line')
    expect(resolveModifierTempTool('line', { mod: false, shift: false, alt: true })).toBeNull()
  })

  it('Alt alone still gives a temporary straight line from non-shape tools', () => {
    expect(resolveModifierTempTool('highlighter', { mod: false, shift: false, alt: true })).toBe('line')
    expect(resolveModifierTempTool('laser', { mod: false, shift: false, alt: true })).toBe('line')
    expect(resolveModifierTempTool('select', { mod: false, shift: false, alt: true })).toBe('line')
  })

  it('keeps Alt+Mod as square and Alt+Shift as circle', () => {
    expect(resolveModifierTempTool('pen', { mod: true, shift: false, alt: true })).toBe('rect')
    expect(resolveModifierTempTool('pen', { mod: false, shift: true, alt: true })).toBe('ellipse')
    expect(resolveModifierTempTool('rect', { mod: false, shift: true, alt: true })).toBe('ellipse')
    expect(resolveModifierTempTool('line', { mod: true, shift: false, alt: true })).toBe('rect')
  })

  it('skips no-op switches when already on the temporary tool', () => {
    expect(resolveModifierTempTool('ellipse', { mod: false, shift: true, alt: false })).toBeNull()
    expect(resolveModifierTempTool('rect', { mod: true, shift: false, alt: false })).toBeNull()
    expect(resolveModifierTempTool('arrow', { mod: true, shift: true, alt: false })).toBeNull()
  })

  it('returns null when no modifier is held', () => {
    expect(resolveModifierTempTool('pen', { mod: false, shift: false, alt: false })).toBeNull()
    expect(resolveModifierTempTool('rect', { mod: false, shift: false, alt: false })).toBeNull()
  })
})

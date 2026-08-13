import { describe, it, expect } from 'vitest'
import {
  createDefaultLineWidths,
  DEFAULT_LINE_WIDTH,
  eraserLineWidth,
  ERASER_WIDTH_SCALE,
  highlighterLineWidth,
  HIGHLIGHTER_WIDTH_SCALE,
  normalizeLineWidth,
  resolveLineWidths,
  toolLineWidthGroup,
} from './tools'

describe('line width helpers', () => {
  it('defaults every width group to the middle preset', () => {
    const widths = createDefaultLineWidths()
    for (const value of Object.values(widths)) {
      expect(value).toBe(DEFAULT_LINE_WIDTH)
    }
    expect(DEFAULT_LINE_WIDTH).toBe(3)
  })

  it('maps stroke tools to shared group; others are separate', () => {
    expect(toolLineWidthGroup('select')).toBe('stroke')
    expect(toolLineWidthGroup('pen')).toBe('stroke')
    expect(toolLineWidthGroup('laser')).toBe('stroke')
    expect(toolLineWidthGroup('arrow')).toBe('stroke')
    expect(toolLineWidthGroup('rect')).toBe('stroke')
    expect(toolLineWidthGroup('highlighter')).toBe('highlighter')
    expect(toolLineWidthGroup('eraser')).toBe('eraser')
    expect(toolLineWidthGroup('text')).toBe('text')
    expect(toolLineWidthGroup('stamp')).toBe('text')
  })

  it('scales lineWidth for eraser and highlighter', () => {
    expect(ERASER_WIDTH_SCALE).toBe(8)
    expect(HIGHLIGHTER_WIDTH_SCALE).toBe(7)
    expect(eraserLineWidth(3)).toBe(24)
    expect(highlighterLineWidth(3)).toBe(21)
  })

  it('normalizes line width to presets', () => {
    expect(normalizeLineWidth(5)).toBe(5)
    expect(normalizeLineWidth(4)).toBe(DEFAULT_LINE_WIDTH)
    expect(normalizeLineWidth('3')).toBe(DEFAULT_LINE_WIDTH)
  })

  it('resolves persisted line widths with fallbacks', () => {
    expect(resolveLineWidths()).toEqual(createDefaultLineWidths())
    expect(resolveLineWidths({ stroke: 8, eraser: 4 })).toEqual({
      stroke: 8,
      highlighter: DEFAULT_LINE_WIDTH,
      eraser: DEFAULT_LINE_WIDTH,
      text: DEFAULT_LINE_WIDTH,
    })
  })
})

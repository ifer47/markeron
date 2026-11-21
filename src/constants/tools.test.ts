import { describe, it, expect } from 'vitest'
import {
  createDefaultLineWidths,
  DEFAULT_LINE_WIDTH,
  eraserLineWidth,
  ERASER_WIDTH_SCALE,
  highlighterLineWidth,
  HIGHLIGHTER_WIDTH_SCALE,
  isDashableTool,
  nextStrokeDashStyle,
  normalizeLineWidth,
  resolveLineWidths,
  shapeDashPattern,
  toolLineWidthGroup,
  textSizeForLineWidth,
  TEXT_SIZE_PRESETS,
  toStoredLineWidths,
  WIDTH_PRESET_STORAGE,
  WIDTH_PRESETS,
  WIDTH_PREVIEW_HEIGHTS,
} from './tools'

describe('line width helpers', () => {
  it('defaults every width group to the middle preset', () => {
    const widths = createDefaultLineWidths()
    for (const value of Object.values(widths)) {
      expect(value).toBe(DEFAULT_LINE_WIDTH)
    }
    expect(DEFAULT_LINE_WIDTH).toBe(3.25)
    expect(WIDTH_PRESETS).toEqual([1.15, 1.49, 1.93, 2.51, 3.25, 4.22, 5.47, 7.09, 9.2])
    expect(WIDTH_PRESET_STORAGE).toEqual([115, 149, 193, 251, 325, 422, 547, 709, 920])
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

  it('maps every width preset to its own text / stamp font size', () => {
    // Same 16–55.2px bounds as the old 6x-with-floor formula, but all nine steps differ.
    expect(TEXT_SIZE_PRESETS).toEqual([16, 18.7, 21.8, 25.5, 29.7, 34.7, 40.5, 47.3, 55.2])
    expect(TEXT_SIZE_PRESETS).toHaveLength(WIDTH_PRESETS.length)
    expect(WIDTH_PRESETS.map(textSizeForLineWidth)).toEqual(TEXT_SIZE_PRESETS)
    expect(new Set(TEXT_SIZE_PRESETS).size).toBe(TEXT_SIZE_PRESETS.length)
    expect(TEXT_SIZE_PRESETS[0]).toBe(16)
    expect(TEXT_SIZE_PRESETS[TEXT_SIZE_PRESETS.length - 1]).toBe(55.2)
    // Non-preset / invalid widths snap to the nearest step instead of throwing.
    expect(textSizeForLineWidth(4)).toBe(34.7)
    expect(textSizeForLineWidth(0)).toBe(29.7)
    expect(textSizeForLineWidth(Number.NaN)).toBe(29.7)
  })

  it('spaces toolbar preview bars evenly so every step reads apart', () => {
    expect(WIDTH_PREVIEW_HEIGHTS).toHaveLength(WIDTH_PRESETS.length)
    expect(WIDTH_PREVIEW_HEIGHTS[0]).toBe(2)
    expect(WIDTH_PREVIEW_HEIGHTS[WIDTH_PREVIEW_HEIGHTS.length - 1]).toBe(10.8)
    const steps = WIDTH_PREVIEW_HEIGHTS.slice(1).map((h, i) => Number((h - WIDTH_PREVIEW_HEIGHTS[i]).toFixed(2)))
    // Constant 1.1px step: at 1.2x width the first two bars snapped to the same device pixel.
    expect(new Set(steps)).toEqual(new Set([1.1]))
    expect(WIDTH_PREVIEW_HEIGHTS.every((h, i) => i === 0 || h > WIDTH_PREVIEW_HEIGHTS[i - 1])).toBe(true)
  })

  it('scales lineWidth for eraser and highlighter', () => {
    expect(ERASER_WIDTH_SCALE).toBe(8)
    expect(HIGHLIGHTER_WIDTH_SCALE).toBe(7)
    expect(eraserLineWidth(3)).toBe(24)
    expect(highlighterLineWidth(3)).toBe(21)
  })

  it('normalizes line width to the nearest preset and migrates legacy/storage values', () => {
    expect([1, 2, 3, 5, 8].map(normalizeLineWidth)).toEqual([1.15, 1.93, 3.25, 5.47, 7.09])
    expect(WIDTH_PRESET_STORAGE.map(normalizeLineWidth)).toEqual(WIDTH_PRESETS)
    // The previous ladders (345/575 and 163/460/650) snap to the nearest new step.
    expect([345, 575].map(normalizeLineWidth)).toEqual([3.25, 5.47])
    expect([163, 230, 460, 650].map(normalizeLineWidth)).toEqual([1.49, 2.51, 4.22, 7.09])
    expect(normalizeLineWidth(2.5100000000000002)).toBe(2.51)
    expect(normalizeLineWidth(4)).toBe(4.22)
    expect(normalizeLineWidth('3')).toBe(DEFAULT_LINE_WIDTH)
    expect(normalizeLineWidth(0)).toBe(DEFAULT_LINE_WIDTH)
    expect(normalizeLineWidth(Number.NaN)).toBe(DEFAULT_LINE_WIDTH)
  })

  it('converts CSS-pixel widths to integer storage', () => {
    expect(toStoredLineWidths({ stroke: 1.15, highlighter: 2.51, eraser: 3.25, text: 5.47 })).toEqual({
      stroke: 115,
      highlighter: 251,
      eraser: 325,
      text: 547,
    })
    expect(toStoredLineWidths({ stroke: 9.2, highlighter: 8, eraser: 3, text: 1 })).toEqual({
      stroke: 920,
      highlighter: 709,
      eraser: 325,
      text: 115,
    })
    // Invalid widths fall back to the middle preset; valid ones snap to the nearest step.
    expect(toStoredLineWidths({ stroke: 4, highlighter: Number.NaN, eraser: 0, text: 99 })).toEqual({
      stroke: 422,
      highlighter: 325,
      eraser: 325,
      text: 920,
    })
  })

  it('resolves persisted line widths with fallbacks', () => {
    expect(resolveLineWidths()).toEqual(createDefaultLineWidths())
    expect(resolveLineWidths({ stroke: 8, eraser: 4 })).toEqual({
      stroke: 7.09,
      highlighter: DEFAULT_LINE_WIDTH,
      eraser: 4.22,
      text: DEFAULT_LINE_WIDTH,
    })
    expect(resolveLineWidths({ stroke: 575, eraser: 345 })).toEqual({
      stroke: 5.47,
      highlighter: DEFAULT_LINE_WIDTH,
      eraser: 3.25,
      text: DEFAULT_LINE_WIDTH,
    })
  })

  it('marks pen and geometric shapes as dashable', () => {
    expect(isDashableTool('pen')).toBe(true)
    expect(isDashableTool('line')).toBe(true)
    expect(isDashableTool('arrow')).toBe(true)
    expect(isDashableTool('rect')).toBe(true)
    expect(isDashableTool('ellipse')).toBe(true)
    expect(isDashableTool('highlighter')).toBe(false)
    expect(isDashableTool('laser')).toBe(false)
  })

  it('scales dash pattern with stroke width', () => {
    expect(shapeDashPattern(3)).toEqual([12, 9])
    expect(shapeDashPattern(0)).toEqual([4, 3])
    expect(shapeDashPattern(3, 'dotted')[0]).toBe(0.01)
    expect(shapeDashPattern(3, 'dotted')[1]).toBeGreaterThan(shapeDashPattern(3, 'dotted')[0])
  })

  it('cycles stroke dash styles forward and backward', () => {
    expect(nextStrokeDashStyle('solid', 1)).toBe('dashed')
    expect(nextStrokeDashStyle('dashed', 1)).toBe('dotted')
    expect(nextStrokeDashStyle('dotted', 1)).toBe('solid')
    expect(nextStrokeDashStyle('solid', -1)).toBe('dotted')
    expect(nextStrokeDashStyle('dotted', -1)).toBe('dashed')
    expect(nextStrokeDashStyle('dashed', -1)).toBe('solid')
  })
})

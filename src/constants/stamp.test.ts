import { describe, it, expect, beforeEach } from 'vitest'
import {
  toExcelColumn,
  stampLabel,
  peekStampLabel,
  takeStampLabel,
  cycleStampKind,
  setStampKind,
  resetStampCounters,
  resetActiveStampCounter,
  getStampKind,
  stampRadius,
  stampLabelFontSize,
  stampFontSizeFromWidth,
  stampBboxPad,
  stampStrokeWidth,
  stampShadowParams,
} from './stamp'

describe('stamp', () => {
  beforeEach(() => {
    resetStampCounters('number')
  })

  describe('toExcelColumn', () => {
    it('maps 1-based indices like Excel columns', () => {
      expect(toExcelColumn(1)).toBe('A')
      expect(toExcelColumn(26)).toBe('Z')
      expect(toExcelColumn(27)).toBe('AA')
      expect(toExcelColumn(28)).toBe('AB')
      expect(toExcelColumn(52)).toBe('AZ')
      expect(toExcelColumn(53)).toBe('BA')
    })
  })

  describe('stampLabel', () => {
    it('formats numbers and letters', () => {
      expect(stampLabel('number', 1)).toBe('1')
      expect(stampLabel('number', 12)).toBe('12')
      expect(stampLabel('letter', 1)).toBe('A')
      expect(stampLabel('letter', 27)).toBe('AA')
    })
  })

  describe('counters', () => {
    it('takes sequential number stamps', () => {
      expect(takeStampLabel()).toBe('1')
      expect(takeStampLabel()).toBe('2')
      expect(peekStampLabel()).toBe('3')
    })

    it('keeps independent letter counter across kind switches', () => {
      expect(takeStampLabel()).toBe('1')
      expect(takeStampLabel()).toBe('2')
      expect(cycleStampKind()).toBe('letter')
      expect(takeStampLabel()).toBe('A')
      expect(takeStampLabel()).toBe('B')
      expect(setStampKind('number')).toBe('number')
      expect(takeStampLabel()).toBe('3')
      expect(getStampKind()).toBe('number')
    })

    it('resets only the active kind counter', () => {
      takeStampLabel()
      takeStampLabel()
      cycleStampKind()
      takeStampLabel()
      expect(resetActiveStampCounter()).toBe('A')
      expect(takeStampLabel()).toBe('A')
      setStampKind('number')
      expect(peekStampLabel()).toBe('3')
    })
  })

  describe('sizing', () => {
    it('scales font from line width like text', () => {
      expect(stampFontSizeFromWidth(3.25)).toBe(16)
      expect(stampFontSizeFromWidth(9.2)).toBe(29.7)
      // Legacy pixel widths snap to the nearest preset instead of resetting.
      expect(stampFontSizeFromWidth(3)).toBe(16)
      expect(stampFontSizeFromWidth(1)).toBe(8.6)
    })

    it('keeps two-digit stamps compact with stronger type', () => {
      const fs = 24
      const oneR = stampRadius(fs, '1')
      const twoR = stampRadius(fs, '15')
      const oneFs = stampLabelFontSize(fs, '1')
      const twoFs = stampLabelFontSize(fs, '15')
      // Disc grows only a little for 10–99
      expect(twoR / oneR).toBeLessThan(1.25)
      expect(twoR).toBeGreaterThan(oneR)
      // Type stays close in weight (not a big drop like the old 0.58 ratio)
      expect(twoFs / oneFs).toBeGreaterThan(0.85)
      expect(stampLabelFontSize(fs, '99')).toBe(twoFs)
    })

    it('pads bbox for stroke and shadow', () => {
      const r = stampRadius(24, '1')
      expect(stampBboxPad(r)).toBeGreaterThan(stampStrokeWidth(r))
      expect(stampShadowParams(r).blur).toBeGreaterThan(stampStrokeWidth(r) * 2)
    })
  })
})

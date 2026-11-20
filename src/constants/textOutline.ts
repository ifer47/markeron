import type { TextOutlineColorMode, TextOutlineStyle } from '../composables/drawingTypes'

export const TEXT_OUTLINE_WIDTH_PRESETS: number[] = [1, 2, 3, 5, 8]

/** Outline widths keep their own five-step ladder, independent of the stroke-width presets. */
export const TEXT_OUTLINE_WIDTH_LABEL_KEYS = ['xs', 's', 'm', 'l', 'xl'] as const

const DEFAULT_TEXT_OUTLINE: TextOutlineStyle = {
  enabled: false,
  colorMode: 'auto',
  color: '#FFFFFF',
  width: 3,
}

function clampOutlineWidth(width: unknown): number {
  return Math.max(1, Math.min(12, Number.isFinite(width) ? Number(width) : DEFAULT_TEXT_OUTLINE.width))
}

function normalizeOutlineColor(color: unknown): string {
  return typeof color === 'string' && color.trim() ? color : DEFAULT_TEXT_OUTLINE.color
}

function normalizeColorMode(mode: unknown, hasExplicitOutline: boolean): TextOutlineColorMode {
  if (mode === 'auto' || mode === 'fixed') return mode
  return hasExplicitOutline ? 'fixed' : DEFAULT_TEXT_OUTLINE.colorMode
}

function parseHexColor(color: string): { r: number; g: number; b: number } | null {
  const raw = color.trim()
  const short = /^#([0-9a-f]{3})$/i.exec(raw)
  if (short) {
    return {
      r: parseInt(short[1][0] + short[1][0], 16),
      g: parseInt(short[1][1] + short[1][1], 16),
      b: parseInt(short[1][2] + short[1][2], 16),
    }
  }

  const long = /^#([0-9a-f]{6})$/i.exec(raw)
  if (!long) return null
  return {
    r: parseInt(long[1].slice(0, 2), 16),
    g: parseInt(long[1].slice(2, 4), 16),
    b: parseInt(long[1].slice(4, 6), 16),
  }
}

function relativeLuminance(channel: number): number {
  const value = channel / 255
  return value <= 0.03928 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4)
}

export function resolveAutoTextOutlineColor(textColor: string): string {
  const rgb = parseHexColor(textColor)
  if (!rgb) return '#000000'
  const luminance =
    0.2126 * relativeLuminance(rgb.r) + 0.7152 * relativeLuminance(rgb.g) + 0.0722 * relativeLuminance(rgb.b)
  return luminance > 0.45 ? '#000000' : '#FFFFFF'
}

export function hexColorToRgba(color: string, alpha: number): string {
  const rgb = parseHexColor(color)
  if (!rgb) return `rgba(128, 128, 128, ${alpha})`
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`
}

export function createDefaultTextOutline(): TextOutlineStyle {
  return { ...DEFAULT_TEXT_OUTLINE }
}

export function normalizeTextOutline(outline?: Partial<TextOutlineStyle> | null): TextOutlineStyle {
  const hasExplicitOutline = !!outline
  return {
    enabled: outline?.enabled ?? DEFAULT_TEXT_OUTLINE.enabled,
    colorMode: normalizeColorMode(outline?.colorMode, hasExplicitOutline),
    color: normalizeOutlineColor(outline?.color),
    width: clampOutlineWidth(outline?.width),
  }
}

export function resolveTextOutlineColor(
  outline: Partial<TextOutlineStyle> | null | undefined,
  textColor: string,
): string {
  const normalized = normalizeTextOutline(outline)
  return normalized.colorMode === 'auto' ? resolveAutoTextOutlineColor(textColor) : normalized.color
}

export function getActiveTextOutline(
  outline?: Partial<TextOutlineStyle> | null,
  textColor = DEFAULT_TEXT_OUTLINE.color,
): TextOutlineStyle | null {
  const normalized = normalizeTextOutline(outline)
  normalized.color = resolveTextOutlineColor(normalized, textColor)
  return normalized.enabled && normalized.width > 0 ? normalized : null
}

export function textOutlinePadding(outline?: Partial<TextOutlineStyle> | null): number {
  return getActiveTextOutline(outline)?.width ?? 0
}

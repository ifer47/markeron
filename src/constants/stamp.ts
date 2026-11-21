import { resolveAutoTextOutlineColor } from './textOutline'
import { textSizeForLineWidth } from './tools'

export type StampKind = 'number' | 'letter'

export interface StampCounters {
  kind: StampKind
  /** Next 1-based number stamp (① → 1). */
  nextNumber: number
  /** Next 1-based Excel-style letter index (A → 1). */
  nextLetter: number
}

const state: StampCounters = {
  kind: 'number',
  nextNumber: 1,
  nextLetter: 1,
}

/** Excel-style column label: 1→A, 26→Z, 27→AA. */
export function toExcelColumn(index: number): string {
  let n = Math.max(1, Math.floor(index))
  let label = ''
  while (n > 0) {
    n -= 1
    label = String.fromCharCode(65 + (n % 26)) + label
    n = Math.floor(n / 26)
  }
  return label
}

export function stampLabel(kind: StampKind, index: number): string {
  if (kind === 'letter') return toExcelColumn(index)
  return String(Math.max(1, Math.floor(index)))
}

export function getStampState(): Readonly<StampCounters> {
  return state
}

export function getStampKind(): StampKind {
  return state.kind
}

export function setStampKind(kind: StampKind): StampKind {
  state.kind = kind
  return state.kind
}

/** Toggle number ↔ letter; returns the new kind. */
export function cycleStampKind(): StampKind {
  state.kind = state.kind === 'number' ? 'letter' : 'number'
  return state.kind
}

export function peekStampLabel(): string {
  return stampLabel(state.kind, state.kind === 'number' ? state.nextNumber : state.nextLetter)
}

/** Consume the next stamp label and advance the matching counter. */
export function takeStampLabel(): string {
  if (state.kind === 'number') {
    const label = stampLabel('number', state.nextNumber)
    state.nextNumber += 1
    return label
  }
  const label = stampLabel('letter', state.nextLetter)
  state.nextLetter += 1
  return label
}

/** Reset both counters (tests / full reset). Keeps or sets kind. */
export function resetStampCounters(kind: StampKind = state.kind): void {
  state.kind = kind
  state.nextNumber = 1
  state.nextLetter = 1
}

/** Reset only the active kind’s counter back to 1 / A. */
export function resetActiveStampCounter(): string {
  if (state.kind === 'number') state.nextNumber = 1
  else state.nextLetter = 1
  return peekStampLabel()
}

/** Same ladder as the text tool font size (8.6–29.7px, default 16px, one size per width preset). */
export function stampFontSizeFromWidth(lineWidth: number): number {
  return textSizeForLineWidth(lineWidth)
}

export function stampContrastColor(fillColor: string): string {
  return resolveAutoTextOutlineColor(fillColor)
}

/** White ring on dark fills (FastStone-style); dark ring on light fills. */
export function stampRingColor(fillColor: string): string {
  return stampContrastColor(fillColor)
}

/**
 * Outer stamp radius (includes the white ring).
 * Sized for at most two characters (1–99 / A–ZZ).
 */
export function stampRadius(fontSize: number, label: string): number {
  const chars = Math.max(1, label.length)
  if (chars <= 1) return fontSize * 0.82
  // Two digits: modest grow so the disc stays compact while fitting “99”
  return fontSize * 0.96
}

/**
 * Label font size. Two-digit stamps keep nearly the same visual weight as 1–9.
 */
export function stampLabelFontSize(fontSize: number, label: string): number {
  const chars = Math.max(1, label.length)
  if (chars <= 1) return fontSize * 0.8
  // Was ~0.58 (looked sparse inside the larger disc); fill closer to single-digit density
  return fontSize * 0.74
}

/** Thin white ring — ~2px at default size, scales gently. */
export function stampStrokeWidth(radius: number): number {
  return Math.max(1.75, Math.min(3, radius * 0.1))
}

/**
 * FastStone-like contact shadow: tight offset, modest blur
 * (≈ CSS `2px 3px 5px rgba(0,0,0,0.4)` at default size).
 */
export function stampShadowParams(radius: number): {
  blur: number
  offsetX: number
  offsetY: number
  alpha: number
} {
  return {
    blur: Math.max(3.5, radius * 0.28),
    offsetX: Math.max(1.25, radius * 0.1),
    offsetY: Math.max(1.75, radius * 0.14),
    alpha: 0.4,
  }
}

/** Extra bbox padding so stroke + drop shadow are not clipped when dragging. */
export function stampBboxPad(radius: number): number {
  const shadow = stampShadowParams(radius)
  return shadow.blur + Math.max(shadow.offsetX, shadow.offsetY) + 2
}

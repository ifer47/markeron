/** Timing window for double-pressing V to select every annotation. */
export const SELECT_ALL_DOUBLE_MS = 400

export interface SelectAllPressState {
  /** `performance.now()` of the last plain V press; 0 = not armed. */
  lastAt: number
}

export const EMPTY_SELECT_ALL_PRESS: SelectAllPressState = { lastAt: 0 }

/**
 * Track plain V presses. The second press inside `windowMs` completes a
 * double-press and disarms the timer, so a third press starts a new pair.
 */
export function noteSelectAllPress(
  state: SelectAllPressState,
  now: number,
  windowMs = SELECT_ALL_DOUBLE_MS,
): { isDouble: boolean; next: SelectAllPressState } {
  const isDouble = state.lastAt > 0 && now - state.lastAt <= windowMs
  return { isDouble, next: isDouble ? { ...EMPTY_SELECT_ALL_PRESS } : { lastAt: now } }
}

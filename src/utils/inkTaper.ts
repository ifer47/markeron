/** Default: on — 笔锋 is a rendering improvement, not an opt-in tool. */
export const DEFAULT_INK_TAPER = true

/** Read the persisted 笔锋 switch; configs written before the field keep it on. */
export function resolveInkTaper(general?: { inkTaper?: boolean }): boolean {
  return general?.inkTaper ?? DEFAULT_INK_TAPER
}

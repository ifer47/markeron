export type ToolbarVisibility = 'space' | 'always'

export function resolveToolbarVisibility(general?: { toolbarVisibility?: ToolbarVisibility }): ToolbarVisibility {
  return general?.toolbarVisibility ?? 'space'
}

export function isToolbarPinned(visibility: ToolbarVisibility): boolean {
  return visibility === 'always'
}

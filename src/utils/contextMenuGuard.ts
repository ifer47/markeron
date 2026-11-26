/**
 * The native WebView context menu (Reload / Inspect / Save as / Print) is browser
 * chrome, not app UI, and it can reload the whole window. Packaged builds should
 * not expose it; dev builds keep it so right-click → Inspect still works.
 *
 * Keyboard clipboard shortcuts (Ctrl/Cmd + C/V/X) are unaffected.
 */
export function installContextMenuGuard(): void {
  if (typeof document === 'undefined') return
  document.addEventListener('contextmenu', (event) => event.preventDefault())
}

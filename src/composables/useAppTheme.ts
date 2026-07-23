import { invoke } from '@tauri-apps/api/core'

export type ThemePreference = 'dark' | 'light' | 'system'
export type ResolvedTheme = 'dark' | 'light'

function systemPrefersDark(): boolean {
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

export function resolveTheme(preference: ThemePreference): ResolvedTheme {
  if (preference === 'system') return systemPrefersDark() ? 'dark' : 'light'
  return preference
}

export async function applyTheme(preference: ThemePreference): Promise<ResolvedTheme> {
  const resolved = resolveTheme(preference)
  document.documentElement.dataset.theme = resolved
  document.documentElement.style.colorScheme = resolved
  try {
    await invoke('apply_app_theme', { preference })
  } catch (error) {
    console.error('Failed to apply native theme:', error)
  }
  return resolved
}

export function watchSystemTheme(
  getPreference: () => ThemePreference,
  onResolved?: (resolved: ResolvedTheme) => void,
): () => void {
  const mql = window.matchMedia('(prefers-color-scheme: dark)')
  const handler = () => {
    if (getPreference() !== 'system') return
    void applyTheme('system').then((resolved) => onResolved?.(resolved))
  }
  mql.addEventListener('change', handler)
  return () => mql.removeEventListener('change', handler)
}

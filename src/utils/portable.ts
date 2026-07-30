import { invoke } from '@tauri-apps/api/core'

let cached: boolean | null = null

/**
 * Resolve portable mode.
 * - `true` / `false` after a successful backend read (cached)
 * - `null` when the invoke fails (not cached — callers must treat as unknown)
 */
export async function resolvePortableMode(): Promise<boolean | null> {
  if (cached !== null) return cached
  try {
    cached = await invoke<boolean>('is_portable')
    return cached
  } catch {
    return null
  }
}

/** True only when the backend confirmed portable mode. */
export async function isPortableMode(): Promise<boolean> {
  return (await resolvePortableMode()) === true
}

/**
 * True only when the backend confirmed a normal (non-portable) install.
 * Use before autostart registry writes or NSIS updater flows.
 */
export async function isInstalledMode(): Promise<boolean> {
  return (await resolvePortableMode()) === false
}

/**
 * True when OS autostart may be registered (installed release build only).
 * Debug builds load the UI from localhost and must not be added to login items.
 */
export async function supportsAutostart(): Promise<boolean> {
  try {
    return await invoke<boolean>('supports_autostart')
  } catch {
    return false
  }
}

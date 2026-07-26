export function resolveAutoStart(general?: { autoStart?: boolean }): boolean {
  return general?.autoStart ?? true
}

/**
 * Prefer the OS autostart registration as the source of truth for the toggle.
 * When the OS state can be read and differs from config, mark config out of sync
 * so the caller can persist a correction (e.g. security software blocked install).
 */
export function reconcileAutoStartState(opts: { configEnabled: boolean; osEnabled: boolean | null }): {
  enabled: boolean
  configOutOfSync: boolean
} {
  if (opts.osEnabled === null) {
    return { enabled: opts.configEnabled, configOutOfSync: false }
  }
  return {
    enabled: opts.osEnabled,
    configOutOfSync: opts.osEnabled !== opts.configEnabled,
  }
}

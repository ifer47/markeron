# Windows tray icon follows taskbar / flyout theme

**Date:** 2026-07-26  
**Status:** Approved design  
**Scope:** Windows system tray icon only (macOS unchanged)

## Problem

Windows separates **app color mode** (`AppsUseLightTheme`) from **system chrome**
(`SystemUsesLightTheme` — taskbar, Start, notification overflow / tray flyout).

MarkerOn previously tied the tray glyph to the app’s resolved theme (or forced a
permanent black icon so a white glyph would not vanish on light flyouts). On
machines with a **dark** taskbar/flyout and a different app theme, the tray icon
is wrong or hard to see.

## Decisions (locked)

| Topic | Choice |
|-------|--------|
| Tray signal | Always `SystemUsesLightTheme` — independent of `general.theme` |
| Live update | Yes — react while the app is running (no restart) |
| Settings window icon / WebView theme | Unchanged — still follow `general.theme` → `ResolvedTheme` / `AppsUseLightTheme` |
| macOS | No change — keep `iconAsTemplate` |
| User setting for tray color | Out of scope |

## Architecture

```
SystemUsesLightTheme (registry)
        │
        ├─ startup: apply_windows_tray_icon once
        └─ RegNotifyChangeKeyValue on Personalize
                 └─ re-apply tray icon

general.theme → resolve_theme (AppsUseLightTheme when system)
        │
        └─ apply_app_theme
                 ├─ settings WebView theme
                 └─ settings window icon (Windows)
                 └─ does NOT set tray icon
```

### Icon selection (Windows tray)

| `SystemUsesLightTheme` | Shell | Glyph |
|------------------------|-------|--------|
| `0` | Dark taskbar / flyout | `icon-light.png` (light) |
| `1` | Light taskbar / flyout | `icon.png` (dark) |
| Missing / read error | Treat as light shell | `icon.png` |

Existing assets only; no new PNGs.

## Components

### `theme.rs` (Windows)

- `windows_system_shell_is_light() -> bool` — read `SystemUsesLightTheme`
- `apply_windows_tray_icon(app)` — pick PNG, `tray_by_id("main").set_icon`
- `start_windows_tray_theme_watcher(app)` — background thread:
  1. Open `HKCU\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize`
  2. `RegNotifyChangeKeyValue` for value changes
  3. On notify → `apply_windows_tray_icon` → re-arm notify
- Failure to set icon: `warn!` only; never fail app startup for tray

### `lib.rs` setup

- After tray exists: call `apply_windows_tray_icon` once, then start the watcher
  (`#[cfg(target_os = "windows")]`)

### `apply_app_theme`

- Continue resolving app preference for settings chrome / window icon
- Remove tray updates from this path so Dark/Light/System app preference cannot
  override the taskbar-aligned tray glyph

## Out of scope

- Polling instead of registry notify
- Frontend `matchMedia` driving tray color
- Separate tray-color preference in settings
- Changing macOS tray behavior
- Listening to taskbar accent / wallpaper color (only light vs dark shell)

## Testing

**Unit (Rust):**

- Shell light → dark glyph bytes path; shell dark → light glyph path
- Missing registry value → light-shell default (`icon.png`)

**Manual (Windows):**

- Dark flyout → light MarkerOn tray glyph visible
- Light flyout → dark glyph visible
- Change taskbar theme in Personalization while MarkerOn runs → tray updates
  without restart
- Change MarkerOn app theme Dark ↔ Light → tray stays on taskbar signal;
  settings window icon still follows app theme

## Acceptance

1. Tray contrast matches the overflow flyout background (dark shell → light icon,
   light shell → dark icon).
2. Live Personalization changes update the tray without restarting MarkerOn.
3. App theme preference never forces the tray glyph.
4. macOS behavior unchanged.

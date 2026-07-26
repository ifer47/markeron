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
| Settings window icon (title bar + taskbar button) | Same shell signal as tray (taskbar contrast wins over in-app chrome) |
| Settings WebView / CSS theme | Still follow `general.theme` → `ResolvedTheme` / `AppsUseLightTheme` |
| macOS | No change — keep `iconAsTemplate` |
| User setting for tray color | Out of scope |

## Architecture

```
SystemUsesLightTheme (registry) / high contrast
        │
        ├─ startup: install_main_tray with shell glyph
        ├─ apply_windows_shell_icons (tray + settings window icon)
        └─ RegNotifyChangeKeyValue on Personalize
                 └─ re-apply shell icons when lightness changes

general.theme → resolve_theme (AppsUseLightTheme when system)
        │
        └─ apply_app_theme
                 ├─ settings WebView theme
                 └─ also re-applies shell icons (does not use ResolvedTheme for icons)
```

### Icon selection (Windows tray + settings taskbar button)

| `SystemUsesLightTheme` | Shell | Glyph |
|------------------------|-------|--------|
| `0` | Dark taskbar / flyout | `icon-light.png` (light) |
| `1` | Light taskbar / flyout | `icon.png` (dark) |
| Missing / read error | Treat as **dark** shell (Windows fallback) | `icon-light.png` |
| High contrast on | Luminance of `COLOR_MENU` | dark glyph if light bg, else light |

Existing assets only; no new PNGs.

### Startup

Tray is **not** declared in `tauri.conf.json`. `install_main_tray` builds it in setup with
`theme::main_tray_icon()` so the first painted glyph already matches the shell (no conf-default flash).

### Watcher

`RegNotifyChangeKeyValue` on Personalize may fire for unrelated values (`AppsUseLightTheme`, etc.).
The watcher re-resolves shell lightness and calls `apply_windows_shell_icons` **only when that
boolean changes**.

## Components

### `theme.rs` (Windows)

- `windows_system_shell_is_light() -> bool` — high contrast or `SystemUsesLightTheme`
- `apply_windows_shell_icons(app)` — tray + settings window icon from shell
- `start_windows_tray_theme_watcher(app)` — background thread:
  1. Open `HKCU\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize`
  2. `RegNotifyChangeKeyValue` for value changes
  3. On notify → `apply_windows_shell_icons` if lightness changed → re-arm notify
- Failure to set icon: `warn!` only; never fail app startup for tray

### `lib.rs` setup

- After i18n: `install_main_tray`, then start the watcher
  (`#[cfg(target_os = "windows")]`)

### `apply_app_theme`

- Resolve app preference for settings WebView / native window theme only
- Windows icons always come from shell via `apply_windows_shell_icons`

## Out of scope

- Polling instead of registry notify
- Frontend `matchMedia` driving tray color
- Separate tray-color preference in settings
- Changing macOS tray behavior
- Listening to taskbar accent / wallpaper color (only light vs dark shell)

## Testing

**Unit (Rust):**

- Shell light → dark glyph bytes path; shell dark → light glyph path
- Missing registry value → dark-shell default (`icon-light.png`)

**Manual (Windows):**

- Dark flyout → light MarkerOn tray glyph visible
- Light flyout → dark glyph visible
- Light taskbar + dark MarkerOn appearance → settings taskbar button uses **dark** glyph
- Change taskbar theme in Personalization while MarkerOn runs → tray + settings
  icons update without restart
- Change MarkerOn app theme Dark ↔ Light → tray and settings **icons** stay on
  taskbar signal; settings UI colors still follow app theme

## Acceptance

1. Tray and settings taskbar button contrast match the shell (dark shell → light
   icon, light shell → dark icon).
2. Live Personalization changes update shell icons without restarting MarkerOn.
3. App theme preference never forces tray / settings window icons.
4. macOS behavior unchanged.

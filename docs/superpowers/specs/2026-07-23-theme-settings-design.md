# Theme settings: light / dark / system

**Date:** 2026-07-23  
**Status:** Approved design  
**Issue:** [#29](https://github.com/ifer47/markeron/issues/29)  
**Scope:** Settings window + floating chrome (toolbar, Space panel, color panels); Mac + Windows

## Problem

MarkerOn UI colors are hardcoded dark (`rgba` in `src/style.css`, `Theme::Dark` in `macos.rs`). Users cannot switch to light mode or follow the OS appearance. Tray icon behavior is Mac-friendly (`iconAsTemplate`) but Windows has no light/dark tray asset switch.

## Decisions (locked)

| Topic | Choice |
|-------|--------|
| Surfaces | Settings window + floating panels (toolbar, Space, color chrome) — **not** canvas stroke colors or whiteboard fill |
| Default preference | `dark` (backward compatible; no surprise for existing users) |
| Tray | Mac: keep template auto-adapt; Windows: swap dark/light icons with **resolved** theme |
| System follow | Live: listen to `prefers-color-scheme` changes |
| Implementation | CSS variables + `html[data-theme]` (not duplicate class trees, not a theme library) |

## Out of scope

- Custom accent / palette editor for the annotation toolbar
- Canvas stroke colors, highlighter opacity, whiteboard background
- Separate “tray icon color” setting independent of UI theme
- Marketing site / store screenshot HTML theming

## Architecture

```
config.json general.theme: "dark" | "light" | "system"
        │
        ▼
   save_general / get_config / config-changed
        │
        ├─► Frontend useAppTheme → resolve → data-theme + color-scheme
        │         (settings / overlay / toolbar webviews)
        │
        └─► Rust apply_app_theme
                  ├─ macOS: set_theme + SETTINGS_BG light/dark
                  └─ Windows: tray.set_icon(dark|light)
```

### Preference vs resolved

- **Preference** (`ThemePreference`): what the user chose — `dark` | `light` | `system`
- **Resolved** (`ResolvedTheme`): what is painted — `dark` | `light`
- Frontend resolves `system` via `matchMedia('(prefers-color-scheme: dark)')`
- Rust `apply_app_theme(preference)` **also** resolves `system` (OS / Tauri APIs) for native settings chrome and Windows tray — do not rely on the webview alone
- When OS appearance changes under `system`, frontend re-runs `applyTheme` (updates CSS) **and** re-invokes `apply_app_theme` so the tray icon updates too

## Config & IPC

### Rust (`config.rs`)

```rust
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub enum ThemePreference {
    #[default]
    Dark,
    Light,
    System,
}

// In GeneralConfig:
#[serde(default, rename = "theme")]
pub theme: ThemePreference,
```

- Default `Dark`; `#[serde(default)]` so old `config.json` loads cleanly
- `normalized()` maps unknown values to `Dark`

### TypeScript (`app.d.ts`)

```typescript
theme?: 'dark' | 'light' | 'system'
```

### Commands

- Persist via existing `save_general` + `config-changed` (no new save command)
- New `apply_app_theme(preference)` for native window + tray updates
- `save_general` also calls `apply_app_theme` after persist so setting changes take effect immediately
- App setup: read config once and call `apply_app_theme`

## Frontend

### `useAppTheme` composable

- `resolveTheme(preference) → 'dark' | 'light'`
- `applyTheme(preference)` sets `document.documentElement.dataset.theme`, `colorScheme`, and invokes `apply_app_theme`
- `watchSystemTheme` only while preference is `system`; remove listener when switching to fixed light/dark

### Mount points

| Surface | When |
|---------|------|
| `App.vue` (settings mode) | Early init so shell matches before tabs load |
| `DrawingOverlay.vue` | Initial `get_config` + `config-changed` |
| `ToolbarWindow.vue` | Same |
| `SettingsView` / `GeneralTab` | UI state + save path |

### Settings UI

- General tab: “Appearance” card near language
- Three `ui-segment` options: Dark / Light / System
- Same save pattern as drag mode / eraser mode

### i18n (`en.ts` + `zh-CN.ts`)

- `settings.theme`, `settings.themeDark`, `settings.themeLight`, `settings.themeSystem`

## CSS tokens (Mac-safe)

### Structure

```css
html[data-theme='dark'] { /* migrate current rgba 1:1 */ }
html[data-theme='light'] { /* new light palette */ }
```

Semantic classes (`.settings-*`, `.overlay-*`, `.ui-*`) keep the same names; replace hardcoded `rgba` / hex with `var(--ui-…)`.

### Token groups (~25–30)

| Group | Examples |
|-------|----------|
| Surface | `--ui-bg`, `--ui-bg-elevated`, `--ui-bg-subtle` |
| Border | `--ui-border`, `--ui-border-strong`, `--ui-divider` |
| Text | `--ui-text-primary` … `--ui-text-faint` |
| Control | `--ui-control-bg`, `--ui-control-bg-hover`, `--ui-control-border` |
| Accent | `--ui-accent`, `--ui-accent-bg`, `--ui-accent-border` |
| Shadow | `--ui-shadow-panel`, `--ui-shadow-popover` |

### Rules

- Dark tokens = current hardcoded values (zero visual change at default)
- Light: light gray surfaces + dark text; accent stays `#0a84ff`
- No Tailwind opacity modifiers (`text-white/45`, etc.) — keep explicit `rgba` / token values for WebKit
- Also migrate scoped hardcodes in `SettingsView.vue` and `DiagnosticsTab.vue`

### Mac / overlay specifics

| Concern | Handling |
|---------|----------|
| Settings chrome | `macos.rs`: stop hardcoding `Theme::Dark`; `configure_settings_window(resolved)` sets theme + `SETTINGS_BG_DARK` (`#1e1e20`) / `SETTINGS_BG_LIGHT` (`#f5f5f7`) |
| Overlay / toolbar windows | Keep transparent `set_background_color(0,0,0,0)`; only CSS panel tokens change |
| Corner bleed | Keep `overlay-panel-surface`; light `.overlay-panel` uses solid light bg, not translucent white |
| `color-scheme` | Sync with resolved theme on `html` |

### Tray

- macOS: leave `iconAsTemplate: true` — no dual assets required
- Windows: existing `icons/icon.png` = tray for dark resolved theme; add `icons/icon-light.png` for light; switch in `apply_app_theme` by resolved theme

## Testing

### Automated

- Rust: default / serde round-trip / `normalized()` invalid → `Dark`
- Frontend: `useAppTheme` resolve + `dataset.theme` / `colorScheme` with mocked `matchMedia`

### Manual QA (macOS + Windows)

- Appearance segments switch immediately
- Dark ↔ light: cards, segments, popovers, help tables, diagnostics textarea
- System: OS theme change updates app live
- Space panel / toolbar / color chrome
- Mac settings title bar + no white flash; overlay corners no white bleed
- Windows tray readable on light taskbar; Mac tray template OK
- Language dropdown + shortcut tooltip not clipped
- Restart persists preference

## File touch list

| Layer | Files |
|-------|-------|
| CSS | `src/style.css`; scoped styles in `SettingsView.vue`, `DiagnosticsTab.vue` |
| FE | `useAppTheme.ts` (+ test); `App.vue`; `DrawingOverlay.vue`; `ToolbarWindow.vue`; `GeneralTab.vue`; `app.d.ts`; `en.ts`; `zh-CN.ts` |
| Rust | `config.rs`; new `theme.rs`; `commands.rs`; `macos.rs`; `lib.rs` |
| Assets | `src-tauri/icons/icon-light.png` (Windows tray) |

## Success criteria

1. User can choose Dark / Light / System in General settings
2. Default remains Dark for existing installs
3. Settings + floating chrome follow preference; canvas colors unchanged
4. System preference updates live without restart
5. Mac title bar / bg and Windows tray stay consistent with resolved theme
6. No new Tailwind opacity classes; Mac/Windows WebKit/Chromium parity preserved

# Theme Settings (Light / Dark / System) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Dark / Light / System appearance settings so settings UI and floating chrome (toolbar, Space panel, color panels) follow the preference, with Mac title-bar/background and Windows tray icons staying in sync.

**Architecture:** Persist `general.theme` (`dark` | `light` | `system`, default `dark`). Frontend `useAppTheme` resolves preference → `html[data-theme]` + `color-scheme` and listens to `prefers-color-scheme` when `system`. CSS semantic classes use shared `--ui-*` tokens. Rust `apply_app_theme` resolves the same preference for native settings chrome (macOS) and Windows tray icons.

**Tech Stack:** Vue 3, Vitest, Tauri 2 (Rust), `src/style.css` semantic rgba classes, `config.json` via `save_general`

## Global Constraints

- Surfaces: settings window + floating chrome only — **not** canvas stroke colors or whiteboard fill
- Default preference: `dark` (existing installs unchanged)
- Tray: macOS keep `iconAsTemplate: true`; Windows swap `icon.png` / `icon-light.png` by **resolved** theme
- System follow: live via `matchMedia('(prefers-color-scheme: dark)')`; on change re-apply CSS **and** re-invoke `apply_app_theme`
- No Tailwind opacity modifiers (`text-white/45`, etc.) — explicit `rgba` / CSS variables only (Mac WebKit)
- New config field must use `#[serde(default)]`; keep TS `AppConfig` in sync
- i18n: add keys to both `en.ts` and `zh-CN.ts`
- Spec: `docs/superpowers/specs/2026-07-23-theme-settings-design.md`

---

## File map

| File | Role |
|------|------|
| `src-tauri/src/config.rs` | `ThemePreference` enum + `general.theme` field + tests |
| `src-tauri/src/theme.rs` | Resolve preference; apply native theme + Windows tray |
| `src-tauri/src/commands.rs` | `apply_app_theme`; call from `save_general` |
| `src-tauri/src/macos.rs` | Theme-aware settings window bg / `set_theme` |
| `src-tauri/src/win32.rs` (or `theme.rs`) | Windows system dark detection + tray icon swap |
| `src-tauri/src/lib.rs` | `mod theme`; register command; setup `apply_app_theme` |
| `src-tauri/icons/icon-light.png` | Windows tray icon when resolved = light |
| `src/types/app.d.ts` | `theme?: 'dark' \| 'light' \| 'system'` |
| `src/composables/useAppTheme.ts` | Resolve / apply / watch system |
| `src/composables/useAppTheme.test.ts` | Unit tests |
| `src/style.css` | `--ui-*` tokens + migrate semantic classes |
| `src/components/settings/GeneralTab.vue` | Appearance segment UI |
| `src/components/SettingsView.vue` | Theme state + hardcode → tokens |
| `src/components/settings/DiagnosticsTab.vue` | Textarea colors → tokens |
| `src/App.vue` | Settings early theme init |
| `src/components/DrawingOverlay.vue` | Theme on config load / change |
| `src/components/ToolbarWindow.vue` | Same |
| `src/i18n/en.ts`, `src/i18n/zh-CN.ts` | Appearance strings |

---

### Task 1: Config — `ThemePreference` + TypeScript type

**Files:**
- Modify: `src-tauri/src/config.rs`
- Modify: `src/types/app.d.ts`
- Test: `src-tauri/src/config.rs` `#[cfg(test)]`

**Interfaces:**
- Produces: `ThemePreference { Dark, Light, System }` with serde `camelCase` (`dark`/`light`/`system`); `GeneralConfig.theme: ThemePreference` default `Dark`; `normalized()` clamps unknown → `Dark`

- [ ] **Step 1: Write failing Rust tests**

Add to `config.rs` tests module:

```rust
#[test]
fn theme_defaults_to_dark() {
    let config = AppConfig::default();
    assert_eq!(config.general.theme, ThemePreference::Dark);
}

#[test]
fn theme_deserializes_missing_as_dark() {
    let json = r#"{
        "shortcuts": {
            "toggleDrawing": "Ctrl+Shift+D",
            "clearDrawing": "Ctrl+Shift+C"
        },
        "general": {}
    }"#;
    let config: AppConfig = serde_json::from_str(json).unwrap();
    assert_eq!(config.general.theme, ThemePreference::Dark);
}

#[test]
fn theme_roundtrip_light_and_system() {
    for theme in [ThemePreference::Light, ThemePreference::System] {
        let mut config = AppConfig::default();
        config.general.theme = theme;
        let json = serde_json::to_string(&config).unwrap();
        let parsed: AppConfig = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.general.theme, theme);
    }
    let light_json = serde_json::to_string(&AppConfig {
        general: GeneralConfig {
            theme: ThemePreference::Light,
            ..GeneralConfig::default()
        },
        ..AppConfig::default()
    })
    .unwrap();
    assert!(light_json.contains("\"theme\":\"light\""));
}

#[test]
fn normalized_preserves_system_theme() {
    let g = GeneralConfig {
        theme: ThemePreference::System,
        ..GeneralConfig::default()
    };
    assert_eq!(g.normalized().theme, ThemePreference::System);
}
```

Closed enum: invalid JSON theme strings fail deserialize; `load_config` already falls back to `AppConfig::default()` (dark).

- [ ] **Step 2: Run tests — expect fail**

```bash
cd src-tauri
cargo test theme_defaults_to_dark theme_deserializes_missing_as_dark theme_roundtrip_light_and_system -- --nocapture
```

Expected: compile error — `ThemePreference` not found.

- [ ] **Step 3: Implement `ThemePreference` and wire into `GeneralConfig`**

Near other enums in `config.rs` (before `GeneralConfig`):

```rust
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub enum ThemePreference {
    #[default]
    Dark,
    Light,
    System,
}
```

In `GeneralConfig` add field (with other general fields):

```rust
#[serde(default, rename = "theme")]
pub theme: ThemePreference,
```

In `Default for GeneralConfig`:

```rust
theme: ThemePreference::Dark,
```

In `normalized()`, no clamp needed for a closed enum — leave as-is (or assert match arms if you later store as string).

Also assert in existing `default_config_roundtrip` if convenient:

```rust
assert_eq!(parsed.general.theme, ThemePreference::Dark);
```

- [ ] **Step 4: Update TypeScript type**

In `src/types/app.d.ts`, inside `general`:

```typescript
theme?: 'dark' | 'light' | 'system'
```

- [ ] **Step 5: Run Rust tests — expect pass**

```bash
cd src-tauri
cargo test theme_ -- --nocapture
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/config.rs src/types/app.d.ts
git commit -m "feat(config): add general.theme preference (dark/light/system)"
```

---

### Task 2: Rust `theme` module — resolve + native apply + IPC

**Files:**
- Create: `src-tauri/src/theme.rs`
- Modify: `src-tauri/src/macos.rs` (`SETTINGS_BG`, `style_settings_builder`, `configure_settings_window`)
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/lib.rs`
- Create: `src-tauri/icons/icon-light.png` (dark mark for light taskbars; same pixel size as `icon.png`)

**Interfaces:**
- Consumes: `ThemePreference` from `config`
- Produces:
  - `ResolvedTheme { Dark, Light }`
  - `resolve_theme(preference: &ThemePreference) -> ResolvedTheme`
  - `apply_app_theme(app: &AppHandle, preference: &ThemePreference)`
  - `#[tauri::command] apply_app_theme(app, preference: ThemePreference)`
  - `save_general` calls `apply_app_theme` after save
  - setup calls `apply_app_theme` after config load

- [ ] **Step 1: Add Windows-only `winreg` dependency**

In `src-tauri/Cargo.toml`:

```toml
[target.'cfg(target_os = "windows")'.dependencies]
winreg = "0.55"
```

- [ ] **Step 2: Add `theme.rs` with resolve + unit tests**

```rust
use crate::config::ThemePreference;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};
use tracing::warn;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ResolvedTheme {
    Dark,
    Light,
}

pub fn resolve_theme(preference: &ThemePreference) -> ResolvedTheme {
    match preference {
        ThemePreference::Dark => ResolvedTheme::Dark,
        ThemePreference::Light => ResolvedTheme::Light,
        ThemePreference::System => {
            if system_prefers_dark() {
                ResolvedTheme::Dark
            } else {
                ResolvedTheme::Light
            }
        }
    }
}

fn system_prefers_dark() -> bool {
    #[cfg(target_os = "windows")]
    {
        windows_apps_use_dark_theme()
    }
    #[cfg(target_os = "macos")]
    {
        crate::macos::system_appearance_is_dark()
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        true
    }
}

/// `AppsUseLightTheme` DWORD under
/// `HKCU\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize`
/// — `1` = light apps, `0` = dark. Missing key → treat as dark.
#[cfg(target_os = "windows")]
fn windows_apps_use_dark_theme() -> bool {
    use winreg::enums::HKEY_CURRENT_USER;
    use winreg::RegKey;
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let Ok(key) = hkcu.open_subkey(
        r"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize",
    ) else {
        return true;
    };
    let light: u32 = key.get_value("AppsUseLightTheme").unwrap_or(0);
    light == 0
}

pub fn apply_app_theme(app: &AppHandle, preference: &ThemePreference) {
    let resolved = resolve_theme(preference);

    if let Some(win) = app.get_webview_window("settings") {
        #[cfg(target_os = "macos")]
        crate::macos::configure_settings_window(&win, resolved);
        #[cfg(not(target_os = "macos"))]
        {
            let _ = win.set_theme(Some(match resolved {
                ResolvedTheme::Dark => tauri::Theme::Dark,
                ResolvedTheme::Light => tauri::Theme::Light,
            }));
        }
    }

    #[cfg(target_os = "windows")]
    if let Err(e) = update_windows_tray_icon(app, resolved) {
        warn!("Failed to update tray icon: {}", e);
    }
}

#[cfg(target_os = "windows")]
fn update_windows_tray_icon(
    app: &AppHandle,
    resolved: ResolvedTheme,
) -> Result<(), Box<dyn std::error::Error>> {
    use tauri::image::Image;
    let Some(tray) = app.tray_by_id("main") else {
        return Ok(());
    };
    let bytes: &[u8] = match resolved {
        ResolvedTheme::Dark => include_bytes!("../icons/icon.png"),
        ResolvedTheme::Light => include_bytes!("../icons/icon-light.png"),
    };
    let icon = Image::from_bytes(bytes)?;
    tray.set_icon(Some(icon))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolve_dark_and_light_are_fixed() {
        assert_eq!(
            resolve_theme(&ThemePreference::Dark),
            ResolvedTheme::Dark
        );
        assert_eq!(
            resolve_theme(&ThemePreference::Light),
            ResolvedTheme::Light
        );
    }
}
```

- [ ] **Step 3: Update macOS settings chrome + appearance probe**

In `macos.rs`, replace `SETTINGS_BG` and update configure helpers. Add appearance helper using the existing `objc_msgSend` pattern:

```rust
use crate::theme::ResolvedTheme;

const SETTINGS_BG_DARK: Color = Color(30, 30, 32, 255); // #1e1e20
const SETTINGS_BG_LIGHT: Color = Color(245, 245, 247, 255); // #f5f5f7

/// Reads `AppleInterfaceStyle` from `NSUserDefaults` (`"Dark"` → dark).
pub fn system_appearance_is_dark() -> bool {
    unsafe {
        extern "C" {
            fn objc_getClass(name: *const std::ffi::c_char) -> *mut c_void;
            fn sel_registerName(name: *const std::ffi::c_char) -> Sel;
        }
        let ns_user_defaults = objc_getClass(c"NSUserDefaults".as_ptr());
        if ns_user_defaults.is_null() {
            return true;
        }
        let standard_sel = sel_registerName(c"standardUserDefaults".as_ptr());
        let defaults = msg_send_ptr(ns_user_defaults, standard_sel);
        if defaults.is_null() {
            return true;
        }
        // stringForKey: with CFString/NSString "AppleInterfaceStyle"
        // Simplest reliable check used by many tray apps:
        extern "C" {
            fn CFPreferencesCopyAppValue(
                key: *const c_void,
                app_id: *const c_void,
            ) -> *mut c_void;
            fn CFRelease(cf: *const c_void);
            fn CFStringCreateWithCString(
                alloc: *const c_void,
                cStr: *const std::ffi::c_char,
                encoding: u32,
            ) -> *mut c_void;
            fn CFStringCompare(
                theString1: *const c_void,
                theString2: *const c_void,
                compareOptions: u64,
            ) -> i32;
        }
        const K_CF_STRING_ENCODING_UTF8: u32 = 0x08000100;
        let key = CFStringCreateWithCString(
            std::ptr::null(),
            c"AppleInterfaceStyle".as_ptr(),
            K_CF_STRING_ENCODING_UTF8,
        );
        let app = CFStringCreateWithCString(
            std::ptr::null(),
            c"Apple Global Domain".as_ptr(),
            K_CF_STRING_ENCODING_UTF8,
        );
        let value = CFPreferencesCopyAppValue(key, app);
        CFRelease(key);
        CFRelease(app);
        if value.is_null() {
            return false; // missing → light (macOS default historically)
        }
        let dark = CFStringCreateWithCString(
            std::ptr::null(),
            c"Dark".as_ptr(),
            K_CF_STRING_ENCODING_UTF8,
        );
        let cmp = CFStringCompare(value, dark, 0);
        CFRelease(dark);
        CFRelease(value);
        cmp == 0 // kCFCompareEqualTo
    }
}

pub fn style_settings_builder(
    builder: tauri::WebviewWindowBuilder<'_, tauri::Wry, AppHandle>,
) -> tauri::WebviewWindowBuilder<'_, tauri::Wry, AppHandle> {
    builder
        .title_bar_style(TitleBarStyle::Transparent)
        .theme(Some(Theme::Dark))
        .background_color(SETTINGS_BG_DARK)
}

pub fn configure_settings_window(window: &WebviewWindow, resolved: ResolvedTheme) {
    let (theme, bg) = match resolved {
        ResolvedTheme::Dark => (Theme::Dark, SETTINGS_BG_DARK),
        ResolvedTheme::Light => (Theme::Light, SETTINGS_BG_LIGHT),
    };
    window.set_theme(Some(theme)).ok();
    window.set_background_color(Some(bg)).ok();
}
```

Update `lib.rs` call site when building settings:

```rust
let preference = lock_or_recover(&app.state::<AppState>().config)
    .general
    .theme
    .clone();
macos::configure_settings_window(&window, theme::resolve_theme(&preference));
```

- [ ] **Step 4: Create `icon-light.png`**

- Source: `src-tauri/icons/icon.png`
- Produce a **dark-on-transparent** (or dark monochrome) tray glyph sized the same as `icon.png`, readable on a light Windows taskbar
- Save as `src-tauri/icons/icon-light.png`
- Do not change `tauri.conf.json` `trayIcon.iconAsTemplate` (stay `true` for Mac)
- If generating via script, e.g. ImageMagick: darken/threshold the mark so it remains visible on `#f3f3f3` taskbars; do not use a pure white glyph for the light-theme asset

- [ ] **Step 5: Command + wire `save_general` + setup**

In `commands.rs`:

```rust
#[tauri::command]
pub fn apply_app_theme(
    app: AppHandle,
    preference: crate::config::ThemePreference,
) -> AppResult<()> {
    crate::theme::apply_app_theme(&app, &preference);
    Ok(())
}
```

At end of `save_general`, after emit:

```rust
crate::theme::apply_app_theme(&app, &snapshot.general.theme);
```

In `lib.rs`:

```rust
mod theme;
// generate_handler![..., commands::apply_app_theme]
```

In setup after `load_config` / assign state:

```rust
theme::apply_app_theme(&handle, &loaded.general.theme);
```

- [ ] **Step 6: Compile + test**

```bash
cd src-tauri
cargo test theme:: -- --nocapture
cargo clippy -- -D warnings
```

Expected: PASS / no warnings.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/theme.rs src-tauri/src/macos.rs src-tauri/src/commands.rs src-tauri/src/lib.rs src-tauri/icons/icon-light.png
git commit -m "feat(theme): apply native settings chrome and Windows tray icons"
```

---

### Task 3: Frontend `useAppTheme` composable

**Files:**
- Create: `src/composables/useAppTheme.ts`
- Create: `src/composables/useAppTheme.test.ts`

**Interfaces:**
- Consumes: `invoke('apply_app_theme', { preference })`
- Produces:
  - `export type ThemePreference = 'dark' | 'light' | 'system'`
  - `export type ResolvedTheme = 'dark' | 'light'`
  - `resolveTheme(preference: ThemePreference): ResolvedTheme`
  - `applyTheme(preference: ThemePreference): ResolvedTheme`
  - `watchSystemTheme(preference: () => ThemePreference, onResolved?: (r: ResolvedTheme) => void): () => void`

- [ ] **Step 1: Write failing tests**

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { resolveTheme, applyTheme, watchSystemTheme } from './useAppTheme'

const invoke = vi.fn()
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invoke(...args),
}))

function mockMatchMedia(matchesDark: boolean) {
  const listeners: Array<(e: MediaQueryListEvent) => void> = []
  const mql = {
    matches: matchesDark,
    media: '(prefers-color-scheme: dark)',
    addEventListener: (_: string, cb: (e: MediaQueryListEvent) => void) => {
      listeners.push(cb)
    },
    removeEventListener: (_: string, cb: (e: MediaQueryListEvent) => void) => {
      const i = listeners.indexOf(cb)
      if (i >= 0) listeners.splice(i, 1)
    },
    dispatch(matches: boolean) {
      mql.matches = matches
      listeners.forEach((cb) => cb({ matches } as MediaQueryListEvent))
    },
  }
  vi.stubGlobal('matchMedia', () => mql)
  return mql
}

describe('useAppTheme', () => {
  beforeEach(() => {
    invoke.mockReset()
    invoke.mockResolvedValue(undefined)
    document.documentElement.dataset.theme = ''
    document.documentElement.style.colorScheme = ''
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('resolveTheme maps fixed preferences', () => {
    expect(resolveTheme('dark')).toBe('dark')
    expect(resolveTheme('light')).toBe('light')
  })

  it('resolveTheme system follows matchMedia', () => {
    mockMatchMedia(true)
    expect(resolveTheme('system')).toBe('dark')
    mockMatchMedia(false)
    expect(resolveTheme('system')).toBe('light')
  })

  it('applyTheme sets dataset and color-scheme and invokes Rust', async () => {
    mockMatchMedia(true)
    const resolved = await applyTheme('light')
    expect(resolved).toBe('light')
    expect(document.documentElement.dataset.theme).toBe('light')
    expect(document.documentElement.style.colorScheme).toBe('light')
    expect(invoke).toHaveBeenCalledWith('apply_app_theme', { preference: 'light' })
  })

  it('watchSystemTheme re-applies when OS theme changes', async () => {
    const mql = mockMatchMedia(true)
    const stop = watchSystemTheme(() => 'system')
    mql.dispatch(false)
    await Promise.resolve()
    expect(document.documentElement.dataset.theme).toBe('light')
    expect(invoke).toHaveBeenCalledWith('apply_app_theme', { preference: 'system' })
    stop()
  })
})
```

- [ ] **Step 2: Run tests — expect fail**

```bash
npm test -- src/composables/useAppTheme.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement composable**

```typescript
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
```

- [ ] **Step 4: Run tests — expect pass**

```bash
npm test -- src/composables/useAppTheme.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/composables/useAppTheme.ts src/composables/useAppTheme.test.ts
git commit -m "feat(theme): add useAppTheme resolve/apply/watch helpers"
```

---

### Task 4: CSS tokens — dark migrate + light palette

**Files:**
- Modify: `src/style.css`

**Interfaces:**
- Produces: `html[data-theme='dark']` and `html[data-theme='light']` (with dark as fallback when attribute missing) defining `--ui-*` tokens; all `.settings-*` / `.overlay-*` / `.ui-*` chrome colors use `var(--ui-…)`

- [ ] **Step 1: Insert token blocks after `@theme { … }` / before `@layer base`**

Use dark values that **exactly match** current hardcoded rgba/hex. Light values: light gray surfaces + dark text; accent stays `rgb(10, 132, 255)`.

```css
/* Theme tokens — explicit rgba for macOS WebKit parity */
html,
html[data-theme='dark'] {
  color-scheme: dark;
  --ui-bg: #1e1e20;
  --ui-bg-sidebar: #161618;
  --ui-bg-elevated: #2a2a2c;
  --ui-bg-subtle: rgba(255, 255, 255, 0.02);
  --ui-bg-subtle-hover: rgba(255, 255, 255, 0.03);
  --ui-border: rgba(255, 255, 255, 0.05);
  --ui-border-strong: rgba(255, 255, 255, 0.08);
  --ui-border-panel: rgba(255, 255, 255, 0.08);
  --ui-divider: rgba(255, 255, 255, 0.05);
  --ui-text-brand: rgba(255, 255, 255, 0.85);
  --ui-text-title: rgba(255, 255, 255, 0.75);
  --ui-text-heading: rgba(255, 255, 255, 0.85);
  --ui-text-label: rgba(255, 255, 255, 0.7);
  --ui-text-value: rgba(255, 255, 255, 0.65);
  --ui-text-muted: rgba(255, 255, 255, 0.45);
  --ui-text-subtle: rgba(255, 255, 255, 0.4);
  --ui-text-faint: rgba(255, 255, 255, 0.3);
  --ui-text-dim: rgba(255, 255, 255, 0.25);
  --ui-text-footer: rgba(255, 255, 255, 0.32);
  --ui-text-body: rgba(255, 255, 255, 0.5);
  --ui-text-icon: rgba(255, 255, 255, 0.35);
  --ui-text-icon-hover: rgba(255, 255, 255, 0.6);
  --ui-control-bg: rgba(255, 255, 255, 0.06);
  --ui-control-bg-hover: rgba(255, 255, 255, 0.1);
  --ui-control-border: rgba(255, 255, 255, 0.08);
  --ui-control-text: rgba(255, 255, 255, 0.65);
  --ui-kbd-bg: rgba(255, 255, 255, 0.1);
  --ui-kbd-border: rgba(255, 255, 255, 0.1);
  --ui-kbd-text: rgba(255, 255, 255, 0.7);
  --ui-accent: rgb(10, 132, 255);
  --ui-accent-soft: rgba(10, 132, 255, 0.15);
  --ui-accent-border: rgba(10, 132, 255, 0.4);
  --ui-accent-bg-active: rgba(10, 132, 255, 0.3);
  --ui-shadow-panel: 0 24px 48px rgba(0, 0, 0, 0.45), 0 4px 16px rgba(0, 0, 0, 0.25),
    inset 0 0.5px 0 rgba(255, 255, 255, 0.08);
  --ui-shadow-popover: 0 8px 32px rgba(0, 0, 0, 0.5);
  --ui-nav-text: rgba(255, 255, 255, 0.4);
  --ui-nav-text-hover: rgba(255, 255, 255, 0.6);
  --ui-nav-text-active: rgba(255, 255, 255, 0.9);
  --ui-nav-bg-hover: rgba(255, 255, 255, 0.05);
  --ui-nav-bg-active: rgba(255, 255, 255, 0.1);
  --ui-toggle-off: rgba(255, 255, 255, 0.2);
  --ui-swatch-ring: rgba(255, 255, 255, 0.1);
  --ui-swatch-ring-active: rgba(255, 255, 255, 0.75);
}

html[data-theme='light'] {
  color-scheme: light;
  --ui-bg: #f5f5f7;
  --ui-bg-sidebar: #ebebef;
  --ui-bg-elevated: #ffffff;
  --ui-bg-subtle: rgba(0, 0, 0, 0.02);
  --ui-bg-subtle-hover: rgba(0, 0, 0, 0.04);
  --ui-border: rgba(0, 0, 0, 0.06);
  --ui-border-strong: rgba(0, 0, 0, 0.1);
  --ui-border-panel: rgba(0, 0, 0, 0.1);
  --ui-divider: rgba(0, 0, 0, 0.06);
  --ui-text-brand: rgba(0, 0, 0, 0.88);
  --ui-text-title: rgba(0, 0, 0, 0.82);
  --ui-text-heading: rgba(0, 0, 0, 0.88);
  --ui-text-label: rgba(0, 0, 0, 0.75);
  --ui-text-value: rgba(0, 0, 0, 0.7);
  --ui-text-muted: rgba(0, 0, 0, 0.5);
  --ui-text-subtle: rgba(0, 0, 0, 0.45);
  --ui-text-faint: rgba(0, 0, 0, 0.35);
  --ui-text-dim: rgba(0, 0, 0, 0.28);
  --ui-text-footer: rgba(0, 0, 0, 0.38);
  --ui-text-body: rgba(0, 0, 0, 0.55);
  --ui-text-icon: rgba(0, 0, 0, 0.4);
  --ui-text-icon-hover: rgba(0, 0, 0, 0.65);
  --ui-control-bg: rgba(0, 0, 0, 0.04);
  --ui-control-bg-hover: rgba(0, 0, 0, 0.08);
  --ui-control-border: rgba(0, 0, 0, 0.1);
  --ui-control-text: rgba(0, 0, 0, 0.7);
  --ui-kbd-bg: rgba(0, 0, 0, 0.06);
  --ui-kbd-border: rgba(0, 0, 0, 0.1);
  --ui-kbd-text: rgba(0, 0, 0, 0.7);
  --ui-accent: rgb(10, 132, 255);
  --ui-accent-soft: rgba(10, 132, 255, 0.12);
  --ui-accent-border: rgba(10, 132, 255, 0.45);
  --ui-accent-bg-active: rgba(10, 132, 255, 0.22);
  --ui-shadow-panel: 0 24px 48px rgba(0, 0, 0, 0.12), 0 4px 16px rgba(0, 0, 0, 0.08),
    inset 0 0.5px 0 rgba(255, 255, 255, 0.8);
  --ui-shadow-popover: 0 8px 32px rgba(0, 0, 0, 0.14);
  --ui-nav-text: rgba(0, 0, 0, 0.45);
  --ui-nav-text-hover: rgba(0, 0, 0, 0.65);
  --ui-nav-text-active: rgba(0, 0, 0, 0.9);
  --ui-nav-bg-hover: rgba(0, 0, 0, 0.04);
  --ui-nav-bg-active: rgba(0, 0, 0, 0.08);
  --ui-toggle-off: rgba(0, 0, 0, 0.18);
  --ui-swatch-ring: rgba(0, 0, 0, 0.12);
  --ui-swatch-ring-active: rgba(0, 0, 0, 0.55);
}
```

Add more tokens as needed while migrating (status greens/reds, overlay tool btn text, etc.) — same dark=current / light=inverted-alpha pattern.

- [ ] **Step 2: Update `@layer base` settings background**

Replace hardcoded `#1e1e20` / `color-scheme: dark` with:

```css
html.settings,
html.settings body {
  height: 100%;
  background: var(--ui-bg) !important;
}

html.settings #app {
  height: 100%;
  background: var(--ui-bg);
}
```

(`color-scheme` comes from the token blocks on `html`.)

- [ ] **Step 3: Migrate semantic classes to `var(--ui-*)`**

Rewrite each chrome class that currently hardcodes white/black rgba. Examples:

```css
.settings-card {
  border: 1px solid var(--ui-border);
  background: var(--ui-bg-subtle);
  /* … */
}
.overlay-panel {
  background: var(--ui-bg);
  border: 1px solid var(--ui-border-panel);
  box-shadow: var(--ui-shadow-panel);
}
.settings-text-label {
  color: var(--ui-text-label);
}
.ui-segment--active {
  border-color: var(--ui-accent-border);
  background: var(--ui-accent-soft);
  color: var(--ui-accent);
}
```

Keep credits gold palette on dark as special `--ui-credits-*` tokens with light variants (slightly darker gold on light bg) — do not leave white-only text.

**Acceptance for this task:** with `data-theme="dark"` (default), settings/overlay look unchanged vs current master; toggling `data-theme="light"` in DevTools flips surfaces/text.

- [ ] **Step 4: Grep for leftover Tailwind opacity anti-patterns in components**

```bash
rg "border-white/|text-white/|bg-white/|bg-\[#1e1e20\]|bg-\[#161618\]" src/components src/style.css
```

Expected: zero (or only intentional non-theme canvas bits). Fix hits in Task 5/6 if found in Vue templates.

- [ ] **Step 5: Commit**

```bash
git add src/style.css
git commit -m "ui(theme): introduce dark/light CSS tokens for settings and overlay chrome"
```

---

### Task 5: Settings UI + i18n + early apply

**Files:**
- Modify: `src/i18n/en.ts`, `src/i18n/zh-CN.ts`
- Modify: `src/components/settings/GeneralTab.vue`
- Modify: `src/components/SettingsView.vue`
- Modify: `src/App.vue`
- Modify: `src/components/settings/DiagnosticsTab.vue` (scoped textarea colors)

**Interfaces:**
- Consumes: `ThemePreference`, `applyTheme`, `watchSystemTheme`, `save_general`
- Produces: Appearance segment in General tab; settings shell themed before tabs load

- [ ] **Step 1: Add i18n keys**

`en.ts` (inside `settings`):

```typescript
theme: 'Appearance',
themeDark: 'Dark',
themeLight: 'Light',
themeSystem: 'System',
```

`zh-CN.ts`:

```typescript
theme: '外观',
themeDark: '深色',
themeLight: '浅色',
themeSystem: '跟随系统',
```

- [ ] **Step 2: Wire `GeneralTab` appearance card**

Props + emit:

```typescript
theme: ThemePreference
// emit 'update:theme': [value: ThemePreference]
```

Import type from `useAppTheme`. Place a new `settings-card` **immediately below** the language card:

```vue
<div class="settings-card">
  <div class="settings-card-row">
    <span class="settings-text-label">{{ t('settings.theme') }}</span>
    <div class="flex items-center gap-1">
      <button
        v-for="opt in themeOptions"
        :key="opt"
        type="button"
        class="px-2 py-1 rounded-md ui-segment leading-none transition-colors duration-120 whitespace-nowrap"
        :class="{ 'ui-segment--active': theme === opt }"
        @click="setTheme(opt)"
      >
        {{ t(`settings.theme${opt === 'dark' ? 'Dark' : opt === 'light' ? 'Light' : 'System'}`) }}
      </button>
    </div>
  </div>
</div>
```

`setTheme` mirrors `setDragMode`:

```typescript
async function setTheme(next: ThemePreference) {
  if (next === props.theme) return
  emit('update:theme', next)
  await applyTheme(next)
  try {
    const cfg = await invoke<AppConfig>('get_config')
    if (!cfg.general) { /* init minimal general with theme */ }
    cfg.general.theme = next
    await invoke('save_general', { general: cfg.general })
  } catch (error) {
    console.error('Failed to save theme:', error)
  }
}
```

- [ ] **Step 3: Wire `SettingsView`**

```typescript
import { applyTheme, watchSystemTheme, type ThemePreference } from '../composables/useAppTheme'

const theme = ref<ThemePreference>('dark')
let stopThemeWatch: (() => void) | null = null

function resolveThemePref(general?: AppConfig['general']): ThemePreference {
  const t = general?.theme
  return t === 'light' || t === 'system' || t === 'dark' ? t : 'dark'
}

onMounted(async () => {
  const cfg = await invoke<AppConfig>('get_config')
  // …existing…
  theme.value = resolveThemePref(cfg.general)
  await applyTheme(theme.value)
  stopThemeWatch = watchSystemTheme(() => theme.value)
  // extend config-changed:
  // theme.value = resolveThemePref(event.payload.general)
  // void applyTheme(theme.value)
})

onUnmounted(() => {
  stopThemeWatch?.()
})
```

Pass `:theme` / `@update:theme` to `GeneralTab`.

Replace template hardcodes:

- Root `text-white` → remove or use a token-driven class
- Sidebar `bg-[#161618]` → style via class using `background: var(--ui-bg-sidebar)` (add `.settings-sidebar` in `style.css` if needed)
- Content `bg-[#1e1e20]` → `var(--ui-bg)` / class

- [ ] **Step 4: Early theme in `App.vue` (settings mode)**

Before/when adding `.settings` class:

```typescript
import { applyTheme, type ThemePreference } from './composables/useAppTheme'

if (mode.value === 'settings') {
  document.documentElement.classList.add('settings')
  document.documentElement.dataset.theme = 'dark' // FOUC guard
}

onMounted(async () => {
  if (mode.value === 'settings') {
    try {
      const cfg = await invoke<AppConfig>('get_config')
      const pref = (cfg.general?.theme as ThemePreference | undefined) ?? 'dark'
      await applyTheme(pref === 'light' || pref === 'system' || pref === 'dark' ? pref : 'dark')
    } catch { /* keep dark */ }
    await revealSettingsWindow()
    // …
  }
})
```

- [ ] **Step 5: Diagnostics textarea**

Replace scoped `rgba(255,…)` with `var(--ui-control-bg)` / `var(--ui-control-border)` / `var(--ui-text-value)`.

- [ ] **Step 6: Verify FE**

```bash
npm test -- src/composables/useAppTheme.test.ts
npm run lint
npx vue-tsc --noEmit
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/i18n/en.ts src/i18n/zh-CN.ts src/components/settings/GeneralTab.vue src/components/SettingsView.vue src/App.vue src/components/settings/DiagnosticsTab.vue src/style.css
git commit -m "feat(settings): add appearance control for dark/light/system theme"
```

---

### Task 6: Overlay + toolbar theme wiring

**Files:**
- Modify: `src/components/DrawingOverlay.vue`
- Modify: `src/components/ToolbarWindow.vue`

**Interfaces:**
- Consumes: `applyTheme`, `watchSystemTheme`, `config-changed`
- Produces: Overlay/toolbar chrome follow preference live (including OS changes under `system`)

- [ ] **Step 1: DrawingOverlay**

After initial `get_config` success:

```typescript
import { applyTheme, watchSystemTheme, type ThemePreference } from '../composables/useAppTheme'

function resolveThemePref(general?: AppConfig['general']): ThemePreference {
  const t = general?.theme
  return t === 'light' || t === 'system' || t === 'dark' ? t : 'dark'
}

let currentTheme: ThemePreference = 'dark'
let stopThemeWatch: (() => void) | null = null

// in onMounted after get_config:
currentTheme = resolveThemePref(cfg.general)
await applyTheme(currentTheme)
stopThemeWatch = watchSystemTheme(() => currentTheme)

// in config-changed listener:
currentTheme = resolveThemePref(event.payload.general)
void applyTheme(currentTheme)

// onUnmounted:
stopThemeWatch?.()
```

- [ ] **Step 2: ToolbarWindow** — same pattern on its config load + `config-changed`.

- [ ] **Step 3: Smoke test**

```bash
npm test
npm run lint
npx vue-tsc --noEmit
cd src-tauri && cargo test && cargo clippy -- -D warnings
```

Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add src/components/DrawingOverlay.vue src/components/ToolbarWindow.vue
git commit -m "feat(theme): sync overlay and toolbar chrome with appearance setting"
```

---

### Task 7: Manual QA checklist (Mac + Windows)

**Files:** none required unless bugs found

- [ ] **Step 1: Run app**

```bash
nvm use
npm run dev
```

- [ ] **Step 2: Verify checklist**

| # | Check | Pass? |
|---|-------|-------|
| 1 | General → Appearance shows Dark / Light / System | |
| 2 | Default is Dark; existing config without `theme` stays dark | |
| 3 | Switch Light: settings cards, nav, segments, popovers, help tables | |
| 4 | Switch System: follows OS; changing OS updates app without restart | |
| 5 | Space panel / toolbar / color chrome follow theme | |
| 6 | Canvas stroke colors unchanged | |
| 7 | Mac: settings title bar + bg match; no white flash; overlay corners no bleed | |
| 8 | Windows: tray readable on light taskbar when Light/System-light | |
| 9 | Mac tray: template still auto-adapts | |
| 10 | Language dropdown + shortcut tooltip not clipped | |
| 11 | Restart persists preference | |

- [ ] **Step 3: Fix any bugs found; commit with `fix(theme): …` as needed**

- [ ] **Step 4: Final pre-merge check**

```bash
npm test && npm run lint && npm run format:check && npx vue-tsc --noEmit
cd src-tauri && cargo fmt --check && cargo clippy -- -D warnings && cargo test
```

---

## Self-review (plan vs spec)

| Spec requirement | Task |
|------------------|------|
| `general.theme` dark/light/system, default dark | Task 1 |
| CSS variables + `data-theme` | Task 4 |
| `useAppTheme` + live system watch | Task 3, 5, 6 |
| Settings UI segments + i18n | Task 5 |
| Multi-webview apply + `config-changed` | Task 5, 6 |
| macOS `set_theme` + SETTINGS_BG | Task 2 |
| Windows tray icon swap; Mac template | Task 2 |
| Re-invoke native apply on OS change | Task 3 (`watchSystemTheme` → `applyTheme` → invoke) |
| No canvas / whiteboard / palette editor | Out of scope (Global Constraints) |
| Tests: Rust serde + FE resolve | Task 1, 3 |
| Manual Mac+Windows QA | Task 7 |

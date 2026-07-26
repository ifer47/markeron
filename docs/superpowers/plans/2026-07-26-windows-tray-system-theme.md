# Windows Tray Follows Taskbar Theme Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Windows system tray icon follow `SystemUsesLightTheme` (taskbar / overflow flyout), including live updates while MarkerOn is running, independent of `general.theme`.

**Architecture:** Split Windows chrome icons: settings window icon still uses app `ResolvedTheme`; tray uses a dedicated `apply_windows_tray_icon` driven by `SystemUsesLightTheme`. A background thread blocks on `RegNotifyChangeKeyValue` for the Personalize key and re-applies the tray icon on each change.

**Tech Stack:** Tauri 2 (Rust), `winreg` 0.55, `windows-sys` 0.59 (`Win32_System_Registry`), existing `icon.png` / `icon-light.png`

## Global Constraints

- Tray signal: always `SystemUsesLightTheme` — never `general.theme` / `AppsUseLightTheme`
- Live update: registry notify while app runs (no polling)
- Settings WebView theme + settings window icon: unchanged (still `apply_app_theme` / `ResolvedTheme`)
- macOS: unchanged (`iconAsTemplate`)
- Missing / unreadable `SystemUsesLightTheme` → treat as light shell → dark glyph `icon.png`
- Dark shell (`0`) → `icon-light.png`; light shell (`1`) → `icon.png`
- Spec: `docs/superpowers/specs/2026-07-26-windows-tray-system-theme-design.md`
- Discard any local WIP that forces tray always-black before implementing (match HEAD then apply this plan)

---

## File map

| File | Role |
|------|------|
| `src-tauri/Cargo.toml` | Add Windows-only `windows-sys` for `RegNotifyChangeKeyValue` |
| `src-tauri/src/theme.rs` | Shell light detection, tray apply, watcher; stop tray updates in `apply_app_theme` |
| `src-tauri/src/lib.rs` | After tray setup: first `apply_windows_tray_icon` + `start_windows_tray_theme_watcher` |

No frontend / config / i18n changes.

---

### Task 1: Tray icon selection + decouple from app theme

**Files:**
- Modify: `src-tauri/src/theme.rs`
- Test: `src-tauri/src/theme.rs` `#[cfg(test)]`

**Interfaces:**
- Produces:
  - `pub fn windows_system_shell_is_light() -> bool` (`#[cfg(windows)]`) — reads `SystemUsesLightTheme`; missing/error → `true`
  - `fn tray_icon_png_for_shell_light(shell_is_light: bool) -> &'static [u8]` — pure mapping for tests
  - `pub fn apply_windows_tray_icon(app: &AppHandle)` — sets tray from shell light; `warn!` on failure
- Consumes: existing `load_icon_from_png` (keep or inline); `app.tray_by_id("main")`
- Changes: `update_windows_chrome_icons` / `apply_app_theme` must **not** call `tray.set_icon`

- [ ] **Step 1: Write the failing tests**

Add to `theme.rs` tests module:

```rust
#[cfg(target_os = "windows")]
#[test]
fn tray_png_dark_shell_uses_light_glyph() {
    let bytes = tray_icon_png_for_shell_light(false);
    assert_eq!(
        bytes,
        include_bytes!("../icons/icon-light.png") as &[u8]
    );
}

#[cfg(target_os = "windows")]
#[test]
fn tray_png_light_shell_uses_dark_glyph() {
    let bytes = tray_icon_png_for_shell_light(true);
    assert_eq!(bytes, include_bytes!("../icons/icon.png") as &[u8]);
}
```

Keep existing `resolve_dark_and_light_are_fixed`.

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
cd src-tauri && cargo test --lib theme::tests::tray_png -- --nocapture
```

Expected: FAIL — `tray_icon_png_for_shell_light` not found (or similar).

- [ ] **Step 3: Implement shell read + tray apply; stop tray in app theme path**

In `theme.rs`, replace the Windows chrome/tray block so that:

1. Pure mapper:

```rust
#[cfg(target_os = "windows")]
fn tray_icon_png_for_shell_light(shell_is_light: bool) -> &'static [u8] {
    if shell_is_light {
        include_bytes!("../icons/icon.png")
    } else {
        include_bytes!("../icons/icon-light.png")
    }
}
```

2. Registry reader (keep `windows_apps_use_dark_theme` for app `system` preference):

```rust
/// `SystemUsesLightTheme` under Personalize — `1` = light taskbar/flyout,
/// `0` = dark. Missing key → treat as light (prefer dark glyph visibility).
#[cfg(target_os = "windows")]
pub fn windows_system_shell_is_light() -> bool {
    use winreg::enums::HKEY_CURRENT_USER;
    use winreg::RegKey;
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let Ok(key) =
        hkcu.open_subkey(r"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize")
    else {
        return true;
    };
    let light: u32 = key.get_value("SystemUsesLightTheme").unwrap_or(1);
    light != 0
}
```

3. Public apply:

```rust
#[cfg(target_os = "windows")]
pub fn apply_windows_tray_icon(app: &AppHandle) {
    if let Err(e) = apply_windows_tray_icon_inner(app) {
        warn!("Failed to update Windows tray icon: {}", e);
    }
}

#[cfg(target_os = "windows")]
fn apply_windows_tray_icon_inner(
    app: &AppHandle,
) -> Result<(), Box<dyn std::error::Error>> {
    let Some(tray) = app.tray_by_id("main") else {
        return Ok(());
    };
    let bytes = tray_icon_png_for_shell_light(windows_system_shell_is_light());
    tray.set_icon(Some(load_icon_from_png(bytes)?))?;
    Ok(())
}
```

4. `update_windows_chrome_icons` — **settings window icon only** (remove tray branch). Update the comment above `windows_theme_icon_png` to say it is for the settings window title-bar icon only, not tray.

5. Keep `load_icon_from_png` / `load_windows_theme_icon` / `windows_theme_icon_png` for settings window.

If the working tree still has “always black tray” comments/code, replace that with the above (do not leave a forced `icon.png` tray path).

- [ ] **Step 4: Run tests to verify they pass**

Run:

```bash
cd src-tauri && cargo test --lib theme:: -- --nocapture
```

Expected: PASS (including the two new tray PNG tests and `resolve_dark_and_light_are_fixed`).

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/theme.rs
git commit -m "$(cat <<'EOF'
fix(ui): select Windows tray icon from taskbar theme

EOF
)"
```

---

### Task 2: Registry watcher + setup wiring

**Files:**
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/Cargo.lock` (via `cargo` resolve)
- Modify: `src-tauri/src/theme.rs`
- Modify: `src-tauri/src/lib.rs`

**Interfaces:**
- Consumes: `apply_windows_tray_icon(app: &AppHandle)`, `windows_system_shell_is_light`
- Produces: `pub fn start_windows_tray_theme_watcher(app: &AppHandle)` — spawns a daemon thread; never panics the app on notify failure

- [ ] **Step 1: Add `windows-sys` Windows dependency**

In `src-tauri/Cargo.toml`, under `[target.'cfg(target_os = "windows")'.dependencies]`:

```toml
winreg = "0.55"
windows-sys = { version = "0.59", features = ["Win32_System_Registry", "Win32_Foundation"] }
```

Run:

```bash
cd src-tauri && cargo check
```

Expected: resolves; lockfile updates.

- [ ] **Step 2: Implement watcher in `theme.rs`**

```rust
/// Watch Personalize registry values and refresh the tray icon when the
/// taskbar / system shell theme changes. Fire-and-forget daemon thread.
#[cfg(target_os = "windows")]
pub fn start_windows_tray_theme_watcher(app: &AppHandle) {
    let app = app.clone();
    std::thread::Builder::new()
        .name("windows-tray-theme".into())
        .spawn(move || {
            use winreg::enums::{HKEY_CURRENT_USER, KEY_NOTIFY, KEY_READ};
            use winreg::RegKey;
            use windows_sys::Win32::Foundation::ERROR_SUCCESS;
            use windows_sys::Win32::System::Registry::{
                RegNotifyChangeKeyValue, REG_NOTIFY_CHANGE_LAST_SET, REG_NOTIFY_CHANGE_NAME,
            };

            let hkcu = RegKey::predef(HKEY_CURRENT_USER);
            let path = r"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize";
            let Ok(key) = hkcu.open_subkey_with_flags(path, KEY_READ | KEY_NOTIFY) else {
                warn!("Tray theme watcher: cannot open Personalize key");
                return;
            };

            loop {
                let status = unsafe {
                    RegNotifyChangeKeyValue(
                        key.raw_handle(),
                        0, // no subtree
                        REG_NOTIFY_CHANGE_NAME | REG_NOTIFY_CHANGE_LAST_SET,
                        std::ptr::null_mut(),
                        0, // synchronous
                    )
                };
                if status != ERROR_SUCCESS {
                    warn!(
                        "Tray theme watcher: RegNotifyChangeKeyValue failed ({})",
                        status
                    );
                    break;
                }
                apply_windows_tray_icon(&app);
            }
        })
        .ok();
}
```

Notes for implementer:

- `RegNotifyChangeKeyValue` with null event + synchronous flag blocks until the next change; after return, call `apply_windows_tray_icon` then loop to re-arm.
- Do not join the thread on exit; process exit ends it.
- `KEY_NOTIFY` is already part of `KEY_READ` on Windows; `| KEY_NOTIFY` is explicit and fine.

- [ ] **Step 3: Wire startup in `lib.rs`**

After tray menu rebuild / tray handlers are attached (tray id `"main"` exists), add:

```rust
#[cfg(target_os = "windows")]
{
    theme::apply_windows_tray_icon(&handle);
    theme::start_windows_tray_theme_watcher(&handle);
}
```

Place this **after** `rebuild_tray_menu` and tray event hooks (same `setup` closure), and **after** the existing `theme::apply_app_theme(...)` call is fine — order: `apply_app_theme` (settings chrome) then tray apply + watcher so tray is not briefly set by any leftover app-theme path.

Confirm `apply_app_theme` no longer touches the tray (Task 1).

- [ ] **Step 4: Compile + unit tests**

Run:

```bash
cd src-tauri && cargo fmt && cargo clippy -- -D warnings && cargo test --lib theme::
```

Expected: fmt clean, clippy clean, theme tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/theme.rs src-tauri/src/lib.rs
git commit -m "$(cat <<'EOF'
fix(ui): watch SystemUsesLightTheme for live tray icon

EOF
)"
```

---

### Task 3: Manual acceptance on Windows

**Files:** none (verification only)

**Interfaces:** none

- [ ] **Step 1: Run the app**

```bash
npm run dev
```

- [ ] **Step 2: Verify against acceptance criteria**

Checklist (mark each):

1. Dark taskbar / overflow flyout → light MarkerOn tray glyph (`icon-light.png`) is visible on the dark mica flyout.
2. Light taskbar / flyout → dark glyph (`icon.png`) is visible.
3. With MarkerOn running, flip Windows **Settings → Personalization → Colors → Choose your mode** (or “Windows mode” / taskbar-related mode) so the flyout light/dark changes → tray updates **without** restarting MarkerOn.
4. In MarkerOn settings, switch Appearance Dark ↔ Light ↔ System → **tray stays** on taskbar signal; settings window chrome/icon still follows app theme.
5. macOS build (if available) still uses template tray — no regression expected from `#[cfg(windows)]` gates; optional smoke: tray still clickable.

- [ ] **Step 3: If any checklist item fails, fix in `theme.rs` / `lib.rs` and amend only if the commit is still local and meets amend rules; otherwise new fix commit**

- [ ] **Step 4: No code commit required if verification passes; leave a short note in the PR/commit body of Task 2 if already covered**

---

## Spec coverage (self-review)

| Spec requirement | Task |
|------------------|------|
| Tray from `SystemUsesLightTheme` | Task 1 |
| Independent of `general.theme` | Task 1 (`apply_app_theme` no tray) |
| Live Personalize updates | Task 2 |
| Settings icon / WebView unchanged | Task 1 (window icon path kept) |
| Missing key → light shell / dark glyph | Task 1 (`unwrap_or(1)`) |
| macOS unchanged | `#[cfg(windows)]` only |
| Unit tests for glyph mapping | Task 1 |
| Manual acceptance | Task 3 |

No placeholders remaining; function names consistent across tasks (`apply_windows_tray_icon`, `start_windows_tray_theme_watcher`, `windows_system_shell_is_light`, `tray_icon_png_for_shell_light`).

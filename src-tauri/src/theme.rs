use crate::config::ThemePreference;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};
#[cfg(target_os = "windows")]
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
    let Ok(key) = hkcu.open_subkey(r"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize")
    else {
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

    // `set_theme` / WebView2 can restore the window icon from the shell's cached
    // view of icon.ico (still the pre-brand black glyph after in-place updates).
    #[cfg(target_os = "windows")]
    apply_windows_brand_icons(app);
}

/// Tray / window chrome use the single colored `icon.png` (no theme swap).
pub fn main_tray_icon() -> Result<tauri::image::Image<'static>, Box<dyn std::error::Error>> {
    use tauri::image::Image;
    let bytes = include_bytes!("../icons/icon.png");
    let rgba = image::load_from_memory(bytes)?.to_rgba8();
    let (width, height) = rgba.dimensions();
    Ok(Image::new_owned(rgba.into_raw(), width, height))
}

/// Push the brand-blue PNG onto the tray and settings HWND.
///
/// Needed on Windows even when `icon.ico` already embeds the blue asset: after an
/// in-place updater replace, Explorer keeps serving the previous black glyph from
/// its icon cache / AppUserModelID shortcut until the live window icon is set
/// explicitly (dev builds use a different exe path, so they never hit that cache).
#[cfg(target_os = "windows")]
pub fn apply_windows_brand_icons(app: &AppHandle) {
    if let Err(e) = apply_windows_brand_icons_inner(app) {
        warn!("Failed to apply Windows brand icons: {}", e);
    }
}

#[cfg(target_os = "windows")]
fn apply_windows_brand_icons_inner(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let icon = main_tray_icon()?;
    if let Some(tray) = app.tray_by_id("main") {
        tray.set_icon(Some(icon.clone()))?;
    }
    if let Some(win) = app.get_webview_window("settings") {
        win.set_icon(icon)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolve_dark_and_light_are_fixed() {
        assert_eq!(resolve_theme(&ThemePreference::Dark), ResolvedTheme::Dark);
        assert_eq!(resolve_theme(&ThemePreference::Light), ResolvedTheme::Light);
    }
}

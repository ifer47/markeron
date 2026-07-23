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
    let Ok(key) =
        hkcu.open_subkey(r"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize")
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
    let rgba = image::load_from_memory(bytes)?.to_rgba8();
    let (width, height) = rgba.dimensions();
    let icon = Image::new_owned(rgba.into_raw(), width, height);
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

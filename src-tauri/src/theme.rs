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

    #[cfg(target_os = "windows")]
    {
        apply_windows_shell_icons(app);
    }
}

/// Taskbar / tray flyout shell is light (needs a dark glyph).
///
/// Order: high contrast → sample menu background luminance; else
/// `SystemUsesLightTheme` (`1` light, `0` dark). Missing key → dark shell
/// (matches Windows fallback when the value is absent).
#[cfg(target_os = "windows")]
pub fn windows_system_shell_is_light() -> bool {
    if let Some(light) = windows_high_contrast_shell_is_light() {
        return light;
    }
    use winreg::enums::HKEY_CURRENT_USER;
    use winreg::RegKey;
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let Ok(key) = hkcu.open_subkey(r"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize")
    else {
        return false;
    };
    let light: u32 = key.get_value("SystemUsesLightTheme").unwrap_or(0);
    light != 0
}

/// When high contrast is on, derive shell lightness from `COLOR_MENU`.
/// `None` = high contrast off or query failed → fall back to registry.
#[cfg(target_os = "windows")]
fn windows_high_contrast_shell_is_light() -> Option<bool> {
    use windows_sys::Win32::Graphics::Gdi::{GetSysColor, COLOR_MENU};
    use windows_sys::Win32::UI::Accessibility::{HCF_HIGHCONTRASTON, HIGHCONTRASTW};
    use windows_sys::Win32::UI::WindowsAndMessaging::{SystemParametersInfoW, SPI_GETHIGHCONTRAST};

    let mut hc = HIGHCONTRASTW {
        cbSize: std::mem::size_of::<HIGHCONTRASTW>() as u32,
        dwFlags: 0,
        lpszDefaultScheme: std::ptr::null_mut(),
    };
    let ok = unsafe {
        SystemParametersInfoW(
            SPI_GETHIGHCONTRAST,
            hc.cbSize,
            &mut hc as *mut _ as *mut _,
            0,
        )
    };
    if ok == 0 || (hc.dwFlags & HCF_HIGHCONTRASTON) == 0 {
        return None;
    }
    let color = unsafe { GetSysColor(COLOR_MENU) };
    Some(colorref_is_light(color))
}

#[cfg(target_os = "windows")]
fn colorref_is_light(color: u32) -> bool {
    let r = color & 0xff;
    let g = (color >> 8) & 0xff;
    let b = (color >> 16) & 0xff;
    // Rec. 601 luma; threshold mid-grey.
    (r * 299 + g * 587 + b * 114) >= 128_000
}

/// Settings window title-bar / taskbar button icon follows the **shell**
/// (taskbar) theme — same glyph as the tray — not the in-app appearance.
/// Mixed modes (dark settings UI + light taskbar) prioritize taskbar contrast.
#[cfg(target_os = "windows")]
fn tray_icon_png_for_shell_light(shell_is_light: bool) -> &'static [u8] {
    if shell_is_light {
        include_bytes!("../icons/icon.png")
    } else {
        include_bytes!("../icons/icon-light.png")
    }
}

#[cfg(target_os = "windows")]
fn shell_chrome_icon_png() -> &'static [u8] {
    tray_icon_png_for_shell_light(windows_system_shell_is_light())
}

#[cfg(any(target_os = "windows", target_os = "macos"))]
fn load_icon_from_png(
    bytes: &'static [u8],
) -> Result<tauri::image::Image<'static>, Box<dyn std::error::Error>> {
    use tauri::image::Image;
    let rgba = image::load_from_memory(bytes)?.to_rgba8();
    let (width, height) = rgba.dimensions();
    Ok(Image::new_owned(rgba.into_raw(), width, height))
}

/// Initial tray glyph: Windows follows shell theme; macOS uses the template source.
pub fn main_tray_icon() -> Result<tauri::image::Image<'static>, Box<dyn std::error::Error>> {
    #[cfg(target_os = "windows")]
    {
        load_icon_from_png(shell_chrome_icon_png())
    }
    #[cfg(target_os = "macos")]
    {
        load_icon_from_png(include_bytes!("../icons/icon.png"))
    }
}

/// Refresh tray + settings window icons from the current taskbar / shell theme.
#[cfg(target_os = "windows")]
pub fn apply_windows_shell_icons(app: &AppHandle) {
    if let Err(e) = apply_windows_shell_icons_inner(app) {
        warn!("Failed to update Windows shell icons: {}", e);
    }
}

#[cfg(target_os = "windows")]
fn apply_windows_shell_icons_inner(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let icon = load_icon_from_png(shell_chrome_icon_png())?;
    if let Some(tray) = app.tray_by_id("main") {
        tray.set_icon(Some(icon.clone()))?;
    }
    if let Some(win) = app.get_webview_window("settings") {
        win.set_icon(icon)?;
    }
    Ok(())
}

/// Watch Personalize; refresh tray + settings taskbar icon only when shell
/// lightness actually changes.
#[cfg(target_os = "windows")]
pub fn start_windows_tray_theme_watcher(app: &AppHandle) {
    let app = app.clone();
    std::thread::Builder::new()
        .name("windows-tray-theme".into())
        .spawn(move || {
            use windows_sys::Win32::Foundation::ERROR_SUCCESS;
            use windows_sys::Win32::System::Registry::{
                RegNotifyChangeKeyValue, REG_NOTIFY_CHANGE_LAST_SET, REG_NOTIFY_CHANGE_NAME,
            };
            use winreg::enums::{HKEY_CURRENT_USER, KEY_NOTIFY, KEY_READ};
            use winreg::RegKey;

            let hkcu = RegKey::predef(HKEY_CURRENT_USER);
            let path = r"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize";
            let Ok(key) = hkcu.open_subkey_with_flags(path, KEY_READ | KEY_NOTIFY) else {
                warn!("Tray theme watcher: cannot open Personalize key");
                return;
            };

            let mut last_light = windows_system_shell_is_light();

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
                let now_light = windows_system_shell_is_light();
                if last_light != now_light {
                    last_light = now_light;
                    apply_windows_shell_icons(&app);
                }
            }
        })
        .ok();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolve_dark_and_light_are_fixed() {
        assert_eq!(resolve_theme(&ThemePreference::Dark), ResolvedTheme::Dark);
        assert_eq!(resolve_theme(&ThemePreference::Light), ResolvedTheme::Light);
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn tray_png_dark_shell_uses_light_glyph() {
        let bytes = tray_icon_png_for_shell_light(false);
        assert_eq!(bytes, include_bytes!("../icons/icon-light.png") as &[u8]);
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn tray_png_light_shell_uses_dark_glyph() {
        let bytes = tray_icon_png_for_shell_light(true);
        assert_eq!(bytes, include_bytes!("../icons/icon.png") as &[u8]);
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn colorref_mid_grey_and_extremes() {
        assert!(colorref_is_light(0x00ff_ffff)); // white
        assert!(!colorref_is_light(0x0000_0000)); // black
        assert!(colorref_is_light(0x00c0_c0c0)); // light grey
        assert!(!colorref_is_light(0x0040_4040)); // dark grey
    }
}

use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_global_shortcut::GlobalShortcutExt;
use tauri_plugin_opener::OpenerExt;
use tracing::{info, warn};

use crate::config::{
    lock_or_recover, AppConfig, AppState, GeneralConfig, LineWidthsConfig, SaveResult, Shortcuts,
};
use crate::error::{AppError, AppResult};
use crate::shortcuts::{parse_shortcut, register_shortcuts};

fn duplicate_shortcut_errors(shortcuts: &Shortcuts) -> Vec<String> {
    let s = crate::i18n::strings();
    let actions = [
        (s.toggle_drawing, shortcuts.toggle_drawing.as_str()),
        (s.clear_drawing, shortcuts.clear_drawing.as_str()),
        (s.toggle_penetration, shortcuts.toggle_penetration.as_str()),
    ];
    let mut failed = Vec::new();
    for i in 0..actions.len() {
        for j in (i + 1)..actions.len() {
            // Empty = unbound; multiple unbound shortcuts are allowed.
            if actions[i].1.is_empty() || actions[j].1.is_empty() {
                continue;
            }
            if actions[i].1 == actions[j].1 {
                failed.push(format!(
                    "Duplicate shortcut: {} and {}",
                    actions[i].0, actions[j].0
                ));
            }
        }
    }
    failed
}

/// Non-empty accel that fails to parse is a hard validation error.
fn invalid_shortcut_errors(shortcuts: &Shortcuts) -> Vec<String> {
    let s = crate::i18n::strings();
    let actions = [
        (s.toggle_drawing, shortcuts.toggle_drawing.as_str()),
        (s.clear_drawing, shortcuts.clear_drawing.as_str()),
        (s.toggle_penetration, shortcuts.toggle_penetration.as_str()),
    ];
    let mut failed = Vec::new();
    for (label, accel) in actions {
        if accel.is_empty() {
            continue;
        }
        if parse_shortcut(accel).is_none() {
            failed.push(format!("{}: {}", label, accel));
        }
    }
    failed
}

#[tauri::command]
pub fn get_config(state: tauri::State<'_, AppState>) -> AppConfig {
    lock_or_recover(&state.config).clone()
}

#[tauri::command]
pub fn get_overlay_pointer_position(
    app: AppHandle,
) -> Option<crate::monitor::OverlayPointerPosition> {
    crate::monitor::get_overlay_client_pointer(&app)
}

#[tauri::command]
pub fn get_overlay_monitor_logical_bounds(
    app: AppHandle,
) -> Option<crate::monitor::MonitorLogicalBounds> {
    crate::monitor::get_overlay_monitor_logical_bounds(&app)
}

#[tauri::command]
pub fn is_pointer_over_toolbar_panel(app: AppHandle) -> bool {
    crate::overlay::is_pointer_over_toolbar_panel(&app)
}

#[tauri::command]
pub fn set_overlay_ignore_cursor_events(
    app: AppHandle,
    state: tauri::State<'_, AppState>,
    ignore: bool,
) {
    crate::overlay::set_overlay_ignore_cursor_events(&app, &state, ignore);
}

#[tauri::command]
pub fn save_shortcuts(
    app: AppHandle,
    state: tauri::State<'_, AppState>,
    shortcuts: Shortcuts,
) -> SaveResult {
    // Hard validation: invalid format or in-app duplicates block the whole save.
    let mut hard_failed = invalid_shortcut_errors(&shortcuts);
    hard_failed.extend(duplicate_shortcut_errors(&shortcuts));

    if !hard_failed.is_empty() {
        return SaveResult {
            ok: false,
            failed: Some(hard_failed),
        };
    }

    app.global_shortcut().unregister_all().ok();

    let s = crate::i18n::strings();
    let actions: Vec<(&str, &str)> = vec![
        (s.toggle_drawing, &shortcuts.toggle_drawing),
        (s.clear_drawing, &shortcuts.clear_drawing),
        (s.toggle_penetration, &shortcuts.toggle_penetration),
    ];

    // Soft validation: OS/other-app occupation — still persist config so one
    // occupied binding cannot block changing or clearing the others.
    let mut warnings = Vec::new();
    for (label, accel) in &actions {
        if accel.is_empty() {
            continue;
        }
        if let Some(shortcut) = parse_shortcut(accel) {
            if app.global_shortcut().register(shortcut).is_err() {
                warnings.push(format!("{}: {}", label, accel));
            }
        }
    }

    {
        let mut cfg = lock_or_recover(&state.config);
        cfg.shortcuts = shortcuts;
        crate::config::save_config(&app, &cfg);
    }
    // Re-bind from saved config (skips empty / logs OS failures).
    register_shortcuts(&app);

    if warnings.is_empty() {
        info!("Shortcuts saved successfully");
        SaveResult {
            ok: true,
            failed: None,
        }
    } else {
        warn!(
            "Shortcuts saved with OS registration warnings: {:?}",
            warnings
        );
        SaveResult {
            ok: true,
            failed: Some(warnings),
        }
    }
}

#[tauri::command]
pub fn save_general(
    app: AppHandle,
    state: tauri::State<'_, AppState>,
    general: GeneralConfig,
) -> AppResult<()> {
    let snapshot = {
        let mut cfg = lock_or_recover(&state.config);
        cfg.general = general.normalized();
        crate::config::save_config(&app, &cfg);
        cfg.clone()
    };
    let auto_start = snapshot.general.auto_start;
    let theme = snapshot.general.theme;
    if let Err(e) = app.emit("config-changed", snapshot) {
        warn!("Failed to emit config-changed: {}", e);
    }
    crate::config::sync_autostart(&app, auto_start);
    if crate::overlay::current_mode(&state) != crate::overlay::OverlayMode::Hidden {
        crate::overlay::ensure_toolbar_window(&app, &state);
    }
    crate::theme::apply_app_theme(&app, &theme);
    info!("General config saved");
    Ok(())
}

/// Patch only `lineWidths` under the config lock so concurrent `save_general`
/// callers cannot clobber each other (and vice versa).
#[tauri::command]
pub fn save_line_widths(
    app: AppHandle,
    state: tauri::State<'_, AppState>,
    line_widths: LineWidthsConfig,
) -> AppResult<()> {
    let normalized = line_widths.normalized();
    let snapshot = {
        let mut cfg = lock_or_recover(&state.config);
        if cfg.general.line_widths == normalized {
            return Ok(());
        }
        cfg.general.line_widths = normalized;
        crate::config::save_config(&app, &cfg);
        cfg.clone()
    };
    if let Err(e) = app.emit("config-changed", snapshot) {
        warn!("Failed to emit config-changed: {}", e);
    }
    info!("Line widths saved");
    Ok(())
}

#[tauri::command]
pub fn save_locale(
    app: AppHandle,
    state: tauri::State<'_, AppState>,
    locale: String,
) -> AppResult<()> {
    {
        let mut cfg = lock_or_recover(&state.config);
        cfg.general.locale = Some(locale.clone());
        crate::config::save_config(&app, &cfg);
    }

    crate::i18n::set_locale(&locale);
    crate::rebuild_tray_menu(&app).map_err(|e| AppError::Other(e.to_string()))?;

    if let Some(win) = app.get_webview_window("settings") {
        if let Err(e) = win.set_title(crate::i18n::strings().window_title) {
            warn!("Failed to set settings window title: {}", e);
        }
    }

    info!("Locale changed to {}", locale);
    Ok(())
}

#[tauri::command]
pub fn apply_app_theme(
    app: AppHandle,
    preference: crate::config::ThemePreference,
) -> AppResult<()> {
    crate::theme::apply_app_theme(&app, &preference);
    Ok(())
}

#[tauri::command]
pub fn exit_drawing(app: AppHandle, state: tauri::State<'_, AppState>) {
    crate::deactivate_drawing(&app, &state);
}

#[tauri::command]
pub fn enter_penetration_mode(app: AppHandle, state: tauri::State<'_, AppState>) {
    crate::enter_penetration_mode(&app, &state);
}

#[tauri::command]
pub fn exit_penetration_mode(app: AppHandle, state: tauri::State<'_, AppState>) {
    crate::exit_penetration_mode(&app, &state);
}

#[tauri::command]
pub fn toggle_penetration_mode(app: AppHandle, state: tauri::State<'_, AppState>) {
    crate::toggle_penetration_mode(&app, &state);
}

#[tauri::command]
pub fn set_whiteboard_mode(state: tauri::State<'_, AppState>, active: bool) {
    *lock_or_recover(&state.whiteboard_mode) = active;
}

#[tauri::command]
pub fn set_toolbar_visible(app: AppHandle, visible: bool) {
    crate::set_toolbar_window_visible(&app, visible);
}

#[tauri::command]
pub fn set_toolbar_popup(
    app: AppHandle,
    state: tauri::State<'_, AppState>,
    visible: bool,
    x: Option<f64>,
    y: Option<f64>,
    height: Option<f64>,
) {
    crate::overlay::set_toolbar_popup(&app, &state, visible, x, y, height);
}

#[tauri::command]
pub fn suppress_penetration(state: tauri::State<'_, AppState>, duration_ms: Option<u64>) {
    crate::overlay::suppress_penetration_for(&state, duration_ms.unwrap_or(800));
}

#[tauri::command]
pub fn raise_toolbar(app: AppHandle) {
    crate::overlay::raise_toolbar_above_overlay(&app);
}

const ALLOWED_URL_PREFIXES: &[&str] = &[
    "https://github.com/",
    "https://apps.microsoft.com/",
    "https://afdian.com/",
    "https://markeron.cn/",
];

fn is_allowed_open_url(url: &str) -> bool {
    ALLOWED_URL_PREFIXES
        .iter()
        .any(|prefix| url.starts_with(prefix))
}

#[tauri::command]
pub fn reveal_settings_window(app: AppHandle) {
    crate::reveal_settings_window(&app);
}

#[tauri::command]
pub fn is_portable() -> bool {
    crate::portable::is_portable()
}

#[tauri::command]
pub fn open_url(app: AppHandle, url: String) -> AppResult<()> {
    if !is_allowed_open_url(&url) {
        warn!("Blocked open_url for untrusted URL: {}", url);
        return Err(AppError::Other("URL not allowed".into()));
    }
    app.opener()
        .open_url(&url, None::<&str>)
        .map_err(|e| AppError::Other(e.to_string()))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::default_shortcuts;

    #[test]
    fn duplicate_shortcut_errors_empty_for_defaults() {
        assert!(duplicate_shortcut_errors(&default_shortcuts()).is_empty());
    }

    #[test]
    fn duplicate_shortcut_errors_detects_collision() {
        let mut shortcuts = default_shortcuts();
        shortcuts.clear_drawing = shortcuts.toggle_drawing.clone();
        let errors = duplicate_shortcut_errors(&shortcuts);
        assert_eq!(errors.len(), 1);
        assert!(errors[0].contains("Duplicate shortcut"));
    }

    #[test]
    fn duplicate_shortcut_errors_ignores_empty_bindings() {
        let mut shortcuts = default_shortcuts();
        shortcuts.clear_drawing = String::new();
        shortcuts.toggle_penetration = String::new();
        assert!(duplicate_shortcut_errors(&shortcuts).is_empty());
    }

    #[test]
    fn invalid_shortcut_errors_allows_empty() {
        let mut shortcuts = default_shortcuts();
        shortcuts.clear_drawing = String::new();
        assert!(invalid_shortcut_errors(&shortcuts).is_empty());
    }

    #[test]
    fn invalid_shortcut_errors_rejects_garbage() {
        let mut shortcuts = default_shortcuts();
        shortcuts.clear_drawing = "NotAKey".into();
        let errors = invalid_shortcut_errors(&shortcuts);
        assert_eq!(errors.len(), 1);
        assert!(errors[0].contains("NotAKey"));
    }

    #[test]
    fn open_url_allowlist_permits_known_destinations() {
        assert!(is_allowed_open_url("https://github.com/ifer47/markeron"));
        assert!(is_allowed_open_url(
            "https://github.com/ifer47/markeron/issues"
        ));
        assert!(is_allowed_open_url("https://afdian.com/a/markeron"));
        assert!(is_allowed_open_url(
            "https://apps.microsoft.com/store/detail/markeron/9P123"
        ));
        assert!(is_allowed_open_url("https://markeron.cn/help.html"));
    }

    #[test]
    fn open_url_allowlist_blocks_untrusted_destinations() {
        assert!(!is_allowed_open_url("https://example.com/"));
        assert!(!is_allowed_open_url("http://github.com/ifer47/markeron"));
        assert!(!is_allowed_open_url(
            "https://afdian.com.evil.com/a/markeron"
        ));
        assert!(!is_allowed_open_url("https://markeron.cn.evil.com/help"));
        assert!(!is_allowed_open_url("http://markeron.cn/help.html"));
    }
}

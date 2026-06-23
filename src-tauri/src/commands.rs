use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_global_shortcut::GlobalShortcutExt;
use tauri_plugin_opener::OpenerExt;
use tracing::{info, warn};

use crate::config::{lock_or_recover, AppConfig, AppState, GeneralConfig, SaveResult, Shortcuts};
use crate::error::{AppError, AppResult};
use crate::shortcuts::{parse_shortcut, register_shortcuts};

#[tauri::command]
pub fn get_config(state: tauri::State<'_, AppState>) -> AppConfig {
    lock_or_recover(&state.config).clone()
}

#[tauri::command]
pub fn save_shortcuts(
    app: AppHandle,
    state: tauri::State<'_, AppState>,
    shortcuts: Shortcuts,
) -> SaveResult {
    let old_config = lock_or_recover(&state.config).clone();
    let mut failed = Vec::new();

    app.global_shortcut().unregister_all().ok();

    let s = crate::i18n::strings();
    let actions: Vec<(&str, &str)> = vec![
        (s.toggle_drawing, &shortcuts.toggle_drawing),
        (s.clear_drawing, &shortcuts.clear_drawing),
    ];

    for (label, accel) in &actions {
        if parse_shortcut(accel).is_none() {
            failed.push(format!("{}: {}", label, accel));
        }
    }

    if !failed.is_empty() {
        *lock_or_recover(&state.config) = old_config;
        register_shortcuts(&app);
        return SaveResult {
            ok: false,
            failed: Some(failed),
        };
    }

    for (label, accel) in &actions {
        if let Some(shortcut) = parse_shortcut(accel) {
            if app.global_shortcut().register(shortcut).is_err() {
                failed.push(format!("{}: {}", label, accel));
            }
        }
    }

    if !failed.is_empty() {
        *lock_or_recover(&state.config) = old_config;
        register_shortcuts(&app);
        return SaveResult {
            ok: false,
            failed: Some(failed),
        };
    }

    {
        let mut cfg = lock_or_recover(&state.config);
        cfg.shortcuts = shortcuts;
        crate::config::save_config(&app, &cfg);
    }
    register_shortcuts(&app);

    info!("Shortcuts saved successfully");
    SaveResult {
        ok: true,
        failed: None,
    }
}

#[tauri::command]
pub fn save_general(
    app: AppHandle,
    state: tauri::State<'_, AppState>,
    general: GeneralConfig,
) -> AppResult<()> {
    let mut cfg = lock_or_recover(&state.config);
    cfg.general = general.clone();
    crate::config::save_config(&app, &cfg);
    if let Err(e) = app.emit("config-changed", cfg.clone()) {
        warn!("Failed to emit config-changed: {}", e);
    }
    info!("General config saved");
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
pub fn exit_drawing(app: AppHandle, state: tauri::State<'_, AppState>) {
    crate::deactivate_drawing(&app, &state);
}

const ALLOWED_URL_PREFIXES: &[&str] = &[
    "https://github.com/",
    "https://apps.microsoft.com/",
];

#[tauri::command]
pub fn open_url(app: AppHandle, url: String) -> AppResult<()> {
    if !ALLOWED_URL_PREFIXES.iter().any(|prefix| url.starts_with(prefix)) {
        warn!("Blocked open_url for untrusted URL: {}", url);
        return Err(AppError::Other("URL not allowed".into()));
    }
    app.opener()
        .open_url(&url, None::<&str>)
        .map_err(|e| AppError::Other(e.to_string()))?;
    Ok(())
}

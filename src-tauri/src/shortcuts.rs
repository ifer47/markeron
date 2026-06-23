use tauri::{AppHandle, Manager};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut};
use tracing::warn;

use crate::config::{lock_or_recover, AppState};

pub fn parse_shortcut(accel: &str) -> Option<Shortcut> {
    accel.parse::<Shortcut>().ok()
}

pub fn register_shortcuts(app: &AppHandle) {
    let state = app.state::<AppState>();
    let config = lock_or_recover(&state.config).clone();

    if let Err(e) = app.global_shortcut().unregister_all() {
        warn!("Failed to unregister shortcuts: {}", e);
    }

    let app_handle = app.clone();
    if let Some(shortcut) = parse_shortcut(&config.shortcuts.toggle_drawing) {
        let h = app_handle.clone();
        if let Err(e) = app.global_shortcut().on_shortcut(shortcut, move |_app, _shortcut, event| {
            if event.state == tauri_plugin_global_shortcut::ShortcutState::Pressed {
                crate::toggle_drawing(&h);
            }
        }) {
            warn!("Failed to register toggle_drawing shortcut: {}", e);
        }
    }

    if let Some(shortcut) = parse_shortcut(&config.shortcuts.clear_drawing) {
        let h = app_handle.clone();
        if let Err(e) = app.global_shortcut().on_shortcut(shortcut, move |_app, _shortcut, event| {
            if event.state == tauri_plugin_global_shortcut::ShortcutState::Pressed {
                crate::clear_drawing(&h);
            }
        }) {
            warn!("Failed to register clear_drawing shortcut: {}", e);
        }
    }
}

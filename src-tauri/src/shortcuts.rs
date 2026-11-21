use tauri::{AppHandle, Manager};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut};
use tracing::{info, warn};

use crate::config::{lock_or_recover, AppState};
use crate::diagnostics::log_backend_event;

pub fn parse_shortcut(accel: &str) -> Option<Shortcut> {
    accel.parse::<Shortcut>().ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_valid_shortcuts() {
        assert!(parse_shortcut("Ctrl+Shift+D").is_some());
        assert!(parse_shortcut("Ctrl+Shift+C").is_some());
        assert!(parse_shortcut("Ctrl+Alt+X").is_some());
        assert!(parse_shortcut("Shift+A").is_some());
        assert!(parse_shortcut("Ctrl+Z").is_some());
    }

    #[test]
    fn parse_invalid_shortcuts() {
        assert!(parse_shortcut("").is_none());
        assert!(parse_shortcut("NotAKey").is_none());
        assert!(parse_shortcut("+++").is_none());
    }

    #[test]
    fn parse_single_modifier_only_is_invalid() {
        assert!(parse_shortcut("Ctrl").is_none());
        assert!(parse_shortcut("Shift").is_none());
        assert!(parse_shortcut("Alt").is_none());
    }

    #[test]
    fn parse_function_keys() {
        assert!(parse_shortcut("F1").is_some());
        assert!(parse_shortcut("Ctrl+F5").is_some());
        assert!(parse_shortcut("Alt+F12").is_some());
    }

    #[test]
    fn parse_bare_escape() {
        // The preserved-ink layer binds Esc globally; both spellings must resolve.
        assert_eq!(parse_shortcut("Esc"), parse_shortcut("Escape"));
        assert!(parse_shortcut("Esc").is_some());
    }

    #[test]
    fn parse_default_shortcuts_are_valid() {
        let defaults = crate::config::default_shortcuts();
        assert!(parse_shortcut(&defaults.toggle_drawing).is_some());
        assert!(parse_shortcut(&defaults.clear_drawing).is_some());
        assert!(parse_shortcut(&defaults.toggle_penetration).is_some());
    }
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
        if let Err(e) =
            app.global_shortcut()
                .on_shortcut(shortcut, move |_app, _shortcut, event| {
                    if event.state == tauri_plugin_global_shortcut::ShortcutState::Pressed {
                        let state = h.state::<AppState>();
                        log_backend_event(
                            &state,
                            "session",
                            "toggle drawing requested",
                            Some(serde_json::json!({ "reason": "global-shortcut" })),
                            "info",
                        );
                        crate::toggle_drawing(&h);
                    }
                })
        {
            warn!("Failed to register toggle_drawing shortcut: {}", e);
        } else {
            info!(
                "Registered toggle_drawing shortcut: {}",
                config.shortcuts.toggle_drawing
            );
        }
    }

    if let Some(shortcut) = parse_shortcut(&config.shortcuts.clear_drawing) {
        if let Err(e) = app
            .global_shortcut()
            .on_shortcut(shortcut, move |app, _shortcut, event| {
                if event.state == tauri_plugin_global_shortcut::ShortcutState::Pressed {
                    let state = app.state::<crate::config::AppState>();
                    log_backend_event(
                        &state,
                        "action",
                        "canvas cleared",
                        Some(serde_json::json!({ "reason": "global-shortcut" })),
                        "info",
                    );
                    crate::clear_drawing(app, &state);
                }
            })
        {
            warn!("Failed to register clear_drawing shortcut: {}", e);
        }
    }

    if let Some(shortcut) = parse_shortcut(&config.shortcuts.toggle_penetration) {
        if let Err(e) = app
            .global_shortcut()
            .on_shortcut(shortcut, move |app, _shortcut, event| {
                if event.state == tauri_plugin_global_shortcut::ShortcutState::Pressed {
                    let state = app.state::<crate::config::AppState>();
                    log_backend_event(
                        &state,
                        "action",
                        "toggle penetration requested",
                        Some(serde_json::json!({ "reason": "global-shortcut" })),
                        "info",
                    );
                    crate::toggle_penetration_mode(app, &state);
                }
            })
        {
            warn!("Failed to register toggle_penetration shortcut: {}", e);
        } else {
            info!(
                "Registered toggle_penetration shortcut: {}",
                config.shortcuts.toggle_penetration
            );
        }
    }

    // `unregister_all` dropped the preserved-layer Esc binding along with the configured
    // shortcuts; re-register it if the ink is still on screen.
    crate::overlay::sync_preserved_escape(app);
}

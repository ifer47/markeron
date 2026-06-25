use tauri::{AppHandle, Manager};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut};
use tracing::warn;

use crate::config::{lock_or_recover, AppState};

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
    fn parse_default_shortcuts_are_valid() {
        let defaults = crate::config::default_shortcuts();
        assert!(parse_shortcut(&defaults.toggle_drawing).is_some());
        assert!(parse_shortcut(&defaults.clear_drawing).is_some());
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
                        crate::toggle_drawing(&h);
                    }
                })
        {
            warn!("Failed to register toggle_drawing shortcut: {}", e);
        }
    }

    if let Some(shortcut) = parse_shortcut(&config.shortcuts.clear_drawing) {
        let h = app_handle.clone();
        if let Err(e) =
            app.global_shortcut()
                .on_shortcut(shortcut, move |_app, _shortcut, event| {
                    if event.state == tauri_plugin_global_shortcut::ShortcutState::Pressed {
                        crate::clear_drawing(&h);
                    }
                })
        {
            warn!("Failed to register clear_drawing shortcut: {}", e);
        }
    }
}

use serde::{Deserialize, Serialize};
use std::fs;
use std::sync::{Mutex, MutexGuard};
use tauri::{AppHandle, Manager};
use tracing::{info, warn};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Shortcuts {
    #[serde(rename = "toggleDrawing")]
    pub toggle_drawing: String,
    #[serde(rename = "clearDrawing")]
    pub clear_drawing: String,
}

fn default_angle_snap_step() -> u16 {
    15
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GeneralConfig {
    #[serde(rename = "enableDragging")]
    pub enable_dragging: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub locale: Option<String>,
    #[serde(default, rename = "preserveDrawings")]
    pub preserve_drawings: bool,
    #[serde(default, rename = "whiteboardPreserveDrawings")]
    pub whiteboard_preserve_drawings: bool,
    #[serde(default = "default_angle_snap_step", rename = "angleSnapStep")]
    pub angle_snap_step: u16,
}

impl Default for GeneralConfig {
    fn default() -> Self {
        Self {
            enable_dragging: false,
            locale: None,
            preserve_drawings: false,
            whiteboard_preserve_drawings: true,
            angle_snap_step: default_angle_snap_step(),
        }
    }
}

impl GeneralConfig {
    pub fn normalized(mut self) -> Self {
        if !matches!(self.angle_snap_step, 15 | 30 | 45) {
            self.angle_snap_step = default_angle_snap_step();
        }
        self
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppConfig {
    pub shortcuts: Shortcuts,
    #[serde(default)]
    pub general: GeneralConfig,
}

pub fn default_shortcuts() -> Shortcuts {
    #[cfg(target_os = "macos")]
    {
        Shortcuts {
            toggle_drawing: "Command+Shift+D".into(),
            clear_drawing: "Command+Shift+C".into(),
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        Shortcuts {
            toggle_drawing: "Ctrl+Shift+D".into(),
            clear_drawing: "Ctrl+Shift+C".into(),
        }
    }
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            shortcuts: default_shortcuts(),
            general: GeneralConfig::default().normalized(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SaveResult {
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub failed: Option<Vec<String>>,
}

pub struct AppState {
    pub config: Mutex<AppConfig>,
    pub is_drawing: Mutex<bool>,
}

/// Lock a mutex with poison recovery — if a thread panicked while holding
/// the lock, we recover the inner value instead of propagating the panic.
pub fn lock_or_recover<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|poisoned| {
        warn!("Mutex was poisoned, recovering");
        poisoned.into_inner()
    })
}

pub fn config_path(app: &AppHandle) -> std::path::PathBuf {
    let dir = app
        .path()
        .app_config_dir()
        .expect("failed to get config dir");
    fs::create_dir_all(&dir).ok();
    dir.join("config.json")
}

pub fn load_config(app: &AppHandle) -> AppConfig {
    let path = config_path(app);
    match fs::read_to_string(&path) {
        Ok(raw) => match serde_json::from_str(&raw) {
            Ok(cfg) => {
                info!("Loaded config from {}", path.display());
                cfg
            }
            Err(e) => {
                warn!(
                    "Config file corrupted ({}), using defaults: {}",
                    path.display(),
                    e
                );
                AppConfig::default()
            }
        },
        Err(_) => {
            info!("No config file found, using defaults");
            AppConfig::default()
        }
    }
}

pub fn save_config(app: &AppHandle, config: &AppConfig) {
    let path = config_path(app);
    match serde_json::to_string_pretty(config) {
        Ok(json) => {
            if let Err(e) = fs::write(&path, json) {
                warn!("Failed to write config to {}: {}", path.display(), e);
            }
        }
        Err(e) => {
            warn!("Failed to serialize config: {}", e);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_config_serializes_to_valid_json() {
        let config = AppConfig::default();
        let json = serde_json::to_string_pretty(&config).unwrap();
        assert!(json.contains("toggleDrawing"));
        assert!(json.contains("clearDrawing"));
    }

    #[test]
    fn default_config_roundtrip() {
        let config = AppConfig::default();
        let json = serde_json::to_string(&config).unwrap();
        let parsed: AppConfig = serde_json::from_str(&json).unwrap();
        assert_eq!(
            parsed.shortcuts.toggle_drawing,
            config.shortcuts.toggle_drawing
        );
        assert_eq!(
            parsed.shortcuts.clear_drawing,
            config.shortcuts.clear_drawing
        );
        assert_eq!(
            parsed.general.enable_dragging,
            config.general.enable_dragging
        );
        assert_eq!(
            parsed.general.preserve_drawings,
            config.general.preserve_drawings
        );
        assert_eq!(
            parsed.general.whiteboard_preserve_drawings,
            config.general.whiteboard_preserve_drawings
        );
        assert_eq!(
            parsed.general.angle_snap_step,
            config.general.angle_snap_step
        );
    }

    #[test]
    fn config_deserializes_from_json() {
        let json = r#"{
            "shortcuts": {
                "toggleDrawing": "Ctrl+Alt+X",
                "clearDrawing": "Ctrl+Alt+C"
            },
            "general": {
                "enableDragging": true,
                "locale": "zh-CN",
                "preserveDrawings": true,
                "whiteboardPreserveDrawings": false,
                "angleSnapStep": 30
            }
        }"#;
        let config: AppConfig = serde_json::from_str(json).unwrap();
        assert_eq!(config.shortcuts.toggle_drawing, "Ctrl+Alt+X");
        assert_eq!(config.shortcuts.clear_drawing, "Ctrl+Alt+C");
        assert!(config.general.enable_dragging);
        assert_eq!(config.general.locale, Some("zh-CN".to_string()));
        assert!(config.general.preserve_drawings);
        assert!(!config.general.whiteboard_preserve_drawings);
        assert_eq!(config.general.angle_snap_step, 30);
    }

    #[test]
    fn config_deserializes_with_missing_general() {
        let json = r#"{
            "shortcuts": {
                "toggleDrawing": "Ctrl+Shift+D",
                "clearDrawing": "Ctrl+Shift+C"
            }
        }"#;
        let config: AppConfig = serde_json::from_str(json).unwrap();
        assert!(!config.general.enable_dragging);
        assert_eq!(config.general.locale, None);
        assert!(!config.general.preserve_drawings);
        assert_eq!(config.general.whiteboard_preserve_drawings, true);
        assert_eq!(config.general.angle_snap_step, 15);
    }

    #[test]
    fn config_deserializes_with_missing_angle_snap_step() {
        let json = r#"{
            "shortcuts": {
                "toggleDrawing": "Ctrl+Shift+D",
                "clearDrawing": "Ctrl+Shift+C"
            },
            "general": {
                "enableDragging": true,
                "locale": "en",
                "preserveDrawings": true
            }
        }"#;
        let config: AppConfig = serde_json::from_str(json).unwrap();
        assert!(config.general.enable_dragging);
        assert_eq!(config.general.locale, Some("en".to_string()));
        assert!(config.general.preserve_drawings);
        assert_eq!(config.general.angle_snap_step, 15);
    }

    #[test]
    fn config_deserializes_with_partial_general() {
        let json = r#"{
            "shortcuts": {
                "toggleDrawing": "Ctrl+Shift+D",
                "clearDrawing": "Ctrl+Shift+C"
            },
            "general": {
                "enableDragging": false
            }
        }"#;
        let config: AppConfig = serde_json::from_str(json).unwrap();
        assert!(!config.general.enable_dragging);
        assert_eq!(config.general.locale, None);
        assert!(!config.general.preserve_drawings);
        assert_eq!(config.general.angle_snap_step, 15);
    }

    #[test]
    fn save_result_serializes_correctly() {
        let success = SaveResult {
            ok: true,
            failed: None,
        };
        let json = serde_json::to_string(&success).unwrap();
        assert_eq!(json, r#"{"ok":true}"#);

        let failure = SaveResult {
            ok: false,
            failed: Some(vec!["Toggle: Bad+Key".to_string()]),
        };
        let json = serde_json::to_string(&failure).unwrap();
        assert!(json.contains("\"ok\":false"));
        assert!(json.contains("Bad+Key"));
    }

    #[test]
    fn lock_or_recover_normal_mutex() {
        let mutex = Mutex::new(42);
        let guard = lock_or_recover(&mutex);
        assert_eq!(*guard, 42);
    }

    #[test]
    fn lock_or_recover_poisoned_mutex() {
        let mutex = std::sync::Arc::new(Mutex::new(99));
        let m2 = mutex.clone();
        let _ = std::thread::spawn(move || {
            let _guard = m2.lock().unwrap();
            panic!("intentional panic to poison mutex");
        })
        .join();

        // Mutex is now poisoned
        assert!(mutex.lock().is_err());
        // lock_or_recover should still work
        let guard = lock_or_recover(&mutex);
        assert_eq!(*guard, 99);
    }

    #[test]
    fn default_shortcuts_are_valid() {
        let shortcuts = default_shortcuts();
        assert!(!shortcuts.toggle_drawing.is_empty());
        assert!(!shortcuts.clear_drawing.is_empty());
        assert!(shortcuts.toggle_drawing.contains('+'));
        assert!(shortcuts.clear_drawing.contains('+'));
    }

    #[test]
    fn general_config_default_values() {
        let general = GeneralConfig::default();
        assert!(!general.enable_dragging);
        assert_eq!(general.locale, None);
        assert!(!general.preserve_drawings);
    }

    #[test]
    fn config_skips_none_locale_in_serialization() {
        let config = AppConfig::default();
        let json = serde_json::to_string(&config).unwrap();
        assert!(!json.contains("locale"));
    }

    #[test]
    fn config_includes_locale_when_set() {
        let mut config = AppConfig::default();
        config.general.locale = Some("en".to_string());
        let json = serde_json::to_string(&config).unwrap();
        assert!(json.contains("\"locale\":\"en\""));
    }
}

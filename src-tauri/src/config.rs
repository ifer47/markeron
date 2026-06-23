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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GeneralConfig {
    #[serde(rename = "enableDragging")]
    pub enable_dragging: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub locale: Option<String>,
    #[serde(default, rename = "preserveDrawings")]
    pub preserve_drawings: bool,
}

impl Default for GeneralConfig {
    fn default() -> Self {
        Self {
            enable_dragging: false,
            locale: None,
            preserve_drawings: false,
        }
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
            general: GeneralConfig::default(),
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

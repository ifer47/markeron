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
    #[serde(default = "default_toggle_penetration", rename = "togglePenetration")]
    pub toggle_penetration: String,
}

fn default_toggle_penetration() -> String {
    #[cfg(target_os = "macos")]
    {
        "Command+Shift+X".into()
    }
    #[cfg(not(target_os = "macos"))]
    {
        "Ctrl+Shift+X".into()
    }
}

fn default_angle_snap_step() -> f64 {
    15.0
}

fn default_auto_start() -> bool {
    true
}

fn default_auto_revert_to_pen() -> bool {
    false
}

/// 笔锋 (tapered stroke ends) is a style improvement, so older configs opt in.
fn default_ink_taper() -> bool {
    true
}

/// Persisted widths are hundredths of a CSS pixel (115 = 1.15px), nine geometric steps.
const LINE_WIDTH_PRESET_STORAGE: [u32; 9] = [115, 149, 193, 251, 325, 422, 547, 709, 920];

/// Middle preset (3.25px) — default line width for every width group.
fn default_line_width() -> u32 {
    LINE_WIDTH_PRESET_STORAGE[LINE_WIDTH_PRESET_STORAGE.len() / 2]
}

/// Bumped whenever the on-disk shape changes in a way that needs migration.
/// Older files without the field deserialize as `0` and are upgraded on load.
pub const CONFIG_VERSION: u32 = 1;

/// Snap a stored value to the nearest preset.
///
/// Older builds stored the 1/2/3/5/8 px presets directly, and the previous five-step and
/// seven-step ladders stored 345 / 575 and 163 / 460 / 650 hundredths; all of them are
/// snapped instead of reset so an upgrade never silently changes the user's stroke width.
fn normalize_line_width(value: u32) -> u32 {
    let hundredths = match value {
        1..=8 => value * 100,
        100.. => value,
        _ => return default_line_width(),
    };
    LINE_WIDTH_PRESET_STORAGE
        .iter()
        .copied()
        .min_by_key(|preset| preset.abs_diff(hundredths))
        .unwrap_or_else(default_line_width)
}

/// Accept legacy integer presets, intermediate float values, and new hundredths storage.
fn deserialize_line_width<'de, D>(deserializer: D) -> Result<u32, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let value = f64::deserialize(deserializer)?;
    Ok(normalize_decoded_line_width(value))
}

fn normalize_decoded_line_width(value: f64) -> u32 {
    if !value.is_finite() || value < 0.0 || value > u32::MAX as f64 {
        return default_line_width();
    }
    if value.fract() == 0.0 {
        return normalize_line_width(value as u32);
    }
    let scaled = (value * 100.0).round();
    if scaled < 0.0 || scaled > u32::MAX as f64 {
        return default_line_width();
    }
    normalize_line_width(scaled as u32)
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct LineWidthsConfig {
    #[serde(
        default = "default_line_width",
        deserialize_with = "deserialize_line_width"
    )]
    pub stroke: u32,
    #[serde(
        default = "default_line_width",
        deserialize_with = "deserialize_line_width"
    )]
    pub highlighter: u32,
    #[serde(
        default = "default_line_width",
        deserialize_with = "deserialize_line_width"
    )]
    pub eraser: u32,
    #[serde(
        default = "default_line_width",
        deserialize_with = "deserialize_line_width"
    )]
    pub text: u32,
}

impl Default for LineWidthsConfig {
    fn default() -> Self {
        let w = default_line_width();
        Self {
            stroke: w,
            highlighter: w,
            eraser: w,
            text: w,
        }
    }
}

impl LineWidthsConfig {
    pub fn normalized(self) -> Self {
        Self {
            stroke: normalize_line_width(self.stroke),
            highlighter: normalize_line_width(self.highlighter),
            eraser: normalize_line_width(self.eraser),
            text: normalize_line_width(self.text),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
pub enum DragMode {
    #[serde(rename = "off")]
    #[default]
    Off,
    #[serde(rename = "hover")]
    Hover,
    #[serde(rename = "modifier")]
    Modifier,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
pub enum ToolbarVisibility {
    #[serde(rename = "space")]
    #[default]
    Space,
    #[serde(rename = "always")]
    Always,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
pub enum EraserMode {
    #[serde(rename = "stroke")]
    #[default]
    Stroke,
    #[serde(rename = "object")]
    Object,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
pub enum LaserMode {
    #[serde(rename = "trail")]
    #[default]
    Trail,
    #[serde(rename = "writing")]
    Writing,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
pub enum PenCursorStyle {
    #[serde(rename = "pen")]
    #[default]
    Pen,
    #[serde(rename = "dot")]
    Dot,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
pub enum CrosshairCursorStyle {
    #[serde(rename = "crosshair")]
    #[default]
    Crosshair,
    #[serde(rename = "dot")]
    Dot,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
pub enum DefaultEntryMode {
    #[serde(rename = "screen")]
    #[default]
    Screen,
    #[serde(rename = "whiteboard")]
    Whiteboard,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
pub enum WhiteboardBackground {
    #[serde(rename = "white")]
    #[default]
    White,
    #[serde(rename = "black")]
    Black,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub enum ThemePreference {
    #[default]
    Dark,
    Light,
    System,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ToolbarPositionConfig {
    #[serde(default)]
    pub left: f64,
    #[serde(default)]
    pub top: f64,
    #[serde(
        default,
        rename = "coordSpace",
        skip_serializing_if = "Option::is_none"
    )]
    pub coord_space: Option<String>,
}

impl ToolbarPositionConfig {
    pub fn normalized(mut self) -> Self {
        if !self.left.is_finite() || !self.top.is_finite() {
            return Self::default();
        }
        if !matches!(
            self.coord_space.as_deref(),
            Some("logical") | Some("physical")
        ) {
            self.coord_space = None;
        }
        self
    }
}

impl Default for ToolbarPositionConfig {
    fn default() -> Self {
        Self {
            left: 0.0,
            top: 0.0,
            coord_space: None,
        }
    }
}

/// Window/panel UI state that is not exposed as a settings toggle.
/// Kept separate from [`GeneralConfig`] so a full settings save cannot reset it.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct UiConfig {
    #[serde(
        default,
        rename = "toolbarPosition",
        skip_serializing_if = "Option::is_none"
    )]
    pub toolbar_position: Option<ToolbarPositionConfig>,
    #[serde(
        default,
        rename = "toolbarWindowPosition",
        skip_serializing_if = "Option::is_none"
    )]
    pub toolbar_window_position: Option<ToolbarPositionConfig>,
}

impl UiConfig {
    pub fn normalized(mut self) -> Self {
        self.toolbar_position = self.toolbar_position.map(ToolbarPositionConfig::normalized);
        self.toolbar_window_position = self
            .toolbar_window_position
            .map(ToolbarPositionConfig::normalized);
        self
    }
}

/// Unknown enum values fall back to the type default instead of failing the
/// whole `AppConfig` deserialization. This keeps settings from older (or newer)
/// builds usable after an update instead of silently resetting every preference.
macro_rules! lenient_enum_deserializer {
    ($fn_name:ident, $ty:ty, { $($name:literal => $variant:path),+ $(,)? }) => {
        fn $fn_name<'de, D>(deserializer: D) -> Result<$ty, D::Error>
        where
            D: serde::Deserializer<'de>,
        {
            let value = serde_json::Value::deserialize(deserializer)?;
            Ok(match value.as_str() {
                $(Some($name) => $variant,)+
                _ => <$ty>::default(),
            })
        }
    };
}

lenient_enum_deserializer!(de_toolbar_visibility, ToolbarVisibility, {
    "space" => ToolbarVisibility::Space,
    "always" => ToolbarVisibility::Always,
});
lenient_enum_deserializer!(de_default_entry_mode, DefaultEntryMode, {
    "screen" => DefaultEntryMode::Screen,
    "whiteboard" => DefaultEntryMode::Whiteboard,
});
lenient_enum_deserializer!(de_whiteboard_background, WhiteboardBackground, {
    "white" => WhiteboardBackground::White,
    "black" => WhiteboardBackground::Black,
});
lenient_enum_deserializer!(de_eraser_mode, EraserMode, {
    "stroke" => EraserMode::Stroke,
    "object" => EraserMode::Object,
});
lenient_enum_deserializer!(de_laser_mode, LaserMode, {
    "trail" => LaserMode::Trail,
    "writing" => LaserMode::Writing,
});
lenient_enum_deserializer!(de_pen_cursor_style, PenCursorStyle, {
    "pen" => PenCursorStyle::Pen,
    "dot" => PenCursorStyle::Dot,
});
lenient_enum_deserializer!(de_crosshair_cursor_style, CrosshairCursorStyle, {
    "crosshair" => CrosshairCursorStyle::Crosshair,
    "dot" => CrosshairCursorStyle::Dot,
});
lenient_enum_deserializer!(de_theme_preference, ThemePreference, {
    "dark" => ThemePreference::Dark,
    "light" => ThemePreference::Light,
    "system" => ThemePreference::System,
});

fn de_drag_mode<'de, D>(deserializer: D) -> Result<Option<DragMode>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let value = serde_json::Value::deserialize(deserializer)?;
    if value.is_null() {
        return Ok(None);
    }
    Ok(match value.as_str() {
        Some("off") => Some(DragMode::Off),
        Some("hover") => Some(DragMode::Hover),
        Some("modifier") => Some(DragMode::Modifier),
        _ => None,
    })
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GeneralConfig {
    #[serde(default, rename = "dragMode", deserialize_with = "de_drag_mode")]
    pub drag_mode: Option<DragMode>,
    #[serde(default, rename = "enableDragging", skip_serializing)]
    pub enable_dragging: bool,
    #[serde(default, rename = "dragRequiresModifier", skip_serializing)]
    pub drag_requires_modifier: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub locale: Option<String>,
    #[serde(default, rename = "preserveDrawings")]
    pub preserve_drawings: bool,
    #[serde(default, rename = "whiteboardPreserveDrawings")]
    pub whiteboard_preserve_drawings: bool,
    #[serde(default = "default_angle_snap_step", rename = "angleSnapStep")]
    pub angle_snap_step: f64,
    #[serde(
        default,
        rename = "toolbarVisibility",
        deserialize_with = "de_toolbar_visibility"
    )]
    pub toolbar_visibility: ToolbarVisibility,
    #[serde(
        default,
        rename = "defaultEntryMode",
        deserialize_with = "de_default_entry_mode"
    )]
    pub default_entry_mode: DefaultEntryMode,
    #[serde(
        default,
        rename = "whiteboardBackground",
        deserialize_with = "de_whiteboard_background"
    )]
    pub whiteboard_background: WhiteboardBackground,
    #[serde(default, rename = "eraserMode", deserialize_with = "de_eraser_mode")]
    pub eraser_mode: EraserMode,
    #[serde(default, rename = "laserMode", deserialize_with = "de_laser_mode")]
    pub laser_mode: LaserMode,
    #[serde(
        default,
        rename = "penCursorStyle",
        deserialize_with = "de_pen_cursor_style"
    )]
    pub pen_cursor_style: PenCursorStyle,
    #[serde(
        default,
        rename = "crosshairCursorStyle",
        deserialize_with = "de_crosshair_cursor_style"
    )]
    pub crosshair_cursor_style: CrosshairCursorStyle,
    /// After finishing one arrow/rect/ellipse/line stroke, switch back to pen.
    #[serde(default = "default_auto_revert_to_pen", rename = "autoRevertToPen")]
    pub auto_revert_to_pen: bool,
    /// Taper both ends of pen / highlighter ink (笔锋).
    #[serde(default = "default_ink_taper", rename = "inkTaper")]
    pub ink_taper: bool,
    #[serde(default, rename = "lineWidths")]
    pub line_widths: LineWidthsConfig,
    #[serde(default = "default_auto_start", rename = "autoStart")]
    pub auto_start: bool,
    #[serde(default, rename = "theme", deserialize_with = "de_theme_preference")]
    pub theme: ThemePreference,
}

impl Default for GeneralConfig {
    fn default() -> Self {
        Self {
            drag_mode: None,
            enable_dragging: false,
            drag_requires_modifier: false,
            locale: None,
            preserve_drawings: false,
            whiteboard_preserve_drawings: true,
            angle_snap_step: default_angle_snap_step(),
            toolbar_visibility: ToolbarVisibility::Space,
            default_entry_mode: DefaultEntryMode::Screen,
            whiteboard_background: WhiteboardBackground::White,
            eraser_mode: EraserMode::Stroke,
            laser_mode: LaserMode::Trail,
            pen_cursor_style: PenCursorStyle::Pen,
            crosshair_cursor_style: CrosshairCursorStyle::Crosshair,
            auto_revert_to_pen: default_auto_revert_to_pen(),
            ink_taper: default_ink_taper(),
            line_widths: LineWidthsConfig::default(),
            auto_start: default_auto_start(),
            theme: ThemePreference::Dark,
        }
    }
}

impl GeneralConfig {
    pub fn drag_mode(&self) -> DragMode {
        self.drag_mode.unwrap_or(DragMode::Off)
    }

    pub fn normalized(mut self) -> Self {
        if !self.angle_snap_step.is_finite() || !(1.0..=90.0).contains(&self.angle_snap_step) {
            self.angle_snap_step = default_angle_snap_step();
        }
        self.drag_mode = Some(match self.drag_mode {
            Some(m) if matches!(m, DragMode::Off | DragMode::Hover | DragMode::Modifier) => m,
            Some(_) => DragMode::Off,
            None => {
                if self.drag_requires_modifier {
                    DragMode::Modifier
                } else if self.enable_dragging {
                    DragMode::Hover
                } else {
                    DragMode::Off
                }
            }
        });
        self.enable_dragging = false;
        self.drag_requires_modifier = false;
        if !matches!(
            self.toolbar_visibility,
            ToolbarVisibility::Space | ToolbarVisibility::Always
        ) {
            self.toolbar_visibility = ToolbarVisibility::Space;
        }
        if !matches!(
            self.default_entry_mode,
            DefaultEntryMode::Screen | DefaultEntryMode::Whiteboard
        ) {
            self.default_entry_mode = DefaultEntryMode::Screen;
        }
        if !matches!(
            self.whiteboard_background,
            WhiteboardBackground::White | WhiteboardBackground::Black
        ) {
            self.whiteboard_background = WhiteboardBackground::White;
        }
        if !matches!(self.eraser_mode, EraserMode::Stroke | EraserMode::Object) {
            self.eraser_mode = EraserMode::Stroke;
        }
        if !matches!(
            self.pen_cursor_style,
            PenCursorStyle::Pen | PenCursorStyle::Dot
        ) {
            self.pen_cursor_style = PenCursorStyle::Pen;
        }
        if !matches!(
            self.crosshair_cursor_style,
            CrosshairCursorStyle::Crosshair | CrosshairCursorStyle::Dot
        ) {
            self.crosshair_cursor_style = CrosshairCursorStyle::Crosshair;
        }
        self.line_widths = self.line_widths.normalized();
        self
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppConfig {
    /// `0` for files written before versioning was introduced.
    #[serde(default, rename = "configVersion")]
    pub config_version: u32,
    #[serde(default = "default_shortcuts")]
    pub shortcuts: Shortcuts,
    #[serde(default)]
    pub general: GeneralConfig,
    #[serde(default)]
    pub ui: UiConfig,
}

impl AppConfig {
    /// Apply forward migrations after deserialization. New fields already fall
    /// back to their serde defaults, so this mainly stamps the current version
    /// and gives future releases a single place to rewrite obsolete values.
    pub fn migrated(mut self) -> Self {
        if self.config_version < CONFIG_VERSION {
            // v0 → v1: add versioning + toolbar positions. Nothing else to rewrite;
            // serde defaults preserve every existing preference.
            info!(
                "Migrating config from version {} to {}",
                self.config_version, CONFIG_VERSION
            );
            self.config_version = CONFIG_VERSION;
        }
        self.shortcuts = self.shortcuts.normalized();
        self.general = self.general.normalized();
        self.ui = self.ui.normalized();
        self
    }
}

pub fn default_shortcuts() -> Shortcuts {
    #[cfg(target_os = "macos")]
    {
        Shortcuts {
            toggle_drawing: "Command+Shift+D".into(),
            clear_drawing: "Command+Shift+C".into(),
            toggle_penetration: "Command+Shift+X".into(),
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        Shortcuts {
            toggle_drawing: "Ctrl+Shift+D".into(),
            clear_drawing: "Ctrl+Shift+C".into(),
            toggle_penetration: "Ctrl+Shift+X".into(),
        }
    }
}

impl Shortcuts {
    /// Migrate legacy default penetration shortcut (Shift+P → Shift+X).
    pub fn normalized(mut self) -> Self {
        #[cfg(target_os = "macos")]
        {
            if self.toggle_penetration == "Command+Shift+P" {
                self.toggle_penetration = "Command+Shift+X".into();
            }
        }
        #[cfg(not(target_os = "macos"))]
        {
            if self.toggle_penetration == "Ctrl+Shift+P" {
                self.toggle_penetration = "Ctrl+Shift+X".into();
            }
        }
        self
    }
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            config_version: CONFIG_VERSION,
            shortcuts: default_shortcuts(),
            general: GeneralConfig::default().normalized(),
            ui: UiConfig::default(),
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
    pub overlay_mode: Mutex<crate::overlay::OverlayMode>,
    /// Briefly suppress auto-penetration after activation (toolbar window steals focus).
    pub suppress_penetration_until: Mutex<Option<std::time::Instant>>,
    /// Frontend whiteboard mode — penetration is screen-overlay only.
    pub whiteboard_mode: Mutex<bool>,
    /// Cross-window diagnostic ring buffer (overlay + settings are separate webviews).
    /// Priority / pointer events are capped separately; also mirrored to diagnostics.jsonl.
    pub diagnostic_events: Mutex<crate::diagnostics::DiagnosticBuffer>,
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
    if let Some(data) = crate::portable::data_dir() {
        fs::create_dir_all(&data).ok();
        return data.join("config.json");
    }
    let dir = app
        .path()
        .app_config_dir()
        .expect("failed to get config dir");
    fs::create_dir_all(&dir).ok();
    dir.join("config.json")
}

fn backup_path(path: &std::path::Path) -> std::path::PathBuf {
    path.with_extension("json.bak")
}

fn corrupt_path(path: &std::path::Path) -> std::path::PathBuf {
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    path.with_extension(format!("corrupt-{}.json", stamp))
}

/// Every location a previous MarkerOn install may have written `config.json` to.
///
/// Windows ships three flavours (NSIS installer, MSIX/Store package, portable
/// zip) and each uses a different config root. Users also switch between them,
/// so a fresh install must look in the others before falling back to defaults.
fn candidate_config_paths(_app: &AppHandle) -> Vec<std::path::PathBuf> {
    let mut paths: Vec<std::path::PathBuf> = Vec::new();
    let mut push = |path: std::path::PathBuf| {
        if !paths.contains(&path) {
            paths.push(path);
        }
    };

    // Portable zip: config lives next to the executable.
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            push(dir.join("data").join("config.json"));
        }
    }

    // Installed builds: Tauri stores `%APPDATA%\<identifier>\config.json`.
    // `com.markon.app` was the identifier before the v0.0.6 rename.
    for var in ["APPDATA", "LOCALAPPDATA"] {
        if let Some(base) = std::env::var_os(var) {
            let base = std::path::PathBuf::from(base);
            for id in ["com.markeron.app", "com.markon.app"] {
                push(base.join(id).join("config.json"));
            }
        }
    }

    // MSIX / Microsoft Store: package data is virtualized under
    // `%LOCALAPPDATA%\Packages\<PackageFamilyName>\LocalCache\...`.
    if let Some(local) = std::env::var_os("LOCALAPPDATA") {
        let packages = std::path::PathBuf::from(local).join("Packages");
        if let Ok(entries) = fs::read_dir(&packages) {
            for entry in entries.flatten() {
                let name = entry.file_name();
                let name = name.to_string_lossy();
                if !(name.starts_with("ifer.MarkerOn_") || name.starts_with("MarkerOn_")) {
                    continue;
                }
                for scope in ["Roaming", "Local"] {
                    for id in ["com.markeron.app", "com.markon.app"] {
                        push(
                            entry
                                .path()
                                .join("LocalCache")
                                .join(scope)
                                .join(id)
                                .join("config.json"),
                        );
                    }
                }
            }
        }
    }

    // Newest first so a machine with both an MSIX and an NSIS install keeps
    // whichever copy the user touched most recently.
    paths.sort_by_cached_key(|path| {
        std::cmp::Reverse(path.metadata().and_then(|m| m.modified()).ok())
    });
    paths
}

fn read_config(path: &std::path::Path) -> Option<AppConfig> {
    let raw = match fs::read_to_string(path) {
        Ok(raw) => raw,
        Err(_) => return None,
    };
    match serde_json::from_str::<AppConfig>(&raw) {
        Ok(cfg) => Some(cfg.migrated()),
        Err(e) => {
            warn!(
                "Config file {} is invalid ({}), trying backup",
                path.display(),
                e
            );
            None
        }
    }
}

fn write_config_atomic(path: &std::path::Path, json: &str) -> std::io::Result<()> {
    // Keep the previous valid file as `config.json.bak` before replacing it.
    // Only back up files that parse cleanly so a corrupted write can never
    // overwrite the last good backup.
    if path.is_file() {
        if let Ok(raw) = fs::read_to_string(path) {
            if serde_json::from_str::<AppConfig>(&raw).is_ok() {
                fs::write(backup_path(path), raw).ok();
            }
        }
    }

    let tmp = path.with_extension("json.tmp");
    // A previous crash may have left a partial temp file behind.
    let _ = fs::remove_file(&tmp);
    {
        use std::io::Write;
        let mut file = fs::File::create(&tmp)?;
        file.write_all(json.as_bytes())?;
        // Flush before the rename so a power loss cannot leave an empty file
        // under the real name (rename is atomic, but data may still be cached).
        file.sync_all()?;
    }
    // `rename` replaces atomically on Windows and Unix, so a crash mid-write
    // leaves either the old or the new complete file — never a truncated one.
    fs::rename(&tmp, path)
}

fn save_config_to_path(path: &std::path::Path, config: &AppConfig) {
    let json = match serde_json::to_string_pretty(config) {
        Ok(json) => json,
        Err(e) => {
            warn!("Failed to serialize config: {}", e);
            return;
        }
    };
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).ok();
    }
    if let Err(e) = write_config_atomic(path, &json) {
        warn!("Failed to write config to {}: {}", path.display(), e);
    }
}

fn load_config_from_paths(
    primary: &std::path::Path,
    candidates: &[std::path::PathBuf],
) -> AppConfig {
    // 1. Current config file.
    if let Some(cfg) = read_config(primary) {
        info!("Loaded config from {}", primary.display());
        return cfg;
    }

    // 2. Preserve the broken file instead of silently overwriting it later.
    if primary.is_file() {
        let corrupt = corrupt_path(primary);
        if fs::rename(primary, &corrupt).is_ok() {
            warn!("Preserved corrupted config as {}", corrupt.display());
        }
    }

    // 3. Last good write of the same file.
    let backup = backup_path(primary);
    if let Some(cfg) = read_config(&backup) {
        warn!("Recovered config from backup {}", backup.display());
        save_config_to_path(primary, &cfg);
        return cfg;
    }

    // 4. Any other install flavour on this machine (newest wins).
    for candidate in candidates {
        if candidate == primary || candidate == &backup {
            continue;
        }
        if let Some(cfg) = read_config(candidate) {
            info!("Migrated config from {}", candidate.display());
            save_config_to_path(primary, &cfg);
            return cfg;
        }
    }

    // 5. First run.
    info!("No config file found, using defaults");
    AppConfig::default()
}

pub fn load_config(app: &AppHandle) -> AppConfig {
    let path = config_path(app);
    let candidates = candidate_config_paths(app);
    load_config_from_paths(&path, &candidates)
}

/// Whether this executable may register OS autostart (installed release only).
pub fn supports_autostart() -> bool {
    !crate::portable::is_portable() && !cfg!(debug_assertions)
}

/// Sync OS autostart with the desired preference.
///
/// Returns `None` in portable or debug builds (no OS registration). Otherwise
/// returns the actual enabled state after the attempt — callers should persist
/// when this differs from `enabled` (e.g. security software blocked registry writes).
pub fn sync_autostart(app: &AppHandle, enabled: bool) -> Option<bool> {
    use tauri_plugin_autostart::ManagerExt;

    if !supports_autostart() {
        if crate::portable::is_portable() {
            info!("Portable mode: skipping autostart sync");
        } else {
            // Debug builds load the UI from localhost; clear stale OS entries that
            // were registered during a dev session so boot does not launch this exe.
            let manager = app.autolaunch();
            if manager.is_enabled().unwrap_or(false) {
                if let Err(e) = manager.disable() {
                    warn!("Failed to disable autostart from debug build: {}", e);
                } else {
                    info!("Removed OS autostart registration (debug build)");
                }
            }
        }
        return None;
    }

    let manager = app.autolaunch();
    let current = manager.is_enabled().unwrap_or(false);
    if current == enabled {
        return Some(current);
    }
    if enabled {
        if let Err(e) = manager.enable() {
            warn!("Failed to enable autostart: {}", e);
            return Some(manager.is_enabled().unwrap_or(false));
        }
    } else if let Err(e) = manager.disable() {
        warn!("Failed to disable autostart: {}", e);
        return Some(manager.is_enabled().unwrap_or(true));
    }
    Some(enabled)
}

/// Apply autostart preference and rewrite config when the OS state diverges.
pub fn apply_autostart_preference(app: &AppHandle, state: &AppState, enabled: bool) {
    let Some(actual) = sync_autostart(app, enabled) else {
        return;
    };
    if actual == enabled {
        return;
    }
    let mut cfg = lock_or_recover(&state.config);
    if cfg.general.auto_start == actual {
        return;
    }
    info!(
        "Autostart preference {} diverged from OS state {}; updating config",
        enabled, actual
    );
    cfg.general.auto_start = actual;
    save_config(app, &cfg);
}

pub fn save_config(app: &AppHandle, config: &AppConfig) {
    save_config_to_path(&config_path(app), config);
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
        assert_eq!(parsed.general.drag_mode(), config.general.drag_mode());
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
        assert_eq!(parsed.general.theme, ThemePreference::Dark);
        assert!(parsed.general.ink_taper);
    }

    #[test]
    fn ink_taper_defaults_on_and_roundtrips() {
        // Configs written before the field existed keep the improved default.
        let legacy: AppConfig = serde_json::from_str(r#"{"general":{}}"#).unwrap();
        assert!(legacy.general.ink_taper);

        let off: AppConfig = serde_json::from_str(r#"{"general":{"inkTaper":false}}"#).unwrap();
        assert!(!off.general.ink_taper);

        let json = serde_json::to_string(&off).unwrap();
        assert!(json.contains("\"inkTaper\":false"));
    }

    #[test]
    fn config_deserializes_drag_mode() {
        let json = r#"{
            "shortcuts": {
                "toggleDrawing": "Ctrl+Alt+X",
                "clearDrawing": "Ctrl+Alt+C"
            },
            "general": {
                "dragMode": "modifier",
                "locale": "zh-CN",
                "preserveDrawings": true,
                "whiteboardPreserveDrawings": false,
                "angleSnapStep": 30
            }
        }"#;
        let config: AppConfig = serde_json::from_str(json).unwrap();
        assert_eq!(config.general.drag_mode(), DragMode::Modifier);
        assert_eq!(config.general.locale, Some("zh-CN".to_string()));
        assert!(config.general.preserve_drawings);
        assert!(!config.general.whiteboard_preserve_drawings);
        assert_eq!(config.general.angle_snap_step, 30.0);
    }

    #[test]
    fn normalized_migrates_legacy_drag_settings() {
        let general = GeneralConfig {
            drag_mode: None,
            enable_dragging: true,
            drag_requires_modifier: true,
            ..GeneralConfig::default()
        };
        let normalized = general.normalized();
        assert_eq!(normalized.drag_mode(), DragMode::Modifier);
        assert!(!normalized.enable_dragging);
        assert!(!normalized.drag_requires_modifier);
    }

    #[test]
    fn normalized_migrates_legacy_hover_drag() {
        let general = GeneralConfig {
            drag_mode: None,
            enable_dragging: true,
            drag_requires_modifier: false,
            ..GeneralConfig::default()
        };
        assert_eq!(general.normalized().drag_mode(), DragMode::Hover);
    }

    #[test]
    fn normalized_keeps_explicit_off_when_legacy_enable_dragging_present() {
        let general = GeneralConfig {
            drag_mode: Some(DragMode::Off),
            enable_dragging: true,
            drag_requires_modifier: false,
            ..GeneralConfig::default()
        };
        assert_eq!(general.normalized().drag_mode(), DragMode::Off);
    }

    #[test]
    fn config_deserializes_explicit_off_with_legacy_fields() {
        let json = r#"{
            "shortcuts": {
                "toggleDrawing": "Ctrl+Shift+D",
                "clearDrawing": "Ctrl+Shift+C"
            },
            "general": {
                "dragMode": "off",
                "enableDragging": true
            }
        }"#;
        let config: AppConfig = serde_json::from_str(json).unwrap();
        assert_eq!(config.general.normalized().drag_mode(), DragMode::Off);
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
        assert_eq!(config.general.drag_mode(), DragMode::Off);
        assert_eq!(config.general.locale, None);
        assert!(!config.general.preserve_drawings);
        assert_eq!(config.general.whiteboard_preserve_drawings, true);
        assert_eq!(config.general.angle_snap_step, 15.0);
    }

    #[test]
    fn config_deserializes_legacy_enable_dragging() {
        let json = r#"{
            "shortcuts": {
                "toggleDrawing": "Ctrl+Shift+D",
                "clearDrawing": "Ctrl+Shift+C"
            },
            "general": {
                "enableDragging": true
            }
        }"#;
        let config: AppConfig = serde_json::from_str(json).unwrap();
        assert_eq!(config.general.normalized().drag_mode(), DragMode::Hover);
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
        assert_eq!(
            config.general.clone().normalized().drag_mode(),
            DragMode::Hover
        );
        assert_eq!(config.general.locale, Some("en".to_string()));
        assert!(config.general.preserve_drawings);
        assert_eq!(config.general.angle_snap_step, 15.0);
    }

    #[test]
    fn config_deserializes_with_partial_general() {
        let json = r#"{
            "shortcuts": {
                "toggleDrawing": "Ctrl+Shift+D",
                "clearDrawing": "Ctrl+Shift+C"
            },
            "general": {
                "dragMode": "off"
            }
        }"#;
        let config: AppConfig = serde_json::from_str(json).unwrap();
        assert_eq!(config.general.drag_mode(), DragMode::Off);
        assert_eq!(config.general.locale, None);
        assert!(!config.general.preserve_drawings);
        assert_eq!(config.general.angle_snap_step, 15.0);
    }

    #[test]
    fn normalized_clamps_out_of_range_angle_snap_step() {
        let too_small = GeneralConfig {
            angle_snap_step: 0.5,
            ..GeneralConfig::default()
        };
        assert_eq!(too_small.normalized().angle_snap_step, 15.0);

        let too_big = GeneralConfig {
            angle_snap_step: 120.0,
            ..GeneralConfig::default()
        };
        assert_eq!(too_big.normalized().angle_snap_step, 15.0);

        let fine = GeneralConfig {
            angle_snap_step: 1.0,
            ..GeneralConfig::default()
        };
        assert_eq!(fine.normalized().angle_snap_step, 1.0);

        let fractional = GeneralConfig {
            angle_snap_step: 2.5,
            ..GeneralConfig::default()
        };
        assert_eq!(fractional.normalized().angle_snap_step, 2.5);
    }

    #[test]
    fn config_deserializes_toolbar_settings() {
        let json = r#"{
            "shortcuts": {
                "toggleDrawing": "Ctrl+Shift+D",
                "clearDrawing": "Ctrl+Shift+C"
            },
            "general": {
                "toolbarVisibility": "always"
            }
        }"#;
        let config: AppConfig = serde_json::from_str(json).unwrap();
        assert_eq!(config.general.toolbar_visibility, ToolbarVisibility::Always);
    }

    #[test]
    fn general_config_defaults_toolbar_visibility() {
        let general = GeneralConfig::default();
        assert_eq!(general.toolbar_visibility, ToolbarVisibility::Space);
    }

    #[test]
    fn supports_autostart_false_in_debug_tests() {
        // Unit tests run with debug_assertions; dev builds must not register autostart.
        assert!(!super::supports_autostart());
    }

    #[test]
    fn general_config_defaults_auto_start() {
        let general = GeneralConfig::default();
        assert!(general.auto_start);
    }

    #[test]
    fn general_config_defaults_default_entry_mode() {
        let general = GeneralConfig::default();
        assert_eq!(general.default_entry_mode, DefaultEntryMode::Screen);
    }

    #[test]
    fn general_config_defaults_whiteboard_background() {
        let general = GeneralConfig::default();
        assert_eq!(general.whiteboard_background, WhiteboardBackground::White);
    }

    #[test]
    fn general_config_defaults_auto_revert_to_pen_off() {
        let general = GeneralConfig::default();
        assert!(!general.auto_revert_to_pen);
    }

    #[test]
    fn missing_auto_revert_to_pen_defaults_to_false() {
        let json = r#"{
            "shortcuts": {
                "toggleDrawing": "Ctrl+Shift+D",
                "clearDrawing": "Ctrl+Shift+C"
            },
            "general": {}
        }"#;
        let config: AppConfig = serde_json::from_str(json).unwrap();
        assert!(!config.general.auto_revert_to_pen);
    }

    #[test]
    fn config_ignores_legacy_stroke_straighten_field() {
        let json = r#"{
            "shortcuts": {
                "toggleDrawing": "Ctrl+Shift+D",
                "clearDrawing": "Ctrl+Shift+C"
            },
            "general": {
                "strokeStraighten": false
            }
        }"#;
        let config: AppConfig = serde_json::from_str(json).unwrap();
        assert!(!config.general.auto_revert_to_pen);
    }

    #[test]
    fn config_deserializes_auto_revert_to_pen_on() {
        let json = r#"{
            "shortcuts": {
                "toggleDrawing": "Ctrl+Shift+D",
                "clearDrawing": "Ctrl+Shift+C"
            },
            "general": {
                "autoRevertToPen": true
            }
        }"#;
        let config: AppConfig = serde_json::from_str(json).unwrap();
        assert!(config.general.auto_revert_to_pen);
    }

    #[test]
    fn config_deserializes_whiteboard_background() {
        let json = r#"{
            "shortcuts": {
                "toggleDrawing": "Ctrl+Shift+D",
                "clearDrawing": "Ctrl+Shift+C"
            },
            "general": {
                "whiteboardBackground": "black"
            }
        }"#;
        let config: AppConfig = serde_json::from_str(json).unwrap();
        assert_eq!(
            config.general.whiteboard_background,
            WhiteboardBackground::Black
        );
    }

    #[test]
    fn missing_whiteboard_background_defaults_to_white() {
        let json = r#"{
            "shortcuts": {
                "toggleDrawing": "Ctrl+Shift+D",
                "clearDrawing": "Ctrl+Shift+C"
            },
            "general": {}
        }"#;
        let config: AppConfig = serde_json::from_str(json).unwrap();
        assert_eq!(
            config.general.whiteboard_background,
            WhiteboardBackground::White
        );
    }

    #[test]
    fn config_deserializes_eraser_mode() {
        let json = r#"{
            "shortcuts": {
                "toggleDrawing": "Ctrl+Shift+D",
                "clearDrawing": "Ctrl+Shift+C"
            },
            "general": {
                "eraserMode": "object"
            }
        }"#;
        let config: AppConfig = serde_json::from_str(json).unwrap();
        assert_eq!(config.general.eraser_mode, EraserMode::Object);
    }

    #[test]
    fn general_config_defaults_eraser_mode() {
        let general = GeneralConfig::default();
        assert_eq!(general.eraser_mode, EraserMode::Stroke);
    }

    #[test]
    fn config_deserializes_laser_mode() {
        let json = r#"{
            "shortcuts": {
                "toggleDrawing": "Ctrl+Shift+D",
                "clearDrawing": "Ctrl+Shift+C"
            },
            "general": {
                "laserMode": "writing"
            }
        }"#;
        let config: AppConfig = serde_json::from_str(json).unwrap();
        assert_eq!(config.general.laser_mode, LaserMode::Writing);
    }

    #[test]
    fn general_config_defaults_laser_mode() {
        let general = GeneralConfig::default();
        assert_eq!(general.laser_mode, LaserMode::Trail);
        let json = serde_json::to_value(&general).unwrap();
        assert_eq!(json["laserMode"], "trail");
    }

    #[test]
    fn config_deserializes_pen_cursor_style() {
        let json = r#"{
            "shortcuts": {
                "toggleDrawing": "Ctrl+Shift+D",
                "clearDrawing": "Ctrl+Shift+C"
            },
            "general": {
                "penCursorStyle": "dot"
            }
        }"#;
        let config: AppConfig = serde_json::from_str(json).unwrap();
        assert_eq!(config.general.pen_cursor_style, PenCursorStyle::Dot);
    }

    #[test]
    fn general_config_defaults_pen_cursor_style() {
        let general = GeneralConfig::default();
        assert_eq!(general.pen_cursor_style, PenCursorStyle::Pen);
    }

    #[test]
    fn config_deserializes_crosshair_cursor_style() {
        let json = r#"{
            "shortcuts": {
                "toggleDrawing": "Ctrl+Shift+D",
                "clearDrawing": "Ctrl+Shift+C"
            },
            "general": {
                "crosshairCursorStyle": "dot"
            }
        }"#;
        let config: AppConfig = serde_json::from_str(json).unwrap();
        assert_eq!(
            config.general.crosshair_cursor_style,
            CrosshairCursorStyle::Dot
        );
    }

    #[test]
    fn general_config_defaults_crosshair_cursor_style() {
        let general = GeneralConfig::default();
        assert_eq!(
            general.crosshair_cursor_style,
            CrosshairCursorStyle::Crosshair
        );
    }

    #[test]
    fn config_deserializes_line_widths() {
        let json = r#"{
            "shortcuts": {
                "toggleDrawing": "Ctrl+Shift+D",
                "clearDrawing": "Ctrl+Shift+C"
            },
            "general": {
                "lineWidths": {
                    "stroke": 575,
                    "highlighter": 920,
                    "eraser": 230,
                    "text": 115
                }
            }
        }"#;
        let config: AppConfig = serde_json::from_str(json).unwrap();
        assert_eq!(config.general.line_widths.stroke, 547);
        assert_eq!(config.general.line_widths.highlighter, 920);
        assert_eq!(config.general.line_widths.eraser, 251);
        assert_eq!(config.general.line_widths.text, 115);
    }

    #[test]
    fn config_deserializes_legacy_and_float_line_widths() {
        let legacy = r#"{
            "general": { "lineWidths": {
                "stroke": 5, "highlighter": 8, "eraser": 2, "text": 1
            } }
        }"#;
        let legacy: AppConfig = serde_json::from_str(legacy).unwrap();
        assert_eq!(legacy.general.line_widths.stroke, 547);
        assert_eq!(legacy.general.line_widths.highlighter, 709);
        assert_eq!(legacy.general.line_widths.eraser, 193);
        assert_eq!(legacy.general.line_widths.text, 115);

        let floats = r#"{
            "general": { "lineWidths": {
                "stroke": 5.75, "highlighter": 9.2, "eraser": 2.3, "text": 1.15
            } }
        }"#;
        let floats: AppConfig = serde_json::from_str(floats).unwrap();
        assert_eq!(floats.general.line_widths.stroke, 547);
        assert_eq!(floats.general.line_widths.highlighter, 920);
        assert_eq!(floats.general.line_widths.eraser, 251);
        assert_eq!(floats.general.line_widths.text, 115);
    }

    #[test]
    fn normalized_snaps_legacy_and_previous_line_widths() {
        // Legacy CSS-pixel presets snap to the nearest step of the nine-step ladder.
        assert_eq!(
            [1, 2, 3, 5, 8].map(normalize_line_width),
            [115, 193, 325, 547, 709]
        );
        // The previous five-step (345 / 575) and seven-step (163 / 460 / 650) ladders must survive.
        assert_eq!(
            [115, 163, 230, 345, 460, 575, 650, 920].map(normalize_line_width),
            [115, 149, 251, 325, 422, 547, 709, 920]
        );
    }

    #[test]
    fn general_config_defaults_line_widths() {
        let general = GeneralConfig::default();
        assert_eq!(general.line_widths, LineWidthsConfig::default());
        assert_eq!(general.line_widths.stroke, 325);
    }

    #[test]
    fn normalized_clamps_invalid_line_widths() {
        let general = GeneralConfig {
            line_widths: LineWidthsConfig {
                stroke: 4,
                highlighter: 0,
                eraser: 99,
                text: 5,
            },
            ..GeneralConfig::default()
        };
        let normalized = general.normalized();
        assert_eq!(normalized.line_widths.stroke, 422);
        assert_eq!(normalized.line_widths.highlighter, 325);
        assert_eq!(normalized.line_widths.eraser, 325);
        assert_eq!(normalized.line_widths.text, 547);
    }

    #[test]
    fn config_deserializes_default_entry_mode() {
        let json = r#"{
            "shortcuts": {
                "toggleDrawing": "Ctrl+Shift+D",
                "clearDrawing": "Ctrl+Shift+C"
            },
            "general": {
                "defaultEntryMode": "whiteboard"
            }
        }"#;
        let config: AppConfig = serde_json::from_str(json).unwrap();
        assert_eq!(
            config.general.default_entry_mode,
            DefaultEntryMode::Whiteboard
        );
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
    fn normalized_migrates_legacy_toggle_penetration_shortcut() {
        #[cfg(target_os = "macos")]
        {
            let shortcuts = Shortcuts {
                toggle_drawing: "Command+Shift+D".into(),
                clear_drawing: "Command+Shift+C".into(),
                toggle_penetration: "Command+Shift+P".into(),
            };
            assert_eq!(shortcuts.normalized().toggle_penetration, "Command+Shift+X");
        }
        #[cfg(not(target_os = "macos"))]
        {
            let shortcuts = Shortcuts {
                toggle_drawing: "Ctrl+Shift+D".into(),
                clear_drawing: "Ctrl+Shift+C".into(),
                toggle_penetration: "Ctrl+Shift+P".into(),
            };
            assert_eq!(shortcuts.normalized().toggle_penetration, "Ctrl+Shift+X");
        }
    }

    #[test]
    fn default_shortcuts_are_valid() {
        let shortcuts = default_shortcuts();
        assert!(!shortcuts.toggle_drawing.is_empty());
        assert!(!shortcuts.clear_drawing.is_empty());
        assert!(!shortcuts.toggle_penetration.is_empty());
        assert!(shortcuts.toggle_drawing.contains('+'));
        assert!(shortcuts.clear_drawing.contains('+'));
        assert!(shortcuts.toggle_penetration.contains('+'));
    }

    #[test]
    fn general_config_default_values() {
        let general = GeneralConfig::default();
        assert_eq!(general.drag_mode(), DragMode::Off);
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

    #[test]
    fn theme_defaults_to_dark() {
        let config = AppConfig::default();
        assert_eq!(config.general.theme, ThemePreference::Dark);
    }

    #[test]
    fn theme_deserializes_missing_as_dark() {
        let json = r#"{
            "shortcuts": {
                "toggleDrawing": "Ctrl+Shift+D",
                "clearDrawing": "Ctrl+Shift+C"
            },
            "general": {}
        }"#;
        let config: AppConfig = serde_json::from_str(json).unwrap();
        assert_eq!(config.general.theme, ThemePreference::Dark);
    }

    #[test]
    fn theme_roundtrip_light_and_system() {
        for theme in [ThemePreference::Light, ThemePreference::System] {
            let mut config = AppConfig::default();
            config.general.theme = theme;
            let json = serde_json::to_string(&config).unwrap();
            let parsed: AppConfig = serde_json::from_str(&json).unwrap();
            assert_eq!(parsed.general.theme, theme);
        }
        let light_json = serde_json::to_string(&AppConfig {
            general: GeneralConfig {
                theme: ThemePreference::Light,
                ..GeneralConfig::default()
            },
            ..AppConfig::default()
        })
        .unwrap();
        assert!(light_json.contains("\"theme\":\"light\""));
    }

    #[test]
    fn normalized_preserves_system_theme() {
        let g = GeneralConfig {
            theme: ThemePreference::System,
            ..GeneralConfig::default()
        };
        assert_eq!(g.normalized().theme, ThemePreference::System);
    }

    fn temp_dir(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "markeron-config-test-{}-{}",
            name,
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn config_version_defaults_to_current_and_upgrades_legacy_files() {
        assert_eq!(AppConfig::default().config_version, CONFIG_VERSION);

        let json = r#"{
            "shortcuts": {
                "toggleDrawing": "Ctrl+Shift+D",
                "clearDrawing": "Ctrl+Shift+C",
                "togglePenetration": "Ctrl+Shift+X"
            },
            "general": {}
        }"#;
        let config: AppConfig = serde_json::from_str(json).unwrap();
        assert_eq!(config.config_version, 0);
        assert_eq!(config.migrated().config_version, CONFIG_VERSION);
    }

    #[test]
    fn unknown_enum_values_fall_back_instead_of_resetting_everything() {
        let json = r#"{
            "shortcuts": {
                "toggleDrawing": "Ctrl+Shift+D",
                "clearDrawing": "Ctrl+Shift+C",
                "togglePenetration": "Ctrl+Shift+X"
            },
            "general": {
                "dragMode": "bogus",
                "toolbarVisibility": "bogus",
                "defaultEntryMode": "bogus",
                "whiteboardBackground": "bogus",
                "eraserMode": "bogus",
                "laserMode": "bogus",
                "penCursorStyle": "bogus",
                "crosshairCursorStyle": "bogus",
                "theme": "bogus",
                "preserveDrawings": true
            }
        }"#;
        let config: AppConfig = serde_json::from_str(json).unwrap();
        let general = config.general.normalized();
        assert_eq!(general.drag_mode(), DragMode::Off);
        assert_eq!(general.toolbar_visibility, ToolbarVisibility::Space);
        assert_eq!(general.default_entry_mode, DefaultEntryMode::Screen);
        assert_eq!(general.whiteboard_background, WhiteboardBackground::White);
        assert_eq!(general.eraser_mode, EraserMode::Stroke);
        assert_eq!(general.laser_mode, LaserMode::Trail);
        assert_eq!(general.pen_cursor_style, PenCursorStyle::Pen);
        assert_eq!(
            general.crosshair_cursor_style,
            CrosshairCursorStyle::Crosshair
        );
        assert_eq!(general.theme, ThemePreference::Dark);
        // Unrelated settings in the same file must survive.
        assert!(general.preserve_drawings);
    }

    #[test]
    fn non_string_enum_values_also_fall_back() {
        let json = r#"{
            "shortcuts": {
                "toggleDrawing": "Ctrl+Shift+D",
                "clearDrawing": "Ctrl+Shift+C",
                "togglePenetration": "Ctrl+Shift+X"
            },
            "general": { "theme": 123, "dragMode": true }
        }"#;
        let config: AppConfig = serde_json::from_str(json).unwrap();
        assert_eq!(config.general.theme, ThemePreference::Dark);
        assert_eq!(config.general.drag_mode(), DragMode::Off);
    }

    #[test]
    fn ui_positions_roundtrip_through_json() {
        let mut config = AppConfig::default();
        config.ui.toolbar_position = Some(ToolbarPositionConfig {
            left: 12.5,
            top: -8.0,
            coord_space: None,
        });
        config.ui.toolbar_window_position = Some(ToolbarPositionConfig {
            left: 100.0,
            top: 200.0,
            coord_space: Some("logical".into()),
        });

        let json = serde_json::to_string(&config).unwrap();
        assert!(json.contains("\"toolbarPosition\""));
        assert!(json.contains("\"toolbarWindowPosition\""));

        let parsed: AppConfig = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.ui.toolbar_position, config.ui.toolbar_position);
        assert_eq!(
            parsed.ui.toolbar_window_position,
            config.ui.toolbar_window_position
        );
    }

    #[test]
    fn ui_positions_are_omitted_when_unset() {
        let json = serde_json::to_string(&AppConfig::default()).unwrap();
        assert!(!json.contains("toolbarPosition"));
        assert!(!json.contains("toolbarWindowPosition"));
    }

    #[test]
    fn invalid_ui_positions_are_discarded() {
        let json = r#"{
            "shortcuts": {
                "toggleDrawing": "Ctrl+Shift+D",
                "clearDrawing": "Ctrl+Shift+C",
                "togglePenetration": "Ctrl+Shift+X"
            },
            "general": {},
            "ui": {
                "toolbarPosition": { "left": 100, "top": 200, "coordSpace": "bogus" },
                "toolbarWindowPosition": { "left": 100, "top": 200 }
            }
        }"#;
        let config: AppConfig = serde_json::from_str::<AppConfig>(json).unwrap().migrated();
        assert_eq!(
            config.ui.toolbar_position.unwrap().coord_space,
            None,
            "unknown coord space is cleared instead of rejecting the file"
        );
        assert_eq!(config.ui.toolbar_window_position.unwrap().coord_space, None);
    }

    #[test]
    fn save_config_keeps_previous_valid_file_as_backup() {
        let dir = temp_dir("backup");
        let path = dir.join("config.json");

        let mut first = AppConfig::default();
        first.general.theme = ThemePreference::Dark;
        save_config_to_path(&path, &first);

        let mut second = AppConfig::default();
        second.general.theme = ThemePreference::Light;
        save_config_to_path(&path, &second);

        let backup = backup_path(&path);
        assert!(backup.is_file(), ".bak must exist after the second save");
        let recovered = read_config(&backup).unwrap();
        assert_eq!(recovered.general.theme, ThemePreference::Dark);
        assert_eq!(
            read_config(&path).unwrap().general.theme,
            ThemePreference::Light
        );

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn load_config_recovers_from_backup_and_preserves_corrupt_file() {
        let dir = temp_dir("recover-backup");
        let path = dir.join("config.json");
        let backup = backup_path(&path);

        fs::write(&path, "{ this is not json").unwrap();
        let mut good = AppConfig::default();
        good.general.theme = ThemePreference::Light;
        fs::write(&backup, serde_json::to_string_pretty(&good).unwrap()).unwrap();

        let loaded = load_config_from_paths(&path, &[]);
        assert_eq!(loaded.general.theme, ThemePreference::Light);
        // The primary file is rewritten with the recovered settings.
        assert_eq!(
            read_config(&path).unwrap().general.theme,
            ThemePreference::Light
        );
        // The broken file is kept for diagnosis instead of being deleted.
        let corrupt = fs::read_dir(&dir)
            .unwrap()
            .flatten()
            .find(|entry| entry.file_name().to_string_lossy().contains("corrupt"))
            .expect("corrupt config should be preserved");
        assert!(corrupt.path().is_file());

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn load_config_migrates_from_another_install_flavour() {
        let dir = temp_dir("migrate");
        let primary = dir.join("current").join("config.json");
        let legacy = dir.join("legacy").join("config.json");
        fs::create_dir_all(legacy.parent().unwrap()).unwrap();

        let mut old = AppConfig::default();
        old.general.theme = ThemePreference::Light;
        old.general.locale = Some("en".into());
        fs::write(&legacy, serde_json::to_string_pretty(&old).unwrap()).unwrap();

        let loaded = load_config_from_paths(&primary, &[legacy]);
        assert_eq!(loaded.general.theme, ThemePreference::Light);
        assert_eq!(loaded.general.locale.as_deref(), Some("en"));
        assert!(primary.is_file(), "migrated config must be written back");
        assert_eq!(
            read_config(&primary).unwrap().general.theme,
            ThemePreference::Light
        );

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn load_config_prefers_primary_over_candidates() {
        let dir = temp_dir("prefer-primary");
        let primary = dir.join("primary").join("config.json");
        let legacy = dir.join("legacy").join("config.json");
        fs::create_dir_all(primary.parent().unwrap()).unwrap();
        fs::create_dir_all(legacy.parent().unwrap()).unwrap();

        let mut current = AppConfig::default();
        current.general.theme = ThemePreference::Dark;
        save_config_to_path(&primary, &current);

        let mut old = AppConfig::default();
        old.general.theme = ThemePreference::Light;
        fs::write(&legacy, serde_json::to_string_pretty(&old).unwrap()).unwrap();

        let loaded = load_config_from_paths(&primary, &[legacy]);
        assert_eq!(loaded.general.theme, ThemePreference::Dark);

        let _ = fs::remove_dir_all(&dir);
    }
}

use std::collections::VecDeque;
use std::fs::{self, OpenOptions};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;
use time::macros::format_description;
use time::OffsetDateTime;
use tracing::{info, warn};
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

use crate::config::{lock_or_recover, AppState};
use crate::error::{AppError, AppResult};
use crate::overlay;

const LOG_TAIL_BYTES: u64 = 96 * 1024;
const EVENTS_FILE_TAIL_BYTES: u64 = 512 * 1024;
const EVENTS_FILE_MAX_BYTES: u64 = 2 * 1024 * 1024;
const MAX_PRIORITY_EVENTS: usize = 300;
const MAX_POINTER_EVENTS: usize = 50;
const MAX_NOISE_EVENTS: usize = 40;
const GITHUB_ISSUE_REPO: &str = "https://github.com/ifer47/markeron/issues/new";
const EVENTS_FILE_NAME: &str = "diagnostics.jsonl";

static EVENTS_PATH: OnceLock<PathBuf> = OnceLock::new();
static EVENTS_FILE_LOCK: Mutex<()> = Mutex::new(());
static SESSION_STARTED_AT_MS: OnceLock<u64> = OnceLock::new();

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticEvent {
    pub ts: u64,
    pub level: String,
    pub category: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticSummary {
    pub total: usize,
    pub errors: usize,
    pub warnings: usize,
    pub sessions: usize,
    pub actions: usize,
    pub pointers: usize,
    pub other: usize,
    /// Events recorded after this process started (excludes hydrated history).
    pub since_launch: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MonitorInfo {
    pub name: Option<String>,
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    pub scale_factor: f64,
    pub is_primary: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticBundle {
    pub exported_at: String,
    pub app_version: String,
    pub app_identifier: String,
    pub platform: String,
    pub arch: String,
    pub os_version: Option<String>,
    pub webview_version: Option<String>,
    pub locale: Option<String>,
    pub overlay_mode: String,
    pub whiteboard_mode: bool,
    pub monitors: Vec<MonitorInfo>,
    pub config: Value,
    pub description: Option<String>,
    pub summary: DiagnosticSummary,
    pub frontend_events: Vec<DiagnosticEvent>,
    pub log_tail: String,
}

#[derive(Debug, Default)]
pub struct DiagnosticBuffer {
    priority: VecDeque<DiagnosticEvent>,
    pointer: VecDeque<DiagnosticEvent>,
    /// console / uncaught runtime noise — capped separately so it cannot crowd out actions.
    noise: VecDeque<DiagnosticEvent>,
}

impl DiagnosticBuffer {
    pub fn push(&mut self, event: DiagnosticEvent) {
        if is_pointer_event(&event) {
            self.pointer.push_back(event);
            while self.pointer.len() > MAX_POINTER_EVENTS {
                self.pointer.pop_front();
            }
        } else if is_noise_event(&event) {
            self.noise.push_back(event);
            while self.noise.len() > MAX_NOISE_EVENTS {
                self.noise.pop_front();
            }
        } else {
            self.priority.push_back(event);
            while self.priority.len() > MAX_PRIORITY_EVENTS {
                self.priority.pop_front();
            }
        }
    }

    pub fn clear(&mut self) {
        self.priority.clear();
        self.pointer.clear();
        self.noise.clear();
    }

    pub fn snapshot(&self) -> Vec<DiagnosticEvent> {
        let mut events: Vec<DiagnosticEvent> = self
            .priority
            .iter()
            .chain(self.pointer.iter())
            .chain(self.noise.iter())
            .cloned()
            .collect();
        events.sort_by_key(|event| event.ts);
        events
    }

    pub fn summary(&self) -> DiagnosticSummary {
        let mut summary = summarize_events(
            self.priority
                .iter()
                .chain(self.pointer.iter())
                .chain(self.noise.iter()),
        );
        let started = session_started_at_ms();
        summary.since_launch = self
            .priority
            .iter()
            .chain(self.pointer.iter())
            .chain(self.noise.iter())
            .filter(|event| event.ts >= started)
            .count();
        summary
    }
}

fn is_pointer_event(event: &DiagnosticEvent) -> bool {
    event.category == "pointer"
}

fn is_noise_event(event: &DiagnosticEvent) -> bool {
    matches!(event.category.as_str(), "console" | "runtime")
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn session_started_at_ms() -> u64 {
    *SESSION_STARTED_AT_MS.get_or_init(now_ms)
}

fn mark_session_started() {
    let _ = SESSION_STARTED_AT_MS.set(now_ms());
}

fn summarize_events<'a>(events: impl Iterator<Item = &'a DiagnosticEvent>) -> DiagnosticSummary {
    let mut summary = DiagnosticSummary::default();
    for event in events {
        summary.total += 1;
        match event.level.as_str() {
            "error" => summary.errors += 1,
            "warn" => summary.warnings += 1,
            _ => {}
        }
        match event.category.as_str() {
            "session" => summary.sessions += 1,
            "action" => summary.actions += 1,
            "pointer" => summary.pointers += 1,
            _ => summary.other += 1,
        }
    }
    summary
}

fn truncate_chars(input: &str, max_chars: usize) -> String {
    let mut chars = input.chars();
    let taken: String = chars.by_ref().take(max_chars).collect();
    if chars.next().is_some() {
        format!("{taken}…")
    } else {
        taken
    }
}

#[allow(dead_code)]
pub struct LogGuard(pub tracing_appender::non_blocking::WorkerGuard);

pub fn log_dir(app: &AppHandle) -> AppResult<PathBuf> {
    let logs = if let Some(data) = crate::portable::data_dir() {
        data.join("logs")
    } else {
        let dir = app
            .path()
            .app_log_dir()
            .map_err(|e| AppError::Other(e.to_string()))?;
        dir.join("logs")
    };
    fs::create_dir_all(&logs).map_err(|e| AppError::Other(e.to_string()))?;
    Ok(logs)
}

pub fn events_path() -> Option<&'static Path> {
    EVENTS_PATH.get().map(PathBuf::as_path)
}

pub fn init_tracing(app: &AppHandle) -> AppResult<LogGuard> {
    let logs = log_dir(app)?;
    let events = logs.join(EVENTS_FILE_NAME);
    let _ = EVENTS_PATH.set(events);

    let file_appender = tracing_appender::rolling::RollingFileAppender::new(
        tracing_appender::rolling::Rotation::DAILY,
        &logs,
        "markeron.log",
    );
    let (non_blocking, guard) = tracing_appender::non_blocking(file_appender);
    let env_filter = tracing_subscriber::EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| "markeron=info".parse().unwrap());

    tracing_subscriber::registry()
        .with(env_filter)
        .with(tracing_subscriber::fmt::layer())
        .with(
            tracing_subscriber::fmt::layer()
                .with_ansi(false)
                .with_writer(non_blocking),
        )
        .init();

    info!("Diagnostic log directory: {}", logs.display());
    Ok(LogGuard(guard))
}

/// Load persisted events into the in-memory buffer (survives crash → relaunch).
pub fn hydrate_from_disk(state: &AppState) {
    mark_session_started();
    let Some(path) = events_path() else {
        return;
    };
    // Hold the buffer lock for the whole hydrate so a concurrent append cannot
    // push then get wiped by clear(). File I/O uses the same lock order as append
    // (buffer → file) to avoid deadlock.
    let mut buffer = lock_or_recover(&state.diagnostic_events);
    let events = {
        let _file_guard = EVENTS_FILE_LOCK
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        read_jsonl_tail(path, EVENTS_FILE_TAIL_BYTES)
    };
    if events.is_empty() {
        return;
    }
    buffer.clear();
    for event in events {
        buffer.push(event);
    }
    info!(
        "Hydrated {} diagnostic events from disk",
        buffer.summary().total
    );
}

pub fn append_event(state: &AppState, event: DiagnosticEvent) {
    let mut buffer = lock_or_recover(&state.diagnostic_events);
    persist_event_line(&event);
    buffer.push(event);
}

pub fn log_backend_event(
    state: &AppState,
    category: &str,
    message: &str,
    detail: Option<Value>,
    level: &str,
) {
    append_event(
        state,
        DiagnosticEvent {
            ts: now_ms(),
            level: level.to_string(),
            category: category.to_string(),
            message: message.to_string(),
            detail,
        },
    );
}

pub fn snapshot_events(state: &AppState) -> Vec<DiagnosticEvent> {
    lock_or_recover(&state.diagnostic_events).snapshot()
}

pub fn event_summary(state: &AppState) -> DiagnosticSummary {
    lock_or_recover(&state.diagnostic_events).summary()
}

fn persist_event_line(event: &DiagnosticEvent) {
    let Some(path) = events_path() else {
        return;
    };
    let Ok(line) = serde_json::to_string(event) else {
        return;
    };
    let _file_guard = EVENTS_FILE_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let Ok(mut file) = OpenOptions::new().create(true).append(true).open(path) else {
        return;
    };
    if writeln!(file, "{line}").is_err() {
        return;
    }
    drop(file);
    rotate_events_file_if_needed(path);
}

fn rotate_events_file_if_needed(path: &Path) {
    let Ok(meta) = fs::metadata(path) else {
        return;
    };
    if meta.len() <= EVENTS_FILE_MAX_BYTES {
        return;
    }
    let Ok(trimmed) = read_tail(path, EVENTS_FILE_TAIL_BYTES) else {
        return;
    };
    let _ = fs::write(path, trimmed);
}

fn read_jsonl_tail(path: &Path, max_bytes: u64) -> Vec<DiagnosticEvent> {
    let Ok(text) = read_tail(path, max_bytes) else {
        return Vec::new();
    };
    text.lines()
        .filter_map(|line| {
            let trimmed = line.trim();
            if trimmed.is_empty() {
                return None;
            }
            serde_json::from_str::<DiagnosticEvent>(trimmed).ok()
        })
        .collect()
}

fn read_log_tail(dir: &Path) -> String {
    let mut candidates: Vec<PathBuf> = fs::read_dir(dir)
        .ok()
        .into_iter()
        .flatten()
        .filter_map(|entry| entry.ok())
        .map(|entry| entry.path())
        .filter(|path| {
            path.is_file()
                && path
                    .file_name()
                    .and_then(|name| name.to_str())
                    .is_some_and(|name| name.starts_with("markeron.log"))
        })
        .collect();
    candidates.sort();

    let Some(path) = candidates.last() else {
        return String::new();
    };

    read_tail(path, LOG_TAIL_BYTES).unwrap_or_default()
}

fn read_tail(path: &Path, max_bytes: u64) -> std::io::Result<String> {
    let mut file = fs::File::open(path)?;
    let len = file.metadata()?.len();
    let start = len.saturating_sub(max_bytes);
    file.seek(SeekFrom::Start(start))?;
    let mut buf = Vec::new();
    file.read_to_end(&mut buf)?;
    let mut text = String::from_utf8_lossy(&buf).into_owned();
    if start > 0 {
        if let Some(idx) = text.find('\n') {
            text = text[idx + 1..].to_string();
        }
    }
    Ok(text)
}

#[cfg(target_os = "windows")]
fn os_version() -> Option<String> {
    use winreg::enums::HKEY_LOCAL_MACHINE;
    use winreg::RegKey;

    let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
    let key = hklm
        .open_subkey(r"SOFTWARE\Microsoft\Windows NT\CurrentVersion")
        .ok()?;
    let product: String = key.get_value("ProductName").unwrap_or_default();
    let display: String = key
        .get_value("DisplayVersion")
        .or_else(|_| key.get_value::<String, _>("ReleaseId"))
        .unwrap_or_default();
    let build: String = key.get_value("CurrentBuild").unwrap_or_default();
    let ubr: u32 = key.get_value("UBR").unwrap_or(0);

    let mut parts = Vec::new();
    if !product.is_empty() {
        parts.push(product);
    }
    if !display.is_empty() {
        parts.push(display);
    }
    if !build.is_empty() {
        if ubr > 0 {
            parts.push(format!("build {build}.{ubr}"));
        } else {
            parts.push(format!("build {build}"));
        }
    }
    if parts.is_empty() {
        None
    } else {
        Some(parts.join(" · "))
    }
}

#[cfg(target_os = "macos")]
fn os_version() -> Option<String> {
    std::process::Command::new("sw_vers")
        .arg("-productVersion")
        .output()
        .ok()
        .and_then(|output| String::from_utf8(output.stdout).ok())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

#[cfg(target_os = "windows")]
fn webview_version() -> Option<String> {
    use winreg::enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE};
    use winreg::RegKey;

    const CLIENT_ID: &str = r"{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}";
    let relative = [
        format!(r"SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{CLIENT_ID}"),
        format!(r"SOFTWARE\Microsoft\EdgeUpdate\Clients\{CLIENT_ID}"),
    ];

    for root in [HKEY_LOCAL_MACHINE, HKEY_CURRENT_USER] {
        let hive = RegKey::predef(root);
        for path in &relative {
            if let Ok(key) = hive.open_subkey(path) {
                if let Ok(version) = key.get_value::<String, _>("pv") {
                    if !version.is_empty() && version != "0.0.0.0" {
                        return Some(version);
                    }
                }
            }
        }
    }
    None
}

#[cfg(target_os = "macos")]
fn webview_version() -> Option<String> {
    // WKWebView follows the OS; productVersion already covers the engine family.
    None
}

fn collect_monitors(app: &AppHandle) -> Vec<MonitorInfo> {
    let Ok(monitors) = app.available_monitors() else {
        return Vec::new();
    };
    let primary = app.primary_monitor().ok().flatten();
    let primary_pos = primary.as_ref().map(|m| m.position());
    let primary_size = primary.as_ref().map(|m| m.size());

    monitors
        .into_iter()
        .map(|monitor| {
            let pos = monitor.position();
            let size = monitor.size();
            let is_primary = match (primary_pos, primary_size) {
                (Some(pp), Some(ps)) => {
                    pp == pos && ps.width == size.width && ps.height == size.height
                }
                _ => false,
            };
            MonitorInfo {
                name: monitor.name().map(|s| s.to_string()),
                x: pos.x,
                y: pos.y,
                width: size.width,
                height: size.height,
                scale_factor: monitor.scale_factor(),
                is_primary,
            }
        })
        .collect()
}

pub fn build_bundle(
    app: &AppHandle,
    state: &AppState,
    description: Option<String>,
) -> AppResult<DiagnosticBundle> {
    let config = lock_or_recover(&state.config).clone();
    let overlay_mode = overlay::current_mode(state);
    let whiteboard_mode = *lock_or_recover(&state.whiteboard_mode);
    let frontend_events = snapshot_events(state);
    let summary = summarize_events(frontend_events.iter());

    let config_value = serde_json::to_value(&config).map_err(|e| AppError::Other(e.to_string()))?;
    let logs = log_dir(app).unwrap_or_else(|_| PathBuf::from("."));

    Ok(DiagnosticBundle {
        exported_at: exported_at_iso(),
        app_version: app.package_info().version.to_string(),
        app_identifier: app.config().identifier.clone(),
        platform: std::env::consts::OS.to_string(),
        arch: std::env::consts::ARCH.to_string(),
        os_version: os_version(),
        webview_version: webview_version(),
        locale: config.general.locale.clone(),
        overlay_mode: overlay_mode.as_str().to_string(),
        whiteboard_mode,
        monitors: collect_monitors(app),
        config: config_value,
        description,
        summary,
        frontend_events,
        log_tail: read_log_tail(&logs),
    })
}

fn exported_at_iso() -> String {
    let format = format_description!("[year]-[month]-[day]T[hour]:[minute]:[second]Z");
    OffsetDateTime::now_utc()
        .format(format)
        .unwrap_or_else(|_| "unknown".to_string())
}

pub fn write_bundle(path: &Path, bundle: &DiagnosticBundle) -> AppResult<()> {
    let json = serde_json::to_string_pretty(bundle).map_err(|e| AppError::Other(e.to_string()))?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| AppError::Other(e.to_string()))?;
    }
    fs::write(path, json).map_err(|e| AppError::Other(e.to_string()))?;
    info!("Exported diagnostics to {}", path.display());
    Ok(())
}

fn percent_encode(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    for byte in input.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(byte as char)
            }
            b' ' => out.push('+'),
            _ => out.push_str(&format!("%{byte:02X}")),
        }
    }
    out
}

pub fn github_issue_url(title: &str, body: &str) -> String {
    format!(
        "{GITHUB_ISSUE_REPO}?title={}&body={}",
        percent_encode(title),
        percent_encode(body)
    )
}

pub fn issue_title_from_description(description: &Option<String>, fallback: &str) -> String {
    let Some(raw) = description
        .as_ref()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
    else {
        return fallback.to_string();
    };
    let first_line = raw.lines().next().unwrap_or(raw).trim();
    let mut chars = first_line.chars();
    let title: String = chars.by_ref().take(80).collect();
    if chars.next().is_some() {
        format!("{title}…")
    } else {
        title
    }
}

fn format_event_line(event: &DiagnosticEvent) -> String {
    let message = truncate_chars(&event.message, 120);
    let mut line = format!("- [{}] {}: {}", event.level, event.category, message);
    if let Some(detail) = &event.detail {
        let compact = serde_json::to_string(detail).unwrap_or_default();
        if compact != "null" && compact != "{}" {
            line.push_str(&format!(" — {}", truncate_chars(&compact, 120)));
        }
    }
    line
}

pub fn issue_body_from_bundle(bundle: &DiagnosticBundle) -> String {
    let mut lines = vec![
        "## 问题描述 / Description".to_string(),
        bundle
            .description
            .clone()
            .filter(|s| !s.trim().is_empty())
            .unwrap_or_else(|| "_请补充复现步骤 / Please add reproduction steps_".to_string()),
        String::new(),
        "## 环境 / Environment".to_string(),
        format!(
            "- MarkerOn v{} ({})",
            bundle.app_version, bundle.app_identifier
        ),
        format!(
            "- OS: {} {} ({})",
            bundle.platform,
            bundle.os_version.as_deref().unwrap_or("unknown"),
            bundle.arch
        ),
    ];

    if let Some(webview) = &bundle.webview_version {
        lines.push(format!("- WebView2: {webview}"));
    }

    lines.push(format!(
        "- Overlay: {}, whiteboard: {}",
        bundle.overlay_mode, bundle.whiteboard_mode
    ));

    if !bundle.monitors.is_empty() {
        let monitor_bits: Vec<String> = bundle
            .monitors
            .iter()
            .map(|m| {
                let name = m.name.as_deref().unwrap_or("display");
                let primary = if m.is_primary { " primary" } else { "" };
                format!(
                    "{name}{primary} {}x{} @{}x ({},{})",
                    m.width, m.height, m.scale_factor, m.x, m.y
                )
            })
            .collect();
        lines.push(format!("- Monitors: {}", monitor_bits.join("; ")));
    }

    let summary = &bundle.summary;
    lines.push(String::new());
    lines.push("## 事件摘要 / Event summary".to_string());
    lines.push(format!(
        "- total {}, errors {}, warnings {}, session {}, action {}, pointer {}",
        summary.total,
        summary.errors,
        summary.warnings,
        summary.sessions,
        summary.actions,
        summary.pointers
    ));

    // Prefer actionable categories over console/runtime noise in the Issue URL body.
    let notable: Vec<&DiagnosticEvent> = bundle
        .frontend_events
        .iter()
        .filter(|e| e.level == "error" || e.level == "warn")
        .filter(|e| !is_noise_event(e))
        .rev()
        .take(5)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect();
    if !notable.is_empty() {
        lines.push(String::new());
        lines.push("## 最近错误 / Recent errors & warnings".to_string());
        for event in notable {
            lines.push(format_event_line(event));
        }
    }

    lines.push(String::new());
    lines.push("## 诊断包 / Diagnostics".to_string());
    lines.push("1. 在 MarkerOn 中：**设置 → 应用诊断 → 导出日志**，保存 JSON 文件。".to_string());
    lines.push(
        "2. 在本 Issue 编辑框中 **拖拽该 JSON 文件**（或粘贴）作为附件，再点击 Submit。"
            .to_string(),
    );
    lines.push(String::new());
    lines.push(
        "1. In MarkerOn: **Settings → Diagnostics → Export logs**, save the JSON file.".to_string(),
    );
    lines.push(
        "2. **Drag the JSON file** into this issue editor (or paste) as an attachment, then click Submit.".to_string(),
    );
    lines.join("\n")
}

#[tauri::command]
pub fn append_diagnostic_event(state: State<'_, AppState>, event: DiagnosticEvent) {
    append_event(&state, event);
}

#[tauri::command]
pub fn get_diagnostics_summary(state: State<'_, AppState>) -> DiagnosticSummary {
    event_summary(&state)
}

#[tauri::command]
pub async fn export_diagnostics(
    app: AppHandle,
    state: State<'_, AppState>,
    description: Option<String>,
) -> AppResult<Option<String>> {
    let bundle = build_bundle(&app, &state, description)?;
    let default_name = format!(
        "markeron-diagnostics-{}.json",
        bundle.exported_at.replace(':', "-")
    );
    let Some(path) = app
        .dialog()
        .file()
        .set_title("MarkerOn Diagnostics")
        .set_file_name(&default_name)
        .add_filter("JSON", &["json"])
        .blocking_save_file()
    else {
        return Ok(None);
    };

    let file_path = path
        .into_path()
        .map_err(|e| AppError::Other(e.to_string()))?;
    write_bundle(&file_path, &bundle)?;
    Ok(Some(file_path.to_string_lossy().into_owned()))
}

#[tauri::command]
pub async fn reveal_diagnostics_file(app: AppHandle, path: String) -> AppResult<()> {
    let path = PathBuf::from(path);
    if !path.exists() {
        return Err(AppError::Other("File not found".into()));
    }
    app.opener()
        .reveal_item_in_dir(&path)
        .map_err(|e| AppError::Other(e.to_string()))?;
    Ok(())
}

#[tauri::command]
pub async fn open_github_issue_report(
    app: AppHandle,
    state: State<'_, AppState>,
    title: String,
    description: Option<String>,
) -> AppResult<()> {
    let bundle = build_bundle(&app, &state, description.clone())?;
    let resolved_title = issue_title_from_description(&description, &title);
    let body = issue_body_from_bundle(&bundle);
    let mut url = github_issue_url(&resolved_title, &body);
    if !url.starts_with("https://github.com/ifer47/markeron/") {
        return Err(AppError::Other("URL not allowed".into()));
    }
    // Browsers / GitHub truncate very long query strings; fall back to a compact body.
    if url.len() > 7000 {
        warn!(
            "GitHub issue URL is long ({} chars); retrying with a compact body",
            url.len()
        );
        let compact = issue_body_from_bundle(&DiagnosticBundle {
            frontend_events: Vec::new(),
            ..bundle.clone()
        });
        url = github_issue_url(&resolved_title, &compact);
    }
    app.opener()
        .open_url(&url, None::<&str>)
        .map_err(|e| AppError::Other(e.to_string()))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn percent_encode_handles_spaces() {
        assert_eq!(percent_encode("hello world"), "hello+world");
    }

    #[test]
    fn github_issue_url_uses_repo() {
        let url = github_issue_url("bug", "steps");
        assert!(url.starts_with(GITHUB_ISSUE_REPO));
        assert!(url.contains("title=bug"));
        assert!(url.contains("body=steps"));
    }

    #[test]
    fn buffer_keeps_pointer_and_priority_separately() {
        let mut buffer = DiagnosticBuffer::default();
        for i in 0..80 {
            buffer.push(DiagnosticEvent {
                ts: i,
                level: "info".into(),
                category: "pointer".into(),
                message: format!("stroke-{i}"),
                detail: None,
            });
        }
        for i in 0..10 {
            buffer.push(DiagnosticEvent {
                ts: 1000 + i,
                level: "error".into(),
                category: "copy".into(),
                message: format!("fail-{i}"),
                detail: None,
            });
        }
        let summary = buffer.summary();
        assert_eq!(summary.pointers, MAX_POINTER_EVENTS);
        assert_eq!(summary.errors, 10);
        assert_eq!(summary.total, MAX_POINTER_EVENTS + 10);
        let snap = buffer.snapshot();
        assert!(snap.iter().any(|e| e.message == "fail-9"));
        assert!(snap.iter().any(|e| e.message == "stroke-79"));
        assert!(!snap.iter().any(|e| e.message == "stroke-0"));
    }

    #[test]
    fn issue_title_uses_first_line() {
        let desc = Some("抬笔就复制\n第二行".to_string());
        assert_eq!(
            issue_title_from_description(&desc, "Bug report"),
            "抬笔就复制"
        );
        assert_eq!(
            issue_title_from_description(&None, "Bug report"),
            "Bug report"
        );
    }

    #[test]
    fn summarize_counts_levels_and_categories() {
        let events = vec![
            DiagnosticEvent {
                ts: 1,
                level: "error".into(),
                category: "copy".into(),
                message: "a".into(),
                detail: None,
            },
            DiagnosticEvent {
                ts: 2,
                level: "warn".into(),
                category: "session".into(),
                message: "b".into(),
                detail: None,
            },
            DiagnosticEvent {
                ts: 3,
                level: "info".into(),
                category: "pointer".into(),
                message: "c".into(),
                detail: None,
            },
        ];
        let summary = summarize_events(events.iter());
        assert_eq!(summary.total, 3);
        assert_eq!(summary.errors, 1);
        assert_eq!(summary.warnings, 1);
        assert_eq!(summary.sessions, 1);
        assert_eq!(summary.pointers, 1);
        assert_eq!(summary.other, 1);
    }

    #[test]
    fn truncate_chars_is_utf8_safe() {
        let text = "错误信息：剪贴板复制失败，请重试一次";
        let truncated = truncate_chars(text, 8);
        assert!(truncated.ends_with('…'));
        assert_eq!(truncated.chars().count(), 9); // 8 + ellipsis
    }

    #[test]
    fn format_event_line_does_not_panic_on_multibyte_detail() {
        let event = DiagnosticEvent {
            ts: 1,
            level: "error".into(),
            category: "copy".into(),
            message: "copyScreen failed".into(),
            detail: Some(serde_json::json!({
                "error": "剪贴板写入失败：权限不足或格式不受支持，请稍后重试并检查系统设置"
            })),
        };
        let line = format_event_line(&event);
        assert!(line.contains("copyScreen failed"));
        assert!(line.contains('…') || line.contains("剪贴板"));
    }

    #[test]
    fn noise_events_do_not_evict_priority() {
        let mut buffer = DiagnosticBuffer::default();
        buffer.push(DiagnosticEvent {
            ts: 1,
            level: "info".into(),
            category: "session".into(),
            message: "keep-me".into(),
            detail: None,
        });
        for i in 0..80 {
            buffer.push(DiagnosticEvent {
                ts: 10 + i,
                level: "error".into(),
                category: "console".into(),
                message: format!("noise-{i}"),
                detail: None,
            });
        }
        let snap = buffer.snapshot();
        assert!(snap.iter().any(|e| e.message == "keep-me"));
        assert_eq!(
            snap.iter().filter(|e| e.category == "console").count(),
            MAX_NOISE_EVENTS
        );
    }
}

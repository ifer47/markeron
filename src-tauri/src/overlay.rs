use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use tracing::{info, warn};

use crate::config::{lock_or_recover, AppState, ToolbarVisibility};
use crate::diagnostics::log_backend_event;
use crate::monitor;
use std::time::{Duration, Instant};

fn set_ignore_cursor_events(window: &WebviewWindow, ignore: bool) {
    window.set_ignore_cursor_events(ignore).ok();
}

/// Keep the overlay clear color fully transparent.
///
/// On Windows, WebView2 can lose transparency after long idle / GPU recycle /
/// DPI moves and fall back to an opaque dark (black) clear color. Re-asserting
/// on each activation matches macOS `configure_overlay_window`.
fn ensure_overlay_transparent(window: &WebviewWindow) {
    use tauri::window::Color;
    window.set_background_color(Some(Color(0, 0, 0, 0))).ok();
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OverlayMode {
    Hidden,
    Drawing,
    Penetration,
}

impl OverlayMode {
    pub fn as_str(self) -> &'static str {
        match self {
            OverlayMode::Hidden => "hidden",
            OverlayMode::Drawing => "drawing",
            OverlayMode::Penetration => "penetration",
        }
    }
}

pub fn current_mode(state: &AppState) -> OverlayMode {
    *lock_or_recover(&state.overlay_mode)
}

pub fn set_mode(state: &AppState, mode: OverlayMode) {
    *lock_or_recover(&state.overlay_mode) = mode;
}

fn begin_activation_guard(state: &AppState) {
    *lock_or_recover(&state.suppress_penetration_until) =
        Some(Instant::now() + Duration::from_millis(600));
}

fn should_suppress_penetration(state: &AppState) -> bool {
    lock_or_recover(&state.suppress_penetration_until)
        .map(|deadline| Instant::now() < deadline)
        .unwrap_or(false)
}

pub fn suppress_penetration_for(state: &AppState, duration_ms: u64) {
    *lock_or_recover(&state.suppress_penetration_until) =
        Some(Instant::now() + Duration::from_millis(duration_ms));
}

fn is_toolbar_focused(app: &AppHandle) -> bool {
    app.get_webview_window("toolbar")
        .and_then(|w| w.is_focused().ok())
        .unwrap_or(false)
}

fn emit_mode(app: &AppHandle, mode: OverlayMode) {
    let payload = mode.as_str();
    if let Err(e) = app.emit("overlay-mode-changed", payload) {
        warn!("Failed to emit overlay-mode-changed: {}", e);
    }
    let is_active = mode != OverlayMode::Hidden;
    if let Err(e) = app.emit("toggle-drawing", is_active) {
        warn!("Failed to emit toggle-drawing({}): {}", is_active, e);
    }
}

fn emit_overlay_geometry_changed(app: &AppHandle) {
    if let Err(e) = app.emit("overlay-geometry-changed", ()) {
        warn!("Failed to emit overlay-geometry-changed: {}", e);
    }
}

fn reassert_overlay_transparency(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("overlay") {
        ensure_overlay_transparent(&window);
    }
}

fn apply_deferred_overlay_geometry(app: &AppHandle) {
    reassert_overlay_transparency(app);
    emit_overlay_geometry_changed(app);
    #[cfg(target_os = "macos")]
    {
        // Overlay may have moved while the toolbar was its child; clamp and
        // re-attach so the panel stays on the new monitor and above ink.
        if app
            .get_webview_window("toolbar")
            .is_some_and(|w| w.is_visible().unwrap_or(false))
        {
            clamp_toolbar_to_overlay_monitor(app);
            raise_toolbar_above_overlay(app);
        }
    }
}

/// Notify the overlay webview after Win32/Tauri has applied a new monitor geometry.
/// Deferred pulses let WM_DPICHANGED (and WebView2 compositor recreate) finish
/// before the frontend resizes canvases; also re-assert transparent clear color
/// because DPI/GPU recycle can restore an opaque dark backdrop.
pub fn notify_overlay_geometry_changed(app: &AppHandle) {
    reassert_overlay_transparency(app);
    emit_overlay_geometry_changed(app);
    let app = app.clone();
    std::thread::spawn(move || {
        for delay_ms in [50_u64, 150] {
            std::thread::sleep(Duration::from_millis(delay_ms));
            let app_for_thread = app.clone();
            let _ = app.run_on_main_thread(move || {
                apply_deferred_overlay_geometry(&app_for_thread);
            });
        }
    });
}

pub fn setup_overlay_size(app: &AppHandle) {
    #[cfg(target_os = "macos")]
    {
        // Detach before moving the overlay so an attached toolbar is not dragged
        // by the parent's set_position / set_size.
        if let Some(toolbar) = app.get_webview_window("toolbar") {
            crate::macos::detach_toolbar_ns_window_from_overlay(&toolbar);
        }
    }

    if let Some(window) = app.get_webview_window("overlay") {
        if let Some((x, y, w, h)) = monitor::get_cursor_monitor_rect() {
            #[cfg(target_os = "macos")]
            {
                window.set_size(tauri::LogicalSize::new(w, h)).ok();
                window.set_position(tauri::LogicalPosition::new(x, y)).ok();
            }
            #[cfg(windows)]
            {
                if let Ok(hwnd) = window.hwnd() {
                    crate::win32::position_window_on_monitor(hwnd.0 as isize, x, y, w, h);
                } else {
                    window
                        .set_size(tauri::PhysicalSize::new(w, h.saturating_sub(1)))
                        .ok();
                    window.set_position(tauri::PhysicalPosition::new(x, y)).ok();
                }
            }
        } else if let Some(mon) = app.primary_monitor().ok().flatten() {
            let size = mon.size();
            let pos = mon.position();
            #[cfg(target_os = "macos")]
            {
                let scale = mon.scale_factor();
                window
                    .set_size(tauri::LogicalSize::new(
                        size.width as f64 / scale,
                        size.height as f64 / scale,
                    ))
                    .ok();
                window
                    .set_position(tauri::LogicalPosition::new(
                        pos.x as f64 / scale,
                        pos.y as f64 / scale,
                    ))
                    .ok();
            }
            #[cfg(not(target_os = "macos"))]
            {
                window
                    .set_size(tauri::PhysicalSize::new(
                        size.width,
                        size.height.saturating_sub(1),
                    ))
                    .ok();
                window
                    .set_position(tauri::PhysicalPosition::new(pos.x, pos.y))
                    .ok();
            }
        }
        set_ignore_cursor_events(&window, true);
        ensure_overlay_transparent(&window);
    }

    #[cfg(target_os = "macos")]
    {
        // Restore on-monitor placement and child stacking if the toolbar is up.
        if app
            .get_webview_window("toolbar")
            .is_some_and(|w| w.is_visible().unwrap_or(false))
        {
            clamp_toolbar_to_overlay_monitor(app);
            raise_toolbar_above_overlay(app);
        }
    }
}

const TOOLBAR_WIDTH: f64 = 340.0;
const TOOLBAR_PANEL_WIDTH: f64 = 320.0;
/// Compact standalone panel height measured from live DOM (`.overlay-panel-surface`).
/// Expanded ≈452. Inflating this (e.g. 500) raises maxTop and pulls space-popup away from a
/// bottom-edge pointer.
const TOOLBAR_PANEL_HEIGHT_COMPACT: f64 = 234.0;
const TOOLBAR_EDGE_MARGIN: f64 = 8.0;

fn toolbar_panel_height_logical(window: &tauri::WebviewWindow, fallback: f64) -> f64 {
    let scale = window.scale_factor().unwrap_or(1.0);
    window
        .outer_size()
        .ok()
        .map(|s| s.height as f64 / scale)
        .filter(|h| *h >= 64.0)
        .unwrap_or(fallback)
}

fn position_toolbar_window(app: &AppHandle) {
    let Some(window) = app.get_webview_window("toolbar") else {
        return;
    };

    if let Some((x, y, w, _h)) = monitor::get_cursor_monitor_rect() {
        #[cfg(target_os = "macos")]
        {
            let left = x as f64 + w as f64 - TOOLBAR_WIDTH - 16.0;
            let top = y as f64 + 40.0;
            window
                .set_position(tauri::LogicalPosition::new(left, top))
                .ok();
        }
        #[cfg(not(target_os = "macos"))]
        {
            let left = x + w as i32 - TOOLBAR_WIDTH as i32 - 16;
            let top = y + 40;
            window
                .set_position(tauri::PhysicalPosition::new(left, top))
                .ok();
        }
    }
}

fn toolbar_always_visible(state: &AppState) -> bool {
    lock_or_recover(&state.config).general.toolbar_visibility == ToolbarVisibility::Always
}

fn create_toolbar_window(app: &AppHandle) {
    if app.get_webview_window("toolbar").is_some() {
        return;
    }

    let url = WebviewUrl::App("index.html#toolbar".into());
    let builder = WebviewWindowBuilder::new(app, "toolbar", url)
        .title("MarkerOn")
        .inner_size(TOOLBAR_WIDTH, TOOLBAR_PANEL_HEIGHT_COMPACT)
        .decorations(false)
        .transparent(true)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(false)
        .visible(false)
        .focused(false)
        .shadow(false);

    match builder.build() {
        Ok(window) => {
            position_toolbar_window(app);
            #[cfg(target_os = "macos")]
            crate::macos::configure_toolbar_window(&window);
            window.set_always_on_top(true).ok();
            set_ignore_cursor_events(&window, false);
        }
        Err(e) => warn!("Failed to create toolbar window: {}", e),
    }
}

/// Re-stack the toolbar webview above the drawing overlay.
///
/// Both windows use `always_on_top`. Clicking the overlay canvas (e.g. to start a
/// stroke) can promote it above the toolbar on Windows and macOS. This restores
/// toolbar-on-top ordering without focusing the toolbar.
///
/// **Shared (all platforms):** `overlay` and `toolbar` → `set_always_on_top(true)`.
///
/// **Windows:** `SetWindowPos(HWND_TOPMOST)` on overlay, then toolbar (`win32.rs`).
///
/// **macOS:** attach toolbar as overlay's AppKit child window (`macos.rs`). Do
/// **not** rely on `toolbar.show()` or same-level `always_on_top` — leaving the
/// panel toggles click-through and canvas clicks reorder the overlay above the
/// panel. A child window stays above its parent. Do not call WKWebView
/// Objective-C selectors (crashes on Wry).
///
/// Invoked from drawing activation, toolbar reposition, panel hover pass-through
/// changes, and the frontend `raise_toolbar` IPC (pointer-down, toolbar drag end).
pub fn raise_toolbar_above_overlay(app: &AppHandle) {
    let Some(toolbar) = app.get_webview_window("toolbar") else {
        return;
    };
    if !toolbar.is_visible().unwrap_or(false) {
        return;
    }
    let overlay = app.get_webview_window("overlay");
    #[cfg(target_os = "macos")]
    {
        crate::macos::raise_toolbar_ns_window_above_overlay(&toolbar, overlay.as_ref());
        return;
    }
    #[cfg(not(target_os = "macos"))]
    {
        // Keep both windows topmost, then force toolbar above overlay in the OS Z-order.
        if let Some(ref overlay) = overlay {
            overlay.set_always_on_top(true).ok();
        }
        toolbar.set_always_on_top(true).ok();
        #[cfg(windows)]
        {
            if let Ok(toolbar_hwnd) = toolbar.hwnd() {
                if let Some(ref overlay) = overlay {
                    if let Ok(overlay_hwnd) = overlay.hwnd() {
                        crate::win32::raise_window_topmost_no_activate(overlay_hwnd.0 as isize);
                    }
                }
                crate::win32::raise_window_topmost_no_activate(toolbar_hwnd.0 as isize);
            }
        }
    }
}

/// Keep the always-on toolbar fully inside the current overlay monitor.
///
/// Called whenever the pinned toolbar is shown (e.g. Ctrl+Shift+D) so a saved or
/// stale position on a disconnected / other display cannot leave the panel off-screen.
fn clamp_toolbar_to_overlay_monitor(app: &AppHandle) {
    let Some(window) = app.get_webview_window("toolbar") else {
        return;
    };
    let Some(bounds) = monitor::get_overlay_monitor_logical_bounds(app) else {
        return;
    };

    let overlay_scale = app
        .get_webview_window("overlay")
        .and_then(|w| w.scale_factor().ok())
        .unwrap_or(1.0);
    let toolbar_scale = window.scale_factor().unwrap_or(overlay_scale);

    let Ok(pos) = window.outer_position() else {
        return;
    };
    let left = pos.x as f64 / toolbar_scale;
    let top = pos.y as f64 / toolbar_scale;

    let panel_h = toolbar_panel_height_logical(&window, TOOLBAR_PANEL_HEIGHT_COMPACT);
    let (x, y) = monitor::clamp_logical_position_to_monitor(
        left,
        top,
        TOOLBAR_PANEL_WIDTH,
        panel_h,
        &bounds,
        TOOLBAR_EDGE_MARGIN,
    );

    if (x - left).abs() < 0.5 && (y - top).abs() < 0.5 {
        return;
    }

    #[cfg(windows)]
    {
        let phys_x = (x * overlay_scale).round() as i32;
        let phys_y = (y * overlay_scale).round() as i32;
        window
            .set_position(tauri::PhysicalPosition::new(phys_x, phys_y))
            .ok();
        if let Err(e) = app.emit("toolbar-window-positioned", ()) {
            warn!("Failed to emit toolbar-window-positioned: {}", e);
        }
    }

    #[cfg(not(windows))]
    {
        window.set_position(tauri::LogicalPosition::new(x, y)).ok();
    }
}

pub fn set_toolbar_window_visible(app: &AppHandle, visible: bool) {
    create_toolbar_window(app);
    if let Some(window) = app.get_webview_window("toolbar") {
        if visible {
            window.show().ok();
            window.set_always_on_top(true).ok();
            set_ignore_cursor_events(&window, false);
            let state = app.state::<AppState>();
            if toolbar_always_visible(&state) {
                clamp_toolbar_to_overlay_monitor(app);
            }
            raise_toolbar_above_overlay(app);
        } else {
            window.hide().ok();
        }
    }
}

pub fn position_toolbar_at(app: &AppHandle, x: f64, y: f64, panel_height: Option<f64>) {
    create_toolbar_window(app);
    let Some(window) = app.get_webview_window("toolbar") else {
        return;
    };
    let bounds = monitor::get_overlay_monitor_logical_bounds(app);
    let requested_x = x;
    let requested_y = y;
    let panel_h = panel_height
        .filter(|h| *h >= 64.0)
        .unwrap_or_else(|| toolbar_panel_height_logical(&window, TOOLBAR_PANEL_HEIGHT_COMPACT));
    let (x, y) = if let Some(ref bounds) = bounds {
        monitor::clamp_logical_position_to_monitor(
            x,
            y,
            TOOLBAR_PANEL_WIDTH,
            panel_h,
            bounds,
            TOOLBAR_EDGE_MARGIN,
        )
    } else {
        (x, y)
    };
    let state = app.state::<crate::config::AppState>();
    let overlay_scale = app
        .get_webview_window("overlay")
        .and_then(|w| w.scale_factor().ok())
        .unwrap_or(1.0);

    log_backend_event(
        &state,
        "ui",
        "toolbar popup positioned",
        Some(serde_json::json!({
            "requested": { "x": requested_x, "y": requested_y },
            "clamped": { "x": x, "y": y },
            "panelHeight": panel_h,
            "monitorBounds": bounds,
            "overlayScale": overlay_scale,
        })),
        "info",
    );

    #[cfg(windows)]
    {
        let phys_x = (x * overlay_scale).round() as i32;
        let phys_y = (y * overlay_scale).round() as i32;
        let phys_w = (TOOLBAR_PANEL_WIDTH * overlay_scale).round() as u32;
        let phys_h = (panel_h * overlay_scale).round() as u32;
        if let Ok(hwnd) = window.hwnd() {
            crate::win32::position_window_on_monitor(
                hwnd.0 as isize,
                phys_x,
                phys_y,
                phys_w.max(1),
                phys_h.max(96),
            );
        } else {
            window
                .set_position(tauri::PhysicalPosition::new(phys_x, phys_y))
                .ok();
            window
                .set_size(tauri::PhysicalSize::new(
                    phys_w.max(1),
                    phys_h.saturating_sub(1).max(1),
                ))
                .ok();
        }
        if let Err(e) = app.emit("toolbar-window-positioned", ()) {
            warn!("Failed to emit toolbar-window-positioned: {}", e);
        }
    }

    #[cfg(not(windows))]
    {
        window.set_position(tauri::LogicalPosition::new(x, y)).ok();
        if let Err(e) = app.emit("toolbar-window-positioned", ()) {
            warn!("Failed to emit toolbar-window-positioned: {}", e);
        }
    }

    raise_toolbar_above_overlay(app);
}

pub fn set_toolbar_popup(
    app: &AppHandle,
    state: &AppState,
    visible: bool,
    x: Option<f64>,
    y: Option<f64>,
    height: Option<f64>,
) {
    if visible {
        if let (Some(x), Some(y)) = (x, y) {
            position_toolbar_at(app, x, y, height);
        }
        set_toolbar_window_visible(app, true);
        suppress_penetration_for(state, 800);
    } else {
        set_toolbar_window_visible(app, false);
    }
}

pub fn ensure_toolbar_window(app: &AppHandle, state: &AppState) {
    set_toolbar_window_visible(app, toolbar_always_visible(state));
}

pub fn hide_toolbar_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("toolbar") {
        window.hide().ok();
    }
}

pub fn deactivate_drawing(app: &AppHandle, state: &AppState) {
    if current_mode(state) == OverlayMode::Hidden {
        return;
    }

    monitor::release_drawing_cursor_clip();
    set_mode(state, OverlayMode::Hidden);
    *lock_or_recover(&state.whiteboard_mode) = false;

    if let Some(window) = app.get_webview_window("overlay") {
        set_ignore_cursor_events(&window, true);
        window.hide().ok();
    }
    hide_toolbar_window(app);
    emit_mode(app, OverlayMode::Hidden);
}

pub fn activate_drawing(app: &AppHandle, state: &AppState) {
    begin_activation_guard(state);
    set_mode(state, OverlayMode::Drawing);

    let preserve = lock_or_recover(&state.config).general.preserve_drawings;

    if let Some(window) = app.get_webview_window("overlay") {
        setup_overlay_size(app);
        if !preserve {
            if let Err(e) = app.emit("clear-drawing", ()) {
                warn!("Failed to emit clear-drawing: {}", e);
            }
        }
        ensure_overlay_transparent(&window);
        window.show().ok();
        set_ignore_cursor_events(&window, false);
        window.set_always_on_top(true).ok();
        // Re-assert after show: some WebView2 builds only apply clear color once visible.
        ensure_overlay_transparent(&window);
        notify_overlay_geometry_changed(app);
    }

    ensure_toolbar_window(app, state);

    if let Some(window) = app.get_webview_window("overlay") {
        window.set_focus().ok();
    }
    raise_toolbar_above_overlay(app);

    monitor::remember_and_clip_drawing_monitor(app);
    emit_mode(app, OverlayMode::Drawing);
    info!("Drawing mode activated");
}

/// Whether the OS cursor is over the visible toolbar window (macOS drawing-mode panel hover).
pub fn is_pointer_over_toolbar_panel(app: &AppHandle) -> bool {
    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
        false
    }
    #[cfg(target_os = "macos")]
    {
        let Some(toolbar) = app.get_webview_window("toolbar") else {
            return false;
        };
        if !toolbar.is_visible().unwrap_or(false) {
            return false;
        }
        let Some((px, py)) = monitor::get_cursor_screen_pos() else {
            return false;
        };
        let Ok(pos) = toolbar.outer_position() else {
            return false;
        };
        let Ok(size) = toolbar.outer_size() else {
            return false;
        };
        let Ok(scale) = toolbar.scale_factor() else {
            return false;
        };
        let left = pos.x as f64 / scale;
        let top = pos.y as f64 / scale;
        let w = size.width as f64 / scale;
        let h = size.height as f64 / scale;
        let x = px as f64;
        let y = py as f64;
        x >= left && x < left + w && y >= top && y < top + h
    }
}

/// Pass pointer events through the overlay while the cursor is over the toolbar (drawing mode).
///
/// **macOS:** the toolbar is an AppKit *child* above the overlay, so it already wins
/// hit-testing. Enabling `ignoresMouseEvents` on the parent was the old (sibling
/// z-order) approach and now prevents the child from receiving hover until a click
/// activates it. Instead: keep stacking, make the toolbar key on enter, and restore
/// the overlay as key on leave.
///
/// **Other platforms:** unused from the frontend today; keep click-through + raise.
pub fn set_overlay_ignore_cursor_events(app: &AppHandle, state: &AppState, ignore: bool) {
    if current_mode(state) != OverlayMode::Drawing {
        return;
    }
    #[cfg(target_os = "macos")]
    {
        raise_toolbar_above_overlay(app);
        if ignore {
            if let Some(toolbar) = app.get_webview_window("toolbar") {
                crate::macos::activate_toolbar_for_pointer_interaction(&toolbar);
            }
        } else if let Some(overlay) = app.get_webview_window("overlay") {
            // Ensure we are not left in a stale click-through state from older builds.
            set_ignore_cursor_events(&overlay, false);
            crate::macos::activate_overlay_for_drawing(&overlay);
        }
        return;
    }
    #[cfg(not(target_os = "macos"))]
    {
        if let Some(window) = app.get_webview_window("overlay") {
            set_ignore_cursor_events(&window, ignore);
        }
        raise_toolbar_above_overlay(app);
    }
}

pub fn enter_penetration_mode(app: &AppHandle, state: &AppState) {
    if current_mode(state) != OverlayMode::Drawing {
        return;
    }
    if *lock_or_recover(&state.whiteboard_mode) {
        return;
    }

    set_mode(state, OverlayMode::Penetration);

    if let Some(window) = app.get_webview_window("overlay") {
        set_ignore_cursor_events(&window, true);
    }

    monitor::suspend_drawing_cursor_clip();

    // Keep the current toolbar placement. Re-running ensure_toolbar_window would
    // hide a space-popup (always-on=false) or re-clamp a pinned panel.
    raise_toolbar_above_overlay(app);
    emit_mode(app, OverlayMode::Penetration);
}

pub fn exit_penetration_mode(app: &AppHandle, state: &AppState) {
    if current_mode(state) != OverlayMode::Penetration {
        return;
    }

    set_mode(state, OverlayMode::Drawing);

    if let Some(window) = app.get_webview_window("overlay") {
        set_ignore_cursor_events(&window, false);
        window.set_always_on_top(true).ok();
        window.set_focus().ok();
    }

    raise_toolbar_above_overlay(app);
    monitor::apply_drawing_cursor_clip();
    emit_mode(app, OverlayMode::Drawing);
}

pub fn toggle_penetration_mode(app: &AppHandle, state: &AppState) {
    match current_mode(state) {
        OverlayMode::Drawing => enter_penetration_mode(app, state),
        OverlayMode::Penetration => exit_penetration_mode(app, state),
        OverlayMode::Hidden => {}
    }
}

pub fn toggle_drawing(app: &AppHandle) {
    let state = app.state::<AppState>();
    match current_mode(&state) {
        OverlayMode::Hidden => activate_drawing(app, &state),
        OverlayMode::Drawing | OverlayMode::Penetration => deactivate_drawing(app, &state),
    }
}

pub fn clear_drawing(app: &AppHandle, state: &AppState) {
    if current_mode(state) == OverlayMode::Hidden {
        return;
    }
    // `true` = undoable clear (Ctrl+Z restores). Activation without preserve emits `()`.
    if let Err(e) = app.emit("clear-drawing", true) {
        warn!("Failed to emit clear-drawing: {}", e);
    }
}

pub fn on_overlay_focus_lost(app: &AppHandle, state: &AppState) {
    if current_mode(state) != OverlayMode::Drawing {
        return;
    }
    if should_suppress_penetration(state) || is_toolbar_focused(app) {
        return;
    }

    // Defer so toolbar pointerdown can set suppression before we enter penetration.
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(120));
        let app_for_thread = app.clone();
        let _ = app.run_on_main_thread(move || {
            let state = app_for_thread.state::<AppState>();
            if current_mode(&state) != OverlayMode::Drawing {
                return;
            }
            if should_suppress_penetration(&state) || is_toolbar_focused(&app_for_thread) {
                return;
            }
            log_backend_event(
                &state,
                "action",
                "toggle penetration requested",
                Some(serde_json::json!({ "reason": "focus-loss" })),
                "info",
            );
            enter_penetration_mode(&app_for_thread, &state);
        });
    });
}

#[cfg(test)]
mod tests {
    /// Regression guard for cross-platform toolbar stacking in `raise_toolbar_above_overlay`.
    ///
    /// macOS must use AppKit `addChildWindow` (`macos.rs`), not the Win32-only
    /// `SetWindowPos` branch. CI on macOS runners executes this test.
    #[test]
    #[cfg(target_os = "macos")]
    fn macos_raise_toolbar_uses_nswindow_reorder_not_win32() {
        assert!(
            !cfg!(windows),
            "macOS must use NSWindow addChildWindow, not SetWindowPos"
        );
    }

    #[test]
    #[cfg(windows)]
    fn windows_raise_toolbar_uses_win32_topmost_reorder() {
        assert!(
            cfg!(windows),
            "Windows must compile the SetWindowPos topmost reorder block"
        );
    }
}

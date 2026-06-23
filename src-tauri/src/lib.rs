mod clipboard;
mod commands;
mod config;
mod error;
mod i18n;
mod monitor;
mod shortcuts;
#[cfg(target_os = "windows")]
mod win32;

use std::sync::Mutex;
use tauri::{
    menu::{MenuBuilder, MenuItemBuilder},
    tray::TrayIconEvent,
    AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder,
};
use tracing::{info, warn};

use config::{lock_or_recover, AppConfig, AppState};

pub fn rebuild_tray_menu(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let s = i18n::strings();
    if let Some(tray) = app.tray_by_id("main") {
        let settings_item = MenuItemBuilder::with_id("settings", s.settings).build(app)?;
        let help_item = MenuItemBuilder::with_id("help", s.help).build(app)?;
        let about_item = MenuItemBuilder::with_id("about", s.about).build(app)?;
        let quit_item = MenuItemBuilder::with_id("quit", s.quit).build(app)?;
        let menu = MenuBuilder::new(app)
            .item(&settings_item)
            .item(&help_item)
            .item(&about_item)
            .separator()
            .item(&quit_item)
            .build()?;
        tray.set_menu(Some(menu))?;
    }
    Ok(())
}

fn setup_overlay_size(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("overlay") {
        if let Some((x, y, w, h)) = monitor::get_cursor_monitor_rect() {
            #[cfg(target_os = "macos")]
            {
                // xcap returns logical coordinates (points) on macOS via CGDisplayBounds
                window
                    .set_size(tauri::LogicalSize::new(w, h))
                    .ok();
                window
                    .set_position(tauri::LogicalPosition::new(x, y))
                    .ok();
            }
            #[cfg(not(target_os = "macos"))]
            {
                // Subtract 1px from height to prevent Windows from treating it as
                // fullscreen exclusive, which causes the taskbar to lose Mica effect.
                window
                    .set_size(tauri::PhysicalSize::new(w, h.saturating_sub(1)))
                    .ok();
                window
                    .set_position(tauri::PhysicalPosition::new(x, y))
                    .ok();
            }
        } else if let Some(mon) = app.primary_monitor().ok().flatten() {
            let size = mon.size();
            let pos = mon.position();
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
        window.set_ignore_cursor_events(true).ok();
    }
}

/// Deactivate drawing mode: set state to false, hide overlay, notify frontend.
/// Unified logic used by exit_drawing command, focus-loss handler, and toggle.
pub fn deactivate_drawing(app: &AppHandle, state: &AppState) {
    let mut is_drawing = lock_or_recover(&state.is_drawing);
    if !*is_drawing {
        return;
    }
    *is_drawing = false;
    drop(is_drawing);

    if let Some(window) = app.get_webview_window("overlay") {
        window.set_ignore_cursor_events(true).ok();
        if let Err(e) = app.emit("toggle-drawing", false) {
            warn!("Failed to emit toggle-drawing(false): {}", e);
        }
        window.hide().ok();
    }
}

fn toggle_drawing(app: &AppHandle) {
    let state = app.state::<AppState>();
    let currently_drawing = *lock_or_recover(&state.is_drawing);

    if currently_drawing {
        // deactivate_drawing handles setting is_drawing = false
        deactivate_drawing(app, &state);
        return;
    }

    // Activate drawing
    *lock_or_recover(&state.is_drawing) = true;

    let preserve = lock_or_recover(&state.config).general.preserve_drawings;

    if let Some(window) = app.get_webview_window("overlay") {
        setup_overlay_size(app);
        if !preserve {
            if let Err(e) = app.emit("clear-drawing", ()) {
                warn!("Failed to emit clear-drawing: {}", e);
            }
        }
        window.show().ok();
        window.set_ignore_cursor_events(false).ok();
        window.set_always_on_top(true).ok();
        window.set_focus().ok();
        if let Err(e) = app.emit("toggle-drawing", true) {
            warn!("Failed to emit toggle-drawing(true): {}", e);
        }
    }
}

fn clear_drawing(app: &AppHandle) {
    if let Err(e) = app.emit("clear-drawing", ()) {
        warn!("Failed to emit clear-drawing: {}", e);
    }
}

fn open_settings(app: &AppHandle) {
    open_settings_tab(app, None);
}

fn open_settings_tab(app: &AppHandle, tab: Option<&str>) {
    if let Some(win) = app.get_webview_window("settings") {
        win.set_focus().ok();
        if let Some(t) = tab {
            app.emit("switch-tab", t).ok();
        }
        return;
    }

    let hash = match tab {
        Some(t) => format!("index.html#settings/{}", t),
        None => "index.html#settings".to_string(),
    };
    let url = WebviewUrl::App(hash.into());
    let builder = WebviewWindowBuilder::new(app, "settings", url)
        .title(i18n::strings().window_title)
        .inner_size(620.0, 450.0)
        .min_inner_size(500.0, 380.0)
        .resizable(true)
        .visible(true);

    if let Err(e) = builder.build() {
        warn!("Failed to open settings window: {}", e);
    }
}

pub fn run() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "markeron=info".parse().unwrap()),
        )
        .init();

    info!("Starting MarkerOn");

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(win) = app.get_webview_window("settings") {
                win.set_focus().ok();
            }
        }))
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec![]),
        ))
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .manage(AppState {
            config: Mutex::new(AppConfig::default()),
            is_drawing: Mutex::new(false),
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_config,
            commands::save_shortcuts,
            commands::save_general,
            commands::save_locale,
            commands::exit_drawing,
            commands::open_url,
            clipboard::copy_screen,
        ])
        .setup(|app| {
            let handle = app.handle().clone();

            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            let loaded = config::load_config(&handle);
            i18n::init(loaded.general.locale.as_deref());
            {
                let state = handle.state::<AppState>();
                *lock_or_recover(&state.config) = loaded;
            }

            setup_overlay_size(&handle);

            rebuild_tray_menu(&handle).ok();

            if let Some(tray) = app.tray_by_id("main") {
                tray.on_menu_event(move |app, event| match event.id().as_ref() {
                    "settings" => open_settings(app),
                    "help" => open_settings_tab(app, Some("help")),
                    "about" => open_settings_tab(app, Some("about")),
                    "quit" => app.exit(0),
                    _ => {}
                });
                let handle_click = handle.clone();
                tray.on_tray_icon_event(move |_tray, event| {
                    if let TrayIconEvent::Click {
                        button: tauri::tray::MouseButton::Left,
                        button_state: tauri::tray::MouseButtonState::Up,
                        ..
                    } = event
                    {
                        toggle_drawing(&handle_click);
                    }
                });
            }

            shortcuts::register_shortcuts(&handle);

            let ctrlc_handle = handle.clone();
            ctrlc::set_handler(move || {
                ctrlc_handle.exit(0);
            })
            .ok();

            Ok(())
        })
        .on_window_event(|window, event| match event {
            tauri::WindowEvent::CloseRequested { api, .. } if window.label() == "overlay" => {
                api.prevent_close();
                window.hide().ok();
            }
            tauri::WindowEvent::Focused(false) if window.label() == "overlay" => {
                let app = window.app_handle();
                let state = app.state::<AppState>();
                deactivate_drawing(app, &state);
            }
            _ => {}
        })
        .run(tauri::generate_context!())
        .expect("error while running MarkerOn");
}

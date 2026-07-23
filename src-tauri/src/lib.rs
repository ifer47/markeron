#[cfg(not(any(target_os = "windows", target_os = "macos")))]
compile_error!("MarkerOn only supports Windows and macOS.");

mod clipboard;
mod commands;
mod config;
mod diagnostics;
mod error;
mod i18n;
#[cfg(target_os = "macos")]
mod macos;
#[cfg(target_os = "macos")]
mod macos_cursor;
mod monitor;
mod overlay;
mod portable;
mod shortcuts;
mod theme;
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
use diagnostics::log_backend_event;
pub use overlay::{
    activate_drawing, clear_drawing, deactivate_drawing, enter_penetration_mode,
    exit_penetration_mode, raise_toolbar_above_overlay, set_toolbar_window_visible,
    setup_overlay_size, toggle_drawing, toggle_penetration_mode,
};

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
        tray.set_tooltip(Some(s.tray_tooltip))?;
    }
    Ok(())
}

fn open_settings(app: &AppHandle) {
    open_settings_tab(app, None);
}

fn focus_settings_window(app: &AppHandle, tab: Option<&str>) {
    let Some(win) = app.get_webview_window("settings") else {
        return;
    };
    #[cfg(target_os = "macos")]
    macos::activate_for_settings(app);
    win.show().ok();
    win.set_focus().ok();
    if let Some(t) = tab {
        app.emit_to("settings", "switch-tab", t).ok();
    }
}

/// Second launch while the app is already running (desktop icon / pinned taskbar /
/// opening the .app again on macOS). Match tray left-click: toggle annotation.
///
/// Previously this only focused the settings window, which no-ops when settings
/// was never opened — so relaunch appeared to do nothing. `toggle_drawing` is the
/// same path as the tray and global shortcut; safe on macOS Accessory policy.
fn on_second_instance(app: &AppHandle) {
    let state = app.state::<AppState>();
    log_backend_event(
        &state,
        "session",
        "toggle drawing requested",
        Some(serde_json::json!({ "reason": "second-instance" })),
        "info",
    );
    toggle_drawing(app);
}

/// Called from the settings webview after it mounts (window starts hidden to avoid white flash).
pub fn reveal_settings_window(app: &AppHandle) {
    focus_settings_window(app, None);
}

fn open_settings_tab(app: &AppHandle, tab: Option<&str>) {
    if app.get_webview_window("settings").is_some() {
        focus_settings_window(app, tab);
        return;
    }

    let hash = match tab {
        Some(t) => format!("index.html#settings/{}", t),
        None => "index.html#settings".to_string(),
    };
    let url = WebviewUrl::App(hash.into());
    let builder = WebviewWindowBuilder::new(app, "settings", url)
        .title(i18n::strings().window_title)
        .inner_size(660.0, 500.0)
        .min_inner_size(540.0, 420.0)
        .resizable(true)
        .center()
        .visible(false);

    #[cfg(target_os = "macos")]
    let builder = macos::style_settings_builder(builder);

    match builder.build() {
        #[cfg(target_os = "macos")]
        Ok(window) => {
            macos::activate_for_settings(app);
            let preference = lock_or_recover(&app.state::<AppState>().config).general.theme;
            macos::configure_settings_window(&window, theme::resolve_theme(&preference));
        }
        #[cfg(not(target_os = "macos"))]
        Ok(_) => {
            let preference = lock_or_recover(&app.state::<AppState>().config).general.theme;
            theme::apply_app_theme(app, &preference);
        }
        Err(e) => warn!("Failed to open settings window: {}", e),
    }
}

pub fn run() {
    // Redirect WebView2 profile before any webview is created (portable builds).
    portable::apply_webview_user_data_dir();

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            on_second_instance(app);
        }))
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec![]),
        ))
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(AppState {
            config: Mutex::new(AppConfig::default()),
            overlay_mode: Mutex::new(overlay::OverlayMode::Hidden),
            suppress_penetration_until: Mutex::new(None),
            whiteboard_mode: Mutex::new(false),
            diagnostic_events: Mutex::new(Vec::new()),
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_config,
            commands::get_overlay_pointer_position,
            commands::get_overlay_monitor_logical_bounds,
            commands::is_pointer_over_toolbar_panel,
            commands::set_overlay_ignore_cursor_events,
            commands::save_shortcuts,
            commands::save_general,
            commands::save_line_widths,
            commands::save_locale,
            commands::apply_app_theme,
            commands::exit_drawing,
            commands::enter_penetration_mode,
            commands::exit_penetration_mode,
            commands::toggle_penetration_mode,
            commands::set_toolbar_visible,
            commands::set_toolbar_popup,
            commands::suppress_penetration,
            commands::raise_toolbar,
            commands::set_whiteboard_mode,
            commands::open_url,
            commands::reveal_settings_window,
            commands::is_portable,
            diagnostics::export_diagnostics,
            diagnostics::open_github_issue_report,
            diagnostics::append_diagnostic_event,
            clipboard::copy_screen,
            clipboard::copy_whiteboard,
        ])
        .setup(|app| {
            let handle = app.handle().clone();
            let log_guard = diagnostics::init_tracing(&handle)?;
            app.manage(log_guard);
            if portable::is_portable() {
                info!("Starting MarkerOn (portable mode)");
            } else {
                info!("Starting MarkerOn");
            }

            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            let loaded = config::load_config(&handle);
            i18n::init(loaded.general.locale.as_deref());
            {
                let state = handle.state::<AppState>();
                *lock_or_recover(&state.config) = loaded.clone();
            }
            config::sync_autostart(&handle, loaded.general.auto_start);

            theme::apply_app_theme(&handle, &loaded.general.theme);

            setup_overlay_size(&handle);

            #[cfg(target_os = "macos")]
            macos::configure_overlay_window(&handle);

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
                        let state = handle_click.state::<AppState>();
                        log_backend_event(
                            &state,
                            "session",
                            "toggle drawing requested",
                            Some(serde_json::json!({ "reason": "tray" })),
                            "info",
                        );
                        toggle_drawing(&handle_click);
                    }
                });
            }

            shortcuts::register_shortcuts(&handle);

            let ctrlc_handle = handle.clone();
            ctrlc::set_handler(move || {
                crate::monitor::release_drawing_cursor_clip();
                ctrlc_handle.exit(0);
            })
            .ok();

            Ok(())
        })
        .on_window_event(|window, event| match event {
            tauri::WindowEvent::CloseRequested { api, .. }
                if window.label() == "overlay" || window.label() == "toolbar" =>
            {
                api.prevent_close();
                window.hide().ok();
            }
            tauri::WindowEvent::Focused(false) if window.label() == "overlay" => {
                let app = window.app_handle();
                let state = app.state::<AppState>();
                overlay::on_overlay_focus_lost(app, &state);
            }
            tauri::WindowEvent::Destroyed if window.label() == "settings" => {
                #[cfg(target_os = "macos")]
                macos::restore_accessory_policy(window.app_handle());
            }
            _ => {}
        })
        .run(tauri::generate_context!())
        .expect("error while running MarkerOn");
}

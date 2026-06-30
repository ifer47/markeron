use tauri::{AppHandle, Manager, TitleBarStyle, Theme, WebviewWindow};
use tauri_utils::config::Color;

const SETTINGS_BG: Color = Color(30, 30, 32, 255);

pub fn style_settings_builder(
    builder: tauri::WebviewWindowBuilder<'_, tauri::Wry, AppHandle>,
) -> tauri::WebviewWindowBuilder<'_, tauri::Wry, AppHandle> {
    builder
        .title_bar_style(TitleBarStyle::Transparent)
        .theme(Some(Theme::Dark))
        .background_color(SETTINGS_BG)
}

pub fn configure_settings_window(window: &WebviewWindow) {
    window.set_theme(Some(Theme::Dark)).ok();
    window.set_background_color(Some(SETTINGS_BG)).ok();
}

pub fn configure_overlay_window(app: &AppHandle) {
    let Some(window) = app.get_webview_window("overlay") else {
        return;
    };

    window.set_background_color(Some(Color(0, 0, 0, 0))).ok();

    window
        .with_webview(|webview| {
            use objc2::msg_send;
            use objc2::runtime::AnyObject;

            unsafe {
                let view = webview.inner() as *mut AnyObject;
                let _: () = msg_send![view, setDrawsBackground, false];
                let _: () = msg_send![view, setOpaque, false];
            }
        })
        .ok();
}

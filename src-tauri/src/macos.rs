#![allow(unexpected_cfgs)]

use tauri::window::Color;
use tauri::{ActivationPolicy, AppHandle, Manager, Theme, TitleBarStyle, WebviewWindow};

use objc::declare::ClassDecl;
use objc::runtime::{Class, Object, Sel};
use objc::{class, msg_send, sel, sel_impl};
use std::sync::OnceLock;

const SETTINGS_BG: Color = Color(30, 30, 32, 255);
static APP_HANDLE: OnceLock<AppHandle> = OnceLock::new();

unsafe extern "C" {
    fn object_setClass(object: *mut Object, class: *const Class) -> *const Class;
}

unsafe fn nsstring(value: &str) -> *mut Object {
    let string: *mut Object = msg_send![class!(NSString), alloc];
    let string: *mut Object = msg_send![string, initWithBytes:value.as_ptr()
        length:value.len()
        encoding:4usize];
    string
}

unsafe fn append_dock_item(menu: *mut Object, title: &str, action: Sel, target: *mut Object) {
    let title = nsstring(title);
    let empty = nsstring("");
    let item: *mut Object = msg_send![class!(NSMenuItem), alloc];
    let item: *mut Object = msg_send![item, initWithTitle:title action:action keyEquivalent:empty];
    let _: () = msg_send![item, setTarget:target];
    let _: () = msg_send![menu, addItem:item];
    let _: () = msg_send![title, release];
    let _: () = msg_send![empty, release];
    let _: () = msg_send![item, release];
}

extern "C" fn dock_menu(this: &Object, _: Sel, _: *mut Object) -> *mut Object {
    unsafe {
        let menu: *mut Object = msg_send![class!(NSMenu), alloc];
        let title = nsstring("MarkerOn");
        let menu: *mut Object = msg_send![menu, initWithTitle:title];
        let _: () = msg_send![title, release];
        let strings = crate::i18n::strings();
        append_dock_item(
            menu,
            strings.toggle_drawing,
            sel!(markerOnToggleDrawing:),
            this as *const _ as *mut _,
        );
        append_dock_item(
            menu,
            strings.clear_drawing,
            sel!(markerOnClearDrawing:),
            this as *const _ as *mut _,
        );
        append_dock_item(
            menu,
            strings.toggle_penetration,
            sel!(markerOnTogglePenetration:),
            this as *const _ as *mut _,
        );
        msg_send![menu, autorelease]
    }
}

extern "C" fn toggle_drawing(_: &Object, _: Sel, _: *mut Object) {
    if let Some(app) = APP_HANDLE.get() {
        crate::dispatch_system_menu_action(app, "toggle_drawing", "dock-menu");
    }
}

extern "C" fn clear_drawing(_: &Object, _: Sel, _: *mut Object) {
    if let Some(app) = APP_HANDLE.get() {
        crate::dispatch_system_menu_action(app, "clear_drawing", "dock-menu");
    }
}

extern "C" fn toggle_penetration(_: &Object, _: Sel, _: *mut Object) {
    if let Some(app) = APP_HANDLE.get() {
        crate::dispatch_system_menu_action(app, "toggle_penetration", "dock-menu");
    }
}

/// Add the three high-frequency global actions to the native Dock context menu.
pub fn install_dock_menu(app: &AppHandle) {
    APP_HANDLE.set(app.clone()).ok();
    unsafe {
        let ns_app: *mut Object = msg_send![class!(NSApplication), sharedApplication];
        let delegate: *mut Object = msg_send![ns_app, delegate];
        if delegate.is_null() {
            return;
        }
        let superclass: &Class = msg_send![delegate, class];
        let subclass_name = format!("MarkerOnDockMenuDelegate_{}", superclass.name());
        let subclass = if let Some(existing) = Class::get(&subclass_name) {
            existing
        } else {
            let Some(mut decl) = ClassDecl::new(&subclass_name, superclass) else {
                return;
            };
            decl.add_method(
                sel!(applicationDockMenu:),
                dock_menu as extern "C" fn(&Object, Sel, *mut Object) -> *mut Object,
            );
            decl.add_method(
                sel!(markerOnToggleDrawing:),
                toggle_drawing as extern "C" fn(&Object, Sel, *mut Object),
            );
            decl.add_method(
                sel!(markerOnClearDrawing:),
                clear_drawing as extern "C" fn(&Object, Sel, *mut Object),
            );
            decl.add_method(
                sel!(markerOnTogglePenetration:),
                toggle_penetration as extern "C" fn(&Object, Sel, *mut Object),
            );
            decl.register()
        };
        object_setClass(delegate, subclass);
    }
}

/// Tray apps run as Accessory; a Regular policy is required to surface the settings window.
pub fn activate_for_settings(app: &AppHandle) {
    app.set_activation_policy(ActivationPolicy::Regular).ok();
}

pub fn restore_accessory_policy(app: &AppHandle) {
    app.set_activation_policy(ActivationPolicy::Accessory).ok();
}

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

    // Use Tauri's API only. Wry already disables WKWebView's white background for
    // transparent windows; calling Objective-C selectors on WryWebView will crash.
    window.set_background_color(Some(Color(0, 0, 0, 0))).ok();
}

pub fn configure_toolbar_window(window: &WebviewWindow) {
    window.set_background_color(Some(Color(0, 0, 0, 0))).ok();
}

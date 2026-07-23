use std::ffi::c_void;

use dispatch2::DispatchQueue;
use tauri::window::Color;
use tauri::{ActivationPolicy, AppHandle, Manager, Theme, TitleBarStyle, WebviewWindow};

use crate::theme::ResolvedTheme;

const SETTINGS_BG_DARK: Color = Color(30, 30, 32, 255); // #1e1e20
const SETTINGS_BG_LIGHT: Color = Color(245, 245, 247, 255); // #f5f5f7

/// `NSWindowAbove` — place the receiver above the other window / as an ordered child.
const NS_WINDOW_ABOVE: isize = 1;

/// AppKit `NSFloatingWindowLevel` — Tauri `always_on_top` uses this.
const NS_FLOATING_WINDOW_LEVEL: isize = 3;

/// `NSWindowSharingNone` — omit this window from screen capture / screencapture
/// (legacy window-list APIs; pairs with sync `orderOut` for in-app copy).
const NS_WINDOW_SHARING_NONE: isize = 0;

type Sel = *const c_void;

extern "C" {
    fn sel_registerName(name: *const std::ffi::c_char) -> Sel;
    fn objc_msgSend();
    fn pthread_main_np() -> i32;
}

unsafe fn msg_send_ptr(receiver: *mut c_void, sel: Sel) -> *mut c_void {
    let f: unsafe extern "C" fn(*mut c_void, Sel) -> *mut c_void =
        std::mem::transmute(objc_msgSend as *const c_void);
    f(receiver, sel)
}

unsafe fn msg_send_void(receiver: *mut c_void, sel: Sel) {
    let f: unsafe extern "C" fn(*mut c_void, Sel) =
        std::mem::transmute(objc_msgSend as *const c_void);
    f(receiver, sel);
}

unsafe fn msg_send_void_id(receiver: *mut c_void, sel: Sel, arg: *mut c_void) {
    let f: unsafe extern "C" fn(*mut c_void, Sel, *mut c_void) =
        std::mem::transmute(objc_msgSend as *const c_void);
    f(receiver, sel, arg);
}

unsafe fn msg_send_iset(receiver: *mut c_void, sel: Sel, value: isize) {
    let f: unsafe extern "C" fn(*mut c_void, Sel, isize) =
        std::mem::transmute(objc_msgSend as *const c_void);
    f(receiver, sel, value);
}

unsafe fn msg_send_add_child(receiver: *mut c_void, sel: Sel, child: *mut c_void, ordered: isize) {
    let f: unsafe extern "C" fn(*mut c_void, Sel, *mut c_void, isize) =
        std::mem::transmute(objc_msgSend as *const c_void);
    f(receiver, sel, child, ordered);
}

unsafe fn msg_send_bool_arg(receiver: *mut c_void, sel: Sel, value: bool) {
    // ObjC BOOL is a signed char on Apple platforms.
    let f: unsafe extern "C" fn(*mut c_void, Sel, i8) =
        std::mem::transmute(objc_msgSend as *const c_void);
    f(receiver, sel, if value { 1 } else { 0 });
}

fn is_main_thread() -> bool {
    unsafe { pthread_main_np() != 0 }
}

fn run_on_appkit_main(f: impl FnOnce() + Send + 'static) {
    if is_main_thread() {
        f();
    } else {
        // Same serial queue as tao's set_level_async / set_ignore_mouse_events.
        // exec_sync runs after any blocks already queued on that queue.
        DispatchQueue::main().exec_sync(f);
    }
}

fn detach_toolbar_from_parent_now(toolbar: &WebviewWindow) {
    let Ok(toolbar_ns) = toolbar.ns_window() else {
        return;
    };
    if toolbar_ns.is_null() {
        return;
    }
    unsafe {
        let parent_sel = sel_registerName(c"parentWindow".as_ptr());
        let parent = msg_send_ptr(toolbar_ns, parent_sel);
        if parent.is_null() {
            return;
        }
        let remove_sel = sel_registerName(c"removeChildWindow:".as_ptr());
        msg_send_void_id(parent, remove_sel, toolbar_ns);
    }
}

/// Detach the toolbar from its AppKit parent (usually the overlay).
///
/// Call before independently hiding the toolbar (screenshot) or before moving the
/// overlay, so the child is not ordered out with / dragged by the parent.
pub fn detach_toolbar_ns_window_from_overlay(toolbar: &WebviewWindow) {
    let toolbar = toolbar.clone();
    run_on_appkit_main(move || {
        detach_toolbar_from_parent_now(&toolbar);
    });
}

fn exclude_toolbar_from_capture_now(toolbar_ns: *mut c_void) {
    if toolbar_ns.is_null() {
        return;
    }
    unsafe {
        let sel = sel_registerName(c"setSharingType:".as_ptr());
        msg_send_iset(toolbar_ns, sel, NS_WINDOW_SHARING_NONE);
    }
}

fn hide_toolbar_for_capture_now(toolbar: &WebviewWindow) {
    detach_toolbar_from_parent_now(toolbar);
    let Ok(toolbar_ns) = toolbar.ns_window() else {
        let _ = toolbar.hide();
        return;
    };
    if toolbar_ns.is_null() {
        let _ = toolbar.hide();
        return;
    }
    unsafe {
        exclude_toolbar_from_capture_now(toolbar_ns);
        // `orderOut:` must run on the AppKit queue before `screencapture`; Tauri's
        // `hide()` is async via the event loop and often still visible mid-capture.
        let order_out = sel_registerName(c"orderOut:".as_ptr());
        msg_send_void_id(toolbar_ns, order_out, std::ptr::null_mut());
    }
}

/// Synchronously detach + `orderOut` the toolbar so in-app `screencapture` cannot
/// include it. Also pins `NSWindowSharingNone` (Windows `WDA_EXCLUDEFROMCAPTURE` analog).
pub fn hide_toolbar_ns_window_for_capture(toolbar: &WebviewWindow) {
    let toolbar = toolbar.clone();
    run_on_appkit_main(move || {
        hide_toolbar_for_capture_now(&toolbar);
    });
}

/// Mark the toolbar so capture APIs that respect sharing type omit it.
pub fn exclude_toolbar_ns_window_from_capture(toolbar: &WebviewWindow) {
    let toolbar = toolbar.clone();
    run_on_appkit_main(move || {
        if let Ok(ns) = toolbar.ns_window() {
            exclude_toolbar_from_capture_now(ns);
        }
    });
}

fn set_accepts_mouse_moved_now(ns_window: *mut c_void, accepts: bool) {
    if ns_window.is_null() {
        return;
    }
    unsafe {
        let sel = sel_registerName(c"setAcceptsMouseMovedEvents:".as_ptr());
        msg_send_bool_arg(ns_window, sel, accepts);
    }
}

fn make_key_window_now(ns_window: *mut c_void) {
    if ns_window.is_null() {
        return;
    }
    unsafe {
        // Key only — do not orderFront (would fight child stacking / z-order).
        let sel = sel_registerName(c"makeKeyWindow".as_ptr());
        msg_send_void(ns_window, sel);
    }
}

/// Toolbar is an AppKit child above the overlay: enable mouse-moved and make it
/// key so hover/buttons work without a prior activating click.
pub fn activate_toolbar_for_pointer_interaction(toolbar: &WebviewWindow) {
    let toolbar = toolbar.clone();
    run_on_appkit_main(move || {
        let Ok(ns) = toolbar.ns_window() else {
            return;
        };
        set_accepts_mouse_moved_now(ns, true);
        make_key_window_now(ns);
    });
}

/// Pointer left the panel — give the overlay key status again for drawing.
pub fn activate_overlay_for_drawing(overlay: &WebviewWindow) {
    let overlay = overlay.clone();
    run_on_appkit_main(move || {
        let Ok(ns) = overlay.ns_window() else {
            return;
        };
        set_accepts_mouse_moved_now(ns, true);
        make_key_window_now(ns);
    });
}

/// Attach the toolbar as an AppKit **child** of the overlay so it stays above ink.
///
/// Do **not** call Tauri `set_always_on_top` here: it `DispatchQueue::main().exec_async`
/// `setLevel(NSFloatingWindowLevel)` and races with any higher level we set. Child
/// windows are always ordered above their parent, so canvas click reorder and
/// panel enter/leave click-through cannot put ink over the panel.
fn order_toolbar_above_overlay_now(toolbar: &WebviewWindow, overlay: Option<&WebviewWindow>) {
    let Ok(toolbar_ns) = toolbar.ns_window() else {
        let _ = toolbar.show();
        return;
    };
    if toolbar_ns.is_null() {
        let _ = toolbar.show();
        return;
    }

    unsafe {
        let set_level_sel = sel_registerName(c"setLevel:".as_ptr());

        if let Some(overlay) = overlay {
            if let Ok(overlay_ns) = overlay.ns_window() {
                if !overlay_ns.is_null() {
                    // Keep both at floating; stacking comes from the child relationship.
                    msg_send_iset(overlay_ns, set_level_sel, NS_FLOATING_WINDOW_LEVEL);
                    msg_send_iset(toolbar_ns, set_level_sel, NS_FLOATING_WINDOW_LEVEL);

                    let parent_sel = sel_registerName(c"parentWindow".as_ptr());
                    let parent = msg_send_ptr(toolbar_ns, parent_sel);
                    if !parent.is_null() && parent != overlay_ns {
                        let remove_sel = sel_registerName(c"removeChildWindow:".as_ptr());
                        msg_send_void_id(parent, remove_sel, toolbar_ns);
                    }
                    if parent != overlay_ns {
                        let add_sel = sel_registerName(c"addChildWindow:ordered:".as_ptr());
                        msg_send_add_child(overlay_ns, add_sel, toolbar_ns, NS_WINDOW_ABOVE);
                    }
                    // Keep capture-exclusion across re-attach (tao may recreate state).
                    exclude_toolbar_from_capture_now(toolbar_ns);
                    set_accepts_mouse_moved_now(toolbar_ns, true);
                    return;
                }
            }
        }

        let regardless_sel = sel_registerName(c"orderFrontRegardless".as_ptr());
        msg_send_void(toolbar_ns, regardless_sel);
    }
}

/// Re-stack the toolbar **NSWindow** above the overlay without activating it.
///
/// macOS: make the toolbar a child of the overlay (`addChildWindow:ordered:`).
/// Same-level `always_on_top` + `orderWindow` is not enough — leaving the panel
/// toggles `ignoresMouseEvents` (GCD async) and canvas clicks reorder the overlay
/// above the panel. A child window cannot be covered by its parent.
///
/// Runs on the AppKit/GCD main queue (same as tao window ops). A follow-up
/// `exec_async` re-asserts after any blocks that were already queued when called
/// from the main thread (without blocking — that would deadlock).
///
/// Only NSWindow selectors are used — never WKWebView / WryWebView (those crash).
pub fn raise_toolbar_ns_window_above_overlay(
    toolbar: &WebviewWindow,
    overlay: Option<&WebviewWindow>,
) {
    let toolbar_sync = toolbar.clone();
    let overlay_sync = overlay.cloned();
    run_on_appkit_main(move || {
        order_toolbar_above_overlay_now(&toolbar_sync, overlay_sync.as_ref());
    });

    let toolbar_async = toolbar.clone();
    let overlay_async = overlay.cloned();
    DispatchQueue::main().exec_async(move || {
        order_toolbar_above_overlay_now(&toolbar_async, overlay_async.as_ref());
    });
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
        .background_color(SETTINGS_BG_DARK)
}

/// Reads `AppleInterfaceStyle` via CFPreferences (`"Dark"` → dark).
pub fn system_appearance_is_dark() -> bool {
    unsafe {
        extern "C" {
            fn CFPreferencesCopyAppValue(key: *const c_void, app_id: *const c_void) -> *mut c_void;
            fn CFRelease(cf: *const c_void);
            fn CFStringCreateWithCString(
                alloc: *const c_void,
                c_str: *const std::ffi::c_char,
                encoding: u32,
            ) -> *mut c_void;
            fn CFStringCompare(
                the_string1: *const c_void,
                the_string2: *const c_void,
                compare_options: u64,
            ) -> i32;
        }
        const K_CF_STRING_ENCODING_UTF8: u32 = 0x0800_0100;
        let key = CFStringCreateWithCString(
            std::ptr::null(),
            c"AppleInterfaceStyle".as_ptr(),
            K_CF_STRING_ENCODING_UTF8,
        );
        let app = CFStringCreateWithCString(
            std::ptr::null(),
            c"Apple Global Domain".as_ptr(),
            K_CF_STRING_ENCODING_UTF8,
        );
        let value = CFPreferencesCopyAppValue(key, app);
        CFRelease(key);
        CFRelease(app);
        if value.is_null() {
            return false; // missing → light
        }
        let dark = CFStringCreateWithCString(
            std::ptr::null(),
            c"Dark".as_ptr(),
            K_CF_STRING_ENCODING_UTF8,
        );
        let cmp = CFStringCompare(value, dark, 0);
        CFRelease(dark);
        CFRelease(value);
        cmp == 0 // kCFCompareEqualTo
    }
}

pub fn configure_settings_window(window: &WebviewWindow, resolved: ResolvedTheme) {
    let (theme, bg) = match resolved {
        ResolvedTheme::Dark => (Theme::Dark, SETTINGS_BG_DARK),
        ResolvedTheme::Light => (Theme::Light, SETTINGS_BG_LIGHT),
    };
    window.set_theme(Some(theme)).ok();
    window.set_background_color(Some(bg)).ok();
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
    // Same intent as Windows WDA_EXCLUDEFROMCAPTURE: omit panel from screenshots.
    exclude_toolbar_ns_window_from_capture(window);
    // Hover styles / tooltips without requiring an activating click first.
    let window = window.clone();
    run_on_appkit_main(move || {
        if let Ok(ns) = window.ns_window() {
            set_accepts_mouse_moved_now(ns, true);
        }
    });
}

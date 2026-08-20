#![cfg(target_os = "windows")]

#[allow(clippy::upper_case_acronyms)]
#[repr(C)]
#[derive(Copy, Clone)]
pub struct POINT {
    pub x: i32,
    pub y: i32,
}

#[allow(clippy::upper_case_acronyms)]
#[repr(C)]
#[derive(Copy, Clone)]
pub struct RECT {
    pub left: i32,
    pub top: i32,
    pub right: i32,
    pub bottom: i32,
}

#[allow(clippy::upper_case_acronyms)]
#[repr(C)]
pub struct MONITORINFO {
    pub cb_size: u32,
    pub rc_monitor: RECT,
    pub rc_work: RECT,
    pub dw_flags: u32,
}

pub const MONITOR_DEFAULTTONEAREST: u32 = 2;

pub const HWND_TOPMOST: isize = -1;
pub const SWP_NOMOVE: u32 = 0x0002;
pub const SWP_NOSIZE: u32 = 0x0001;
pub const SWP_NOACTIVATE: u32 = 0x0010;
pub const WDA_NONE: u32 = 0x00000000;
/// Exclude window from BitBlt / screen capture (Windows 10 2004+).
pub const WDA_EXCLUDEFROMCAPTURE: u32 = 0x00000011;

extern "system" {
    pub fn GetCursorPos(lp_point: *mut POINT) -> i32;
    pub fn MonitorFromPoint(pt: POINT, dw_flags: u32) -> isize;
    pub fn GetMonitorInfoW(h_monitor: isize, lpmi: *mut MONITORINFO) -> i32;
    pub fn ClipCursor(lp_rect: *const RECT) -> i32;
    pub fn SetWindowPos(
        h_wnd: isize,
        h_wnd_insert_after: isize,
        x: i32,
        y: i32,
        cx: i32,
        cy: i32,
        u_flags: u32,
    ) -> i32;
    fn SetWindowDisplayAffinity(h_wnd: isize, dw_affinity: u32) -> i32;
}

/// Exclude (or re-include) a window from desktop BitBlt / screen capture.
/// Returns false when the API is unavailable or rejects the hwnd.
pub fn set_window_exclude_from_capture(hwnd: isize, exclude: bool) -> bool {
    let affinity = if exclude {
        WDA_EXCLUDEFROMCAPTURE
    } else {
        WDA_NONE
    };
    unsafe { SetWindowDisplayAffinity(hwnd, affinity) != 0 }
}

/// Raise a window to the top of the topmost group without stealing keyboard focus.
pub fn raise_window_topmost_no_activate(hwnd: isize) {
    unsafe {
        SetWindowPos(
            hwnd,
            HWND_TOPMOST,
            0,
            0,
            0,
            0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE,
        );
    }
}

/// Move and resize a topmost window in one Win32 call so per-monitor DPI updates
/// before the WebView relayouts (avoids pointer/canvas offset on mixed-DPI setups).
pub fn position_window_on_monitor(hwnd: isize, x: i32, y: i32, width: u32, height: u32) {
    let w = width.max(1) as i32;
    let h = height.saturating_sub(1).max(1) as i32;
    unsafe {
        SetWindowPos(hwnd, HWND_TOPMOST, x, y, w, h, SWP_NOACTIVATE);
    }
}

/// Re-apply the DWM blur-behind transparent backdrop for the overlay window.
///
/// `tao` implements a `transparent(true)` window by calling
/// `DwmEnableBlurBehindWindow` with an empty blur region — but only once, at
/// window creation. After a long idle the DWM compositor can drop that state
/// (especially while the overlay sits hidden with `WS_EX_LAYERED` from
/// click-through), which leaves an opaque black backdrop. Re-asserting it on
/// each activation restores the transparent host window that the WebView2
/// alpha-compositor sits on top of.
pub fn reapply_overlay_transparency(hwnd: isize) {
    use windows_sys::Win32::Foundation::{BOOL, HWND};
    use windows_sys::Win32::Graphics::Dwm::{
        DwmEnableBlurBehindWindow, DWM_BB_BLURREGION, DWM_BB_ENABLE, DWM_BLURBEHIND,
    };
    use windows_sys::Win32::Graphics::Gdi::{CreateRectRgn, DeleteObject};

    unsafe {
        // Empty region for the blur effect, so the window is fully transparent.
        let region = CreateRectRgn(0, 0, -1, -1);
        if region.is_null() {
            return;
        }
        let blur = DWM_BLURBEHIND {
            dwFlags: DWM_BB_ENABLE | DWM_BB_BLURREGION,
            fEnable: 1 as BOOL,
            hRgnBlur: region,
            fTransitionOnMaximized: 0,
        };
        let _ = DwmEnableBlurBehindWindow(hwnd as HWND, &blur);
        let _ = DeleteObject(region);
    }
}

fn monitor_rect_from_point(x: i32, y: i32) -> Option<(i32, i32, u32, u32)> {
    unsafe {
        let pt = POINT { x, y };
        let hmon = MonitorFromPoint(pt, MONITOR_DEFAULTTONEAREST);
        if hmon == 0 {
            return None;
        }

        let mut info: MONITORINFO = std::mem::zeroed();
        info.cb_size = std::mem::size_of::<MONITORINFO>() as u32;
        if GetMonitorInfoW(hmon, &mut info) == 0 {
            return None;
        }

        let rc = &info.rc_monitor;
        Some((
            rc.left,
            rc.top,
            (rc.right - rc.left) as u32,
            (rc.bottom - rc.top) as u32,
        ))
    }
}

/// Confine the cursor to a screen rectangle (physical pixels). Pass `None` to release.
pub fn clip_cursor_to_rect(rect: Option<&RECT>) -> bool {
    unsafe {
        match rect {
            Some(rc) => ClipCursor(rc) != 0,
            None => ClipCursor(std::ptr::null()) != 0,
        }
    }
}

pub fn release_cursor_clip() {
    let _ = clip_cursor_to_rect(None);
}

/// Returns (x, y, width, height) of the monitor containing the cursor.
pub fn get_cursor_monitor_rect_win32() -> Option<(i32, i32, u32, u32)> {
    unsafe {
        let mut pt = POINT { x: 0, y: 0 };
        if GetCursorPos(&mut pt) == 0 {
            return None;
        }
        monitor_rect_from_point(pt.x, pt.y)
    }
}

pub fn get_monitor_rect_at_point_win32(x: i32, y: i32) -> Option<(i32, i32, u32, u32)> {
    monitor_rect_from_point(x, y)
}

/// Create an `HICON` from premultiplied-capable RGBA bytes (row-major).
/// Caller owns the handle and must eventually `DestroyIcon`.
pub fn create_hicon_from_rgba(
    rgba: &[u8],
    width: u32,
    height: u32,
) -> Option<*mut std::ffi::c_void> {
    use windows_sys::Win32::UI::WindowsAndMessaging::CreateIcon;

    if width == 0 || height == 0 {
        return None;
    }
    let pixel_count = (width as usize).checked_mul(height as usize)?;
    if rgba.len() < pixel_count * 4 {
        return None;
    }

    let mut bgra = rgba[..pixel_count * 4].to_vec();
    let mut and_mask = Vec::with_capacity(pixel_count);
    for chunk in bgra.chunks_exact_mut(4) {
        and_mask.push(chunk[3].wrapping_sub(u8::MAX));
        chunk.swap(0, 2); // RGBA → BGRA
    }

    let handle = unsafe {
        CreateIcon(
            std::ptr::null_mut(),
            width as i32,
            height as i32,
            1,
            32,
            and_mask.as_ptr(),
            bgra.as_ptr(),
        )
    };
    if handle.is_null() {
        None
    } else {
        Some(handle)
    }
}

/// Set title-bar (`ICON_SMALL`) icon. Does not touch `ICON_BIG`.
pub fn set_window_small_icon(hwnd: isize, small: *mut std::ffi::c_void) {
    use windows_sys::Win32::UI::WindowsAndMessaging::{SendMessageW, ICON_SMALL, WM_SETICON};
    let hwnd = hwnd as windows_sys::Win32::Foundation::HWND;
    unsafe {
        SendMessageW(hwnd, WM_SETICON, ICON_SMALL as usize, small as isize);
    }
}

/// Set taskbar/Alt-Tab (`ICON_BIG`) icon. Does not touch `ICON_SMALL`.
pub fn set_window_big_icon(hwnd: isize, big: *mut std::ffi::c_void) {
    use windows_sys::Win32::UI::WindowsAndMessaging::{SendMessageW, ICON_BIG, WM_SETICON};
    let hwnd = hwnd as windows_sys::Win32::Foundation::HWND;
    unsafe {
        SendMessageW(hwnd, WM_SETICON, ICON_BIG as usize, big as isize);
    }
}

/// Set title-bar (`ICON_SMALL`) and taskbar/Alt-Tab (`ICON_BIG`) icons separately.
pub fn set_window_small_and_big_icons(
    hwnd: isize,
    small: *mut std::ffi::c_void,
    big: *mut std::ffi::c_void,
) {
    set_window_small_icon(hwnd, small);
    set_window_big_icon(hwnd, big);
}

pub fn destroy_hicon(handle: *mut std::ffi::c_void) {
    if !handle.is_null() {
        unsafe {
            windows_sys::Win32::UI::WindowsAndMessaging::DestroyIcon(handle);
        }
    }
}

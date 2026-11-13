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
///
/// By default the window stays 1px short of `height`: a topmost window that exactly
/// covers a monitor is treated by Windows 11 as a fullscreen app, which strips the
/// taskbar's Mica/transparency. `cover_monitor` drops that gap for sessions started
/// over another fullscreen app, where a short window would make Explorer raise the
/// taskbar above it once the overlay takes focus (#81).
pub fn position_window_on_monitor(
    hwnd: isize,
    x: i32,
    y: i32,
    width: u32,
    height: u32,
    cover_monitor: bool,
) {
    let w = width.max(1) as i32;
    let h = if cover_monitor {
        height
    } else {
        height.saturating_sub(1)
    }
    .max(1) as i32;
    unsafe {
        SetWindowPos(hwnd, HWND_TOPMOST, x, y, w, h, SWP_NOACTIVATE);
    }
}

/// Show the overlay without activating it, then re-apply geometry while visible.
///
/// `SetWindowPos` while the window is still hidden does not reliably update WebView2's
/// client size / per-monitor DPI. Cross-monitor reactivation then keeps the previous
/// display's CSS viewport (wrong resolution) until a later show. Nudging size while
/// visible forces WM_SIZE / DPI catch-up — same idea as the fullscreen covering path (#81).
///
/// Callers must still invoke Tauri `window.show()` afterward so wry/tao visibility
/// state stays in sync with the Win32 `ShowWindow(SW_SHOWNA)`.
///
/// Non-cover nudges stay 1px short of the monitor (`H-2` → `H-1`) so we never briefly
/// become an exact monitor-covering topmost window (that strips taskbar Mica, #81).
pub fn show_and_refit_overlay_window(
    hwnd: isize,
    x: i32,
    y: i32,
    width: u32,
    height: u32,
    cover_monitor: bool,
) {
    use windows_sys::Win32::UI::WindowsAndMessaging::{ShowWindow, SW_SHOWNA};

    let w = width.max(1) as i32;
    let h_full = height.max(1) as i32;
    let h_short = height.saturating_sub(1).max(1) as i32;
    let (h_nudge, h_final) = if cover_monitor {
        (h_short, h_full)
    } else {
        let h_nudge = height.saturating_sub(2).max(1) as i32;
        (h_nudge, h_short)
    };

    unsafe {
        ShowWindow(hwnd as _, SW_SHOWNA);
        SetWindowPos(hwnd, HWND_TOPMOST, x, y, w, h_nudge, SWP_NOACTIVATE);
        SetWindowPos(hwnd, HWND_TOPMOST, x, y, w, h_final, SWP_NOACTIVATE);
    }
}

fn rect_covers(
    outer: &windows_sys::Win32::Foundation::RECT,
    x: i32,
    y: i32,
    width: u32,
    height: u32,
) -> bool {
    outer.left <= x
        && outer.top <= y
        && outer.right >= x + width as i32
        && outer.bottom >= y + height as i32
}

/// Another process's foreground window if it fills the given monitor (browser F11,
/// fullscreen video, slideshow). Desktop/taskbar, minimized and captioned windows do not
/// count — a captioned maximized window can span the monitor when the taskbar auto-hides.
/// Do not test `IsZoomed`: Chrome stays zoomed after F11 from a maximized window.
pub fn fullscreen_foreground_window(x: i32, y: i32, width: u32, height: u32) -> Option<isize> {
    use windows_sys::Win32::Foundation::{HWND, RECT as WinRect};
    use windows_sys::Win32::System::Threading::GetCurrentProcessId;
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        GetClassNameW, GetForegroundWindow, GetWindowLongW, GetWindowRect,
        GetWindowThreadProcessId, IsIconic, GWL_STYLE, WS_CAPTION,
    };

    unsafe {
        let hwnd: HWND = GetForegroundWindow();
        if hwnd.is_null() {
            return None;
        }
        let mut pid = 0u32;
        GetWindowThreadProcessId(hwnd, &mut pid);
        if pid == 0 || pid == GetCurrentProcessId() {
            return None;
        }
        if IsIconic(hwnd) != 0 {
            return None;
        }
        if (GetWindowLongW(hwnd, GWL_STYLE) as u32) & WS_CAPTION == WS_CAPTION {
            return None;
        }

        let mut class = [0u16; 64];
        let len = GetClassNameW(hwnd, class.as_mut_ptr(), class.len() as i32);
        if len > 0 {
            let name = String::from_utf16_lossy(&class[..len as usize]);
            if matches!(name.as_str(), "Progman" | "WorkerW") {
                return None;
            }
        }

        let mut rc: WinRect = std::mem::zeroed();
        if GetWindowRect(hwnd, &mut rc) == 0 {
            return None;
        }
        rect_covers(&rc, x, y, width, height).then_some(hwnd as isize)
    }
}

/// Hand the foreground back to `hwnd`, but only while one of `holders` (overlay/toolbar)
/// still has it — never steal focus from another app or from the settings window.
/// No-op if `hwnd` is gone, hidden or minimized.
pub fn restore_foreground_window(hwnd: isize, holders: &[isize]) -> bool {
    use windows_sys::Win32::Foundation::HWND;
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        GetForegroundWindow, IsIconic, IsWindowVisible, SetForegroundWindow,
    };

    let hwnd = hwnd as HWND;
    unsafe {
        holders.contains(&(GetForegroundWindow() as isize))
            && IsWindowVisible(hwnd) != 0
            && IsIconic(hwnd) == 0
            && SetForegroundWindow(hwnd) != 0
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

#[cfg(test)]
mod tests {
    use super::rect_covers;
    use windows_sys::Win32::Foundation::RECT;

    #[test]
    fn rect_covers_requires_the_full_monitor() {
        let full = RECT {
            left: 0,
            top: 0,
            right: 2560,
            bottom: 1440,
        };
        let overhang = RECT {
            left: -8,
            top: -8,
            right: 2568,
            bottom: 1448,
        };
        let work_area = RECT {
            left: -8,
            top: -8,
            right: 2568,
            bottom: 1400,
        };
        assert!(rect_covers(&full, 0, 0, 2560, 1440));
        assert!(rect_covers(&overhang, 0, 0, 2560, 1440));
        assert!(!rect_covers(&work_area, 0, 0, 2560, 1440));
    }

    #[test]
    fn rect_covers_is_per_monitor() {
        let left_screen_fullscreen = RECT {
            left: 0,
            top: 0,
            right: 1920,
            bottom: 1080,
        };
        assert!(rect_covers(&left_screen_fullscreen, 0, 0, 1920, 1080));
        assert!(!rect_covers(&left_screen_fullscreen, 1920, 0, 2560, 1440));
    }
}

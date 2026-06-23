#![cfg(target_os = "windows")]

#[repr(C)]
#[derive(Copy, Clone)]
pub struct POINT {
    pub x: i32,
    pub y: i32,
}

#[repr(C)]
#[derive(Copy, Clone)]
pub struct RECT {
    pub left: i32,
    pub top: i32,
    pub right: i32,
    pub bottom: i32,
}

#[repr(C)]
pub struct MONITORINFO {
    pub cb_size: u32,
    pub rc_monitor: RECT,
    pub rc_work: RECT,
    pub dw_flags: u32,
}

pub const MONITOR_DEFAULTTONEAREST: u32 = 2;

extern "system" {
    pub fn GetCursorPos(lp_point: *mut POINT) -> i32;
    pub fn MonitorFromPoint(pt: POINT, dw_flags: u32) -> isize;
    pub fn GetMonitorInfoW(h_monitor: isize, lpmi: *mut MONITORINFO) -> i32;
}

/// Returns (x, y, width, height) of the monitor containing the cursor.
pub fn get_cursor_monitor_rect_win32() -> Option<(i32, i32, u32, u32)> {
    unsafe {
        let mut pt = POINT { x: 0, y: 0 };
        if GetCursorPos(&mut pt) == 0 {
            return None;
        }

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

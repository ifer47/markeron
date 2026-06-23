/// Returns (x, y, width, height) of the monitor containing the cursor.
#[cfg(target_os = "windows")]
pub fn get_cursor_monitor_rect() -> Option<(i32, i32, u32, u32)> {
    crate::win32::get_cursor_monitor_rect_win32()
}

#[cfg(target_os = "macos")]
pub fn get_cursor_monitor_rect() -> Option<(i32, i32, u32, u32)> {
    #[repr(C)]
    struct CGPoint {
        x: f64,
        y: f64,
    }
    extern "C" {
        fn CGEventCreate(source: *const std::ffi::c_void) -> *mut std::ffi::c_void;
        fn CGEventGetLocation(event: *const std::ffi::c_void) -> CGPoint;
        fn CFRelease(cf: *const std::ffi::c_void);
    }

    let (cx, cy) = unsafe {
        let event = CGEventCreate(std::ptr::null());
        if event.is_null() {
            return None;
        }
        let pt = CGEventGetLocation(event);
        CFRelease(event);
        (pt.x as i32, pt.y as i32)
    };

    let monitor = xcap::Monitor::from_point(cx, cy).ok()?;
    let x = monitor.x().ok()?;
    let y = monitor.y().ok()?;
    let w = monitor.width().ok()?;
    let h = monitor.height().ok()?;
    Some((x, y, w, h))
}

#[cfg(not(any(target_os = "windows", target_os = "macos")))]
pub fn get_cursor_monitor_rect() -> Option<(i32, i32, u32, u32)> {
    let monitors = xcap::Monitor::all().ok()?;
    if monitors.len() <= 1 {
        let m = monitors.first()?;
        let x = m.x().ok()?;
        let y = m.y().ok()?;
        let w = m.width().ok()?;
        let h = m.height().ok()?;
        return Some((x, y, w, h));
    }
    // xcap doesn't provide cursor position on Linux directly,
    // return the primary monitor as fallback
    let m = monitors.first()?;
    let x = m.x().ok()?;
    let y = m.y().ok()?;
    let w = m.width().ok()?;
    let h = m.height().ok()?;
    Some((x, y, w, h))
}

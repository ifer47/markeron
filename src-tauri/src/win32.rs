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

/// Show a monitor-covering window without activating it, then re-fit it while visible.
///
/// Windows only re-evaluates whether a window is fullscreen when a visible window is
/// resized; activation reuses that cached verdict. Sizing the overlay while hidden leaves
/// it stale, so the first activation briefly raises the taskbar over a fullscreen app.
pub fn show_covering_window_without_activation(hwnd: isize) {
    use windows_sys::Win32::Foundation::{HWND, RECT as WinRect};
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        GetWindowRect, ShowWindow, SWP_NOZORDER, SW_SHOWNA,
    };

    unsafe {
        let mut rc: WinRect = std::mem::zeroed();
        if GetWindowRect(hwnd as HWND, &mut rc) == 0 {
            return;
        }
        let (w, h) = (rc.right - rc.left, rc.bottom - rc.top);
        ShowWindow(hwnd as HWND, SW_SHOWNA);
        let flags = SWP_NOACTIVATE | SWP_NOZORDER;
        SetWindowPos(hwnd, 0, rc.left, rc.top, w, (h - 1).max(1), flags);
        SetWindowPos(hwnd, 0, rc.left, rc.top, w, h, flags);
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

/// Create an `HICON` from RGBA bytes (row-major, non-premultiplied alpha).
///
/// Uses `CreateIconIndirect` with a bottom-up 32bpp DIB (icon-compatible) and a
/// zeroed 1-bit AND mask so transparency comes from the alpha channel.
///
/// Caller owns the handle and must eventually `DestroyIcon`.
pub fn create_hicon_from_rgba(
    rgba: &[u8],
    width: u32,
    height: u32,
) -> Option<*mut std::ffi::c_void> {
    use windows_sys::Win32::Graphics::Gdi::{
        CreateBitmap, CreateDIBSection, DeleteObject, GetDC, ReleaseDC, BITMAPINFO,
        BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS, RGBQUAD,
    };
    use windows_sys::Win32::UI::WindowsAndMessaging::{CreateIconIndirect, ICONINFO};

    if width == 0 || height == 0 {
        return None;
    }
    let pixel_count = (width as usize).checked_mul(height as usize)?;
    if rgba.len() < pixel_count * 4 {
        return None;
    }
    let row_bytes = (width as usize).checked_mul(4)?;
    let height_usize = height as usize;

    let bmi = BITMAPINFO {
        bmiHeader: BITMAPINFOHEADER {
            biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
            biWidth: width as i32,
            // Bottom-up DIB — more compatible with CreateIconIndirect than top-down.
            biHeight: height as i32,
            biPlanes: 1,
            biBitCount: 32,
            biCompression: BI_RGB,
            biSizeImage: (width.checked_mul(height)?.checked_mul(4)?),
            biXPelsPerMeter: 0,
            biYPelsPerMeter: 0,
            biClrUsed: 0,
            biClrImportant: 0,
        },
        bmiColors: [RGBQUAD {
            rgbBlue: 0,
            rgbGreen: 0,
            rgbRed: 0,
            rgbReserved: 0,
        }],
    };

    let mut bits: *mut core::ffi::c_void = std::ptr::null_mut();
    let (color, mask) = unsafe {
        let hdc = GetDC(std::ptr::null_mut());
        let color = CreateDIBSection(
            hdc,
            &bmi,
            DIB_RGB_COLORS,
            &mut bits,
            std::ptr::null_mut(),
            0,
        );
        if !hdc.is_null() {
            ReleaseDC(std::ptr::null_mut(), hdc);
        }
        if color.is_null() || bits.is_null() {
            if !color.is_null() {
                DeleteObject(color as _);
            }
            return None;
        }

        let dest = std::slice::from_raw_parts_mut(bits as *mut u8, pixel_count.checked_mul(4)?);
        // Flip rows while converting RGBA → BGRA for bottom-up layout.
        for y in 0..height_usize {
            let src_row = &rgba[y * row_bytes..(y + 1) * row_bytes];
            let dst_y = height_usize - 1 - y;
            let dst_row = &mut dest[dst_y * row_bytes..(dst_y + 1) * row_bytes];
            for (dst, src) in dst_row.chunks_exact_mut(4).zip(src_row.chunks_exact(4)) {
                dst[0] = src[2]; // B
                dst[1] = src[1]; // G
                dst[2] = src[0]; // R
                dst[3] = src[3]; // A
            }
        }

        // 1-bit AND mask, rows DWORD-aligned. All zeros → rely on 32bpp alpha.
        let stride = (width as usize).div_ceil(32) * 4;
        let mask_bytes = vec![0u8; stride.checked_mul(height_usize)?];
        let mask = CreateBitmap(
            width as i32,
            height as i32,
            1,
            1,
            mask_bytes.as_ptr() as *const _,
        );
        if mask.is_null() {
            DeleteObject(color as _);
            return None;
        }
        (color, mask)
    };

    let info = ICONINFO {
        fIcon: windows_sys::Win32::Foundation::TRUE,
        xHotspot: 0,
        yHotspot: 0,
        hbmMask: mask,
        hbmColor: color,
    };
    let handle = unsafe { CreateIconIndirect(&info) };
    unsafe {
        DeleteObject(color as _);
        DeleteObject(mask as _);
    }
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

#[cfg(test)]
mod tests {
    use super::{create_hicon_from_rgba, destroy_hicon, rect_covers};
    use windows_sys::Win32::Foundation::RECT;

    fn rgba_from_png(bytes: &[u8], width: u32, height: u32) -> Vec<u8> {
        use image::imageops::FilterType;
        let img = image::load_from_memory(bytes).expect("png").to_rgba8();
        if img.width() == width && img.height() == height {
            return img.into_raw();
        }
        image::imageops::resize(&img, width, height, FilterType::Triangle).into_raw()
    }

    /// Sample opaque pixels from an HICON's color bitmap (top-down BGRA).
    fn hicon_opaque_avg_luma(handle: *mut std::ffi::c_void) -> Option<(f32, usize)> {
        use windows_sys::Win32::Graphics::Gdi::{
            GetDC, GetDIBits, GetObjectW, ReleaseDC, BITMAP, BITMAPINFO, BITMAPINFOHEADER, BI_RGB,
            DIB_RGB_COLORS, RGBQUAD,
        };
        use windows_sys::Win32::UI::WindowsAndMessaging::{GetIconInfo, ICONINFO};

        unsafe {
            let mut info = std::mem::zeroed::<ICONINFO>();
            if GetIconInfo(handle, &mut info) == 0 || info.hbmColor.is_null() {
                return None;
            }
            let mut bm = std::mem::zeroed::<BITMAP>();
            if GetObjectW(
                info.hbmColor as _,
                std::mem::size_of::<BITMAP>() as i32,
                &mut bm as *mut _ as _,
            ) == 0
            {
                windows_sys::Win32::Graphics::Gdi::DeleteObject(info.hbmMask as _);
                windows_sys::Win32::Graphics::Gdi::DeleteObject(info.hbmColor as _);
                return None;
            }
            let w = bm.bmWidth.max(0) as u32;
            let h = bm.bmHeight.unsigned_abs();
            if w == 0 || h == 0 {
                windows_sys::Win32::Graphics::Gdi::DeleteObject(info.hbmMask as _);
                windows_sys::Win32::Graphics::Gdi::DeleteObject(info.hbmColor as _);
                return None;
            }
            let mut bmi = BITMAPINFO {
                bmiHeader: BITMAPINFOHEADER {
                    biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                    biWidth: w as i32,
                    biHeight: -(h as i32),
                    biPlanes: 1,
                    biBitCount: 32,
                    biCompression: BI_RGB,
                    biSizeImage: w * h * 4,
                    biXPelsPerMeter: 0,
                    biYPelsPerMeter: 0,
                    biClrUsed: 0,
                    biClrImportant: 0,
                },
                bmiColors: [RGBQUAD {
                    rgbBlue: 0,
                    rgbGreen: 0,
                    rgbRed: 0,
                    rgbReserved: 0,
                }],
            };
            let mut pixels = vec![0u8; (w * h * 4) as usize];
            let hdc = GetDC(std::ptr::null_mut());
            let copied = GetDIBits(
                hdc,
                info.hbmColor,
                0,
                h,
                pixels.as_mut_ptr() as _,
                &mut bmi,
                DIB_RGB_COLORS,
            );
            if !hdc.is_null() {
                ReleaseDC(std::ptr::null_mut(), hdc);
            }
            windows_sys::Win32::Graphics::Gdi::DeleteObject(info.hbmMask as _);
            windows_sys::Win32::Graphics::Gdi::DeleteObject(info.hbmColor as _);
            if copied == 0 {
                return None;
            }
            let mut sum = 0f32;
            let mut count = 0usize;
            for px in pixels.chunks_exact(4) {
                if px[3] > 200 {
                    // BGRA → Rec.601 luma
                    sum += 0.299 * px[2] as f32 + 0.587 * px[1] as f32 + 0.114 * px[0] as f32;
                    count += 1;
                }
            }
            (count > 0).then_some((sum / count as f32, count))
        }
    }

    #[test]
    fn create_hicon_preserves_light_and_dark_glyph_luma() {
        let dark_rgba = rgba_from_png(include_bytes!("../icons/icon.png"), 32, 32);
        let light_rgba = rgba_from_png(include_bytes!("../icons/icon-light.png"), 32, 32);
        let dark = create_hicon_from_rgba(&dark_rgba, 32, 32).expect("dark hicon");
        let light = create_hicon_from_rgba(&light_rgba, 32, 32).expect("light hicon");
        let (dark_luma, dark_n) = hicon_opaque_avg_luma(dark).expect("dark sample");
        let (light_luma, light_n) = hicon_opaque_avg_luma(light).expect("light sample");
        destroy_hicon(dark);
        destroy_hicon(light);
        assert!(dark_n > 0 && light_n > 0);
        assert!(
            dark_luma < 40.0,
            "dark glyph should stay dark, got luma {dark_luma}"
        );
        assert!(
            light_luma > 200.0,
            "light glyph must stay bright for dark taskbars, got luma {light_luma}"
        );
    }

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

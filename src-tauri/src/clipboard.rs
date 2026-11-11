#[cfg(not(windows))]
use std::borrow::Cow;
use std::time::Duration;

use base64::Engine;
use image::RgbaImage;
use tauri::{AppHandle, Manager};

#[tauri::command]
pub fn copy_whiteboard(data_url: String) -> Result<(), String> {
    let (_, encoded) = data_url
        .split_once(',')
        .ok_or_else(|| "Invalid data URL".to_string())?;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(encoded)
        .map_err(|e| format!("Failed to decode whiteboard image: {}", e))?;
    let image = image::load_from_memory(&bytes)
        .map_err(|e| format!("Failed to decode whiteboard PNG: {}", e))?
        .to_rgba8();

    #[cfg(windows)]
    {
        win::set_clipboard_rgba_with_file(&image)
    }

    #[cfg(not(windows))]
    {
        let mut cb = arboard::Clipboard::new().map_err(|e| format!("{}", e))?;
        cb.set_image(arboard::ImageData {
            width: image.width() as usize,
            height: image.height() as usize,
            bytes: Cow::Owned(image.into_raw()),
        })
        .map_err(|e| format!("{}", e))?;
        Ok(())
    }
}

/// Hide / exclude the independent toolbar window so it does not appear in the
/// clipboard screenshot, then restore it afterward.
fn with_toolbar_excluded_from_capture<R>(app: &AppHandle, capture: impl FnOnce() -> R) -> R {
    let Some(toolbar) = app.get_webview_window("toolbar") else {
        return capture();
    };
    if !toolbar.is_visible().unwrap_or(false) {
        return capture();
    }

    #[cfg(windows)]
    let affinity_applied = toolbar
        .hwnd()
        .ok()
        .is_some_and(|hwnd| crate::win32::set_window_exclude_from_capture(hwnd.0 as isize, true));

    #[cfg(target_os = "macos")]
    {
        // Sync AppKit orderOut — Tauri hide() is async and races with screencapture.
        crate::macos::hide_toolbar_ns_window_for_capture(&toolbar);
        // Brief settle for the compositor after orderOut.
        std::thread::sleep(Duration::from_millis(32));
    }
    #[cfg(not(target_os = "macos"))]
    {
        // Hide so capture never includes the toolbar. On Windows, display-affinity
        // above also covers the brief compositor race between hide() and BitBlt.
        toolbar.hide().ok();
        std::thread::sleep(Duration::from_millis(64));
    }

    let result = capture();
    crate::set_toolbar_window_visible(app, true);

    #[cfg(windows)]
    if affinity_applied {
        if let Ok(hwnd) = toolbar.hwnd() {
            let _ = crate::win32::set_window_exclude_from_capture(hwnd.0 as isize, false);
        }
    }

    result
}

#[tauri::command]
pub fn copy_screen(app: AppHandle) -> Result<(), String> {
    with_toolbar_excluded_from_capture(&app, copy_screen_inner)
}

#[cfg(target_os = "windows")]
fn copy_screen_inner() -> Result<(), String> {
    use crate::win32::*;

    #[allow(clippy::upper_case_acronyms)]
    #[repr(C)]
    struct BITMAPINFOHEADER {
        bi_size: u32,
        bi_width: i32,
        bi_height: i32,
        bi_planes: u16,
        bi_bit_count: u16,
        bi_compression: u32,
        bi_size_image: u32,
        bi_x_pels_per_meter: i32,
        bi_y_pels_per_meter: i32,
        bi_clr_used: u32,
        bi_clr_important: u32,
    }
    #[allow(clippy::upper_case_acronyms)]
    #[repr(C)]
    struct BITMAPINFO {
        header: BITMAPINFOHEADER,
        _colors: [u32; 1],
    }

    const SRCCOPY: u32 = 0x00CC0020;
    const GMEM_MOVEABLE: u32 = 0x0002;

    extern "system" {
        fn GetDC(hwnd: isize) -> isize;
        fn CreateCompatibleDC(hdc: isize) -> isize;
        fn CreateCompatibleBitmap(hdc: isize, w: i32, h: i32) -> isize;
        fn SelectObject(hdc: isize, h: isize) -> isize;
        fn BitBlt(
            dst: isize,
            x: i32,
            y: i32,
            w: i32,
            h: i32,
            src: isize,
            sx: i32,
            sy: i32,
            rop: u32,
        ) -> i32;
        fn GetDIBits(
            hdc: isize,
            hbm: isize,
            start: u32,
            lines: u32,
            bits: *mut u8,
            bmi: *mut BITMAPINFO,
            usage: u32,
        ) -> i32;
        fn DeleteObject(h: isize) -> i32;
        fn DeleteDC(hdc: isize) -> i32;
        fn ReleaseDC(hwnd: isize, hdc: isize) -> i32;
        fn GlobalAlloc(flags: u32, size: usize) -> isize;
        fn GlobalLock(hmem: isize) -> *mut u8;
        fn GlobalUnlock(hmem: isize) -> i32;
        fn GlobalFree(hmem: isize) -> isize;
    }

    unsafe {
        let mut pt = POINT { x: 0, y: 0 };
        if GetCursorPos(&mut pt) == 0 {
            return Err("Failed to get cursor position".into());
        }
        let hmon = MonitorFromPoint(pt, MONITOR_DEFAULTTONEAREST);
        if hmon == 0 {
            return Err("No monitor found".into());
        }
        let mut mi: MONITORINFO = std::mem::zeroed();
        mi.cb_size = std::mem::size_of::<MONITORINFO>() as u32;
        if GetMonitorInfoW(hmon, &mut mi) == 0 {
            return Err("Failed to get monitor info".into());
        }
        let rc = &mi.rc_monitor;
        let w = rc.right - rc.left;
        let h = rc.bottom - rc.top;

        let hdc_screen = GetDC(0);
        if hdc_screen == 0 {
            return Err("Failed to get screen DC".into());
        }
        let hdc_mem = CreateCompatibleDC(hdc_screen);
        let hbm = CreateCompatibleBitmap(hdc_screen, w, h);
        let old_obj = SelectObject(hdc_mem, hbm);
        BitBlt(hdc_mem, 0, 0, w, h, hdc_screen, rc.left, rc.top, SRCCOPY);

        let header_size = std::mem::size_of::<BITMAPINFOHEADER>();
        let pixel_bytes = (w as usize) * (h as usize) * 4;
        let total = header_size + pixel_bytes;

        let hmem = GlobalAlloc(GMEM_MOVEABLE, total);
        if hmem == 0 {
            SelectObject(hdc_mem, old_obj);
            DeleteObject(hbm);
            DeleteDC(hdc_mem);
            ReleaseDC(0, hdc_screen);
            return Err("GlobalAlloc failed".into());
        }
        let ptr = GlobalLock(hmem);
        if ptr.is_null() {
            GlobalFree(hmem);
            SelectObject(hdc_mem, old_obj);
            DeleteObject(hbm);
            DeleteDC(hdc_mem);
            ReleaseDC(0, hdc_screen);
            return Err("GlobalLock failed".into());
        }

        let mut bmi: BITMAPINFO = std::mem::zeroed();
        bmi.header.bi_size = header_size as u32;
        bmi.header.bi_width = w;
        bmi.header.bi_height = h;
        bmi.header.bi_planes = 1;
        bmi.header.bi_bit_count = 32;

        let scan_lines = GetDIBits(hdc_mem, hbm, 0, h as u32, ptr.add(header_size), &mut bmi, 0);

        if scan_lines == 0 {
            GlobalUnlock(hmem);
            GlobalFree(hmem);
            SelectObject(hdc_mem, old_obj);
            DeleteObject(hbm);
            DeleteDC(hdc_mem);
            ReleaseDC(0, hdc_screen);
            return Err("GetDIBits failed: no scan lines copied".into());
        }

        std::ptr::copy_nonoverlapping(&bmi.header as *const _ as *const u8, ptr, header_size);

        // Keep a copy for async BMP+HDROP; CF_DIB goes on the clipboard immediately.
        let dib_bytes = std::slice::from_raw_parts(ptr, total).to_vec();
        GlobalUnlock(hmem);

        SelectObject(hdc_mem, old_obj);
        DeleteObject(hbm);
        DeleteDC(hdc_mem);
        ReleaseDC(0, hdc_screen);

        win::publish_dib_then_async_file(hmem, dib_bytes)?;
    }
    Ok(())
}

#[cfg(target_os = "macos")]
fn copy_screen_inner() -> Result<(), String> {
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

    let cursor_pos: Option<(i32, i32)> = unsafe {
        let event = CGEventCreate(std::ptr::null());
        if event.is_null() {
            None
        } else {
            let pt = CGEventGetLocation(event);
            CFRelease(event);
            Some((pt.x as i32, pt.y as i32))
        }
    };

    let monitor = cursor_pos.and_then(|(x, y)| xcap::Monitor::from_point(x, y).ok());
    let monitor = match monitor {
        Some(m) => m,
        None => xcap::Monitor::all()
            .map_err(|e| format!("{}", e))?
            .into_iter()
            .next()
            .ok_or_else(|| "No monitor found".to_string())?,
    };

    let x = monitor.x().map_err(|e| format!("{}", e))?;
    let y = monitor.y().map_err(|e| format!("{}", e))?;
    let w = monitor.width().map_err(|e| format!("{}", e))?;
    let h = monitor.height().map_err(|e| format!("{}", e))?;
    let region = format!("{},{},{},{}", x, y, w, h);
    let status = std::process::Command::new("screencapture")
        .args(["-c", "-x", "-R", &region])
        .status()
        .map_err(|e| format!("screencapture failed: {}", e))?;

    if !status.success() {
        return Err(format!(
            "screencapture exited with code {:?}",
            status.code()
        ));
    }
    Ok(())
}

#[cfg(windows)]
mod win {
    use super::*;
    use std::os::windows::ffi::OsStrExt;
    use std::path::{Path, PathBuf};
    use std::sync::atomic::{AtomicU64, Ordering};

    const CF_DIB: u32 = 8;
    const CF_HDROP: u32 = 15;
    const GMEM_MOVEABLE: u32 = 0x0002;
    const GMEM_ZEROINIT: u32 = 0x0040;
    const GHND: u32 = GMEM_MOVEABLE | GMEM_ZEROINIT;
    const DROPEFFECT_COPY: u32 = 1;
    const BMP_FILE_HEADER_SIZE: usize = 14;

    /// Bumps when a new copy starts so older async HDROP jobs bail out.
    static CLIPBOARD_FILE_GEN: AtomicU64 = AtomicU64::new(0);

    #[repr(C)]
    struct DropFiles {
        p_files: u32,
        pt_x: i32,
        pt_y: i32,
        f_nc: i32,
        f_wide: i32,
    }

    #[allow(clippy::upper_case_acronyms)]
    #[repr(C)]
    struct BITMAPINFOHEADER {
        bi_size: u32,
        bi_width: i32,
        bi_height: i32,
        bi_planes: u16,
        bi_bit_count: u16,
        bi_compression: u32,
        bi_size_image: u32,
        bi_x_pels_per_meter: i32,
        bi_y_pels_per_meter: i32,
        bi_clr_used: u32,
        bi_clr_important: u32,
    }

    extern "system" {
        fn OpenClipboard(hwnd: isize) -> i32;
        fn EmptyClipboard() -> i32;
        fn SetClipboardData(format: u32, data: isize) -> isize;
        fn CloseClipboard() -> i32;
        fn RegisterClipboardFormatW(name: *const u16) -> u32;
        fn GlobalAlloc(flags: u32, size: usize) -> isize;
        fn GlobalLock(hmem: isize) -> *mut u8;
        fn GlobalUnlock(hmem: isize) -> i32;
        fn GlobalFree(hmem: isize) -> isize;
        fn Sleep(ms: u32);
    }

    pub(super) fn set_clipboard_rgba_with_file(image: &RgbaImage) -> Result<(), String> {
        let (dib, dib_bytes) = alloc_dib_from_rgba(image)?;
        publish_dib_then_async_file(dib, dib_bytes)
    }

    fn is_current_clipboard_gen(gen: u64) -> bool {
        CLIPBOARD_FILE_GEN.load(Ordering::SeqCst) == gen
    }

    /// Put CF_DIB on the clipboard immediately, then write a temp BMP and attach
    /// CF_HDROP on a background thread so Ctrl+C stays responsive.
    pub(super) fn publish_dib_then_async_file(
        dib: isize,
        dib_bytes: Vec<u8>,
    ) -> Result<(), String> {
        // Invalidate older workers before emptying the clipboard.
        let gen = CLIPBOARD_FILE_GEN.fetch_add(1, Ordering::SeqCst) + 1;
        publish_clipboard_dib_only(dib)?;

        std::thread::Builder::new()
            .name("markeron-clipboard-file".into())
            .spawn(move || {
                if !is_current_clipboard_gen(gen) {
                    return;
                }
                let Ok(path) = write_temp_bmp_from_dib(&dib_bytes, gen) else {
                    return;
                };
                if !is_current_clipboard_gen(gen) {
                    let _ = std::fs::remove_file(&path);
                    return;
                }
                let Ok(hdrop) = alloc_hdrop(&path) else {
                    let _ = std::fs::remove_file(&path);
                    return;
                };
                if let Err(err) = append_clipboard_hdrop(hdrop, gen) {
                    tracing::debug!("clipboard HDROP append skipped: {err}");
                    let _ = std::fs::remove_file(&path);
                }
            })
            .map_err(|e| format!("Failed to start clipboard file worker: {}", e))?;

        Ok(())
    }

    fn publish_clipboard_dib_only(dib: isize) -> Result<(), String> {
        unsafe {
            let mut opened = false;
            for _ in 0..8 {
                if OpenClipboard(0) != 0 {
                    opened = true;
                    break;
                }
                Sleep(8);
            }
            if !opened {
                GlobalFree(dib);
                return Err("OpenClipboard failed".into());
            }
            EmptyClipboard();
            let dib_ok = SetClipboardData(CF_DIB, dib);
            CloseClipboard();
            if dib_ok == 0 {
                GlobalFree(dib);
                return Err("SetClipboardData(CF_DIB) failed".into());
            }
        }
        Ok(())
    }

    fn append_clipboard_hdrop(hdrop: isize, gen: u64) -> Result<(), String> {
        unsafe {
            // Brief retries: another app may briefly hold the clipboard.
            let mut opened = false;
            for _ in 0..8 {
                if !is_current_clipboard_gen(gen) {
                    GlobalFree(hdrop);
                    return Err("clipboard generation superseded".into());
                }
                if OpenClipboard(0) != 0 {
                    opened = true;
                    break;
                }
                Sleep(8);
            }
            if !opened {
                GlobalFree(hdrop);
                return Err("OpenClipboard failed while appending CF_HDROP".into());
            }

            // Re-check while holding the clipboard to avoid attaching a stale file
            // after a newer copy already replaced CF_DIB.
            if !is_current_clipboard_gen(gen) {
                CloseClipboard();
                GlobalFree(hdrop);
                return Err("clipboard generation superseded".into());
            }

            let hdrop_ok = SetClipboardData(CF_HDROP, hdrop);
            let _ = set_preferred_drop_effect_copy();
            CloseClipboard();

            if hdrop_ok == 0 {
                GlobalFree(hdrop);
                return Err("SetClipboardData(CF_HDROP) failed".into());
            }
        }
        Ok(())
    }

    fn ensure_temp_dir() -> Result<PathBuf, String> {
        let dir = std::env::temp_dir().join("MarkerOn");
        std::fs::create_dir_all(&dir).map_err(|e| format!("Failed to create temp dir: {}", e))?;
        Ok(dir)
    }

    fn prune_stale_clipboard_images(dir: &Path, keep_gen: u64) {
        let keep_name = format!("MarkerOn_clip_{keep_gen}.bmp");
        if let Ok(entries) = std::fs::read_dir(dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
                    continue;
                };
                let is_clip_image = matches!(
                    path.extension().and_then(|ext| ext.to_str()),
                    Some("bmp" | "png")
                ) && (name.starts_with("MarkerOn_clip_")
                    || name.starts_with("MarkerOn_"));
                if is_clip_image && name != keep_name {
                    let _ = std::fs::remove_file(path);
                }
            }
        }
    }

    fn write_temp_bmp_from_dib(dib: &[u8], gen: u64) -> Result<PathBuf, String> {
        if dib.len() < std::mem::size_of::<BITMAPINFOHEADER>() {
            return Err("DIB buffer too small for BMP".into());
        }
        let bi_size = u32::from_le_bytes([dib[0], dib[1], dib[2], dib[3]]) as usize;
        if bi_size < std::mem::size_of::<BITMAPINFOHEADER>() || bi_size > dib.len() {
            return Err("Invalid BITMAPINFOHEADER size".into());
        }

        let dir = ensure_temp_dir()?;
        let path = dir.join(format!("MarkerOn_clip_{gen}.bmp"));
        prune_stale_clipboard_images(&dir, gen);

        let file_size = (BMP_FILE_HEADER_SIZE + dib.len()) as u32;
        let off_bits = (BMP_FILE_HEADER_SIZE + bi_size) as u32;
        let mut out = Vec::with_capacity(BMP_FILE_HEADER_SIZE + dib.len());
        out.extend_from_slice(&0x4D42u16.to_le_bytes()); // "BM"
        out.extend_from_slice(&file_size.to_le_bytes());
        out.extend_from_slice(&0u16.to_le_bytes());
        out.extend_from_slice(&0u16.to_le_bytes());
        out.extend_from_slice(&off_bits.to_le_bytes());
        out.extend_from_slice(dib);

        std::fs::write(&path, out).map_err(|e| format!("Failed to write clipboard BMP: {}", e))?;
        Ok(path)
    }

    fn alloc_dib_from_rgba(image: &RgbaImage) -> Result<(isize, Vec<u8>), String> {
        let width = image.width() as i32;
        let height = image.height() as i32;
        if width <= 0 || height <= 0 {
            return Err("Invalid image size".into());
        }

        let header_size = std::mem::size_of::<BITMAPINFOHEADER>();
        let pixel_bytes = (width as usize) * (height as usize) * 4;
        let total = header_size + pixel_bytes;
        let mut dib_bytes = vec![0u8; total];

        let header = BITMAPINFOHEADER {
            bi_size: header_size as u32,
            bi_width: width,
            bi_height: height,
            bi_planes: 1,
            bi_bit_count: 32,
            bi_compression: 0,
            bi_size_image: pixel_bytes as u32,
            bi_x_pels_per_meter: 0,
            bi_y_pels_per_meter: 0,
            bi_clr_used: 0,
            bi_clr_important: 0,
        };
        // SAFETY: BITMAPINFOHEADER is repr(C) and dib_bytes is large enough.
        unsafe {
            std::ptr::copy_nonoverlapping(
                &header as *const _ as *const u8,
                dib_bytes.as_mut_ptr(),
                header_size,
            );
        }

        let src = image.as_raw();
        let w = width as usize;
        let h = height as usize;
        for y in 0..h {
            let src_y = h - 1 - y;
            for x in 0..w {
                let si = (src_y * w + x) * 4;
                let di = header_size + (y * w + x) * 4;
                dib_bytes[di] = src[si + 2];
                dib_bytes[di + 1] = src[si + 1];
                dib_bytes[di + 2] = src[si];
                dib_bytes[di + 3] = 255;
            }
        }

        unsafe {
            let hmem = GlobalAlloc(GMEM_MOVEABLE, total);
            if hmem == 0 {
                return Err("GlobalAlloc failed for DIB".into());
            }
            let ptr = GlobalLock(hmem);
            if ptr.is_null() {
                GlobalFree(hmem);
                return Err("GlobalLock failed for DIB".into());
            }
            std::ptr::copy_nonoverlapping(dib_bytes.as_ptr(), ptr, total);
            GlobalUnlock(hmem);
            Ok((hmem, dib_bytes))
        }
    }

    fn alloc_hdrop(path: &Path) -> Result<isize, String> {
        let absolute = if path.is_absolute() {
            path.to_path_buf()
        } else {
            std::env::current_dir()
                .map_err(|e| format!("Failed to resolve clipboard path: {}", e))?
                .join(path)
        };

        let mut wide: Vec<u16> = absolute.as_os_str().encode_wide().collect();
        wide.push(0);
        wide.push(0);

        let header_size = std::mem::size_of::<DropFiles>();
        let total = header_size + wide.len() * 2;

        unsafe {
            let hmem = GlobalAlloc(GHND, total);
            if hmem == 0 {
                return Err("GlobalAlloc failed for CF_HDROP".into());
            }
            let ptr = GlobalLock(hmem);
            if ptr.is_null() {
                GlobalFree(hmem);
                return Err("GlobalLock failed for CF_HDROP".into());
            }

            let drop_files = DropFiles {
                p_files: header_size as u32,
                pt_x: 0,
                pt_y: 0,
                f_nc: 0,
                f_wide: 1,
            };
            std::ptr::copy_nonoverlapping(&drop_files as *const _ as *const u8, ptr, header_size);
            std::ptr::copy_nonoverlapping(
                wide.as_ptr() as *const u8,
                ptr.add(header_size),
                wide.len() * 2,
            );
            GlobalUnlock(hmem);
            Ok(hmem)
        }
    }

    unsafe fn set_preferred_drop_effect_copy() -> Result<(), String> {
        let name: Vec<u16> = "Preferred DropEffect"
            .encode_utf16()
            .chain(std::iter::once(0))
            .collect();
        let format = RegisterClipboardFormatW(name.as_ptr());
        if format == 0 {
            return Err("RegisterClipboardFormatW failed".into());
        }

        let hmem = GlobalAlloc(GHND, std::mem::size_of::<u32>());
        if hmem == 0 {
            return Err("GlobalAlloc failed for Preferred DropEffect".into());
        }
        let ptr = GlobalLock(hmem);
        if ptr.is_null() {
            GlobalFree(hmem);
            return Err("GlobalLock failed for Preferred DropEffect".into());
        }
        std::ptr::write_unaligned(ptr as *mut u32, DROPEFFECT_COPY);
        GlobalUnlock(hmem);

        if SetClipboardData(format, hmem) == 0 {
            GlobalFree(hmem);
            return Err("SetClipboardData(Preferred DropEffect) failed".into());
        }
        Ok(())
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn hdrop_payload_contains_wide_path_and_double_null() {
            let path = PathBuf::from(r"C:\Temp\MarkerOn\demo.bmp");
            let hmem = alloc_hdrop(&path).expect("alloc_hdrop");
            unsafe {
                let ptr = GlobalLock(hmem);
                assert!(!ptr.is_null());
                let header_size = std::mem::size_of::<DropFiles>();
                let drop_files = &*(ptr as *const DropFiles);
                assert_eq!(drop_files.p_files as usize, header_size);
                assert_eq!(drop_files.f_wide, 1);

                let wide_ptr = ptr.add(header_size) as *const u16;
                let mut decoded = Vec::new();
                let mut i = 0usize;
                loop {
                    let ch = *wide_ptr.add(i);
                    if ch == 0 {
                        break;
                    }
                    decoded.push(ch);
                    i += 1;
                }
                let text = String::from_utf16_lossy(&decoded);
                assert!(text.eq_ignore_ascii_case(r"C:\Temp\MarkerOn\demo.bmp"));
                assert_eq!(*wide_ptr.add(i + 1), 0);

                GlobalUnlock(hmem);
                GlobalFree(hmem);
            }
        }

        #[test]
        fn write_temp_bmp_from_dib_roundtrips_header() {
            let mut dib = vec![0u8; 40 + 16];
            dib[0..4].copy_from_slice(&40u32.to_le_bytes()); // biSize
            dib[4..8].copy_from_slice(&2i32.to_le_bytes()); // width
            dib[8..12].copy_from_slice(&2i32.to_le_bytes()); // height
            dib[12..14].copy_from_slice(&1u16.to_le_bytes()); // planes
            dib[14..16].copy_from_slice(&32u16.to_le_bytes()); // bit count

            let path = write_temp_bmp_from_dib(&dib, 42).expect("bmp");
            assert!(path.exists());
            assert!(path
                .file_name()
                .and_then(|n| n.to_str())
                .is_some_and(|n| n == "MarkerOn_clip_42.bmp"));
            let bytes = std::fs::read(&path).expect("read bmp");
            assert_eq!(&bytes[0..2], b"BM");
            assert_eq!(u32::from_le_bytes(bytes[10..14].try_into().unwrap()), 54);
            assert_eq!(&bytes[14..], dib.as_slice());
            let _ = std::fs::remove_file(path);
        }
    }
}

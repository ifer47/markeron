# Video Compatibility Freeze Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When `general.videoCompatMode` is on (default), capture a freeze-frame of the annotate monitor before showing the overlay and display it as an opaque underlay so GPU video sites (e.g. Bilibili) do not paint black under a transparent WebView.

**Architecture:** Extract shared monitor pixel capture into `src-tauri/src/capture.rs`. `activate_drawing` captures PNG **before** `window.show()` when the setting is on and default entry is screen, then emits `freeze-frame-ready`. `DrawingOverlay.vue` shows a full-screen underlay `<img>` and clears it on hidden / penetration / whiteboard. Settings toggle persists via existing `save_general`.

**Tech Stack:** Tauri 2, Rust (`image` PNG, `base64`, Win32 BitBlt, macOS `screencapture` to temp file), Vue 3, Vitest for pure helpers, existing config/IPC patterns

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-24-video-compat-freeze-design.md`
- Issue: [#30](https://github.com/ifer47/markeron/issues/30)
- Config key: `videoCompatMode` / `video_compat_mode`, **default `true`**, must use `#[serde(default = "default_true")]` (not bare `#[serde(default)]`)
- Capture **before** overlay `show()`; do **not** write freeze frames to the system clipboard
- Skip capture when `defaultEntryMode == whiteboard`
- Entering penetration / hidden / whiteboard clears freeze; exit penetration does **not** re-capture
- i18n: sync `en.ts` and `zh-CN.ts`
- Follow `.cursor/skills/tauri-config-ipc/SKILL.md` for config wiring
- Linux: no capture backend → emit null / skip (transparent fallback)
- Do not bump version / release

---

## File map

| File | Role |
|------|------|
| `src-tauri/src/config.rs` | `video_compat_mode` field + default-true serde + unit tests |
| `src-tauri/src/capture.rs` | **New** — monitor RGBA capture + PNG data URL; Windows/macOS; Linux stub |
| `src-tauri/src/clipboard.rs` | Refactor `copy_screen` to use `capture` then write clipboard |
| `src-tauri/src/overlay.rs` | In `activate_drawing`, optional capture + `freeze-frame-ready` emit |
| `src-tauri/src/lib.rs` | `mod capture;` |
| `src/types/app.d.ts` | `videoCompatMode: boolean` |
| `src/utils/freezeFrame.ts` | Pure helpers: clear rules + payload typing |
| `src/utils/freezeFrame.test.ts` | Vitest for clear / show rules |
| `src/components/DrawingOverlay.vue` | Underlay `<img>`, listen event, clear on modes, config sync |
| `src/components/settings/GeneralTab.vue` | Toggle UI |
| `src/components/SettingsView.vue` | Prop / state wiring |
| `src/i18n/en.ts`, `src/i18n/zh-CN.ts` | Setting strings |

---

### Task 1: Config field `videoCompatMode` (default true)

**Files:**
- Modify: `src-tauri/src/config.rs`
- Modify: `src/types/app.d.ts`

**Interfaces:**
- Produces: `GeneralConfig.video_compat_mode: bool` ↔ JSON `videoCompatMode`, default `true`; TS `general.videoCompatMode: boolean`

- [ ] **Step 1: Write the failing Rust tests**

In `config.rs` `#[cfg(test)]` module, add:

```rust
fn default_true() -> bool {
    true
}

#[test]
fn video_compat_mode_defaults_true() {
    assert!(GeneralConfig::default().video_compat_mode);
}

#[test]
fn video_compat_mode_missing_field_deserializes_true() {
    let json = r#"{
        "shortcuts": {
            "toggleDrawing": "Ctrl+Shift+D",
            "clearDrawing": "Ctrl+Shift+C"
        },
        "general": {}
    }"#;
    let config: AppConfig = serde_json::from_str(json).unwrap();
    assert!(config.general.video_compat_mode);
}

#[test]
fn video_compat_mode_explicit_false_roundtrips() {
    let json = r#"{
        "shortcuts": {
            "toggleDrawing": "Ctrl+Shift+D",
            "clearDrawing": "Ctrl+Shift+C"
        },
        "general": { "videoCompatMode": false }
    }"#;
    let config: AppConfig = serde_json::from_str(json).unwrap();
    assert!(!config.general.video_compat_mode);
}
```

Place `fn default_true() -> bool { true }` next to `default_auto_start` near the top of `config.rs` (outside the test module) so serde can call it — do **not** nest it only inside tests.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd src-tauri; cargo test video_compat_mode -- --nocapture`

Expected: FAIL (field missing / compile error)

- [ ] **Step 3: Add field + Default + TS type**

In `GeneralConfig`:

```rust
#[serde(default = "default_true", rename = "videoCompatMode")]
pub video_compat_mode: bool,
```

In `Default for GeneralConfig`:

```rust
video_compat_mode: true,
```

Near other default fns:

```rust
fn default_true() -> bool {
    true
}
```

In `src/types/app.d.ts` inside `general`:

```ts
videoCompatMode?: boolean
```

(Optional field with `?? true` at read sites is fine; prefer documenting default true in comments.)

Also update `config_deserializes_with_missing_general` if it asserts full general defaults — add:

```rust
assert!(config.general.video_compat_mode);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd src-tauri; cargo test video_compat_mode -- --nocapture`

Expected: PASS

Also: `cargo test config_deserializes_with_missing_general -- --nocapture`

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/config.rs src/types/app.d.ts
git commit -m "feat(config): add videoCompatMode defaulting to true"
```

---

### Task 2: Pure freeze-frame policy helper (FE) + tests

**Files:**
- Create: `src/utils/freezeFrame.ts`
- Create: `src/utils/freezeFrame.test.ts`

**Interfaces:**
- Produces:
  - `export type FreezeFramePayload = { dataUrl: string | null }`
  - `export function shouldKeepFreezeFrame(opts: { whiteboardMode: boolean; overlayMode: 'hidden' | 'drawing' | 'penetration' }): boolean` — true only when `overlayMode === 'drawing' && !whiteboardMode`
  - `export function resolveFreezeFrameUrl(opts: { dataUrl: string | null; whiteboardMode: boolean; overlayMode: 'hidden' | 'drawing' | 'penetration' }): string | null` — returns `dataUrl` only when `shouldKeepFreezeFrame` and `dataUrl` is non-null non-empty

- [ ] **Step 1: Write failing tests**

```ts
import { describe, expect, it } from 'vitest'
import { resolveFreezeFrameUrl, shouldKeepFreezeFrame } from './freezeFrame'

describe('freezeFrame', () => {
  it('keeps freeze only in drawing + non-whiteboard', () => {
    expect(
      shouldKeepFreezeFrame({ whiteboardMode: false, overlayMode: 'drawing' }),
    ).toBe(true)
    expect(
      shouldKeepFreezeFrame({ whiteboardMode: true, overlayMode: 'drawing' }),
    ).toBe(false)
    expect(
      shouldKeepFreezeFrame({ whiteboardMode: false, overlayMode: 'penetration' }),
    ).toBe(false)
    expect(
      shouldKeepFreezeFrame({ whiteboardMode: false, overlayMode: 'hidden' }),
    ).toBe(false)
  })

  it('resolve returns null when cleared by mode', () => {
    expect(
      resolveFreezeFrameUrl({
        dataUrl: 'data:image/png;base64,abc',
        whiteboardMode: false,
        overlayMode: 'penetration',
      }),
    ).toBeNull()
  })

  it('resolve returns dataUrl when drawing screen overlay', () => {
    expect(
      resolveFreezeFrameUrl({
        dataUrl: 'data:image/png;base64,abc',
        whiteboardMode: false,
        overlayMode: 'drawing',
      }),
    ).toBe('data:image/png;base64,abc')
  })
})
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `npm test -- src/utils/freezeFrame.test.ts`

Expected: FAIL (module missing)

- [ ] **Step 3: Implement helper**

```ts
export type FreezeFramePayload = { dataUrl: string | null }

export type OverlaySessionMode = 'hidden' | 'drawing' | 'penetration'

export function shouldKeepFreezeFrame(opts: {
  whiteboardMode: boolean
  overlayMode: OverlaySessionMode
}): boolean {
  return opts.overlayMode === 'drawing' && !opts.whiteboardMode
}

export function resolveFreezeFrameUrl(opts: {
  dataUrl: string | null
  whiteboardMode: boolean
  overlayMode: OverlaySessionMode
}): string | null {
  if (!opts.dataUrl) return null
  if (!shouldKeepFreezeFrame(opts)) return null
  return opts.dataUrl
}
```

- [ ] **Step 4: Run test — expect PASS**

Run: `npm test -- src/utils/freezeFrame.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/utils/freezeFrame.ts src/utils/freezeFrame.test.ts
git commit -m "feat(overlay): add freeze-frame visibility helpers"
```

---

### Task 3: Shared monitor capture → PNG data URL

**Files:**
- Create: `src-tauri/src/capture.rs`
- Modify: `src-tauri/src/lib.rs` (add `mod capture;`)
- Modify: `src-tauri/src/clipboard.rs` (delegate screen grab; keep clipboard write)
- Test: unit tests in `capture.rs` for PNG data-URL encoding of a tiny synthetic RGBA buffer (no display required)

**Interfaces:**
- Produces:
  - `pub struct CapturedImage { pub width: u32, pub height: u32, pub rgba: Vec<u8> }`
  - `pub fn encode_png_data_url(img: &CapturedImage) -> Result<String, String>`
  - `pub fn capture_cursor_monitor() -> Result<CapturedImage, String>` — Windows BitBlt; macOS `screencapture -x -R` to temp PNG then decode; other OS `Err("Screen capture not supported on this platform")`
  - `pub fn capture_freeze_frame_data_url() -> Result<String, String>` — capture + encode
  - `pub fn should_capture_freeze_frame(video_compat: bool, entry: crate::config::DefaultEntryMode) -> bool`
- Consumes: existing Win32 monitor APIs / xcap geometry (macOS) patterns from current `clipboard.rs`

- [ ] **Step 1: Write failing encode + policy tests in `capture.rs`**

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::DefaultEntryMode;

    #[test]
    fn should_capture_only_when_compat_and_screen_entry() {
        assert!(should_capture_freeze_frame(true, DefaultEntryMode::Screen));
        assert!(!should_capture_freeze_frame(false, DefaultEntryMode::Screen));
        assert!(!should_capture_freeze_frame(true, DefaultEntryMode::Whiteboard));
    }

    #[test]
    fn encode_png_data_url_has_prefix() {
        let img = CapturedImage {
            width: 1,
            height: 1,
            rgba: vec![255, 0, 0, 255],
        };
        let url = encode_png_data_url(&img).unwrap();
        assert!(url.starts_with("data:image/png;base64,"));
    }
}
```

- [ ] **Step 2: Run — expect FAIL**

Run: `cd src-tauri; cargo test should_capture_only_when_compat -- --nocapture`

Expected: FAIL (module missing)

- [ ] **Step 3: Implement `capture.rs`**

Policy:

```rust
use crate::config::DefaultEntryMode;

pub fn should_capture_freeze_frame(video_compat: bool, entry: DefaultEntryMode) -> bool {
    video_compat && matches!(entry, DefaultEntryMode::Screen)
}
```

Encode (use existing `image` + `base64` crates):

```rust
pub fn encode_png_data_url(img: &CapturedImage) -> Result<String, String> {
    use base64::Engine;
    let buffer = image::RgbaImage::from_raw(img.width, img.height, img.rgba.clone())
        .ok_or_else(|| "Invalid RGBA buffer".to_string())?;
    let mut png_bytes = Vec::new();
    {
        let mut cursor = std::io::Cursor::new(&mut png_bytes);
        buffer
            .write_to(&mut cursor, image::ImageFormat::Png)
            .map_err(|e| format!("PNG encode failed: {e}"))?;
    }
    let b64 = base64::engine::general_purpose::STANDARD.encode(png_bytes);
    Ok(format!("data:image/png;base64,{b64}"))
}
```

**Windows `capture_cursor_monitor`:** Move the BitBlt / GetDIBits logic from `clipboard.rs`, but instead of `SetClipboardData`, convert pixels to top-down RGBA:

- GetDIBits with positive `bi_height` yields **bottom-up BGRA**. Flip rows and swap B↔R into `rgba: Vec<u8>` of length `w*h*4`.
- Return `CapturedImage { width: w as u32, height: h as u32, rgba }`.

**macOS `capture_cursor_monitor`:** Resolve monitor rect via existing xcap `from_point` / first monitor (same as today’s `copy_screen_inner`). Then:

```rust
let dir = std::env::temp_dir();
let path = dir.join(format!("markeron-freeze-{}.png", std::process::id()));
let region = format!("{},{},{},{}", x, y, w, h);
let status = std::process::Command::new("screencapture")
    .args(["-x", "-R", &region, path.to_str().unwrap()])
    .status()
    .map_err(|e| format!("screencapture failed: {e}"))?;
// decode PNG with image::open → to_rgba8 → CapturedImage; delete temp file in finally
```

Do **not** use `screencapture -c` for freeze (clipboard pollution).

**Linux / other:**

```rust
Err("Screen capture not supported on this platform".into())
```

`capture_freeze_frame_data_url`:

```rust
pub fn capture_freeze_frame_data_url() -> Result<String, String> {
    let img = capture_cursor_monitor()?;
    encode_png_data_url(&img)
}
```

- [ ] **Step 4: Refactor `clipboard.rs` `copy_screen_inner`**

Windows / macOS: call `crate::capture::capture_cursor_monitor()`, then write to clipboard via `arboard` (RGBA) — same as whiteboard path — **or** keep Windows CF_DIB path by converting from captured RGBA. Prefer **arboard** for both platforms after capture to delete duplicated clipboard DIB code:

```rust
fn copy_screen_inner() -> Result<(), String> {
    let img = crate::capture::capture_cursor_monitor()?;
    let mut cb = arboard::Clipboard::new().map_err(|e| format!("{e}"))?;
    cb.set_image(arboard::ImageData {
        width: img.width as usize,
        height: img.height as usize,
        bytes: std::borrow::Cow::Owned(img.rgba),
    })
    .map_err(|e| format!("{e}"))?;
    Ok(())
}
```

Keep `with_toolbar_excluded_from_capture` wrapper on `copy_screen` unchanged.

- [ ] **Step 5: Register module**

In `lib.rs` near other `mod` lines:

```rust
mod capture;
```

- [ ] **Step 6: Run unit tests**

Run: `cd src-tauri; cargo test capture:: -- --nocapture`

Expected: PASS for policy + encode tests.

Manual smoke (implementer machine): `copy_screen` from overlay still puts an image on the clipboard.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/capture.rs src-tauri/src/clipboard.rs src-tauri/src/lib.rs
git commit -m "feat(capture): shared monitor capture for freeze frame and copy_screen"
```

---

### Task 4: Emit `freeze-frame-ready` from `activate_drawing`

**Files:**
- Modify: `src-tauri/src/overlay.rs` (`activate_drawing`)

**Interfaces:**
- Consumes: `capture::should_capture_freeze_frame`, `capture::capture_freeze_frame_data_url`, `config.general.video_compat_mode`, `config.general.default_entry_mode`
- Produces: event `freeze-frame-ready` with payload `{ "dataUrl": string | null }` **before** `window.show()`

- [ ] **Step 1: Add emit helper + call site**

Near other emit helpers in `overlay.rs`:

```rust
#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct FreezeFramePayload {
    data_url: Option<String>,
}

fn emit_freeze_frame(app: &AppHandle, data_url: Option<String>) {
    if let Err(e) = app.emit("freeze-frame-ready", FreezeFramePayload { data_url }) {
        warn!("Failed to emit freeze-frame-ready: {}", e);
    }
}
```

At the start of `activate_drawing`, after `set_mode(Drawing)` and reading config, **before** `window.show()`:

```rust
let (video_compat, entry_mode) = {
    let cfg = lock_or_recover(&state.config);
    (cfg.general.video_compat_mode, cfg.general.default_entry_mode)
};

if crate::capture::should_capture_freeze_frame(video_compat, entry_mode) {
    // Toolbar may already be visible (always-on); exclude it like copy_screen.
    let captured = crate::clipboard::with_toolbar_excluded_from_capture_for_freeze(app, || {
        crate::capture::capture_freeze_frame_data_url()
    });
    match captured {
        Ok(url) => emit_freeze_frame(app, Some(url)),
        Err(e) => {
            warn!("Freeze-frame capture failed: {}", e);
            emit_freeze_frame(app, None);
        }
    }
} else {
    emit_freeze_frame(app, None);
}
```

**Note on `with_toolbar_excluded_from_capture`:** Today it is private in `clipboard.rs`. Either:

1. `pub(crate) fn with_toolbar_excluded_from_capture` and call it from `overlay.rs`, or  
2. Inline the same exclude/hide pattern in `overlay` / `capture`.

Prefer making the existing helper `pub(crate)` and renaming is unnecessary — just change `fn` → `pub(crate) fn`.

If toolbar is not visible yet at activate time, the helper already no-ops hide — fine.

Always emit (Some or None) so FE clears stale freeze from a previous session when setting is off or whiteboard entry.

- [ ] **Step 2: Compile check**

Run: `cd src-tauri; cargo check`

Expected: success

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/overlay.rs src-tauri/src/clipboard.rs
git commit -m "feat(overlay): emit freeze-frame-ready before showing overlay"
```

---

### Task 5: DrawingOverlay underlay + listeners

**Files:**
- Modify: `src/components/DrawingOverlay.vue`

**Interfaces:**
- Consumes: `freeze-frame-ready` event, `freezeFrame.resolveFreezeFrameUrl`, `config.general.videoCompatMode`
- Produces: visible freeze underlay while drawing on screen overlay

- [ ] **Step 1: Add state + imports**

```ts
import { resolveFreezeFrameUrl, type FreezeFramePayload } from '../utils/freezeFrame'

const freezeFrameDataUrl = ref<string | null>(null)
const videoCompatMode = ref(true)

const freezeFrameDisplayUrl = computed(() =>
  resolveFreezeFrameUrl({
    dataUrl: freezeFrameDataUrl.value,
    whiteboardMode: whiteboardMode.value,
    overlayMode: lastOverlayMode, // ensure lastOverlayMode is reactive or pass penetrationMode/active-derived mode
  }),
)
```

Prefer deriving overlay mode explicitly:

```ts
const sessionMode = computed<OverlaySessionMode>(() => {
  if (!active.value && !penetrationMode.value) return 'hidden'
  if (penetrationMode.value) return 'penetration'
  return 'drawing'
})
```

Note: today `active` is true only for `drawing`, and `penetrationMode` is set from the same event. When penetrating, `active` is false. So:

```ts
const freezeFrameDisplayUrl = computed(() =>
  resolveFreezeFrameUrl({
    dataUrl: freezeFrameDataUrl.value,
    whiteboardMode: whiteboardMode.value,
    overlayMode: penetrationMode.value
      ? 'penetration'
      : active.value
        ? 'drawing'
        : 'hidden',
  }),
)
```

- [ ] **Step 2: Listen `freeze-frame-ready`**

In `onMounted` listeners block:

```ts
unlisteners.push(
  await listen<FreezeFramePayload>('freeze-frame-ready', (event) => {
    freezeFrameDataUrl.value = event.payload?.dataUrl ?? null
  }),
)
```

- [ ] **Step 3: Clear / sync on mode + config**

In `overlay-mode-changed` when `mode === 'hidden'` or `mode === 'penetration'`:

```ts
freezeFrameDataUrl.value = null
```

(Also safe to rely on `resolveFreezeFrameUrl`, but clearing releases the large data URL from memory.)

In `enterWhiteboardMode` after setting `whiteboardMode.value = true`:

```ts
freezeFrameDataUrl.value = null
```

On config load / `config-changed`:

```ts
videoCompatMode.value = event.payload.general?.videoCompatMode ?? true
// if toggled off while freeze visible:
if (!videoCompatMode.value) {
  freezeFrameDataUrl.value = null
}
```

Same for initial `get_config`.

- [ ] **Step 4: Template underlay**

Inside the root container, **before** history canvas:

```vue
<img
  v-if="freezeFrameDisplayUrl"
  :src="freezeFrameDisplayUrl"
  alt=""
  class="absolute top-0 left-0 w-full h-full object-cover pointer-events-none select-none"
  style="z-index: 0"
  draggable="false"
/>
```

Ensure canvases sit above (`z-index` or DOM order). History/preview canvases are already `absolute`; put underlay first in DOM with `z-index: 0` and canvases without negative z.

Do **not** add `bg-white` when freeze is showing (whiteboard still uses white).

- [ ] **Step 5: Manual check list (dev)**

1. Setting on, screen entry, desktop visible under freeze (static).  
2. Toggle penetration → freeze disappears.  
3. Exit drawing → freeze cleared.  
4. Whiteboard default entry → no freeze.  
5. Setting off → transparent (Bilibili may black — expected).

- [ ] **Step 6: Commit**

```bash
git add src/components/DrawingOverlay.vue
git commit -m "feat(overlay): render freeze-frame underlay for video compat mode"
```

---

### Task 6: Settings toggle + i18n

**Files:**
- Modify: `src/components/settings/GeneralTab.vue`
- Modify: `src/components/SettingsView.vue`
- Modify: `src/i18n/en.ts`
- Modify: `src/i18n/zh-CN.ts`

**Interfaces:**
- Consumes: `save_general` / `videoCompatMode`
- Produces: user-visible toggle defaulting to on

- [ ] **Step 1: Add i18n strings**

`en.ts` under `settings`:

```ts
videoCompatMode: 'Video compatibility mode',
videoCompatModeDesc:
  'When enabled, entering annotation captures a frozen screenshot as the overlay background. This avoids black video on sites that use GPU video overlays (for example Bilibili). Entering click-through clears the freeze and restores transparency.',
```

`zh-CN.ts`:

```ts
videoCompatMode: '视频兼容模式',
videoCompatModeDesc:
  '开启后，进入标注时会截取当前屏幕作为冻结背景，避免 B 站等使用 GPU 视频叠加层的页面在透明窗口下变黑。进入穿透模式会清除冻结画面并恢复透明。',
```

Optionally append one sentence to `whiteboardSectionDesc` only if the section title covers this toggle; otherwise add a new row description under the toggle (match `preserveDrawingsDesc` pattern — description in section copy or adjacent hint). Prefer a dedicated row + use existing card description style: look at how `preserveDrawingsDesc` is shown in `GeneralTab.vue` and mirror it.

- [ ] **Step 2: Wire GeneralTab**

Props + emits (mirror `preserveDrawings`):

```ts
videoCompatMode: boolean
// emit 'update:videoCompatMode'
```

```ts
async function toggleVideoCompatMode() {
  const newValue = !props.videoCompatMode
  emit('update:videoCompatMode', newValue)
  try {
    const cfg = await invoke<AppConfig>('get_config')
    if (!cfg.general) {
      cfg.general = {
        dragMode: props.dragMode,
        preserveDrawings: props.preserveDrawings,
        whiteboardPreserveDrawings: props.whiteboardPreserveDrawings,
        angleSnapStep: props.angleSnapStep,
        videoCompatMode: true,
      }
    }
    cfg.general.videoCompatMode = newValue
    await invoke('save_general', { general: cfg.general })
  } catch (error) {
    console.error('Failed to save videoCompatMode:', error)
  }
}
```

UI: new `settings-card-row` in the whiteboard/content card (after preserve drawings row):

```vue
<div class="settings-card-row settings-card-row--divided">
  <div class="flex flex-col gap-0.5 min-w-0">
    <span class="settings-text-label">{{ t('settings.videoCompatMode') }}</span>
    <span class="settings-text-muted text-xs leading-snug">{{ t('settings.videoCompatModeDesc') }}</span>
  </div>
  <button
    role="switch"
    :aria-checked="videoCompatMode"
    :aria-label="t('settings.videoCompatMode')"
    class="relative w-8 h-4.5 rounded-full transition-colors duration-200 cursor-pointer border-none p-0 outline-none shadow-inner shrink-0"
    :class="videoCompatMode ? 'settings-toggle-on' : 'settings-toggle-off'"
    @click="toggleVideoCompatMode"
  >
    <span
      class="absolute top-0.5 left-0.5 size-3.5 rounded-full bg-white shadow-md transition-transform duration-200"
      :class="videoCompatMode ? 'translate-x-3.5' : 'translate-x-0'"
    />
  </button>
</div>
```

Follow existing label-only rows if descriptions are only in the section blurb — if other toggles put desc only in `whiteboardSectionDesc`, instead extend that string and keep a label-only row like `preserveDrawings`. **Match whichever pattern the card already uses for sibling toggles.**

- [ ] **Step 3: Wire SettingsView**

```ts
const videoCompatMode = ref(true)
// onMounted / when applying config:
videoCompatMode.value = cfg.general?.videoCompatMode ?? true
```

Pass to `GeneralTab`:

```vue
:video-compat-mode="videoCompatMode"
@update:video-compat-mode="videoCompatMode = $event"
```

- [ ] **Step 4: Lint / typecheck**

Run: `npx vue-tsc --noEmit`

Expected: clean

Run: `npm test -- src/utils/freezeFrame.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/settings/GeneralTab.vue src/components/SettingsView.vue src/i18n/en.ts src/i18n/zh-CN.ts
git commit -m "feat(settings): add video compatibility mode toggle"
```

---

### Task 7: End-to-end verification

**Files:** none (verification only)

- [ ] **Step 1: Automated suite**

```bash
npm test
npm run lint
npx vue-tsc --noEmit
cd src-tauri
cargo fmt --check
cargo clippy -- -D warnings
cargo test
```

Expected: all pass

- [ ] **Step 2: Manual Bilibili check (Windows or Mac)**

1. Fresh config or ensure `videoCompatMode` true.  
2. Open Bilibili video in Chrome/Edge with hardware acceleration on.  
3. Toggle drawing — video area should show **frozen** frame, not black.  
4. Enter penetration — freeze clears (video may go black again).  
5. Turn setting off, re-enter — black may return (confirms toggle).  
6. `copy_screen` still copies without toolbar chrome.

- [ ] **Step 3: Final commit only if verification fixed anything**; otherwise done.

If docs/help should mention the setting, add a short note in in-app help only when an existing “settings” help section exists — **YAGNI** otherwise (spec did not require help.html).

---

## Spec coverage (self-review)

| Spec requirement | Task |
|------------------|------|
| `videoCompatMode` default true + serde | Task 1 |
| Capture before show | Task 4 |
| Shared capture / no clipboard for freeze | Task 3 |
| Event `freeze-frame-ready` | Task 4–5 |
| FE underlay | Task 5 |
| Clear on penetration / hidden / whiteboard | Task 2 + 5 |
| No re-capture after penetration exit | Task 4 (only Hidden→Drawing) |
| Skip when default entry whiteboard | Task 3 policy + Task 4 |
| Settings toggle + i18n | Task 6 |
| `copy_screen` still works | Task 3 refactor + Task 7 |
| Linux degrade | Task 3 stub |
| Mid-session setting off clears freeze | Task 5 |
| Out of scope (live composite, refresh btn, native 2.0) | Not planned |

**Placeholder scan:** none intentional.  
**Type consistency:** `FreezeFramePayload.dataUrl` (TS) ↔ Rust `data_url` with `rename_all = "camelCase"`.

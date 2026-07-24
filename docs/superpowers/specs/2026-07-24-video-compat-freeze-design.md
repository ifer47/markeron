# Video compatibility mode (freeze screenshot)

**Date:** 2026-07-24  
**Status:** Approved design  
**Issue:** [#30](https://github.com/ifer47/markeron/issues/30)  
**Scope:** Settings + overlay activation (Mac + Windows); Linux degrades gracefully

## Problem

A transparent always-on-top WebView over GPU-accelerated video (e.g. Bilibili in Chrome/Edge) conflicts with the browser’s hardware video overlay plane. The video region paints black while MarkerOn is annotating.

Long-term fix is native drawing (2.0). This design is an interim **product** fix: freeze a desktop screenshot as an opaque overlay background so the real video plane is not visually required.

## Decisions (locked)

| Topic | Choice |
|-------|--------|
| Mode | Settings **视频兼容模式** → every annotate entry auto-captures a freeze frame |
| Default | **On** (`videoCompatMode: true`) |
| Activation | Automatic on **Hidden → Drawing** when setting is on (not a per-session toolbar toggle) |
| Capture timing | Rust `activate_drawing`, **before** `window.show()` |
| Delivery | Event `freeze-frame-ready` with PNG data URL (or null on failure / skip) |
| Whiteboard entry | **No** capture; white background as today |
| Penetration | **Allowed**; entering penetration **clears** freeze → transparent again |
| Exit penetration → Drawing | **No** re-capture (stays transparent until next Hidden → Drawing) |
| Implementation approach | Shared monitor capture kernel; freeze via event; do **not** reuse `copy_screen` clipboard path for freeze |

## Out of scope

- Low-framerate live desktop compositing
- Toolbar “refresh freeze frame”
- Native drawing / architecture rewrite (2.0)
- Auto-detect video sites
- Re-capture after leaving penetration
- New Linux capture backend (skip → behave as if off)

## Architecture

```
general.videoCompatMode (default true)
        │
        ▼
activate_drawing (before window.show)
  ├─ if videoCompatMode && not entering as whiteboard-only path:
  │     capture_monitor_png(annotate monitor)
  │     emit("freeze-frame-ready", { dataUrl: "data:image/png;base64,..." | null })
  ├─ setup / show overlay / toolbar / clip cursor
  └─ emit overlay-mode-changed "drawing"
        │
        ▼
DrawingOverlay
  ├─ freeze-frame-ready → full-screen underlay <img> (pointer-events: none)
  ├─ whiteboard → clear freeze (or cover with white)
  ├─ penetration → clear freeze
  └─ hidden → clear freeze
```

Whiteboard default entry is decided on the frontend after `overlay-mode-changed`. Backend still may emit a freeze frame when the setting is on; FE **must ignore / clear** freeze when applying whiteboard entry so users never see a flash of freeze under white (preferred: backend skips capture when `defaultEntryMode == whiteboard` **and** that is the only entry — see Edge cases).

**Preferred skip rule (backend):** If `general.defaultEntryMode == whiteboard`, skip capture in `activate_drawing` (FE will enter whiteboard immediately). If user later exits whiteboard to screen overlay in the same session, do **not** auto-recapture.

## Config & IPC

### Config

| Layer | Change |
|-------|--------|
| `config.rs` `GeneralConfig` | `video_compat_mode` ↔ `videoCompatMode`, **default `true`**, `#[serde(default = "default_true")]` (plain `#[serde(default)]` would wrongly default bool to `false`) |
| `src/types/app.d.ts` | `general.videoCompatMode: boolean` |
| Persist | Existing `save_general` / `get_config` / `config-changed` |

### Events / internals

| Name | Role |
|------|------|
| `freeze-frame-ready` | Payload `{ dataUrl: string \| null }` — FE sets or clears underlay |
| `capture_monitor_rgba` / `capture_monitor_png` | Internal helpers in `clipboard.rs` (or small `capture.rs`); **not** required as FE invoke for v1 |
| `copy_screen` | Refactor to call shared capture, then write clipboard (behavior unchanged) |

No new `save_*` command.

## Capture details

- **Windows:** Existing BitBlt path → RGBA/PNG (today only writes `CF_DIB`; extend to return pixels for freeze).
- **macOS:** Capture annotate monitor region without leaving the image only on the system clipboard (temp file or in-memory path preferred over `screencapture -c` for freeze).
- **Toolbar:** Reuse `with_toolbar_excluded_from_capture` when toolbar is visible at capture time. Overlay is still hidden → usually no overlay exclude needed.
- **Monitor:** Same monitor selection as drawing clip / annotate target (cursor / remembered overlay monitor — align with `remember_and_clip_drawing_monitor` ordering; capture may run just before clip remember — use the same monitor resolution rules).
- **Failure:** Log + emit `dataUrl: null`; annotation still activates; transparent fallback.

## Frontend

### Settings

- `GeneralTab.vue`: toggle next to whiteboard / content card (same switch pattern as `preserveDrawings`).
- i18n keys (en + zh-CN), e.g.:
  - `settings.videoCompatMode`
  - `settings.videoCompatModeDesc` — explain freeze-on-enter, helps GPU video sites, penetration clears freeze.

### Overlay

- State: `freezeFrameUrl: string | null`.
- Render: full-viewport underlay beneath history/drawing canvases; `pointer-events: none`.
- Listeners:
  - `freeze-frame-ready` → set URL or clear.
  - `overlay-mode-changed` → `hidden` / `penetration` → clear; whiteboard enter → clear.
  - `config-changed` → update local `videoCompatMode` ref; if toggled **off** while freeze visible → clear underlay immediately; **on** while already drawing → no mid-session recapture.

## Edge cases

| Case | Result |
|------|--------|
| Setting on, screen entry | Capture → freeze underlay |
| Setting on, whiteboard default entry | Skip capture (backend) / FE clears if any |
| Screen → W whiteboard | Clear freeze; white bg |
| Whiteboard → back to screen (same session) | No recapture; transparent |
| Drawing → penetration | Clear freeze |
| Penetration → Drawing | No recapture |
| `preserveDrawings` | Ink preserved; freeze still refreshed each Hidden → Drawing |
| Setting off mid-session | Clear freeze immediately |
| Capture fails | Transparent; no block |
| Linux / no capture | Same as capture fail |

## Testing

- Rust: default `videoCompatMode == true`; missing JSON field deserializes to `true`.
- Rust: capture failure does not panic; `copy_screen` still works after refactor.
- Manual: Bilibili (or similar) with setting on → annotate shows frozen frame, not black; setting off → black may return; penetration clears freeze; whiteboard entry has no freeze; copy-screen toolbar action still OK.

## Non-goals reminder

Interim fix only. Does not replace native overlay architecture for 2.0.

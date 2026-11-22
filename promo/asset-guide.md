# MarkerOn Promotion Asset Guide

Last audited: 2026-11-22 (v2.31.0)

## Recommended Assets

| Use | Asset | Size | Notes |
| :--- | :--- | :--- | :--- |
| Square social cover | `assets/social/click-through-social-square.png` | 1254×1254 | Concept visual for click-through; no text, logo, or version claim |
| Square Chinese cover | `assets/酷图_1080x1080.png` | 1080×1080 | Brand-safe generic cover |
| High-resolution square | `assets/酷图_2160x2160.png` | 2160×2160 | Same generic cover at 2× |
| Vertical cover | `assets/招贴画_720x1080.png` | 720×1080 | Good for 小红书 / 视频号 / story formats |
| Vertical high-resolution | `assets/招贴画_1440x2160.png` | 1440×2160 | High-resolution vertical cover |
| Real click-through demo | `docs/assets/click-through-mode.gif` | 720×405 | Strongest functional proof; compress or convert to MP4 per platform. **Recorded 2026-07-07 — predates the toolbar redesign, re-record before the next launch push.** |
| Real desktop scenario | `assets/desktop-annotation.png` / `assets/桌面标注场景.png` | 2880×1620 | Regenerated from `scene1-desktop*.html` |
| Shortcut reference | `docs/assets/shortcuts.png` / `assets/快捷键一览.png` | 2880×1620 | Regenerated from `scene4-shortcuts*.html` (global + action + tools + drawing + color groups) |
| Annotation tools grid | `docs/assets/tools.png` / `assets/十种标注工具.png` | 2880×1620 | Regenerated from `scene2-tools*.html` (10 drawing tools / `1-8` + `T` + `N`; Select is `V` in the top action row) |
| Settings / panel | `docs/assets/settings.png` / `assets/设置面板.png` | 2880×1620 | Regenerated from `scene3-panel*.html`; mirrors the real 320px toolbar panel (action row + 8 colors + custom + 9 width presets) |
| Settings window | `docs/assets/settings-window.png` / `assets/设置窗口.png` | 2880×1620 | Regenerated from `scene5-settings*.html`; embeds a real 660×500 @2x capture of the settings window (all five tabs) |
| Line styles & widths | `docs/assets/stroke-styles.png` / `assets/线型与线宽.png` | 2880×1620 | Regenerated from `scene6-stroke*.html`; the only image that shows solid / dashed / dotted together, the 9-step width ladder, stamp and laser (real dash patterns: `13 9.75` and `0.1 7` with round caps) |
| Whiteboard | `docs/assets/whiteboard.png` / `assets/白板模式.png` | 2880×1620 | Regenerated from `scene7-whiteboard*.html`; white vs black canvas side by side |
| Edit & refine | `docs/assets/precision-editing.png` / `assets/编辑与精修.png` | 2880×1620 | Regenerated from `scene8-precision*.html`; selection frame + handles, hold-to-straighten / bend, text outline, click-through. Geometry copied from `useDrawing.drawSelectionOverlay` (1.5px `6 4` `#007AFF` frame, 8×8 handles, rotate dot 28px above the top edge) |
| Hero / brand | `assets/MarkerOn.png` / `docs/assets/hero.png` | 2880×1620 | Regenerated from `scene0-hero*.html` |

Removed in the 2026-11-22 audit (unreferenced, and the UI they showed no longer exists — drag modes, Diagnostics tab):

- ~~`assets/language-switcher.png`~~
- ~~`assets/preserve-drawings-setting.png`~~

## Regenerating marketing PNGs

Source HTML lives in `assets/store-screenshots/scene*.html` (designed at 1920×1080). Export at 2880×1620 (`1920×1080 × deviceScaleFactor 1.5`) for README / website / Store listings.

Optional helper: `scripts/export-store-screenshots.mjs` (requires Playwright Chromium). Or open each HTML in Chrome at 1920×1080 and save a viewport screenshot, then scale to 2880×1620.

Keep the panel geometry in the scenes in sync with `TOOLBAR_PANEL_WIDTH` (`src/utils/toolbarWindow.ts`, currently 320px) and with `src/constants/colors.ts` (8 presets) and `src/constants/tools.ts` (`WIDTH_PRESETS`, 9 steps).

The settings-window scenes embed real renders, not hand-written markup. To refresh them, run the Vite dev server and capture the real component with mocked Tauri IPC — `?locale=en` switches the UI language:

```bash
npm run dev:fe
# then screenshot at 660×500 / deviceScaleFactor 2:
# http://localhost:1420/assets/store-screenshots/settings-shot.html?locale=zh-CN#settings
# (`?locale=en` for the English build)
```

The capture lands in `assets/store-screenshots/settings-window-{zh,en}.png`; re-run `node scripts/export-store-screenshots.mjs` afterwards.

After changing tools / shortcuts / panel copy in those HTML files, re-export and overwrite the PNG paths above.
Every screenshot has a single copy: English shots live in `docs/assets/` (shared by README and the website), Chinese shots in `assets/`.

## Re-recording the click-through demo

The current `docs/assets/click-through-mode.gif` is a real screen recording from 2026-07-07. It predates the toolbar redesign and the Select tool, so re-record it before a launch push:

1. `cargo build --release` (a fresh `src-tauri/target/release/markeron.exe` is required — an old binary would bake the old UI back in).
2. Close other windows so the desktop is clean, then start a recorder (Xbox Game Bar, OBS, or `ffmpeg -f gdigrab -framerate 15 -i desktop out.mp4`).
3. Press `Ctrl+Shift+D`, draw two or three strokes, press `X`, click a button in the app underneath, press `X` again and keep drawing.
4. Stop the recording and convert it: `bash scripts/recording-to-gif.sh out.mp4`.
5. Keep it under ~12 s; the existing GIF is 431 frames at 720×405.

## New Social Concept Visual

`assets/social/click-through-social-square.png` was generated as a supporting illustration, not a literal MarkerOn screenshot. Captions should label it as an illustration if the context could confuse it with the real interface. Pair it with the real click-through GIF in launch galleries.

Generation prompt:

> Create a premium square software-product illustration on a deep navy background: a modern dashboard window with a coral circle and arrow, yellow highlight, blue rectangle, and laser glow on an annotation layer; show a cursor clicking a button underneath while every annotation remains visible. No text, logo, brand imitation, people, watermark, or pseudo-text.

## Gallery Order

For Product Hunt, directories, and press kits:

1. Real click-through GIF or MP4.
2. Real desktop annotation screenshot.
3. Real shortcut reference.
4. Real settings window (all five tabs) or annotation tools grid.
5. Concept visual as a supporting cover, not as proof of UI.

This order makes the distinctive behavior visible before feature lists.

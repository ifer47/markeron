# MarkerOn Promotion Asset Guide

Last audited: 2026-07-22

## Recommended Assets

| Use | Asset | Size | Notes |
| :--- | :--- | :--- | :--- |
| Square social cover | `assets/social/click-through-social-square.png` | 1254×1254 | Concept visual for click-through; no text, logo, or version claim |
| Square Chinese cover | `assets/酷图_1080x1080.png` | 1080×1080 | Brand-safe generic cover |
| High-resolution square | `assets/酷图_2160x2160.png` | 2160×2160 | Same generic cover at 2× |
| Vertical cover | `assets/招贴画_720x1080.png` | 720×1080 | Good for 小红书 / 视频号 / story formats |
| Vertical high-resolution | `assets/招贴画_1440x2160.png` | 1440×2160 | High-resolution vertical cover |
| Real click-through demo | `docs/assets/click-through-mode.gif` | 720×405 | Strongest functional proof; compress or convert to MP4 per platform |
| Real desktop scenario | `assets/desktop-annotation.png` / `assets/桌面标注场景.png` | 2880×1530 | Regenerated from `scene1-desktop*.html` |
| Shortcut reference | `docs/assets/shortcuts.png` / `assets/快捷键一览.png` | 2880×1530 | Regenerated from store scenes (10 tools / `1-8` + `T` + `N`) |
| Annotation tools grid | `docs/assets/tools.png` / `assets/十种标注工具.png` | 2880×1530 | Regenerated from store scenes (10 tools / `1-8` + `T` + `N`) |
| Settings / panel | `docs/assets/settings.png` / `assets/设置面板.png` | 2880×1530 | Regenerated from `scene3-panel*.html` |
| Hero / brand | `assets/MarkerOn.png` / `docs/assets/hero.png` | 2880×1530 | Regenerated from `scene0-hero*.html` |

Unused legacy settings screenshots (not linked from README/docs; UI has changed — drag modes, Diagnostics tab, etc.):

- `assets/language-switcher.png`
- `assets/preserve-drawings-setting.png`

Prefer regenerating from the live app before promoting them again.

## Regenerating marketing PNGs

Source HTML lives in `assets/store-screenshots/scene*.html` (designed at 1920×1080). Export at 2880×1530 for README / website / Store listings.

Optional helper: `scripts/export-store-screenshots.mjs` (requires Playwright Chromium). Or open each HTML in Chrome at 1920×1080 and save a viewport screenshot, then scale to 2880×1530.

After changing tools / shortcuts / panel copy in those HTML files, re-export and overwrite the PNG paths above.
Every screenshot has a single copy: English shots live in `docs/assets/` (shared by README and the website), Chinese shots in `assets/`.

## New Social Concept Visual

`assets/social/click-through-social-square.png` was generated as a supporting illustration, not a literal MarkerOn screenshot. Captions should label it as an illustration if the context could confuse it with the real interface. Pair it with the real click-through GIF in launch galleries.

Generation prompt:

> Create a premium square software-product illustration on a deep navy background: a modern dashboard window with a coral circle and arrow, yellow highlight, blue rectangle, and laser glow on an annotation layer; show a cursor clicking a button underneath while every annotation remains visible. No text, logo, brand imitation, people, watermark, or pseudo-text.

## Gallery Order

For Product Hunt, directories, and press kits:

1. Real click-through GIF or MP4.
2. Real desktop annotation screenshot.
3. Real shortcut reference.
4. Real settings / tools screenshot.
5. Concept visual as a supporting cover, not as proof of UI.

This order makes the distinctive behavior visible before feature lists.

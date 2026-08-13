<div align="center">
  <img src=".github/assets/icon.png" width="80" height="80" alt="MarkerOn icon" />
  <h1>MarkerOn</h1>
  <p>
    <a href="./README_zh.md">中文</a>
  </p>
  <p>
    <a href="https://github.com/ifer47/markeron/actions/workflows/ci.yml"><img src="https://github.com/ifer47/markeron/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
    <a href="https://github.com/ifer47/markeron/releases/latest"><img src="https://img.shields.io/github/v/tag/ifer47/markeron?label=latest&color=blue" alt="Release" /></a>
    <a href="https://github.com/ifer47/markeron/releases"><img src="https://img.shields.io/github/downloads/ifer47/markeron/total" alt="Downloads" /></a>
    <a href="./LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="License" /></a>
    <a href="https://github.com/ifer47/markeron/stargazers"><img src="https://img.shields.io/github/stars/ifer47/markeron?style=social" alt="Stars" /></a>
    <a href="https://markeron.cn/"><img src="https://img.shields.io/badge/website-docs-0ea5e9" alt="Website" /></a>
    <a href="https://www.bilibili.com/video/BV17ygy67ETV"><img src="https://img.shields.io/badge/Bilibili-tutorial(CN)-fb7299" alt="Bilibili tutorial (Chinese)" /></a>
    <a href="https://afdian.com/a/markeron"><img src="https://img.shields.io/badge/爱发电-赞助-946ce6" alt="Sponsor on 爱发电" /></a>
  </p>
  <p><strong>Lightweight screen annotation tool</strong> (~1.5 MB) — press a hotkey (<strong>keyboard-first</strong>) to instantly draw, highlight, and annotate anywhere on your desktop. Built for demos, teaching, meetings, and screen recording.<strong>Free &amp; open source.</strong> If MarkerOn saves you time in demos, teaching, or meetings, <a href="https://afdian.com/a/markeron"><strong>sponsor on Afdian</strong></a> — every contribution helps keep the project maintained.</p>
</div>


<p align="center">
  <img src="assets/MarkerOn_en.png" width="720" alt="MarkerOn" />
</p>

**Contents:** [Download](#download) · [Quick Start](#quick-start) · [Features](#features) · [Shortcuts](#keyboard-shortcuts) · [Feedback](#feedback--issues) · [Development](#development)

## Download

<p>
  <a href="https://github.com/ifer47/markeron/releases/latest"><img src="https://img.shields.io/badge/Windows-x64-0078D4?logo=windows&logoColor=white" alt="Windows" /></a>
  <a href="https://github.com/ifer47/markeron/releases/latest"><img src="https://img.shields.io/badge/macOS-ARM64-000000?logo=apple&logoColor=white" alt="macOS ARM64" /></a>
  <a href="https://github.com/ifer47/markeron/releases/latest"><img src="https://img.shields.io/badge/macOS-x64-666666?logo=apple&logoColor=white" alt="macOS x64" /></a>
  <a href="https://get.microsoft.com/installer/download/9n6623x973jv?referrer=appbadge"><img src="https://img.shields.io/badge/Microsoft_Store-MarkerOn-0078D4?logo=microsoftstore&logoColor=white" alt="Microsoft Store" /></a>
</p>

**[Download Latest Release](https://github.com/ifer47/markeron/releases/latest)** — pick the installer for your platform from the assets list. Windows also ships a **portable zip** (`*_x64_portable.zip`): extract and run — config stays under `data\` next to the exe (no AppData).

Windows users can also install the Microsoft Store version with WinGet:

```powershell
winget install --id 9N6623X973JV --source msstore
```

> Official downloads are GitHub Releases and Microsoft Store. Third-party mirrors may be outdated or repackaged.

## Quick Start

1. **Install and launch** — MarkerOn runs in the **system tray**; no window appears.
2. **Enter annotation mode** — press <kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>D</kbd> (<kbd>Command</kbd> + <kbd>Shift</kbd> + <kbd>D</kbd> on macOS).
3. **Draw, then click through** — use number keys and <kbd>V</kbd> (Select) for tools; press <kbd>X</kbd> to interact with apps below while keeping annotations visible; press <kbd>Esc</kbd> to exit.

> **New here?** Press <kbd>Space</kbd> for the toolbar. See [Keyboard Shortcuts](#keyboard-shortcuts) for the full list.

## Features

- **Lightweight & fast** — ~1.5 MB installer (Rust + Canvas), minimal memory; runs quietly in the system tray (no extra daemons or telemetry)
- **Annotate anywhere** — draw over any app, including the taskbar
- **11 tools** — select, pen, highlighter, laser, arrow, rectangle, ellipse, line, eraser, text, stamp
- **Marquee batch edit** — press <kbd>V</kbd> for Select: box/click select, group drag, <kbd>Delete</kbd> to remove
- **Flexible toolbar** — press <kbd>Space</kbd> to toggle, or enable **always-on** in Settings; compact panel with **Expand** for full options, undo, copy, and whiteboard actions in-panel; **independent floating window** with drawing / click-through toggles
- **Click-through mode** — interact with apps below while staying in the session; toggle via toolbar buttons, <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>X</kbd> (global), or <kbd>X</kbd> while drawing; disabled in whiteboard mode
- **Full keyboard control** — every action has a shortcut, no menus needed
- **Preserve drawings** — enable **Keep after exit** under Whiteboard & content to resume on re-enter
- **Whiteboard mode** — set default entry to whiteboard, or press <kbd>W</kbd> to toggle; content rules are in **Whiteboard & content** settings
- **Whiteboard copy** — copy the whiteboard as an image with <kbd>Ctrl</kbd>/<kbd>Command</kbd> + <kbd>C</kbd>

<table>
<tr>
<td width="50%">
<img src="assets/annotation-tools.png" alt="MarkerOn annotation tools" />
</td>
<td width="50%">
<img src="assets/settings-panel.png" alt="Settings panel" />
</td>
</tr>
</table>

## Keyboard Shortcuts

On **macOS**, use <kbd>Command</kbd> (⌘) in place of <kbd>Ctrl</kbd>, and <kbd>Option</kbd> (⌥) in place of <kbd>Alt</kbd>.

### Global Shortcuts

| Action | Windows | macOS |
| :--- | :--- | :--- |
| Toggle annotation mode | <kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>D</kbd> | <kbd>Command</kbd> + <kbd>Shift</kbd> + <kbd>D</kbd> |
| Clear all annotations | <kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>C</kbd> | <kbd>Command</kbd> + <kbd>Shift</kbd> + <kbd>C</kbd> |
| Toggle click-through mode | <kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>X</kbd> | <kbd>Command</kbd> + <kbd>Shift</kbd> + <kbd>X</kbd> |

### Tool Switching

| Key | Tool | Key | Tool |
| :---: | :--- | :---: | :--- |
| <kbd>V</kbd> | Select | <kbd>5</kbd> | Ellipse |
| <kbd>1</kbd> | Pen | <kbd>6</kbd> | Line |
| <kbd>2</kbd> | Highlighter | <kbd>7</kbd> | Eraser |
| <kbd>3</kbd> | Arrow | <kbd>8</kbd> | Laser |
| <kbd>4</kbd> | Rectangle | <kbd>T</kbd> | Text |
|  |  | <kbd>N</kbd> | Stamp |

### Common Actions

| Action | Windows | macOS |
| :--- | :--- | :--- |
| Toolbar (toggle) | <kbd>Space</kbd> | <kbd>Space</kbd> |
| Delete selection | <kbd>Delete</kbd> / <kbd>Backspace</kbd> | <kbd>Delete</kbd> / <kbd>Backspace</kbd> |
| Click-through (while drawing) | <kbd>X</kbd> | <kbd>X</kbd> |
| Cycle eraser mode (stroke / object) | <kbd>7</kbd> again while eraser selected | <kbd>7</kbd> again while eraser selected |
| Toolbar always-on / layout | Settings → General | Settings → General |
| Copy screen / whiteboard | <kbd>Ctrl</kbd> + <kbd>C</kbd> | <kbd>Command</kbd> + <kbd>C</kbd> |
| Whiteboard toggle | <kbd>W</kbd> | <kbd>W</kbd> |
| Undo / Redo | <kbd>Ctrl</kbd> + <kbd>Z</kbd> / <kbd>Y</kbd> | <kbd>Command</kbd> + <kbd>Z</kbd> / <kbd>Y</kbd> |
| Stroke width | <kbd>Ctrl</kbd> + Scroll | <kbd>Command</kbd> + Scroll (pen, laser & shapes share; highlighter/eraser/text separate) |
| Exit | <kbd>Esc</kbd> | <kbd>Esc</kbd> |

<details>
<summary><strong>All shortcuts</strong></summary>

#### Drawing with Modifier Keys

| Draws | Windows | macOS |
| :--- | :--- | :--- |
| Current tool (default: pen) | Drag | Drag |
| Line | <kbd>Alt</kbd> + Drag | <kbd>Option</kbd> + Drag |
| Rectangle | <kbd>Ctrl</kbd> + Drag | <kbd>Command</kbd> + Drag |
| Square | <kbd>Ctrl</kbd> + <kbd>Alt</kbd> + Drag | <kbd>Command</kbd> + <kbd>Option</kbd> + Drag |
| Ellipse | <kbd>Shift</kbd> + Drag | <kbd>Shift</kbd> + Drag |
| Circle | <kbd>Shift</kbd> + <kbd>Alt</kbd> + Drag | <kbd>Shift</kbd> + <kbd>Option</kbd> + Drag |
| Arrow | <kbd>Ctrl</kbd> + <kbd>Shift</kbd> + Drag | <kbd>Command</kbd> + <kbd>Shift</kbd> + Drag |

#### Edit & Move

| Action | Effect |
| :--- | :--- |
| Select tool (<kbd>V</kbd>) | Marquee or click to select; drag selection as a group; <kbd>Delete</kbd> / <kbd>Backspace</kbd> to remove; <kbd>Esc</kbd> clears selection |
| Element dragging | In General settings: **Off** / **Hover drag** / **Hold Ctrl to drag** |
| Double-click existing text | Re-enter **edit mode** for that text |
| Double-click empty area in <kbd>T</kbd> mode | Create a new text input at cursor position |

#### Color Switching

| Action | Effect |
| :--- | :--- |
| <kbd>Q</kbd> / <kbd>E</kbd> | Previous / Next color |
| Right-click | Hold to erase; release restores the previous tool |

#### Other

| Action | Windows | macOS |
| :--- | :--- | :--- |
| Redo (alt) | <kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>Z</kbd> | <kbd>Command</kbd> + <kbd>Shift</kbd> + <kbd>Z</kbd> |

</details>

<details>
<summary><strong>Advanced settings</strong></summary>

In **Settings → General** (toolbar display, click-through, and stroke width — see [Features](#features)):

- **Whiteboard & content** — default entry (screen / whiteboard), keep after exit, keep on <kbd>W</kbd> toggle
- **Element dragging** — off, hover to drag, or hold <kbd>Ctrl</kbd>/<kbd>Command</kbd> to drag (disabled while eraser is selected)
- **Eraser mode** — stroke (local erase) or object (delete whole elements); with eraser selected, press <kbd>7</kbd> again (or click the toolbar eraser again) to switch
- **Angle snap step** — snap interval for straight lines drawn with <kbd>Alt</kbd>
- **Auto start** — launch the app automatically at system startup

</details>

## Feedback & Issues

- **Bug reports:** Settings → **Diagnostics** → export a report, then open a [GitHub Issue](https://github.com/ifer47/markeron/issues)
- **Privacy:** [PRIVACY.md](./PRIVACY.md)

## Development

See [CONTRIBUTING.md](./CONTRIBUTING.md) for prerequisites, setup, and the full workflow. **Stack:** Tauri v2 · Vue 3 · Vite · TypeScript · Canvas API

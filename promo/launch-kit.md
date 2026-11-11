# MarkerOn Promotion Kit

Last updated: 2026-07-22

Use this as the source of truth for public posts, replies, bios, and listing forms. Keep evergreen posts version-neutral; only add a version number when the release is already public.

## Verified Fact Sheet

- Product: `MarkerOn`
- Category: lightweight desktop screen annotation
- Platforms: Windows and macOS
- License: MIT; free and open source
- Privacy: local-first, account-free, no telemetry or cloud dependency
- Installer: approximately 1.5 MB
- Core workflow: hotkey to draw, `X` for click-through, `W` for whiteboard, `Esc` to exit
- Tools: pen, highlighter, laser, arrow, rectangle, ellipse, line, eraser, text, stamp
- Official website: https://markeron.cn/
- Source: https://github.com/ifer47/markeron
- Download: https://github.com/ifer47/markeron/releases/latest
- Microsoft Store: https://apps.microsoft.com/detail/9n6623x973jv
- WinGet: `winget install --id 9N6623X973JV --source msstore`

Do not claim Linux support, multi-monitor support, stylus pressure support, or a specific latest version unless verified at posting time.

## Current Release Post — v2.2.0

Published: 2026-07-22

### English

MarkerOn v2.2.0 is out with an official portable Windows build.

Download the zip, extract it, and run — no installer required. Settings stay in `data\` next to the executable instead of AppData, so it works well in a self-contained tools folder or on a USB drive.

MarkerOn is a ~1.5 MB open-source screen annotation app with click-through mode, whiteboard mode, and keyboard-first controls for Windows and macOS.

https://github.com/ifer47/markeron/releases/tag/v2.2.0

### 中文

MarkerOn v2.2.0 已发布，这次新增了官方 Windows 绿色免安装版。

下载 zip、解压、直接运行即可；配置保存在程序旁边的 `data\` 目录，不写 AppData，适合放进自己的工具目录或 U 盘随身携带。

MarkerOn 是一款约 1.5 MB 的开源屏幕标注工具，支持穿透模式、白板模式和全键盘操作，可用于讲课、演示、会议与录屏。

https://github.com/ifer47/markeron/releases/tag/v2.2.0

## Positioning

MarkerOn is a lightweight open-source screen annotation tool for demos, teaching, meetings, and recordings. It starts from a hotkey, draws over any app, and includes click-through mode so annotations stay visible while you interact with the apps underneath.

## One-Liners

- Lightweight open-source screen annotation with click-through mode.
- Draw anywhere on your desktop, then keep annotations visible while you click through to the app below.
- A tiny keyboard-first alternative for people who want fast annotation without a heavy presentation suite.
- Screen annotation, whiteboard mode, and click-through drawing in a 1.5 MB Tauri app.

## Short Description

MarkerOn is a small, open-source desktop app for screen annotation. Press a hotkey, draw over any app, switch to click-through mode when you need to operate the screen below, and jump back to drawing whenever the explanation needs another mark. It supports 10 annotation tools, whiteboard mode, keyboard shortcuts, and official builds for Windows and macOS.

## Long Description

MarkerOn is a lightweight screen annotation tool built with Tauri v2, Rust, Vue, and Canvas. It is designed for people who explain things live: teachers, trainers, meeting hosts, demo presenters, tutorial makers, and developers.

The app runs silently in the system tray. Press Ctrl+Shift+D to enter annotation mode, draw over any desktop app, use number keys to switch tools, and press X or Ctrl+Shift+X to switch between drawing and click-through mode. In click-through mode, annotations remain visible, but your mouse clicks, scrolling, and typing go to the apps underneath.

MarkerOn also includes a whiteboard mode, undo/redo, text, arrows, shapes, eraser modes, angle snapping, copy-to-clipboard, expandable toolbar panel, and content preservation between sessions.

Official downloads:

- GitHub Releases: https://github.com/ifer47/markeron/releases/latest
- Website: https://markeron.cn/
- Microsoft Store: https://apps.microsoft.com/detail/9n6623x973jv
- Source: https://github.com/ifer47/markeron

## Product Hunt Draft

### Name

MarkerOn

### Tagline

Lightweight screen annotation with click-through mode

### Topics

Productivity, Developer Tools, Education, Open Source, Meetings

### Description

MarkerOn is a tiny open-source desktop app for drawing over your screen during demos, teaching, meetings, and recordings. Keep annotations visible while mouse events pass to the apps underneath, then switch back to drawing instantly.

### Maker Comment

Hi Product Hunt! I built MarkerOn because I wanted a fast screen annotation tool that did not feel like a heavy presentation suite.

It runs in the tray, wakes up from a hotkey, and lets you draw over any desktop app. Click-through mode keeps annotations visible while you interact with the app below, then lets you switch back to drawing without leaving the session.

Highlights:

- around 1.5 MB installer
- open source and local-first
- 10 annotation tools, including a laser pointer and numbered stamps
- click-through mode
- whiteboard mode
- full keyboard control
- Windows and macOS builds
- Microsoft Store download for Windows

I'd love feedback from teachers, trainers, people who record tutorials, and anyone who uses tools like ZoomIt or Epic Pen.

## Show HN Draft

Title:

Show HN: MarkerOn – open-source screen annotation with click-through

Post:

Hi HN, I built MarkerOn, a lightweight open-source desktop app for screen annotation.

It is meant for demos, teaching, meetings, and recordings: press a hotkey, draw over any app, and switch tools from the keyboard. Click-through mode lets annotations remain visible while mouse events pass to the apps underneath. That makes it useful in Epic Pen / ZoomIt-style workflows while keeping the app small, local-first, and open source.

Tech stack: Tauri v2, Rust, Vue 3, TypeScript, Canvas.

Downloads: https://github.com/ifer47/markeron/releases/latest
Source: https://github.com/ifer47/markeron

I'd especially appreciate feedback on multi-monitor behavior, macOS tablet/stylus input, and whether the keyboard-first workflow feels natural.

## V2EX Draft

标题：

MarkerOn：约 1.5 MB 的开源屏幕标注工具，支持穿透模式

正文：

大家好，我做了一个轻量级屏幕标注工具 MarkerOn。

MarkerOn 是一个开源、轻量、快捷键优先的桌面标注工具。按快捷键进入标注，可以在任意应用上画线、箭头、矩形、文字、序号，也支持白板模式。

我自己最常用的是「穿透模式」：标注内容可以继续留在屏幕上，同时鼠标点击、滚动和输入会传递给下面的应用。适合讲课、演示、录屏、远程会议里那种「边标注边操作软件」的场景。

特点：

- 安装包约 1.5 MB
- 开源，本地使用，不需要账号
- 支持画笔、荧光笔、激光笔、箭头、矩形、椭圆、直线、橡皮擦、文字、序号
- 支持穿透模式和白板模式
- 工具栏可常驻，也可按 Space 呼出
- 支持 Windows / macOS
- Windows 可从 Microsoft Store 安装

GitHub: https://github.com/ifer47/markeron
下载: https://github.com/ifer47/markeron/releases/latest

欢迎反馈多屏、macOS 数位板等实际使用问题。

## X / Twitter Drafts

1.

MarkerOn is a tiny open-source screen annotation app.

It is a tiny open-source screen annotation app with click-through mode:

- draw over any desktop app
- keep annotations visible
- click/scroll/type in the app underneath
- switch back to drawing instantly

https://github.com/ifer47/markeron

2.

I built MarkerOn because I wanted screen annotation to feel instant:

Ctrl+Shift+D -> draw
D -> solid / dashed / dotted
X -> click-through
W -> whiteboard
Esc -> done

Open source, local-first, around 1.5 MB.

https://github.com/ifer47/markeron

3.

Teachers, demo presenters, and tutorial makers: I would love feedback on MarkerOn.

It is a lightweight screen annotation tool with click-through mode, whiteboard mode, and full keyboard control.

https://github.com/ifer47/markeron/releases/latest

## Dev.to / Medium Draft

Title:

Building a 1.5 MB Screen Annotation Tool with Tauri, Rust, Vue, and Canvas

Outline:

1. Why screen annotation tools matter during live demos.
2. Why MarkerOn is keyboard-first.
3. The overlay problem: transparent always-on-top windows.
4. Click-through mode: drawing window, toolbar window, and event bridging.
5. Rendering strategy: canvas, history, preview, and cached completed drawings.
6. Platform notes: Windows, macOS, and multi-monitor edge cases.
7. What I would like feedback on.

Closing CTA:

If you teach, record tutorials, run demos, or use ZoomIt / Epic Pen-style tools, I would love your feedback on MarkerOn.

## Chinese Technical Article Draft

标题：

我用 Tauri 做了一个约 1.5 MB 的开源屏幕标注工具：MarkerOn

提纲：

1. 为什么要做屏幕标注工具，而不是继续用截图/画图/会议白板。
2. MarkerOn 的核心体验：快捷键进入、键盘切工具、轻量常驻托盘。
3. 穿透模式：标注层保持可见，鼠标事件传给下层窗口。
4. Tauri 多窗口设计：透明 overlay + 独立工具栏窗口。
5. Canvas 绘制和撤销/重做/白板模式。
6. 体积和性能取舍。
7. 当前希望大家帮忙测试的点：多显示器、macOS 数位板。

## Short Video Scripts

### 10 Seconds: Hotkey to Draw

Shot 1: Desktop with a document or browser open.
Text: "Need to explain something live?"
Action: Press Ctrl+Shift+D.
Shot 2: MarkerOn overlay appears; draw arrow and highlight.
Text: "Draw anywhere, instantly."
End card: "MarkerOn - open-source screen annotation"

### 15 Seconds: Click-Through Mode

Shot 1: Draw a circle around a button in an app.
Text: "Keep annotations on screen."
Shot 2: Press X or click pointer button.
Action: Click the underlying app while the annotation remains visible.
Text: "Click through to the app below."
Shot 3: Press X again and add another arrow.
Text: "Switch back to drawing anytime."

### 20 Seconds: Whiteboard Mode

Shot 1: Enter annotation mode.
Shot 2: Press W to switch to whiteboard.
Action: Draw a quick flow diagram with arrow, rectangle, and text.
Shot 3: Press Ctrl+C and paste into chat/doc.
Text: "Whiteboard, copy, continue."

## Screenshot Captions

- "Draw over any app, including the taskbar."
- "Switch between drawing and click-through mode without leaving the session."
- "Use the floating toolbar or keyboard shortcuts."
- "Whiteboard mode for quick explanation and teaching."
- "Local-first, open source, and lightweight."

## Comparison Angles

### MarkerOn vs ZoomIt

MarkerOn focuses on lightweight annotation, whiteboard mode, and click-through drawing. ZoomIt remains excellent for zooming; MarkerOn pairs well with system magnifiers when zoom is needed.

### MarkerOn vs Epic Pen

MarkerOn provides an open-source, local-first alternative with a small installer, keyboard-first controls, and click-through mode for persistent annotations while interacting with apps below.

### MarkerOn vs meeting whiteboards

Meeting whiteboards are tied to a meeting app. MarkerOn works over any desktop app, needs no account, and keeps drawings local (no cloud upload).

## Chinese Social Copy

### 通用短帖

做演示、讲课、录屏时，需要在屏幕上临时圈重点，可以试试 MarkerOn：

- 快捷键一按，直接在任意应用上画
- 按 `X` 开启穿透，标注留着还能继续操作下面的软件
- 按 `W` 切白板，`Esc` 退出
- 约 1.5 MB，免费开源，不要账号，不传云端
- Windows / macOS

官网：https://markeron.cn/
源码：https://github.com/ifer47/markeron

### 小红书 / 即刻

标题：我把「在屏幕上画重点」做成了一个 1.5 MB 的开源小工具

正文：

平时讲课、开会、录教程，经常需要临时圈一下按钮、画个箭头，但又不想先截图再编辑。

MarkerOn 的用法很简单：按 `Ctrl+Shift+D` 直接在桌面上画；按 `D` 可在实线 / 虚线 / 点线间切换；按 `X` 后标注仍然可见，但鼠标可以继续点下面的软件；按 `W` 变白板；按 `Esc` 退出。

它是免费开源的，不需要账号，也没有云端上传。Windows 和 macOS 都能用。欢迎拿真实的教学 / 演示场景来试，也欢迎在 GitHub 提需求。

### Bilibili / 抖音 / 视频号标题

- 这个 1.5 MB 的开源工具，让整个桌面都能直接画
- 讲课录屏神器：标注不消失，还能继续点下面的软件
- 免费开源的屏幕画笔：快捷键一按就能标重点

### 知乎回答开头

如果你的需求是「演示过程中直接在任意软件上画重点」，而不是截图后再编辑，我更建议用专门的桌面标注层。MarkerOn 是我做的免费开源方案：约 1.5 MB，支持 Windows / macOS，快捷键进入后可用画笔、荧光笔、激光笔、箭头、形状、文字和序号，并可用 `D` 切换实线 / 虚线 / 点线；切到穿透模式后，标注保持可见，同时还能继续操作下层软件。

回答后半段应真实比较 ZoomIt、Epic Pen、gInk / ppInk 的差异，不要伪装成无利益关系的第三方推荐；明确写「作者自荐」。

## Community-Specific Reddit Drafts

Do not paste the same post into many subreddits. Change the angle and participate in comments.

### r/opensource

Title: I built an open-source, local-first screen annotation app for Windows and macOS

Body:

MarkerOn is a small MIT-licensed app for drawing over any desktop application during demos, teaching, meetings, and recordings.

The interaction I cared about most was click-through: annotations stay visible while the mouse, scrolling, and typing go to the app underneath. You can switch back to drawing without ending the session.

It is account-free, has no cloud dependency, and the installer is around 1.5 MB. The stack is Tauri v2, Rust, Vue 3, TypeScript, and Canvas.

Website: https://markeron.cn/
Source: https://github.com/ifer47/markeron

I would value feedback on the project structure, packaging, and the keyboard-first workflow.

### r/teachers or teaching community

Title: A free, open-source screen marker for live teaching (Windows and macOS)

Body:

I made MarkerOn for the moments when you need to circle a control, highlight a sentence, or sketch a quick diagram without leaving the app you are teaching from.

Press a hotkey to draw anywhere, press `X` to keep the marks visible while you interact with the app underneath, or press `W` for a clean whiteboard. It runs locally, requires no account, and is free/open source.

I am the developer, so this is a self-promo post. I would especially appreciate feedback from teachers using touchscreens, styluses, or multiple displays.

## Directory Metadata

### 80-character tagline

Open-source screen annotation with click-through mode for Windows and macOS.

### 160-character description

Draw over any desktop app, keep annotations visible while clicking through, or switch to a whiteboard. Lightweight, local-first, and open source.

### Categories

- Productivity
- Education
- Presentation
- Screen annotation
- Whiteboard
- Developer tools
- Open source

### Keywords

`screen annotation`, `desktop drawing`, `screen marker`, `click-through`, `whiteboard`, `presentation`, `teaching`, `screen recording`, `Windows`, `macOS`, `Tauri`

## Newsletter / Editor Outreach

Subject: Open-source screen annotation app for teaching and demos

Hi {{name}},

I am the developer of MarkerOn, a lightweight open-source screen annotation app for Windows and macOS. It is built for live explanation: press a hotkey to draw over any app, then use click-through mode to keep marks visible while continuing to operate the app underneath.

Why it may fit {{publication}}:

- around 1.5 MB and local-first
- MIT licensed, no account or cloud dependency
- useful for teachers, trainers, tutorial makers, and demo presenters
- Windows and macOS builds, plus Microsoft Store availability

Website: https://markeron.cn/
Source and downloads: https://github.com/ifer47/markeron

If useful, I can provide screenshots, a short demo clip, or technical details about the Tauri/Rust/Vue implementation. No expectation of coverage; I thought it matched your audience.

Best,
ifer47

## Comment Replies

### Is it safe / does it upload my screen?

MarkerOn runs locally and does not require an account, telemetry, or cloud upload. The source is available under MIT, and official downloads are linked from https://markeron.cn/.

### Why not ZoomIt?

ZoomIt is excellent, especially for zooming. MarkerOn focuses on cross-platform screen drawing, whiteboard mode, and click-through annotations that stay visible while you keep using the app below.

### Why not Epic Pen?

Epic Pen is a polished commercial option. MarkerOn is a small, open-source, local-first alternative with keyboard-first controls. Which is better depends on whether you value the commercial feature set or an inspectable open-source tool.

### Linux?

MarkerOn currently supports Windows and macOS. Do not promise a Linux date; link interested users to the issue tracker.

## UTM Convention

Use the website as the public link when the channel allows it. Add UTMs only where they do not look noisy:

`https://markeron.cn/?utm_source={{channel}}&utm_medium={{format}}&utm_campaign=evergreen_2026`

Examples:

- Product Hunt: `utm_source=producthunt&utm_medium=launch`
- Reddit: `utm_source=reddit&utm_medium=community`
- Bilibili: `utm_source=bilibili&utm_medium=video`
- 知乎: `utm_source=zhihu&utm_medium=answer`
- Newsletter outreach: `utm_source={{publication}}&utm_medium=editorial`

Never add UTMs to the GitHub source URL in technical communities that prefer direct repository links.

## Publishing Rules

1. Disclose that the author is the maker.
2. Never buy votes, stars, reviews, or fake comments.
3. Do not mass-post identical copy; tailor the use case to each community.
4. Lead with a demo or useful explanation, then link once.
5. Repost only for a meaningful release or a new tutorial, not for minor fixes.
6. Reply to every substantive question within the first 24 hours.

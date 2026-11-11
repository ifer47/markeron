# Building a 1.5 MB Screen Annotation Tool with Tauri, Rust, Vue, and Canvas

> Maker disclosure: I develop MarkerOn. This article introduces the project and explains the engineering tradeoffs behind its transparent overlay, click-through mode, and multi-window design.

During a live demo, class, meeting, or recording, I often need to circle a control or draw an arrow without leaving the application I am explaining. The usual screenshot-edit-paste loop breaks the flow.

The interaction I wanted was simpler: press a hotkey, turn the desktop into a canvas, explain the point, and press Escape when done.

That became [MarkerOn](https://markeron.cn/), an MIT-licensed screen annotation app built with Tauri v2, Rust, Vue 3, TypeScript, and Canvas. It supports Windows and macOS, uses an installer of roughly 1.5 MB, requires no account, and has no cloud dependency.

Source: https://github.com/ifer47/markeron

## Start with a hotkey, not a window

MarkerOn waits in the system tray instead of opening a conventional main window. `Ctrl+Shift+D` on Windows or `Command+Shift+D` on macOS opens the transparent annotation layer.

Number keys select pen, highlighter, arrow, rectangle, ellipse, line, eraser, and laser. `T` selects text, `N` selects stamp (press again to toggle digits/letters), `Q/E` cycles colors, `D` cycles solid / dashed / dotted, `Ctrl/Command + wheel` changes width, and `Space` reveals the toolbar.

Keyboard-first controls are not a novelty here. During a presentation, moving the pointer away from the subject to search through a toolbar makes the audience lose the thread. The shortcuts keep the interface out of the way until it is needed.

## The transparent overlay is the product

At the center is a transparent, borderless, always-on-top native window. Tauri manages the application and window lifecycle. Rust handles global shortcuts, the tray, capture, window state, and platform differences. Vue and Canvas handle the drawing surface and settings UI.

The overlay has competing responsibilities:

1. Stay above the desktop so marks remain visible.
2. Receive pointer and keyboard input while drawing.
3. Cooperate with the taskbar, a separate toolbar window, and screen capture.
4. Behave correctly under different Windows and macOS windowing rules.

MarkerOn therefore does not put everything in one WebView. The drawing overlay and floating toolbar are separate windows. Commands and events synchronize the selected tool, colors, widths, history, whiteboard state, and click-through state.

## Click-through mode keeps the explanation alive

Click-through is the feature that most clearly defines MarkerOn.

Imagine circling a button on a webpage. In many annotation workflows, you must leave drawing mode before clicking the button, and the mark disappears with the overlay. In MarkerOn, pressing `X` keeps every mark visible while clicks, scrolling, and typing go to the application underneath. Press `X` again to resume drawing without ending the session.

This is more than setting CSS `pointer-events: none`. The drawing surface is a native desktop window, so the backend must toggle whether the window ignores cursor events. Meanwhile, the independent toolbar must remain interactive and above the ink. Focus changes must not accidentally switch the overlay state.

The implementation therefore treats several concerns separately: whether the overlay receives input, whether the toolbar is raised, whether the pointer is over the toolbar, and whether whiteboard mode permits click-through. Whiteboard mode has no underlying application to interact with, so click-through is disabled there.

## Canvas history, previews, and laser ink are different problems

Canvas can render all the drawing tools, but their interaction models are not the same.

Freehand strokes need point sampling and smoothing. Shapes need a preview while dragging and should enter history only when committed. Text needs an input lifecycle and later editing. The eraser can remove local stroke segments or complete objects. Undo and redo cannot be reduced to one final bitmap if existing elements should remain editable.

The laser pointer is different again. It is temporary ink with a time-based fade, not a permanent drawing action. MarkerOn renders an Excalidraw-style variable-width outline and lets older positions disappear. The result guides attention without leaving more content to erase.

## Capturing the screen without capturing the toolbar

When the user copies an annotated screen with `Ctrl/Command+C`, the floating toolbar should not appear in the captured image.

MarkerOn temporarily excludes or hides the toolbar during capture, then restores it. Windows can use system-level display-affinity behavior; macOS needs its own native-window handling. This sounds minor, but desktop overlay tools accumulate details that ordinary web applications never encounter.

## Small should describe the workflow, not only the installer

Tauri keeps the package compact by using the system WebView instead of bundling an entire browser engine. Rust provides native behavior; the frontend focuses on drawing and configuration.

For this product, “lightweight” also means no sign-in flow, no cloud service, and no screen upload. That matters when the app is used in classrooms, internal product demos, or recordings that may contain private information.

MarkerOn v2.2.0 also adds an official portable Windows build. Extract the zip and run it directly; configuration stays in a `data\` directory beside the executable instead of AppData.

## The difficult hardware combinations remain

The first overlay is easier than the long tail of real environments: multiple displays, mixed DPI scaling, graphics tablets, touchscreens, pens, macOS window levels, and unusual fullscreen video applications.

Those cases are still being improved. “Windows and macOS support” should not be read as “every hardware combination is already perfect.” The most useful reports include the OS version, display count and scaling, input device, affected application, and the shortest reproducible steps.

MarkerOn can export a diagnostic report from Settings, and issues are welcome on GitHub.

## Try it

- Website: https://markeron.cn/
- Source: https://github.com/ifer47/markeron
- Latest release: https://github.com/ifer47/markeron/releases/latest
- Microsoft Store / WinGet: `winget install --id 9N6623X973JV --source msstore`
- Scoop: `scoop bucket add extras && scoop install markeron`

If you teach, record tutorials, or run live product demos, I would value feedback from a real session. If you work on Tauri, Canvas, or cross-platform desktop windows, I would also enjoy comparing implementation notes.


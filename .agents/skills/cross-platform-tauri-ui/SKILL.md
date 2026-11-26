---
name: cross-platform-tauri-ui
description: >-
  Cross-platform UI styling for MarkerOn Tauri app (macOS WKWebView vs Windows
  WebView2). Use when styling Vue/CSS, fixing Mac/Windows visual differences,
  working on settings window, overlay panels, or Tailwind opacity issues on WebKit.
paths:
  - "src/**/*.vue"
  - "src/**/*.css"
---

# Cross-Platform Tauri UI (MarkerOn)

## Why Mac and Windows look different

### 1. Different web engines (main cause)

| Platform | Engine | Used by |
|----------|--------|---------|
| macOS | WKWebView (WebKit) | Tauri WRY |
| Windows | WebView2 (Chromium) | Tauri WRY |

Same Tailwind class can produce **different pixels**. This is not a "Mac bug" in app logic — it is **compositing / alpha blending** behavior in WebKit vs Chromium.

### 2. Tailwind opacity modifiers are the trigger

Tailwind v4 generates classes like `text-white/45` → `color: rgb(255 255 255 / 45%)`.

On macOS WebKit these often fail in predictable ways:

- **Borders** (`border-white/5`, `/8`): render as harsh white outlines
- **Text** (`text-white/20`–`/70`): render paler than intended; low contrast on `#1e1e20`
- **Backgrounds** (`bg-white/4`, `/10`): nearly transparent; active states disappear
- **Semantic colors with alpha** (`text-green-400/70`, `bg-accent/30`): hue/saturation lost; green looks grey

**Safe:** solid colors — `text-white`, `text-accent`, `bg-[#1e1e20]`, hex/rgb in inline styles.

### 3. Transparent overlay windows (macOS-only extra issues)

The drawing overlay is a transparent Tauri window. WKWebView additionally needs:

- `overlay-panel-surface` (isolation, backface-visibility, contain:paint)
- Explicit panel background on `.overlay-panel` (not relying on semi-transparent Tailwind bg)
- Tauri: `set_background_color` for overlay; settings window uses `macos.rs` dark background + transparent title bar
- Do **not** call Objective-C on WryWebView inner handle (crashes)

---

## Project convention: semantic rgba classes

All cross-platform UI colors live in **`src/style.css`** as named classes with **explicit `rgba()`**.

### Settings window

| Class | Purpose |
|-------|---------|
| `settings-text-brand/title/heading/label/value/muted/subtle/faint/dim/footer/body` | Typography |
| `settings-text-accent`, `settings-text-accent-link` | Links, accent text |
| `settings-status-success` | Green "up to date" |
| `settings-msg-success`, `settings-msg-error` | Toast messages |
| `settings-nav-item`, `settings-nav-item--active` | Sidebar tabs |
| `settings-toggle-on`, `settings-toggle-off` | Switches |
| `settings-card`, `settings-card-row`, `settings-card-desc`, `settings-card--active` | Cards |
| `settings-card--popover-host` | Card that hosts a dropdown/tooltip — overrides card `overflow` |
| `settings-btn-accent-outline`, `settings-btn-accent-primary` | About page buttons |
| `settings-row-hover`, `settings-row-hover-strong` | List row hover |
| `settings-locale-item`, `settings-locale-item--active` | Language dropdown |
| `settings-app-icon` | About logo container |
| `settings-progress-track`, `settings-progress-fill` | Update progress |

### Overlay panels (space panel, quick colors)

| Class | Purpose |
|-------|---------|
| `overlay-panel`, `overlay-panel--compact` | Panel shell |
| `overlay-panel-surface` | WebKit corner bleed fix |
| `overlay-text-section/hint/label/body/secondary/separator/caption/key*` | Text |
| `overlay-tool-btn`, `overlay-tool-btn--active` | Tool buttons |
| `overlay-width-btn`, `overlay-width-btn--active`, `overlay-width-line*` | Stroke width |
| `ui-divider-h/v/b`, `ui-kbd`, `ui-select`, `ui-popover`, `ui-segment*` | Shared controls |
| `color-swatch-ring*`, `color-picker-ring`, `color-dot-ring` | Color UI |

All platforms use the same `rgba()` values — do not add Mac-only text opacity overrides.

### Settings cards and popovers (overflow)

`.settings-card` uses `overflow: hidden` in `style.css` so rounded borders clip
cleanly on macOS WebKit. That **clips** any child with `position: absolute` or
`fixed` (dropdowns, tooltips) and sibling cards below can paint over the
overflow.

**Rules:**

1. Any card that contains a dropdown, tooltip, or popover must also use
   `settings-card--popover-host` (`overflow: visible`).
2. While the popover is open, raise the host card above siblings (e.g.
   `relative z-20` when open) so the menu is not covered by the next card.
3. Prefer `Teleport` to `body` for new floating UI if it must survive scroll
   containers (`overflow-y-auto` on tab content) — see `GeneralTab.vue` language
   select for the card-host pattern; Teleport is the more robust default for new
   work.

**Before changing a shared container class** (`.settings-card`, `.overlay-panel`,
scroll wrappers), grep for floating children:

```bash
rg "absolute|fixed|ui-popover|ui-tooltip|Teleport" src/components/settings/
```

**Container CSS checklist** — these on a parent often break popovers; re-test
open state after adding any of them:

| Property | Risk |
|----------|------|
| `overflow: hidden` / `auto` | Clips absolute/fixed descendants |
| `transform` | New stacking context; z-index surprises |
| `contain: paint` | Clips overflow |
| `isolation: isolate` | Stacking context; siblings may cover popover |

**Manual QA after card/style refactors** (both platforms, ~2 min):

- Settings → 常规: language dropdown fully visible, can switch locale
- Settings → 快捷键: info tooltip visible on hover
- Scroll the tab if applicable; popover still usable

---

## Development workflow

### Adding new UI

1. Check if an existing semantic class fits.
2. If not, add one class (or modifier) in `style.css` with `rgba()`.
3. Use the class in Vue — **no** `text-white/XX` or `border-white/XX` in templates.
4. For Help-tab-style scoped CSS, prefer `rgba()` in `<style scoped>` (already done in `SettingsView.vue` help section).

### Fixing Mac-only reports

1. Confirm the component uses Tailwind opacity → migrate to semantic class.
2. If borders: use `ui-divider-*` or `settings-card` patterns.
3. Use explicit `rgba()` at the same values on all platforms — do not add Mac-only opacity bumps.
4. Verify Windows unchanged (rgba values match original Tailwind intent).

### Pre-commit grep

```bash
rg "border-white/|text-white/|bg-white/|from-accent/|to-accent/|bg-accent/|text-accent/|border-accent/|text-green-|bg-emerald-|text-red-.*/|bg-red-.*/" src/components
```

Zero hits in `src/components` is the target for new work.

### Manual test matrix

| Surface | macOS | Windows |
|---------|-------|---------|
| Settings → 常规 | Toggles, **language dropdown open**, labels | Same |
| Settings → 关于 | Green status, nav highlight, card borders | Same |
| Space → settings panel | Text, borders, tool active state | Same |
| Right-click color panel | Caption text, swatch rings | Same |

---

## Anti-patterns

```vue
<!-- BAD: WebKit opacity issues -->
<span class="text-white/45">Label</span>
<div class="border border-white/8 bg-white/4">

<!-- GOOD -->
<span class="settings-text-muted">Label</span>
<div class="settings-card">
```

```vue
<!-- BAD: dropdown inside .settings-card without popover-host -->
<div class="settings-card">
  <div class="relative">
    <div class="absolute ...">...</div>
  </div>
</div>

<!-- GOOD: allow popover to escape card; raise z-index when open -->
<div class="settings-card settings-card--popover-host" :class="{ 'relative z-20': open }">
  ...
</div>
```

```vue
<!-- BAD: status color with alpha -->
<span class="text-green-400/70">Up to date</span>

<!-- GOOD -->
<span class="settings-status-success">Up to date</span>
```

```css
/* GOOD: new semantic token */
.settings-text-new-role {
  color: rgba(255, 255, 255, 0.55);
}
```

---

## Related files

- `src/style.css` — all semantic UI classes
- `src-tauri/src/macos.rs` — settings window background & title bar
- `index.html` — `html.settings` for settings route

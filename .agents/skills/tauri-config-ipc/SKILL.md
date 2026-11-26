---
name: tauri-config-ipc
description: >-
  Extend MarkerOn settings, persisted config, or Tauri IPC commands. Use when
  adding config fields, new invoke commands, settings UI toggles, or changing
  config.json shape.
---

# Tauri Config & IPC (MarkerOn)

## Architecture

```
config.json (disk, camelCase JSON)
    ↔ config.rs (Rust structs, serde rename)
    ↔ commands.rs (#[tauri::command])
    ↔ lib.rs (generate_handler! registration)
    ↔ src/types/app.d.ts (TypeScript types)
    ↔ Vue (invoke get_config / save_*)
```

Config path: app config dir → `config.json` (`config::config_path`), or `{exe_dir}/data/config.json` when a `markeron.portable` marker file is next to the executable.

## Naming convention

| Layer | Convention | Example |
|-------|------------|---------|
| JSON / TS / Vue | camelCase | `enableDragging`, `toggleDrawing` |
| Rust field | snake_case + `#[serde(rename = "...")]` | `enable_dragging` ↔ `enableDragging` |

Always add `#[serde(default)]` (or `default = "fn"`) on **new** fields so old `config.json` files deserialize.

## Checklist: add a general setting

Example: new boolean `fooBar` in settings.

### 1. Rust — `src-tauri/src/config.rs`

```rust
// In GeneralConfig:
#[serde(default, rename = "fooBar")]
pub foo_bar: bool,

// In Default for GeneralConfig:
foo_bar: false,

// In normalized() if value needs clamping/validation
```

### 2. TypeScript — `src/types/app.d.ts`

```typescript
general: {
  // ...
  fooBar: boolean
}
```

### 3. Command — usually no change

General settings use existing `save_general` (`commands.rs`). It saves `GeneralConfig`, emits `config-changed`, persists to disk.

New **top-level** config section → new struct + new `save_*` command.

### 4. Frontend UI

- **Settings window**: `GeneralTab.vue` or `SettingsView.vue`
- Pattern: optimistic `emit('update:…')` → `get_config` → mutate `cfg.general` → `invoke('save_general', { general: cfg.general })`
- **Overlay runtime**: `DrawingOverlay.vue` loads config on mount and listens:

```typescript
await listen<AppConfig>('config-changed', (event) => { /* apply */ })
```

If the overlay must react live, ensure `save_general` emits `config-changed` (already does).

### 5. Tests

- Rust: add/update tests in `config.rs` `#[cfg(test)]` module (defaults, normalization, serde round-trip).
- Frontend: only if new behavior in composables.

## Checklist: add a new IPC command

1. Implement in `src-tauri/src/commands.rs` (or `clipboard.rs` etc.) with `#[tauri::command]`
2. Register in `lib.rs` → `generate_handler![..., commands::your_fn]`
3. Call from Vue: `invoke('your_fn', { arg: value })` — args use camelCase in JS, match command param names
4. Return `AppResult<T>` for errors surfaced to UI

Existing commands:

| Command | Purpose |
|---------|---------|
| `get_config` | Read full `AppConfig` |
| `save_shortcuts` | Global hotkeys; rolls back on invalid/register failure |
| `save_general` | General settings + `config-changed` event |
| `save_locale` | Persist locale + Rust i18n + tray + window title |
| `exit_drawing` | Leave annotation mode |
| `open_url` | Allowed URLs only (GitHub, Microsoft Store) |
| `copy_screen` / `copy_whiteboard` | Clipboard |

## Checklist: add / change shortcuts

Shortcuts are **not** in `GeneralConfig` — they live in `Shortcuts` struct.

Touch:

- `config.rs` — `Shortcuts`, `default_shortcuts()` (macOS uses `Command+`, others `Ctrl+`)
- `commands.rs` — `save_shortcuts` validation
- `shortcuts.rs` — register handlers + unit tests
- `SettingsView.vue` — capture UI
- `src/types/app.d.ts` — `shortcuts` keys
- `README.md` + `README_zh.md` — shortcut tables

## Agent rules

- Never break backward compatibility: new fields need serde defaults.
- Keep TS `AppConfig` in sync with Rust `AppConfig` / nested structs.
- Do not add invoke commands without registering in `generate_handler!`.
- Prefer extending `save_general` over one-command-per-toggle unless logic is distinct (like `save_locale`).

## Related

- Locale strings: `.agents/skills/i18n/SKILL.md`
- Platform window behavior: `src-tauri/src/lib.rs`, `macos.rs`, `win32.rs`

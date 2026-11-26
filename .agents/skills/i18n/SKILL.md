---
name: i18n
description: >-
  MarkerOn two-layer i18n. Use when adding or changing user-visible text,
  editing locale files, tray/window titles, or language switching.
paths:
  - "src/i18n/**"
  - "src-tauri/src/i18n.rs"
  - "src/components/**/*.vue"
---

# Internationalization (MarkerOn)

MarkerOn has **two** string layers. Changing user-visible text may require both.

## 1. Frontend (Vue UI)

| File | Locale |
|------|--------|
| `src/i18n/en.ts` | English |
| `src/i18n/zh-CN.ts` | 简体中文 |

- **Always edit both files** with the same key structure (dot-path nested objects).
- Use `useI18n()` → `t('section.key')` in components; never hardcode UI strings.
- Optional vars: `t('key', { name: value })` replaces `{name}` in the string.
- Register new locales in `src/i18n/index.ts` (`messages` map + `availableLocales`).

### Checklist (new/changed UI copy)

1. Add the key to `en.ts` and `zh-CN.ts`.
2. Replace literal text in Vue with `t('…')`.
3. Add or update a case in `src/i18n/index.test.ts` when the copy is user-facing.

## 2. Backend (Rust — tray, shortcuts, window title)

`src-tauri/src/i18n.rs` holds the `Strings` struct and the `USE_CHINESE` switch
(zh/en only). It is not a dot-path i18n system.

- `i18n::init()` runs on startup from the saved locale.
- `i18n::set_locale()` runs on language change.
- `save_locale` rebuilds the tray menu and updates the settings window title.

Touch `i18n.rs` when adding:

- a tray menu item label;
- a system-facing shortcut description shown in settings;
- the settings window title.

Read `src-tauri/src/i18n.rs` for the current field list; do not rely on a copied list here.

## Locale persistence flow

```text
GeneralTab changeLocale → setLocale (frontend) → invoke('save_locale')
  → config.json + i18n::set_locale + rebuild_tray_menu + set_title
```

## Commit type

Use `i18n:` when the change is primarily translation or copy (feeds 🧹 Improvements in release notes).

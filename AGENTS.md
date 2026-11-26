# Agent Guide — MarkerOn

MarkerOn is a lightweight screen-annotation tool for Windows and macOS (Tauri 2 + Vue 3 + Rust). Only these two platforms are supported; `src-tauri/src/lib.rs` enforces this with `compile_error!`. This file is loaded automatically; detailed rules and workflows live in `.agents/skills/`.

## Quick start

```bash
nvm use 24.15.0  # or: fnm use; Node 24.15.0, npm 11.12.1
npm install
npm run dev      # Tauri + frontend
```

Platform prerequisites (Rust, Windows SDK, Xcode CLT): [CONTRIBUTING.md](./CONTRIBUTING.md).

## Runtime model

Three window roles: `overlay` (drawing surface, created at startup), `toolbar` (tool palette), and `settings` (configuration, help, diagnostics); toolbar and settings are created on demand. Drawing logic lives in `src/composables/` and pure helpers in `src/utils/`; keep geometry, rendering, and interaction rules in pure modules with co-located tests, and let Vue components orchestrate events and state.

## When to read what

| Task | Doc |
|------|-----|
| **Release / version bump / tag** | [.agents/skills/release/SKILL.md](./.agents/skills/release/SKILL.md) |
| **Commit message / czg / hook failures** | [.agents/skills/commit-conventions/SKILL.md](./.agents/skills/commit-conventions/SKILL.md) |
| **Vue/CSS, Mac vs Windows UI** | [.agents/skills/cross-platform-tauri-ui/SKILL.md](./.agents/skills/cross-platform-tauri-ui/SKILL.md) |
| **Translations (en + zh-CN)** | [.agents/skills/i18n/SKILL.md](./.agents/skills/i18n/SKILL.md) |
| **Settings, config.json, IPC commands** | [.agents/skills/tauri-config-ipc/SKILL.md](./.agents/skills/tauri-config-ipc/SKILL.md) |
| **Node / npm version pin** | [CONTRIBUTING.md](./CONTRIBUTING.md) + `package.json` → `engines` |

## Project layout

```
src/                 Vue 3 frontend (overlay, toolbar, settings)
  components/        Vue components
  composables/       Drawing engine (geometry, render, interaction)
  constants/         Tools, colors, widths
  i18n/              en.ts + zh-CN.ts
  utils/             Pure helpers with co-located tests
src-tauri/src/       Rust backend
  lib.rs             App entry, tray, window lifecycle
  overlay.rs         Overlay/toolbar window control
  monitor.rs         Multi-monitor and DPI
  config.rs          Config persistence and migration
  i18n.rs            System-facing strings (tray, window title)
scripts/             Release, packaging, and helper scripts
.github/             CI and release workflows
docs/                GitHub Pages site (marketon.cn)
docs/superpowers/    Historical plans/specs — not current authority
.agents/skills/      Detailed rules and end-to-end workflows
```

## Common commands

| Command | Purpose |
|---------|---------|
| `npm run dev` | Tauri + frontend |
| `npm run dev:fe` | Frontend only (Vite) |
| `npm run build:fe` | Typecheck + Vite build |
| `npm test` | Vitest + `scripts/*.test.mjs` |
| `npm run test:watch` | Vitest watch mode |
| `npm run lint` / `npm run lint:fix` | oxlint |
| `npm run format` / `npm run format:check` | prettier |
| `npm run commit` | Interactive Conventional Commit |
| `npm run release patch` (or `minor` / `major`) | **Only** way to publish a version |

## Pre-merge checks (CI parity)

```bash
npm run check:engines
npm run build:fe
npm test
npm run lint
npm run format:check
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml
cargo build --manifest-path src-tauri/Cargo.toml
```

`npm run release:check` also asserts a clean tree and `master`, then runs engines, build:fe, test, lint, format, and `cargo fmt`. It does **not** run clippy, `cargo test`, or `cargo build`.

## Completion rules

- Match checks to the change: run focused tests for touched code (`npx vitest run <file>`, `cargo test <name>`); docs-only changes need only link checks and command verification.
- Before finishing a code change, run the full pre-merge block. Never claim a check passed unless it ran in this session.
- `npm test` is `vitest run` plus `node --test scripts/*.test.mjs`, not Vitest alone.
- CI matrix: frontend on Ubuntu, Rust on Windows. macOS has no CI job; the release workflow builds it on tags. Verify macOS-specific changes manually and state what was tested.

## Architecture invariants

- **Config is a two-sided contract.** `src/types/app.d.ts` ↔ `src-tauri/src/config.rs`. JSON uses camelCase; Rust struct fields stay snake_case and map via `#[serde(rename)]`/`rename_all`. Additive fields need `#[serde(default)]`; on-disk shape changes bump `CONFIG_VERSION` and add a step in `AppConfig::migrated`. Reads fall back to `config.json.bak` and discover legacy config from NSIS/MSIX/portable roots.
- **New IPC commands need all three parts**: implementation in `commands.rs`, registration in `lib.rs` → `generate_handler!`, and an `invoke` call in Vue. Fallible commands return `AppResult<T>` so errors reach the UI; simple getters may return plain values.
- **Two i18n layers.** Frontend keys must exist in both `src/i18n/en.ts` and `zh-CN.ts`; tray menus, window titles, and other system-facing strings live in `src-tauri/src/i18n.rs`. Never hardcode user-visible copy.
- **Platform branches come in pairs.** Check both the Windows `#[cfg]` branch and the macOS branch; window, cursor, DPI, and shortcut changes need verification on both platforms.
- **Keep external entry points narrow.** `open_url` only accepts the allowlist in `commands.rs`; new telemetry or outbound requests need explicit maintainer approval and a privacy note; certificates, `.pfx` files, and tokens never enter the repo.
- **Do not hand-edit generated files**: `dist/`, `src-tauri/target*/`, `src-tauri/gen/`, `package-lock.json`, `Cargo.lock`; regenerate them with the owning tool (`npm`, `cargo`, or the release script). Release notes are generated by CI.
- **Drawing engine stays testable.** Put geometry, rendering, and interaction rules in pure modules with co-located tests; components only orchestrate.

## Agent defaults

- **Do not** manually bump versions, create tags, or write release notes — use `npm run release patch` (or `minor` / `major`) ([release skill](./.agents/skills/release/SKILL.md)).
- **Do not** use Tailwind opacity classes for borders, text, or backgrounds — use semantic classes in `src/style.css` ([skill](./.agents/skills/cross-platform-tauri-ui/SKILL.md)).
- **Do not** add UI strings in only one locale — sync `en.ts` and `zh-CN.ts`, and update `i18n.rs` for tray/system strings ([skill](./.agents/skills/i18n/SKILL.md)).
- **Do not** break config compatibility — additive fields get serde defaults; shape changes bump `CONFIG_VERSION` and add a `migrated` step ([skill](./.agents/skills/tauri-config-ipc/SKILL.md)).
- **Do not** skip commit hooks (`--no-verify`) unless the user explicitly requests it.
- Only create commits when the user explicitly asks. Do not manually push or tag; a requested release goes through `npm run release` with a level, which commits, tags, and pushes. Never amend, rebase, or force-push unless the user explicitly asks.

## Before finishing

1. User-visible copy synced in both locales (and `i18n.rs` for system strings)?
2. New config fields have serde defaults; an old `config.json` still loads?
3. New IPC commands registered in `generate_handler!`?
4. Windows and macOS considered? Note any macOS path you could not verify.
5. Tests describe behavior and cover failure paths, not implementation details?
6. Diff free of generated files, temp artifacts, screenshots, and unrelated formatting?

## Maintaining this file

This file is the always-on index: keep it short. Detailed rules and workflows belong in `.agents/skills/`, which OpenCode, Cursor, and Codex discover automatically. When a rule is summarized here, the linked skill is the source of truth.

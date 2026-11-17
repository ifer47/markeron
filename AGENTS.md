# Agent Guide — MarkerOn

Index for AI agents and contributors. Prefer these docs over guessing project conventions.

## Quick start

```bash
nvm use          # Node 24.15.0, npm 11.12.1
npm install
npm run dev      # Tauri + frontend
```

Human-oriented setup: [CONTRIBUTING.md](./CONTRIBUTING.md)

## When to read what

| Task | Doc |
|------|-----|
| **Release / version bump / tag** | [.cursor/skills/release/SKILL.md](./.cursor/skills/release/SKILL.md) + [.cursor/rules/release-workflow.mdc](./.cursor/rules/release-workflow.mdc) |
| **Commit message / czg / hook failures** | [.cursor/rules/commit-conventions.mdc](./.cursor/rules/commit-conventions.mdc) |
| **Vue/CSS, Mac vs Windows UI** | [.cursor/skills/cross-platform-tauri-ui/SKILL.md](./.cursor/skills/cross-platform-tauri-ui/SKILL.md) + [.cursor/rules/cross-platform-ui-styles.mdc](./.cursor/rules/cross-platform-ui-styles.mdc) |
| **Translations (en + zh-CN)** | [.cursor/rules/i18n.mdc](./.cursor/rules/i18n.mdc) |
| **Settings, config.json, IPC commands** | [.cursor/skills/tauri-config-ipc/SKILL.md](./.cursor/skills/tauri-config-ipc/SKILL.md) |
| **Node / npm version pin** | [.cursor/rules/node-toolchain.mdc](./.cursor/rules/node-toolchain.mdc) |

## Project layout

```
src/                 Vue 3 frontend (overlay + settings)
src-tauri/src/       Rust backend (Tauri, tray, shortcuts, config)
.cursor/rules/       Cursor rules (*.mdc)
.cursor/skills/      Cursor skills (workflows)
```

## Common commands

| Command | Purpose |
|---------|---------|
| `npm run dev` | Dev app |
| `npm run build:fe` | Typecheck + Vite build |
| `npm test` | Vitest |
| `npm run lint` / `format:check` | oxlint / prettier |
| `npm run commit` | Interactive Conventional Commit |
| `npm run release patch` | **Only** way to publish a version |

## Pre-merge checks (match CI)

```bash
npm test && npm run lint && npm run format:check && npx vue-tsc --noEmit
cd src-tauri && cargo fmt --check && cargo clippy -- -D warnings && cargo test
```

Or before release: `npm run release:check`

Validate pinned Node against lockfile deps: `npm run check:engines`

## Agent defaults

- **Do not** manually bump versions or create release tags — use `npm run release`.
- **Do not** use Tailwind opacity classes in Vue for borders/text/backgrounds — use semantic classes in `src/style.css`.
- **Do not** add UI strings in only one locale — sync `en.ts` and `zh-CN.ts`.
- **Do not** reset user settings when a config field changes — add serde defaults and a step in `AppConfig::migrated` (`src-tauri/src/config.rs`). Config reads recover from `config.json.bak` and migrate across NSIS/MSIX/portable roots.
- **Do not** skip commit hooks (`--no-verify`) unless the user explicitly requests it.
- Only create git commits when the user asks.

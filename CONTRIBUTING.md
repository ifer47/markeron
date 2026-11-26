# Contributing to MarkerOn

Thank you for your interest in contributing!

> **AI agents / doc index:** see [AGENTS.md](./AGENTS.md) for agent rules, skills, and common workflows.

## Prerequisites

- **Node.js `24.15.0`** and **npm `11.12.1`** (pinned — see `.nvmrc`, `.node-version`, `package.json` → `engines`)
- [Rust](https://www.rust-lang.org/tools/install) (stable)
- Platform-specific dependencies:
  - **Windows**: Windows SDK (for MSIX builds)
  - **macOS**: Xcode Command Line Tools

Supported platforms: **Windows** and **macOS** only.

### Node.js setup

```bash
# nvm
nvm install   # uses .nvmrc
nvm use

# fnm
fnm use       # uses .node-version

node -v       # v24.15.0
npm -v        # 11.12.1
```

`npm install` runs a version check automatically. Wrong Node/npm versions will fail with setup instructions.

When bumping Node/npm, update `package.json` → `engines`/`packageManager`, `.nvmrc`, and `.node-version`, then run `npm run check:engines`.

## Development Setup

```bash
# Install frontend dependencies
npm install

# Run in development mode (frontend + Tauri)
npm run dev

# Run frontend only
npm run dev:fe

# Run tests
npm test

# Lint and format
npm run lint
npm run format:check
```

## Commit Conventions

This project uses [Conventional Commits](https://www.conventionalcommits.org/) enforced by commitlint + husky.

Use `npm run commit` (powered by czg) for an interactive commit prompt.

Common types: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `i18n`, `ui`, `security`.

Example:

```
feat: add keyboard navigation for color picker
fix(overlay): prevent cursor offset when switching tools
```

## Project Structure

```
src/                    # Vue 3 frontend
  components/           # Vue components
  composables/          # Drawing engine
  constants/            # Shared constants (colors, tools, widths)
  i18n/                 # Internationalization (en, zh-CN)
  utils/                # Utilities
src-tauri/              # Rust backend
  src/
    lib.rs              # App entry, tray, overlay lifecycle
    commands.rs          # Tauri IPC commands
    config.rs            # Config persistence
    clipboard.rs         # Screen capture
    monitor.rs           # Multi-monitor support
    shortcuts.rs         # Global hotkeys
    i18n.rs              # Backend i18n strings
```

## Pull Requests

1. Fork and create a branch from `master`
2. Make your changes with appropriate tests
3. Ensure `npm test`, `npm run lint`, and `npx vue-tsc --noEmit` pass
4. Submit a PR with a clear description

## Releasing

**Do not release manually.** Use the automated script:

```bash
npm run release:check          # optional pre-flight (same checks as CI)
npm run release patch --dry-run # preview without changes
npm run release patch           # patch | minor | major
```

This bumps all version files, commits, tags, pushes, and triggers the GitHub Actions Release workflow. Release notes are generated automatically from Conventional Commits (see `.github/release.yml`).

Requirements: clean `master` branch, `gh` CLI logged in, Rust + Node installed.

See `.agents/skills/release/SKILL.md` for the full workflow.

# Contributing to MarkerOn

Thank you for your interest in contributing!

## Prerequisites

- [Node.js](https://nodejs.org/) >= 20
- [Rust](https://www.rust-lang.org/tools/install) (stable)
- Platform-specific dependencies:
  - **Windows**: Windows SDK (for MSIX builds)
  - **macOS**: Xcode Command Line Tools
  - **Linux**: `libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf libxdo-dev libxcb-shm0-dev libxcb-randr0-dev`

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

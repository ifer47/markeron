---
name: release
description: >-
  MarkerOn release workflow. Use when the user asks to release, publish, bump
  version, create a tag, or cut a new version. Never release manually.
---

# MarkerOn Release

## Single entry point

**Always use the release script — never manually bump version, commit, or tag.**

```bash
# 1. Pre-flight (optional, also runs inside release)
npm run release:check

# 2. Dry run
npm run release patch --dry-run

# 3. Publish (patch | minor | major)
npm run release patch
```

The script automatically:

1. Asserts clean git tree + `master` branch
2. Runs the same checks as CI (`build:fe`, test, lint, format, `cargo fmt --check`)
3. Bumps `package.json`, `package-lock.json`, `Cargo.toml`, `Cargo.lock`
4. Commits `chore(release): vX.Y.Z`
5. Tags `vX.Y.Z` and pushes branch + tag
6. Triggers GitHub Actions Release workflow (multi-platform build + upload)

## Release notes format (automatic)

Configured in:

| File | Role |
|------|------|
| `.github/release.yml` | Category titles (✨ New, 🛠 Fixes, …) for GitHub API |
| `.github/workflows/release.yml` | Heading normalization + git-log fallback when no PR notes |

Output format:

```markdown
## What's New in vX.Y.Z

### ✨ New
- ...

### 🛠 Fixes
- ...

### 🧹 Improvements
- ...

**Full Changelog**: https://github.com/ifer47/markeron/compare/vA.B.C...vX.Y.Z
```

Release notes are derived from **Conventional Commits** since the previous tag. Use `npm run commit` (czg) for daily commits so notes categorize correctly.

## Agent rules

- Do **not** hand-edit version in four files — use `npm run release`
- Do **not** `git tag` / `git push` tags manually unless fixing a failed release
- Do **not** write release notes by hand unless user explicitly asks to edit after publish
- Pick bump level: `patch` (fixes), `minor` (features), `major` (breaking)
- Requires `gh` CLI authenticated (`gh auth login`)

## After release

Monitor: https://github.com/ifer47/markeron/actions/workflows/release.yml

If the release-notes job fails, fix `.github/workflows/release.yml` on `master`, then delete and recreate the same tag to re-run the Release workflow. Do not bump the version just to retry.

## Windows code signing (required)

The Windows job fails when the installer is unsigned. Unsigned installers are held by Defender before they start, so the in-app update looks frozen (the window closes and the tray icon only returns a minute later), and browsers flag the download.

Required repository secrets:

| Secret | Value |
|--------|-------|
| `SIGN_PFX_BASE64` | Base64 of the code-signing `.pfx` |
| `SIGN_PFX_PASSWORD` | Export password of that `.pfx` |

The certificate thumbprint must equal `bundle.windows.certificateThumbprint` in `src-tauri/tauri.sign.conf.json`; the workflow checks this before building. `scripts/generate-cert.ps1` creates a local self-signed cert for testing, but only a CA-issued certificate builds SmartScreen reputation.

To publish an unsigned build on purpose (not recommended), set the repository variable `ALLOW_UNSIGNED_WINDOWS_RELEASE=true`. The signature verification step is skipped and the job warns.

> Gotcha: GitHub reads step outputs from `$GITHUB_OUTPUT` as UTF-8. Windows PowerShell's `Out-File` writes UTF-16 by default, which silently drops the output (this is why Windows releases shipped unsigned from June to November 2026). Append outputs with `[IO.File]::AppendAllText` and a `UTF8Encoding($false)` writer instead.

## Prerequisites

- Node 24.15.0 / npm 11.12.1 (pinned), Rust stable, `gh` CLI
- On Windows: no bash required for release (Node script is cross-platform)

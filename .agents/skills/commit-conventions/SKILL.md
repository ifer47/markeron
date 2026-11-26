---
name: commit-conventions
description: >-
  MarkerOn commit workflow and Conventional Commit rules. Use when creating
  commits, choosing a type/scope, or fixing commitlint or husky failures.
---

# Commit Conventions (MarkerOn)

## Preferred workflow

Use the interactive prompt; do not hand-write commits unless the user asks:

```bash
npm run commit   # czg — pick type, scope, subject
```

Hooks run automatically: `lint-staged` (pre-commit), `commitlint` (commit-msg).

## Format and limits

```text
<type>(<scope>): <subject>

<body optional>
```

- Subject: at most 100 characters (`subject-max-length`).
- Body lines: at most 100 characters each (`body-max-line-length`) — split long lines.
- The authoritative type list is `commitlint.config.js`; release-note categories are in `.github/release.yml`.

## Agent rules

- Do not use `--no-verify`; if the commit-msg hook fails on body length, shorten or remove the body.
- Use lowercase type, imperative subject, and no trailing period on the subject.
- For UI/cross-platform fixes, prefer `fix(ui):` or `ui:` when accurate.
- Do not use `release:` for daily work; `npm run release` creates `chore(release): vX.Y.Z`.

See `.agents/skills/release/SKILL.md` for how commits become release notes.

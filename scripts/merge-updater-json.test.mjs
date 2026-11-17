import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { test } from 'node:test'
import assert from 'node:assert/strict'

test('merge-updater-json merges platform maps', () => {
  const dir = mkdtempSync(join(tmpdir(), 'updater-merge-'))
  const out = join(dir, 'merged.json')
  writeFileSync(
    join(dir, 'windows.json'),
    JSON.stringify({
      version: '1.2.0',
      notes: 'short',
      pub_date: '2026-01-01T00:00:00Z',
      platforms: { 'windows-x86_64': { url: 'https://example/windows', signature: 'sig' } },
    }),
  )
  writeFileSync(
    join(dir, 'macos.json'),
    JSON.stringify({
      version: '1.2.0',
      notes: 'longer release notes',
      pub_date: '2026-01-02T00:00:00Z',
      platforms: { 'darwin-aarch64': { url: 'https://example/macos', signature: 'sig2' } },
    }),
  )

  const result = spawnSync(process.execPath, ['scripts/merge-updater-json.mjs', dir, out], {
    encoding: 'utf8',
  })
  assert.equal(result.status, 0, result.stderr)

  const merged = JSON.parse(readFileSync(out, 'utf8'))
  assert.equal(merged.version, '1.2.0')
  assert.equal(merged.notes, 'longer release notes')
  assert.ok(merged.platforms['windows-x86_64'])
  assert.ok(merged.platforms['darwin-aarch64'])

  rmSync(dir, { recursive: true, force: true })
})

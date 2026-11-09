// Issue #55: docker-dockerignore-missing must read the real build context from GitHub Actions workflows and Makefiles, not only compose files and header hints.
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

const SCRIPT = fileURLToPath(new URL('../thorough/infra-plus.mjs', import.meta.url))
const lines = (...l: string[]) => l.join('\n') + '\n'
const writeTree = (files: Record<string, string>) => {
  const dir = mkdtempSync(join(tmpdir(), 'meerkat-i55-'))
  for (const [name, body] of Object.entries(files)) {
    mkdirSync(join(dir, dirname(name)), { recursive: true })
    writeFileSync(join(dir, name), body)
  }
  return dir
}
const missing = /MEERKAT-SUB FAIL docker-dockerignore-missing/
const flagged = (files: Record<string, string>) => missing.test(spawnSync(process.execPath, [SCRIPT, 'ip-docker', '--root', writeTree(files)], { encoding: 'utf8', timeout: 60000 }).stdout)
const df = lines('FROM alpine:3.20', 'USER app', 'HEALTHCHECK CMD true')
const ign = 'node_modules\n'

describe('the build context named by CI and make counts', () => {
  test('a workflow run: docker build -f sub/Dockerfile . uses the root .dockerignore', () => {
    const wf = lines('jobs:', '  b:', '    steps:', '      - run: docker build -f apps/s/Dockerfile -t s .')
    expect(flagged({ '.dockerignore': ign, 'apps/s/Dockerfile': df, '.github/workflows/ci.yml': wf })).toBe(false)
  })
  test('a workflow build-push-action with context: . and file: counts', () => {
    const wf = lines('jobs:', '  b:', '    steps:', '      - uses: docker/build-push-action@v6', '        with:', '          context: .', '          file: apps/s/Dockerfile')
    expect(flagged({ '.dockerignore': ign, 'apps/s/Dockerfile': df, '.github/workflows/ci.yml': wf })).toBe(false)
  })
  test('a Makefile docker line counts, relative to the Makefile folder', () => {
    expect(flagged({ '.dockerignore': ign, 'apps/s/Dockerfile': df, Makefile: lines('image:', '\tdocker build -t s -f apps/s/Dockerfile .') })).toBe(false)
  })
  test('a Dockerfile built from its own folder, with no .dockerignore there, is still flagged', () => {
    const wf = lines('jobs:', '  b:', '    steps:', '      - run: docker build -t s apps/s')
    expect(flagged({ '.dockerignore': ign, 'apps/s/Dockerfile': df, '.github/workflows/ci.yml': wf })).toBe(true)
    const wf2 = lines('jobs:', '  b:', '    steps:', '      - uses: docker/build-push-action@v6', '        with:', '          context: apps/s')
    expect(flagged({ '.dockerignore': ign, 'apps/s/Dockerfile': df, '.github/workflows/ci.yml': wf2 })).toBe(true)
  })
  test('a different Dockerfile built from the root does not clear this one', () => {
    const wf = lines('jobs:', '  b:', '    steps:', '      - run: docker build -f apps/other/Dockerfile -t o .')
    expect(flagged({ '.dockerignore': ign, 'apps/s/Dockerfile': df, 'apps/other/Dockerfile': df, '.github/workflows/ci.yml': wf })).toBe(true)
  })
})

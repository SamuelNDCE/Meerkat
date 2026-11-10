// local-links must look only at tracked Markdown (never node_modules, vendor, ignored files) and, in a gate, only at the Markdown the change touches.
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, test } from 'vitest'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const WRAP = join(ROOT, 'thorough', 'tool-or-builtin.mjs')
const made: string[] = []
afterAll(() => {
  for (const d of made) rmSync(d, { recursive: true, force: true })
})

function repo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'meerkat-links-'))
  made.push(dir)
  const put = (n: string, body: string) => {
    mkdirSync(dirname(join(dir, n)), { recursive: true })
    writeFileSync(join(dir, n), body)
  }
  put('.gitignore', 'node_modules/\n')
  put('README.md', '# Hi\n\nSee [the guide](docs/guide.md).\n')
  put('docs/guide.md', '# Guide\n')
  put('docs/broken.md', '# Broken\n\nok line\nA [bad link](docs/nope.md) here.\n')
  put('vendor/lib/README.md', 'Tracked copy: [x](/BENCHMARKS.md)\n')
  put('node_modules/fdir/README.md', 'Please see [here](/BENCHMARKS.md).\n')
  const git = (...a: string[]) => execFileSync('git', ['-C', dir, ...a], { stdio: 'pipe' })
  git('init', '-q')
  git('add', '-A')
  return dir
}

function links(dir: string, env: Record<string, string> = {}) {
  const r = spawnSync(process.execPath, [WRAP, '--bin', 'lychee', '--fallback', 'links', '--match', '[.]md$', '--docs', '--root', dir, '--force-fallback', '--', '--offline'], { cwd: dir, encoding: 'utf8', env: { ...process.env, ...env } })
  return { code: r.status, out: String(r.stdout) + String(r.stderr) }
}

describe('local-links scope', () => {
  test('reports the broken relative link in a tracked file at its line, and nothing from node_modules or vendor', () => {
    const r = links(repo())
    expect(r.code).toBe(1)
    expect(r.out).toContain('docs/broken.md:4 link to a file that does not exist: docs/nope.md')
    expect(r.out).not.toContain('node_modules')
    expect(r.out).not.toContain('BENCHMARKS')
    expect(r.out).not.toContain('vendor')
  })

  test('a valid relative link in a tracked README is not reported', () => {
    const r = links(repo())
    expect(r.out).not.toContain('README.md:')
  })

  test('against a diff, only the changed Markdown files are checked', () => {
    const dir = repo()
    const list = join(dir, 'changed.txt')
    writeFileSync(list, 'README.md\n')
    const only = links(dir, { MEERKAT_CHANGED_LIST: list })
    expect(only.code).toBe(0)
    expect(only.out).not.toContain('broken.md')
    writeFileSync(list, 'docs/broken.md\n')
    const changed = links(dir, { MEERKAT_CHANGED_LIST: list })
    expect(changed.code).toBe(1)
    expect(changed.out).toContain('docs/broken.md:4')
  })
})

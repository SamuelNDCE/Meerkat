// binary-in-history honours ignorePaths (MEERKAT_IGNORE_PATHS) and .meerkatignore, like the other checks.
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, test } from 'vitest'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const made: string[] = []
afterAll(() => {
  for (const d of made) rmSync(d, { recursive: true, force: true })
})

function repo(files: Record<string, Buffer | string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'meerkat-binhist-'))
  made.push(dir)
  const g = (args: string[]) =>
    execFileSync('git', ['-C', dir, '-c', 'user.name=Test', '-c', 'user.email=test@example.test', '-c', 'commit.gpgsign=false', ...args], { stdio: 'pipe' })
  g(['init', '-q', '-b', 'main'])
  for (const [name, body] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, name)), { recursive: true })
    writeFileSync(join(dir, name), body)
  }
  g(['add', '-A'])
  g(['commit', '-q', '-m', 'Add files'])
  return dir
}

function run(dir: string, ignore?: string[]): { code: number; out: string } {
  const env: NodeJS.ProcessEnv = { ...process.env }
  delete env.MEERKAT_IGNORE_PATHS
  if (ignore) env.MEERKAT_IGNORE_PATHS = JSON.stringify(ignore)
  try {
    const out = execFileSync(process.execPath, ['thorough/git.mjs', 'binary-in-history', '--root', dir], { cwd: ROOT, stdio: 'pipe', encoding: 'utf8', env, timeout: 60_000 })
    return { code: 0, out }
  } catch (e: any) {
    return { code: e.status ?? -1, out: String(e.stdout ?? '') + String(e.stderr ?? '') }
  }
}

const big = () => Buffer.alloc(2 * 1024 * 1024, 7)

describe('binary-in-history skips ignored paths', () => {
  test('only the path not listed in ignorePaths is reported', () => {
    const dir = repo({ 'THIRD-PARTY-NOTICES.md': big(), 'assets/logo.bin': Buffer.alloc(2 * 1024 * 1024, 9) })
    const { code, out } = run(dir, ['THIRD-PARTY-NOTICES.md'])
    expect(code, out).toBe(1)
    expect(out).toContain('assets/logo.bin')
    expect(out).not.toContain('THIRD-PARTY-NOTICES.md')
  }, 60_000)
  test('a folder pattern skips every blob under it', () => {
    const dir = repo({ 'gen/a.bin': Buffer.alloc(2 * 1024 * 1024, 1), 'gen/b.bin': Buffer.alloc(2 * 1024 * 1024, 2) })
    const { code, out } = run(dir, ['gen/**'])
    expect(code, out).toBe(0)
  }, 60_000)
  test('.meerkatignore is honoured too', () => {
    const dir = repo({ 'THIRD-PARTY-NOTICES.md': big(), '.meerkatignore': 'THIRD-PARTY-NOTICES.md\n' })
    const { code, out } = run(dir)
    expect(code, out).toBe(0)
  }, 60_000)
  test('without any ignore the blob is reported', () => {
    const dir = repo({ 'THIRD-PARTY-NOTICES.md': big() })
    const { code, out } = run(dir)
    expect(code, out).toBe(1)
    expect(out).toContain('THIRD-PARTY-NOTICES.md')
  }, 60_000)
})

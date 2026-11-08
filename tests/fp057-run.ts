// Shared helper for the 0.5.7 false-alarm tests: run one thorough check on a throwaway folder and report its exit code and output.
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll } from 'vitest'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const made: string[] = []
afterAll(() => {
  for (const d of made) rmSync(d, { recursive: true, force: true })
})

export function runCheck(script: string, check: string, files: Record<string, string>, tracked = false, env: Record<string, string> = {}): { code: number; out: string } {
  const dir = mkdtempSync(join(tmpdir(), 'meerkat-057-'))
  made.push(dir)
  for (const [n, body] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, n)), { recursive: true })
    writeFileSync(join(dir, n), body)
  }
  if (tracked) {
    execFileSync('git', ['-C', dir, 'init', '-q'], { stdio: 'pipe' })
    execFileSync('git', ['-C', dir, 'add', '-A'], { stdio: 'pipe' })
  }
  try {
    return { code: 0, out: execFileSync(process.execPath, [script, check, '--root', dir], { cwd: ROOT, stdio: 'pipe', encoding: 'utf8', env: { ...process.env, ...env } }) }
  } catch (e: any) {
    return { code: e.status ?? -1, out: String(e.stdout ?? '') + String(e.stderr ?? '') }
  }
}

// Shared helpers for the release scripts in this folder: run a command (npm needs a shell on Windows), find the repo root, make and clean temp folders.
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

const quote = (a) => (/^[\w@%+=:,./\-]+$/.test(a) ? a : `"${String(a).replace(/"/g, '\\"')}"`)

// Runs a program and returns { code, stdout, stderr }. A program that cannot start gives code 127 and the reason in stderr, never a throw.
// `npm` and `npx` are .cmd files on Windows, so they go through the shell there, with every argument quoted.
export function run(cmd, args, opts = {}) {
  const viaShell = process.platform === 'win32' && /^(npm|npx)$/.test(cmd)
  const r = viaShell
    ? spawnSync([cmd, ...args].map(quote).join(' '), { cwd: opts.cwd ?? ROOT, encoding: 'utf8', shell: true, timeout: opts.timeout ?? 300000, env: opts.env ?? process.env, maxBuffer: 64 * 1024 * 1024 })
    : spawnSync(cmd, args, { cwd: opts.cwd ?? ROOT, encoding: 'utf8', timeout: opts.timeout ?? 300000, env: opts.env ?? process.env, maxBuffer: 64 * 1024 * 1024 })
  if (r.error) return { code: 127, stdout: r.stdout ?? '', stderr: String(r.error.message) }
  return { code: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
}

export const tempDir = (prefix) => mkdtempSync(join(tmpdir(), `meerkat-${prefix}-`))
export const removeDir = (dir) => {
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  } catch {
    /* a locked temp folder on Windows is reported by the caller's own leftovers check, never fatal here */
  }
}
export const first = (text, n = 600) => String(text).trim().split('\n').slice(0, 12).join('\n').slice(0, n)
export const isMain = (url) => !!process.argv[1] && fileURLToPath(url) === process.argv[1]

// A gate result names its log folder: the folder must be on disk when the name is printed, must still be there after the next gate
// in the same project, and a blocking result must name its check and the file.
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const BIN = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'meerkat.mjs')
const ROOT = mkdtempSync(join(tmpdir(), 'mk-logfolder-'))
const dir = join(ROOT, 'repo')
const state = join(ROOT, 'state')

function git(...args: string[]) {
  const r = spawnSync('git', ['-c', 'core.autocrlf=false', ...args], { cwd: dir, encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`)
}

function gate(args: string[] = []): Promise<{ code: number | null; stdout: string }> {
  return new Promise((done) => {
    const env = { ...process.env, CI: '1', NO_COLOR: '1', MEERKAT_LOG_DIR: join(state, 'logs'), MEERKAT_HOME: join(state, 'home'), MEERKAT_PROGRESS: '0' }
    const child = spawn(process.execPath, [BIN, 'gate', '--no-input', '--no-cache', ...args], { cwd: dir, env })
    let stdout = ''
    child.stdout.on('data', (d) => (stdout += d))
    child.on('close', (code) => done({ code, stdout }))
  })
}
const folderOf = (out: string) => /^logs: (.+)$/m.exec(out)?.[1]?.trim() ?? ''

beforeAll(() => {
  mkdirSync(dir, { recursive: true })
  mkdirSync(state, { recursive: true })
  git('init', '-q', '-b', 'main')
  git('config', 'user.email', 'a@example.com')
  git('config', 'user.name', 'a')
  writeFileSync(join(dir, 'lib.js'), 'export const lib = () => 1\n')
  git('add', 'lib.js')
  git('commit', '-q', '-m', 'one')
  git('checkout', '-q', '-b', 'feat')
  writeFileSync(join(dir, 'lib.js'), 'export const lib = (s) => eval(s)\n')
  git('add', 'lib.js')
  git('commit', '-q', '-m', 'two')
}, 60000)

afterAll(() => {
  try {
    rmSync(ROOT, { recursive: true, force: true })
  } catch {
    /* left to the OS */
  }
})

describe('gate log folder', () => {
  it('names a folder that exists with summary.json, and a blocking finding names its check and file', async () => {
    const r = await gate(['--base', 'main'])
    expect(r.code, r.stdout).toBe(1)
    const folder = folderOf(r.stdout)
    expect(folder, r.stdout).not.toBe('')
    expect(existsSync(join(folder, 'summary.json'))).toBe(true)
    expect(r.stdout).toMatch(/^FAIL\s+\S+/m)
    expect(r.stdout).toMatch(/lib\.js/)
  }, 120000)

  it('the folder named by an earlier gate is still on disk after the next gate in the same project', async () => {
    const a = await gate(['--base', 'main'])
    const first = folderOf(a.stdout)
    expect(existsSync(join(first, 'summary.json'))).toBe(true)
    const b = await gate(['--base', 'main'])
    expect(folderOf(b.stdout)).not.toBe(first)
    expect(existsSync(join(first, 'summary.json'))).toBe(true)
  }, 180000)
})

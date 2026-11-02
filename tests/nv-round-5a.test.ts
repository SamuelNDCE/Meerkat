// Round 5a false-alarm fixes: each rule keeps reporting its genuine defect and stops reporting the harmless shape.
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

function run(script: string, check: string, files: Record<string, string>): { code: number; out: string } {
  const dir = mkdtempSync(join(tmpdir(), 'nv5a-'))
  made.push(dir)
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, name)), { recursive: true })
    writeFileSync(join(dir, name), text)
  }
  try {
    execFileSync('git', ['init', '-q'], { cwd: dir })
    execFileSync('git', ['add', '-A'], { cwd: dir })
  } catch {
    /* tracked-file listing falls back to a directory walk */
  }
  try {
    const out = execFileSync(process.execPath, [script, check, '--root', dir], { cwd: ROOT, stdio: 'pipe', encoding: 'utf8' })
    return { code: 0, out }
  } catch (e: any) {
    return { code: e.status ?? -1, out: String(e.stdout ?? '') }
  }
}

const lang = (check: string, src: string) => run('thorough/lang.mjs', check, { 'a.js': src })
const quality = (check: string, files: Record<string, string>) => run('thorough/quality.mjs', check, files)

describe('js-await-in-loop', () => {
  test('still reports independent awaits per item', () => {
    expect(lang('js-await-in-loop', 'export async function load(ids) {\n  for (const id of ids) {\n    await fetchOne(id)\n  }\n}\n').code).toBe(1)
  })
  test('a guard-clause continue does not exempt the loop', () => {
    expect(lang('js-await-in-loop', 'export async function w(ids) {\n  for (const id of ids) {\n    if (!id) continue\n    await fetchOne(id)\n  }\n}\n').code).toBe(1)
  })
  test('storing by key does not exempt the loop', () => {
    expect(lang('js-await-in-loop', 'export async function w(fs) {\n  for (const f of fs) {\n    out[f] = await load(f)\n  }\n}\n').code).toBe(1)
  })
  test('the word timeout in an option object does not exempt the loop', () => {
    expect(lang('js-await-in-loop', 'export async function w(ids) {\n  for (const id of ids) {\n    await fetchOne(id, { timeout: 5, wait: true })\n  }\n}\n').code).toBe(1)
  })
  test('a scalar the next pass reads is fine', () => {
    expect(lang('js-await-in-loop', 'export async function w(n) {\n  for (let i = 0; i < n; i++) {\n    cursor = await next(cursor)\n  }\n}\n').code).toBe(0)
  })
  test('polling with a deadline is fine', () => {
    expect(lang('js-await-in-loop', 'export async function w() {\n  while (Date.now() < deadline) {\n    await check()\n  }\n}\n').code).toBe(0)
  })
  test('a sleep or retry loop is fine', () => {
    expect(lang('js-await-in-loop', 'export async function w() {\n  for (let attempt = 0; attempt < 3; attempt++) {\n    await tryOnce()\n  }\n}\n').code).toBe(0)
    expect(lang('js-await-in-loop', 'export async function w(xs) {\n  for (const x of xs) {\n    await sleep(10)\n    await go(x)\n  }\n}\n').code).toBe(0)
  })
  test('a loop that stops at the first hit is fine', () => {
    expect(lang('js-await-in-loop', 'export async function w(cs) {\n  for (const c of cs) {\n    const r = await find(c)\n    if (r) break\n  }\n}\n').code).toBe(0)
  })
  test('a while loop that changes its own condition is fine', () => {
    expect(lang('js-await-in-loop', 'export async function w() {\n  while (size > 1) {\n    size = size / 2\n    await reserve(size)\n  }\n}\n').code).toBe(0)
  })
})

describe('js-unhandled-promise', () => {
  test('still reports a bare .then', () => {
    expect(lang('js-unhandled-promise', 'export function save(id) {\n  fetchUser(id).then((u) => store(u))\n}\n').code).toBe(1)
  })
  test('a .catch inside the then callback is handled', () => {
    expect(lang('js-unhandled-promise', "app.whenReady().then(() => {\n  main().catch((e) => {\n    console.error(e)\n  })\n})\n").code).toBe(0)
  })
  test('a .catch inside an ordinary then callback does not handle the outer chain', () => {
    expect(lang('js-unhandled-promise', 'fetchUser(1).then((u) => {\n  other().catch(log)\n})\n').code).toBe(1)
  })
  test('a .catch on the next line is handled', () => {
    expect(lang('js-unhandled-promise', 'fetchUser(1)\n  .then((u) => store(u))\n  .catch(log)\n').code).toBe(0)
  })
})

describe('json-parse-in-loop', () => {
  const loopy = 'for (const f of list) {\n  JSON.parse(f)\n}\n'
  const many = Array.from({ length: 12 }, () => loopy).join('')
  test('still reports real loops with a line number, over budget', () => {
    const r = run('thorough/health.mjs', 'json-parse-in-loop', { 'src/a.js': many })
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/src\/a\.js:2 calls JSON/)
  })
  test('test files are left out', () => {
    expect(run('thorough/health.mjs', 'json-parse-in-loop', { 'src/a.test.js': many }).code).toBe(0)
  })
})

describe('empty-catch', () => {
  test('still reports a bare empty handler', () => {
    expect(quality('empty-catch', { 'a.js': 'try { run() } catch (e) {}\n' }).code).toBe(1)
  })
  test('a comment that merely mentions catch {} is not a handler', () => {
    expect(quality('empty-catch', { 'a.js': '// This was a bare `catch {}` until last month\nconst x = 1\n' }).code).toBe(0)
  })
  test('a same-line comment without best-effort wording still reports', () => {
    expect(quality('empty-catch', { 'a.js': 'try { run() } catch {} // TODO\n' }).code).toBe(1)
  })
  test('a // inside a string is not a comment', () => {
    expect(quality('empty-catch', { 'a.js': 'try { run("a//ignore") } catch {}; const u = "http://ignore"\n' }).code).toBe(1)
  })
  test('a documented best-effort handler is fine', () => {
    expect(quality('empty-catch', { 'a.js': 'try { run() } catch {} // best effort, the file may not exist\n' }).code).toBe(0)
    expect(quality('empty-catch', { 'a.js': '// Best effort: ignore a missing cache file.\ntry { run() } catch {}\n' }).code).toBe(0)
  })
})

describe('debug-leftovers', () => {
  test('still reports console.log in plain library code', () => {
    expect(quality('debug-leftovers', { 'src/a.js': 'export const f = () => {\n  console.log("x")\n}\n' }).code).toBe(1)
  })
  test('a probe script and a shebang script may print; process.exit alone does not make a CLI', () => {
    expect(quality('debug-leftovers', { 'supabase/probe/p.mjs': 'console.log("PASS")\n' }).code).toBe(0)
    expect(quality('debug-leftovers', { 'src/check.js': '#!/usr/bin/env node\nconsole.log("PASS")\n' }).code).toBe(0)
    expect(quality('debug-leftovers', { 'src/lib.js': 'export function f() {\n  console.log("x")\n  process.exit(1)\n}\n' }).code).toBe(1)
  })
})

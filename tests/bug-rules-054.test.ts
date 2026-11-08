// Four JavaScript bug rules from an outside audit (missing await, loop bound, find() result, test without assert) and two better messages
// (innerHTML from request input, == against a literal). Each rule: the buggy fixture is found, a clean twin with the same shape is not.
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterAll, describe, expect, test } from 'vitest'

const ROOT = join(__dirname, '..')
const made: string[] = []
afterAll(() => made.forEach((d) => rmSync(d, { recursive: true, force: true })))
const run = (script: string, id: string, files: Record<string, string>) => {
  const dir = mkdtempSync(join(tmpdir(), 'mk054-'))
  made.push(dir)
  for (const [n, b] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, n)), { recursive: true })
    writeFileSync(join(dir, n), b)
  }
  spawnSync('git', ['init', '-q'], { cwd: dir })
  spawnSync('git', ['add', '-A'], { cwd: dir })
  const r = spawnSync(process.execPath, [join(ROOT, 'thorough', script), id, '--root', dir], { encoding: 'utf8' })
  const out = `${r.stdout}${r.stderr}`
  return { code: r.status, out, n: (out.match(/^\s+\S+\.[a-z]+:\d+ /gm) ?? []).length }
}
const lang = (id: string, files: Record<string, string>) => run('lang.mjs', id, files)

describe('js-missing-await', () => {
  const bad = 'async function load(id) {\n  return fetchRow(id)\n}\nexport async function show(id) {\n  const row = load(id)\n  console.log(row.name)\n  load(id)\n}\n'
  const clean = 'async function load(id) {\n  return fetchRow(id)\n}\nexport async function show(id) {\n  const row = await load(id)\n  console.log(row.name)\n  await load(id)\n  load(id).catch(report)\n  const p = load(id)\n  return p\n}\nexport function passOn(id) {\n  return load(id)\n}\n'
  test('both the dropped call and the unawaited read are found', () => {
    const r = lang('js-missing-await', { 'a.js': bad })
    expect(r.code).toBe(1)
    expect(r.n).toBe(2)
    expect(r.out).toMatch(/without await/)
  })
  test('awaited, chained and returned promises are quiet', () => {
    const r = lang('js-missing-await', { 'a.js': clean })
    expect(r.code).toBe(0)
    expect(r.n).toBe(0)
  })
  test('const-arrow async functions count, and a name from another file does not', () => {
    expect(lang('js-missing-await', { 'a.js': 'const save = async (x) => { await put(x) }\nexport async function go(x) {\n  save(x)\n}\n' }).n).toBe(1)
    expect(lang('js-missing-await', { 'a.js': 'export async function go(x) {\n  save(x)\n}\n' }).n).toBe(0)
  })
})

describe('js-loop-bound', () => {
  test('<= length with an index read is found', () => {
    const r = lang('js-loop-bound', { 'a.js': 'export function total(items) {\n  let s = 0\n  for (let i = 0; i <= items.length; i++) {\n    s += items[i].price\n  }\n  return s\n}\n' })
    expect(r.code).toBe(1)
    expect(r.n).toBe(1)
    expect(r.out).toMatch(/last index is out of range/)
  })
  test('< length, <= length - 1 and <= length without indexing are quiet', () => {
    const r = lang('js-loop-bound', { 'a.js': 'export function total(items) {\n  let s = 0\n  for (let i = 0; i < items.length; i++) s += items[i].price\n  for (let j = 0; j <= items.length - 1; j++) s += items[j].price\n  for (let k = 0; k <= items.length; k++) count(k)\n  return s\n}\n' })
    expect(r.code).toBe(0)
    expect(r.n).toBe(0)
  })
})

describe('js-find-undefined', () => {
  const bad = 'export function nameOf(users, id) {\n  const u = users.find((x) => x.id === id)\n  return u.name\n}\nexport function label(cacheMap, k) {\n  const e = cacheMap.get(k)\n  return e.label\n}\n'
  const clean = 'export function nameOf(users, id) {\n  const u = users.find((x) => x.id === id)\n  if (!u) return null\n  return u.name\n}\nexport function a(users, id) {\n  const u = users.find((x) => x.id === id)\n  return u?.name\n}\nexport function b(users, id) {\n  const u = users.find((x) => x.id === id)\n  return u && u.name\n}\nexport function c(users, id) {\n  const u = users.find((x) => x.id === id) ?? {}\n  return u.name\n}\nexport function d(client) {\n  const r = client.get("/x")\n  return r.data\n}\n'
  test('find and map get read without a guard are found', () => {
    const r = lang('js-find-undefined', { 'a.js': bad })
    expect(r.code).toBe(1)
    expect(r.n).toBe(2)
  })
  test('guarded reads, optional chaining, defaults and non-map get are quiet', () => {
    const r = lang('js-find-undefined', { 'a.js': clean })
    expect(r.code).toBe(0)
    expect(r.n).toBe(0)
  })
})

describe('js-eqeqeq message', () => {
  test('against a literal it explains the 0 and empty-string, null and undefined pairs', () => {
    const r = lang('js-eqeqeq', { 'a.js': "export const z = (a) => a == 0\nexport const e = (a) => a != ''\n" })
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/pairs like 0 and '' or null and undefined/)
  })
  test('between two variables the plain message is kept', () => {
    const r = lang('js-eqeqeq', { 'a.js': 'export const s = (a, b) => a == b\n' })
    expect(r.out).toMatch(/converts types before comparing/)
    expect(r.out).not.toMatch(/pairs like/)
  })
})

describe('risky-code innerHTML message', () => {
  const st = (src: string) => run('static.mjs', 'risky-code', { 'app.js': src })
  test('request or URL input says so', () => {
    for (const v of ['req.query.q', 'location.hash', 'new URLSearchParams(s).get("a") + searchParams', 'params.id', 'body.html']) {
      expect(st(`el.innerHTML = ${v}\n`).out).toMatch(/the value comes from request or URL input/)
    }
  })
  test('other values keep the plain message', () => {
    const r = st('el.innerHTML = "<b>" + name + "</b>"\n')
    expect(r.out).toMatch(/innerHTML assignment/)
    expect(r.out).not.toMatch(/request or URL input/)
  })
})

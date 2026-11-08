// js-unhandled-promise: a local value that shares its name with an async function in another file is not that function.
import { describe, expect, test } from 'vitest'
import { runCheck } from './fp057-run'

const unhandled = (files: Record<string, string>) => runCheck('thorough/lang.mjs', 'js-unhandled-promise', files)
const HELPER = { 'support.js': 'export async function openSession(id) {\n  await load(id)\n}\n' }

describe('js-unhandled-promise and names shared between files', () => {
  test('a store action bound by const in this file is quiet', () => {
    const r = unhandled({
      ...HELPER,
      'page.js': 'const openSession = useStore((s) => s.openSession)\nexport function pick(id) {\n  openSession(id)\n}\n',
    })
    expect(r.code).toBe(0)
  })
  test('a plain function of the same name declared in this file is quiet', () => {
    const r = unhandled({ ...HELPER, 'page.js': 'function openSession(id) {\n  return id\n}\nexport function pick(id) {\n  openSession(id)\n}\n' })
    expect(r.code).toBe(0)
  })
  test('calling the imported async function without await still fails', () => {
    const r = unhandled({ ...HELPER, 'page.js': "import { openSession } from './support.js'\nexport function pick(id) {\n  openSession(id)\n}\n" })
    expect(r.code).toBe(1)
    expect(r.out).toContain('openSession')
  })
  test('an async function declared in the same file and called bare still fails', () => {
    const r = unhandled({ 'page.js': 'async function save(id) {\n  await put(id)\n}\nexport function go(id) {\n  save(id)\n}\n' })
    expect(r.code).toBe(1)
  })
})

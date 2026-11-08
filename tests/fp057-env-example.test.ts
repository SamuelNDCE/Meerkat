// env-example: a variable the project sets for its own child processes, and the standard XDG paths, are not settings to document.
import { describe, expect, test } from 'vitest'
import { runCheck } from './fp057-run'

const env = (files: Record<string, string>) => runCheck('thorough/static.mjs', 'env-example', files, true)

describe('env-example and variables the code sets or the system owns', () => {
  test('a variable the code assigns for child processes is quiet', () => {
    const r = env({ 'run.js': "process.env.INTERNAL_PLUMBING = JSON.stringify([1])\n", 'kit.js': 'const p = process.env.INTERNAL_PLUMBING || "[]"\n' })
    expect(r.out).not.toContain('INTERNAL_PLUMBING')
  })
  test('XDG_DATA_HOME read by a program is quiet', () => {
    expect(env({ 'app.js': 'const d = process.env.XDG_DATA_HOME\n' }).out).not.toContain('XDG_DATA_HOME')
  })
  test('a variable only read still fails', () => {
    const r = env({ 'app.js': 'const k = process.env.MY_SECRET_THING\n' })
    expect(r.code).toBe(1)
    expect(r.out).toContain('MY_SECRET_THING')
  })
  test('a default-assigned variable (X = X || fallback) is still a setting and still fails', () => {
    const r = env({ 'app.js': 'process.env.MY_TOGGLE = process.env.MY_TOGGLE || "1"\n' })
    expect(r.out).toContain('MY_TOGGLE')
  })
})

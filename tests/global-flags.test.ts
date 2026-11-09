// Every command in `meerkat describe` accepts the global flags: --help answers and exits 0, and --no-input is never reported as an unknown option.
import { spawnSync } from 'node:child_process'
import { describe, expect, test } from 'vitest'
// @ts-expect-error plain .mjs module
import { CLI } from './smoke-helpers.mjs'

const run = (args: string[]) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', env: { ...process.env, NO_COLOR: '1', CI: '1' }, timeout: 60000 })
const described = JSON.parse(run(['describe']).stdout) as { commands: { name: string }[] }
const names = [...new Set(described.commands.map((c) => c.name))]

describe('global flags work on every command', () => {
  test('the command list is not empty', () => expect(names.length).toBeGreaterThan(20))
  for (const name of names) {
    test(`${name} --help exits 0`, () => {
      const r = run([name, '--help'])
      expect(r.status, r.stderr).toBe(0)
      expect(r.stdout.length).toBeGreaterThan(0)
    })
    test(`${name} --no-input --help exits 0 and does not call --no-input unknown`, () => {
      const r = run([name, '--no-input', '--help'])
      expect(r.status, r.stderr).toBe(0)
      expect(`${r.stdout}${r.stderr}`).not.toMatch(/unknown (option|flag)[^\n]*--no-input/i)
    })
    test(`${name} --help --no-input (other order) exits 0`, () => {
      expect(run([name, '--help', '--no-input']).status).toBe(0)
    })
  }
})

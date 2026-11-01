// markdownlint must read the project's own documents, not dependency folders: a folder of agent worktrees (untracked, with its own node_modules) once made
// 498 findings on Plume. Needs the real markdownlint-cli2 (meerkat tools install); without it the test is skipped.
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, test } from 'vitest'
// @ts-ignore plain .mjs modules have no type declarations
import { extraToolDirs, findBinary } from '../lib/which.mjs'
// @ts-ignore
import checks from '../packs/docs/docs.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const made: string[] = []
afterAll(() => {
  for (const d of made) rmSync(d, { recursive: true, force: true })
})
const toolPath = [...extraToolDirs(process.env, []), process.env.PATH].join(delimiter)
const env = { ...process.env, PATH: toolPath }
const have = !!findBinary('markdownlint-cli2', env)
const run = (files: Record<string, string>) => {
  const dir = mkdtempSync(join(tmpdir(), 'meerkat-mdl-scope-'))
  made.push(dir)
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, name)), { recursive: true })
    writeFileSync(join(dir, name), text)
  }
  const check = (checks as any[]).find((c) => c.id === 'markdownlint')
  const r = spawnSync(process.execPath, [...check.run.args], { cwd: dir, env, encoding: 'utf8' })
  return { code: r.status, out: `${r.stdout}${r.stderr}` }
}
const broken = '# T\n\n### skipped a level\n'

describe.skipIf(!have)('markdownlint scope', () => {
  test('a broken document inside a nested node_modules or .claude folder is not read', () => {
    const r = run({ 'README.md': '# Title\n\n## Fine\n', '.claude/worktrees/a/node_modules/x/readme.md': broken, 'sub/node_modules/y/readme.md': broken })
    expect(r.code, r.out).toBe(0)
  })
  test('a broken document of the project itself is still reported', () => {
    expect(run({ 'docs/guide.md': broken }).code).toBe(1)
  })
})

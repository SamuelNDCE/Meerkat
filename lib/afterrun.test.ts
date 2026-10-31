import { mkdtempSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
// @ts-expect-error plain JS module
import { repoChangesText } from './menu.mjs'

describe('repoChangesText', () => {
  it('says so outside a git repository', () => {
    expect(repoChangesText(mkdtempSync(join(tmpdir(), 'mk-nogit-')))).toMatch(/not a git repository/)
  })
  it('lists uncommitted files and the last commit', () => {
    const d = mkdtempSync(join(tmpdir(), 'mk-git-'))
    const g = (...a: string[]) => spawnSync('git', ['-C', d, '-c', 'user.name=t', '-c', 'user.email=t@t', ...a])
    g('init', '-q')
    writeFileSync(join(d, 'a.txt'), 'x')
    g('add', 'a.txt')
    g('commit', '-q', '-m', 'first')
    writeFileSync(join(d, 'b.txt'), 'y')
    const t = repoChangesText(d)
    expect(t).toMatch(/b\.txt/)
    expect(t).toMatch(/Last commit: \w+ first/)
  })
  it('caps a long list', () => {
    const d = mkdtempSync(join(tmpdir(), 'mk-many-'))
    spawnSync('git', ['-C', d, 'init', '-q'])
    for (let i = 0; i < 8; i++) writeFileSync(join(d, `f${i}.txt`), 'x')
    expect(repoChangesText(d, 3)).toMatch(/and 5 more/)
  })
})

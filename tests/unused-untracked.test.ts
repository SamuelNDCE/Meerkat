// unused-files: a file imported only by a source file that is not committed yet (untracked, not ignored) is still imported.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, test } from 'vitest'

const SCRIPT = resolve(__dirname, '..', 'thorough', 'refactor.mjs')

function fixture(tracked: Record<string, string>, untracked: Record<string, string>) {
  const dir = mkdtempSync(join(tmpdir(), 'mk-untracked-'))
  const put = (files: Record<string, string>) => {
    for (const [name, text] of Object.entries(files)) {
      mkdirSync(join(dir, name, '..'), { recursive: true })
      writeFileSync(join(dir, name), text)
    }
  }
  execFileSync('git', ['-C', dir, 'init', '-q'], { stdio: 'pipe' })
  put(tracked)
  execFileSync('git', ['-C', dir, 'add', '-A'], { stdio: 'pipe' })
  execFileSync('git', ['-C', dir, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'init'], { stdio: 'pipe' })
  put(untracked)
  return dir
}

function run(dir: string) {
  try {
    const out = execFileSync(process.execPath, [SCRIPT, 'unused-files', '--root', dir], { encoding: 'utf8', stdio: 'pipe' })
    return { code: 0, out }
  } catch (e: any) {
    return { code: e.status ?? 1, out: `${e.stdout ?? ''}${e.stderr ?? ''}` }
  }
}

describe('unused-files and untracked importers', () => {
  test('a component imported only by an uncommitted file is not reported', () => {
    const dir = fixture(
      { 'app/download/DownloadAction.tsx': 'export default function DownloadAction() { return null }\n', 'app/index.tsx': 'console.log(1)\n' },
      { 'app/download/EditionPanel.tsx': "import DownloadAction from './DownloadAction'\nexport default DownloadAction\n" },
    )
    const r = run(dir)
    expect(r.out).not.toContain('DownloadAction.tsx is not imported')
  })
  test('a file nothing imports, tracked or not, is still reported', () => {
    const dir = fixture(
      { 'lib/orphan.mjs': 'export const x = 1\n', 'lib/main.mjs': 'console.log(1)\n' },
      { 'lib/new.mjs': 'console.log(2)\n' },
    )
    const r = run(dir)
    expect(r.out).toContain('lib/orphan.mjs')
  })
})

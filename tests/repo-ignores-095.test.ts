// .meerkat-ignores.json: reasoned, owned, always reported as IGNORED; a line-keyed entry still matches when the line moves (via snippet).
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'

const root = join(__dirname, '..')
const SRC = 'export const same = (a, b) => a == b\n'
function repo(ignores: unknown, src = SRC): string {
  const dir = mkdtempSync(join(tmpdir(), 'meerkat-ign095-'))
  mkdirSync(join(dir, 'src'))
  writeFileSync(join(dir, 'src', 'a.js'), src)
  if (ignores !== undefined) writeFileSync(join(dir, '.meerkat-ignores.json'), JSON.stringify(ignores))
  execFileSync('git', ['init', '-q'], { cwd: dir })
  execFileSync('git', ['add', '.'], { cwd: dir })
  execFileSync('git', ['-c', 'user.email=a@b', '-c', 'user.name=n', 'commit', '-qm', 'x'], { cwd: dir })
  return dir
}
function runOut(dir: string): string {
  try {
    return execFileSync(process.execPath, [join(root, 'run.mjs'), '--app', dir, '--preset', 'quick', '--plain'], { encoding: 'utf8', stdio: 'pipe' })
  } catch (e: any) {
    return String(e.stdout ?? '')
  }
}
// FAIL if the check is in the final failure list, else PASS; followed by any IGNORED line of the run.

const eq = (out: string) => `${/^FAIL {6}js-eqeqeq:/m.test(out) ? 'FAIL' : 'PASS'} ${out.split(/\r?\n/).filter((l) => l.startsWith('IGNORED ')).join(' | ')}`

describe('.meerkat-ignores.json', () => {
  test('without the file the loose equality fails (the buggy fixture still fails)', () => {
    expect(eq(runOut(repo(undefined)))).toContain('FAIL')
  }, 120000)
  test('an entry with reason and owner passes the check and says IGNORED with both', () => {
    const out = eq(runOut(repo([{ check: 'js-eqeqeq', path: 'src/a.js', line: 1, reason: 'loose compare is deliberate here', owner: 'samuel' }])))
    expect(out).toContain('PASS')
    expect(out).toContain('IGNORED js-eqeqeq src/a.js:1')
    expect(out).toContain('loose compare is deliberate here')
    expect(out).toContain('owner samuel')
  }, 120000)
  test('an entry without a reason or owner suppresses nothing', () => {
    expect(eq(runOut(repo([{ check: 'js-eqeqeq', path: 'src/a.js', line: 1, reason: '', owner: 'samuel' }])))).toContain('FAIL')
    expect(eq(runOut(repo([{ check: 'js-eqeqeq', path: 'src/a.js', line: 1, reason: 'x' }])))).toContain('FAIL')
  }, 240000)
  test('the line moved: the snippet still matches; without a snippet the old line does not', () => {
    const moved = '// a\n// b\n// c\n' + SRC
    const entry = { check: 'js-eqeqeq', path: 'src/a.js', line: 1, reason: 'deliberate', owner: 'samuel' }
    expect(eq(runOut(repo([{ ...entry, snippet: 'a == b' }], moved)))).toContain('PASS')
    expect(eq(runOut(repo([entry], moved)))).toContain('FAIL')
  }, 240000)
})

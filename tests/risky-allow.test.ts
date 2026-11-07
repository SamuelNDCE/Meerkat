// risky-code: a decision about one finding is recorded in the project's own .meerkat-risky-allow, and the finding prints the exact line to paste.
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, test } from 'vitest'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const made: string[] = []
afterAll(() => {
  for (const d of made) rmSync(d, { recursive: true, force: true })
})

// A project that is not Meerkat: a view whose innerHTML value comes from a helper in the same file that escapes its input.
const VIEW = [
  'function esc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;") }',
  'export function show(el, user) {',
  '  const html = "<b>" + esc(user.name) + "</b>"',
  '  el.innerHTML = html + "<i>" + esc(user.bio) + "</i>"',
  '}',
  '',
].join('\n')

function project(): string {
  const dir = mkdtempSync(join(tmpdir(), 'meerkat-risky-'))
  made.push(dir)
  mkdirSync(join(dir, 'src'), { recursive: true })
  writeFileSync(join(dir, 'src/viewmodes.js'), VIEW)
  execFileSync('git', ['init', '-q'], { cwd: dir, stdio: 'ignore' })
  execFileSync('git', ['-C', dir, 'add', '-A'], { stdio: 'ignore' })
  return dir
}
function run(dir: string): { code: number; out: string } {
  try {
    return { code: 0, out: execFileSync(process.execPath, ['thorough/static.mjs', 'risky-code', '--root', dir], { cwd: ROOT, stdio: 'pipe', encoding: 'utf8' }) }
  } catch (e: any) {
    return { code: e.status ?? -1, out: String(e.stdout ?? '') }
  }
}

describe('risky-code and .meerkat-risky-allow in a project of its own', () => {
  test('the finding prints the exact allow line, and pasting that line (with a reason) accepts it', () => {
    const dir = project()
    const first = run(dir)
    expect(first.code).toBe(1)
    expect(first.out).toContain('src/viewmodes.js:4 innerHTML')
    const line = /adding this line to \.meerkat-risky-allow: (src\/viewmodes\.js:4 # reason: say why it is safe)\]/.exec(first.out)?.[1]
    expect(line).toBe('src/viewmodes.js:4 # reason: say why it is safe')
    writeFileSync(join(dir, '.meerkat-risky-allow'), `# esc() in this file escapes both values\n${line}\n`)
    const second = run(dir)
    expect(second.code, second.out).toBe(0)
  })
  test('a bare path:line entry, and a whole-file entry, still work', () => {
    const dir = project()
    writeFileSync(join(dir, '.meerkat-risky-allow'), 'src/viewmodes.js:4\n')
    expect(run(dir).code).toBe(0)
    writeFileSync(join(dir, '.meerkat-risky-allow'), 'src/viewmodes.js\n')
    expect(run(dir).code).toBe(0)
  })
  test('an entry for another line does not hide the finding', () => {
    const dir = project()
    writeFileSync(join(dir, '.meerkat-risky-allow'), 'src/viewmodes.js:9 # a different line\n')
    expect(run(dir).code).toBe(1)
  })
})

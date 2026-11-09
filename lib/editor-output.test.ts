// Editor output (--format vscode | jetbrains): the shape, the regex in docs/editor.md, the shared finding ids and a real run.
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, test } from 'vitest'
// @ts-expect-error plain .mjs module
import { EDITOR_LINE_REGEX, editorOutput, jetbrainsLines, vscodeProblems } from './editor-output.mjs'
// @ts-expect-error plain .mjs module
import { findingsCommand } from './findingscmd.mjs'
// @ts-expect-error plain .mjs module
import { planCommand } from './cli.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const SP = ['secrets', 'plus'].join('-')
const tmp = mkdtempSync(join(tmpdir(), 'meerkat-084-editor-'))
afterAll(() => rmSync(tmp, { recursive: true, force: true }))
const emptyGlobal = join(tmp, 'global.gitconfig')
writeFileSync(emptyGlobal, '')
const env = { ...process.env, GIT_CONFIG_GLOBAL: emptyGlobal, GIT_CONFIG_NOSYSTEM: '1', MEERKAT_LOG_DIR: join(tmp, 'logs'), NO_COLOR: '1' }
const re = new RegExp(EDITOR_LINE_REGEX)
const F = (o: object) => ({ id: 'abcd1234abcd1234', severity: 'high', check: SP, rule: 'github-pat', file: 'src/a.js', line: 2, column: null, message: 'a finding', status: 'new', ...o })
const doc = (...findings: object[]) => ({ findings })

describe('vscode', () => {
  test('is a JSON array of problems with file, line, column, severity, message, code and the finding id', () => {
    const text = editorOutput(doc(F({})), 'vscode')
    const list = JSON.parse(text)
    expect(list).toEqual([{ file: 'src/a.js', line: 2, column: 1, severity: 'error', message: 'a finding', code: 'github-pat', id: 'abcd1234abcd1234', check: SP }])
  })
  test('severity maps: critical/high error, medium warning, low/info info', () => {
    const sev = (s: string) => vscodeProblems(doc(F({ severity: s })))[0].severity
    expect([sev('critical'), sev('high'), sev('medium'), sev('low'), sev('info')]).toEqual(['error', 'error', 'warning', 'info', 'info'])
  })
  test('no findings is an empty array that still parses', () => {
    expect(JSON.parse(editorOutput(doc(), 'vscode'))).toEqual([])
    expect(JSON.parse(editorOutput({}, 'vscode'))).toEqual([])
  })
  test('a finding with no file or line says (no file) at 1:1; accepted and fixed ones are left out', () => {
    const list = vscodeProblems(doc(F({ file: null, line: null }), F({ id: 'x', status: 'accepted' }), F({ id: 'y', status: 'fixed' })))
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ file: '(no file)', line: 1, column: 1 })
  })
  test('newlines and control characters in a message cannot break the JSON or add a line', () => {
    const text = editorOutput(doc(F({ message: 'a\nb\u001b[31m "quoted" \\ back' })), 'vscode')
    expect(JSON.parse(text)[0].message).toBe('a b [31m "quoted" \\ back')
  })
  test('uses the rule when there is one and the check when there is not', () => {
    expect(vscodeProblems(doc(F({ rule: null })))[0].code).toBe(SP)
  })
})

describe('jetbrains', () => {
  test('one line per finding that the documented regex matches, with all six parts', () => {
    const lines = jetbrainsLines(doc(F({}), F({ id: 'ffff0000ffff0000', severity: 'medium', check: 'suite/some check', file: 'C:/p/x.ts', line: 7, message: 'colons: in: message' }), F({ id: 'e', file: null, severity: 'low' })))
    expect(lines).toHaveLength(3)
    for (const l of lines) expect(l).toMatch(re)
    const m = re.exec(lines[0])!
    expect(m.slice(1, 6)).toEqual(['src/a.js', '2', '1', 'error', SP])
    expect(m[6]).toContain('[abcd1234abcd1234]')
    expect(re.exec(lines[1])![1]).toBe('C:/p/x.ts')
    expect(re.exec(lines[1])![5]).toBe('suite/some-check')
    expect(re.exec(lines[2])![1]).toBe('(no file)')
  })
  test('a multi-line or control-laden message stays on one line', () => {
    const out = editorOutput(doc(F({ message: 'one\ntwo\r\nthree\u0007' })), 'jetbrains')
    expect(out.split('\n')).toHaveLength(1)
    expect(out).toMatch(re)
  })
  test('no findings prints nothing', () => {
    expect(editorOutput(doc(), 'jetbrains')).toBe('')
  })
  test('an unknown format prints nothing', () => {
    expect(editorOutput(doc(F({})), 'emacs')).toBe('')
  })
})

describe('docs/editor.md', () => {
  const text = readFileSync(join(here, '..', 'docs', 'editor.md'), 'utf8')
  test('shows the same regex the code uses, and a task JSON that parses', () => {
    expect(text).toContain(EDITOR_LINE_REGEX.replace(/\\\\/g, '\\'))
    const block = /```json\r?\n([\s\S]*?)```/.exec(text)![1]
    const task = JSON.parse(block.replace(/^\s*\/\/.*$/gm, ''))
    expect(task.tasks[0].args.join(' ')).toContain('--format jetbrains')
  })
  test('is linked from docs/how-to.md', () => {
    expect(readFileSync(join(here, '..', 'docs', 'how-to.md'), 'utf8')).toContain('editor.md')
  })
})

describe('a real run', () => {
  const fixture = () => {
    const dir = join(tmp, 'fx')
    mkdirSync(join(dir, 'src'), { recursive: true })
    execFileSync('git', ['init', '-q', dir], { env })
    writeFileSync(join(dir, 'src', 'a.js'), 'const k2 = "ghp' + '_abcdefghijklmnopqrstuvwxyz0123456789"\n')
    writeFileSync(join(dir, 'package.json'), '{"name":"fx"}')
    execFileSync('git', ['-C', dir, 'add', '-A'], { env })
    execFileSync('git', ['-C', dir, '-c', 'user.email=a@b.c', '-c', 'user.name=n', 'commit', '-qm', 'init'], { env })
    return dir
  }
  const run = (dir: string, fmt: string) => spawnSync(process.execPath, [join(here, '..', 'run.mjs'), '--app', dir, '--preset', 'quick', '--only', SP, '--plain', '--format', fmt], { env, encoding: 'utf8', timeout: 120000 })
  const dir = fixture()

  test('--format vscode: stdout is exactly one JSON array, ids match `meerkat findings`', () => {
    const r = run(dir, 'vscode')
    const list = JSON.parse(r.stdout)
    expect(Array.isArray(list)).toBe(true)
    const p = list.find((x: { check: string }) => x.check === SP)
    expect(p).toMatchObject({ file: 'src/a.js', line: 1, severity: 'error' })
    expect(p.id).toMatch(/^[0-9a-f]{16}$/)
    const out: string[] = []
    const plan = planCommand(['findings', '--app', dir, '--format', 'vscode'], { cwd: dir, env, interactive: false, presets: { user: {}, project: {} } })
    expect(plan.kind).toBe('noun')
    findingsCommand(plan, { out: (t: string) => out.push(t), err: (t: string) => out.push(t), env, cwd: dir })
    expect(JSON.parse(out.join('\n')).map((x: { id: string }) => x.id)).toContain(p.id)
    const json = spawnSync(process.execPath, [join(here, '..', 'bin', 'meerkat.mjs'), 'findings', '--app', dir, '--json'], { env, encoding: 'utf8' })
    expect(JSON.parse(json.stdout).findings.map((x: { id: string }) => x.id)).toContain(p.id)
  }, 130000)
  test('--format jetbrains: stdout is only matching lines', () => {
    const r = run(dir, 'jetbrains')
    const lines = r.stdout.split('\n').filter(Boolean)
    expect(lines.length).toBeGreaterThan(0)
    for (const l of lines) expect(l).toMatch(re)
    expect(lines.some((l: string) => l.startsWith(`src/a.js:1:1: error: ${SP}: `))).toBe(true)
  }, 130000)
  test('findings --format rejects an unknown format', () => {
    const plan = planCommand(['findings', '--format', 'emacs'], { cwd: dir, env, interactive: false, presets: { user: {}, project: {} } })
    expect(plan.kind).toBe('error')
  })
})

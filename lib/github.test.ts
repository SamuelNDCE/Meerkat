import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
// @ts-expect-error plain .mjs module
import { COMMENT_MARKER, annotation, appendStepSummary, buildComment, escapeData, escapeProperty, fileLink, gateAnnotations, gateSummary, postComment, upsertPlan } from './github.mjs'
// @ts-expect-error plain .mjs module
import { githubAnnotations, prComment } from './ci-output.mjs'
// @ts-expect-error plain .mjs module
import { gateMain, parseGateArgs } from './gate.mjs'

describe('workflow command escaping', () => {
  test('data escapes percent, CR and LF only', () => {
    expect(escapeData('100%\r\nnext: a,b')).toBe('100%25%0D%0Anext: a,b')
  })
  test('percent is escaped first, so codes are not escaped twice', () => {
    expect(escapeData('%0A')).toBe('%250A')
    expect(escapeProperty('%3A')).toBe('%253A')
  })
  test('properties also escape colon and comma', () => {
    expect(escapeProperty('C:\\a,b\nc')).toBe('C%3A\\a%2Cb%0Ac')
  })
  test('annotation builds a valid line and drops empty props', () => {
    expect(annotation('error', { file: 'a,b.js', line: 3, title: 'x:y', col: '' }, 'bad\nthing 100%')).toBe('::error file=a%2Cb.js,line=3,title=x%3Ay::bad%0Athing 100%25')
    expect(annotation('warning', {}, 'm')).toBe('::warning::m')
  })
  test('a message cannot start a second command', () => {
    expect(annotation('error', {}, 'x\n::error::injected')).not.toContain('\n')
  })
  test('finding annotations still use the same escaping', () => {
    const [l] = githubAnnotations({ findings: [{ severity: 'high', file: 'a,b.js', line: 0, rule: 'r:1', message: '100% bad\nline2' }] })
    expect(l).toBe('::error file=a%2Cb.js,line=1,title=r%3A1::100%25 bad%0Aline2')
  })
})

describe('gate output for GitHub', () => {
  const out = {
    files: ['a.js'],
    rows: [
      { kind: 'pass', id: 'ok-check' },
      { kind: 'fail', id: 'secrets', detail: '2 found: key,\nsecond line' },
      { kind: 'crash', id: 'broken' },
      { kind: 'notrun', id: 'skipped', detail: 'needs docker' },
    ],
  }
  test('one annotation per non-passing row', () => {
    const l = gateAnnotations(out)
    expect(l).toHaveLength(3)
    expect(l[0]).toBe('::error title=Meerkat secrets::secrets failed: 2 found: key,')
    expect(l[1]).toContain('::error title=Meerkat broken::broken tool crashed')
    expect(l[2].startsWith('::warning ')).toBe(true)
    expect(l.join('\n')).not.toContain('second line')
  })
  test('summary says failing and lists the rows', () => {
    const md = gateSummary('gate', out, 'changed since abc')
    expect(md).toContain('## Meerkat gate: failing')
    expect(md).toContain('`secrets`')
    expect(gateSummary('gate', { rows: [{ kind: 'pass', id: 'a' }], files: [] }, 'x')).toContain('passing')
  })
  test('step summary is written only inside Actions', () => {
    const dir = mkdtempSync(join(tmpdir(), 'meerkat-gh-'))
    try {
      expect(appendStepSummary('hi', {})).toBe(false)
      const f = join(dir, 'summary.md')
      expect(appendStepSummary('hi\n', { GITHUB_STEP_SUMMARY: f })).toBe(true)
      expect(readFileSync(f, 'utf8')).toBe('hi\n')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
  test('gate accepts --format github and rejects other formats', () => {
    expect(parseGateArgs(['--base', 'x', '--format', 'github']).errors).toEqual([])
    expect(parseGateArgs(['--format', 'xml']).errors.join()).toContain('--format only supports: github')
    expect(typeof gateMain).toBe('function')
  })
})

describe('pull request comment', () => {
  const doc = {
    findings: [
      { severity: 'low', file: 'src/low.js', line: 1, message: 'low one' },
      { severity: 'critical', file: 'src/a b.js', line: 12, message: 'crit\nmultiline', rule: 'secret' },
      { severity: 'high', file: 'src/h.js', line: 4, message: 'high one' },
      { severity: 'medium', file: 'm.js', message: 'med' },
      { severity: 'info', file: 'i.js', line: 9, message: 'info' },
      { severity: 'high', file: 'h2.js', line: 2, message: 'high two' },
      { severity: 'low', file: 'x.js', line: 2, message: 'accepted', status: 'accepted' },
    ],
  }
  const body = buildComment(doc, { repo: 'o/r', sha: 'abc123' })
  test('starts with the marker, then the blocking count', () => {
    const lines = body.split('\n')
    expect(lines[0]).toBe(COMMENT_MARKER)
    expect(lines[1]).toBe('## Meerkat: 3 blocking, 6 finding(s) in total')
  })
  test('top five by severity come first, accepted findings are left out', () => {
    const items = body.split('\n').filter((l) => l.startsWith('- '))
    expect(items[0]).toContain('**critical**')
    expect(items[1]).toContain('**high**')
    expect(items.slice(0, 5).join('\n')).not.toContain('i.js')
    expect(body).not.toContain('accepted')
    expect(body).toContain('<summary>1 more</summary>')
  })
  test('file:line links are blob links with an anchor and encoded paths', () => {
    expect(body).toContain('[src/a b.js:12](https://github.com/o/r/blob/abc123/src/a%20b.js#L12)')
    expect(body).toContain('[m.js](https://github.com/o/r/blob/abc123/m.js)')
    expect(fileLink({ file: 'a.js', line: 3 })).toBe('`a.js:3`')
  })
  test('ci-output prComment is the same builder, and empty runs still carry the marker', () => {
    expect(prComment(doc, { repo: 'o/r', sha: 'abc123' })).toBe(body)
    expect(prComment({ findings: [] })).toBe(`${COMMENT_MARKER}\nMeerkat found nothing new in this change.\n`)
  })
  test('upsertPlan updates the marked comment and creates only when none exists', () => {
    expect(upsertPlan([])).toEqual({ action: 'create' })
    expect(upsertPlan([{ id: 1, body: 'hello' }])).toEqual({ action: 'create' })
    expect(upsertPlan([{ id: 1, body: 'hello' }, { id: 7, body: `${COMMENT_MARKER}\nold` }])).toEqual({ action: 'update', id: 7 })
  })
  test('postComment updates in place and never posts a second comment (fake fetch, no network)', async () => {
    const calls: string[] = []
    const fake = async (url: string, init: { method: string; body?: string; headers: Record<string, string> }) => {
      calls.push(`${init.method} ${url.replace('https://api.github.com', '')}`)
      expect(init.headers.authorization).toBe('Bearer tok')
      const list = init.method === 'GET' ? [{ id: 42, body: `${COMMENT_MARKER}\nold` }] : { id: 42 }
      return { ok: true, status: 200, json: async () => list }
    }
    const r = await postComment({ body: 'new', repo: 'o/r', pr: 5, token: 'tok', fetchImpl: fake as never })
    expect(r).toEqual({ ok: true, detail: 'updated the existing comment' })
    expect(calls).toEqual(['GET /repos/o/r/issues/5/comments?per_page=100&page=1', 'PATCH /repos/o/r/issues/comments/42'])
  })
  test('postComment creates when there is no marked comment, and refuses without a token', async () => {
    const calls: string[] = []
    const fake = async (url: string, init: { method: string }) => {
      calls.push(init.method)
      return { ok: true, status: 200, json: async () => (init.method === 'GET' ? [] : {}) }
    }
    expect((await postComment({ body: 'b', repo: 'o/r', pr: 5, token: 't', fetchImpl: fake as never })).detail).toBe('posted a new comment')
    expect(calls).toEqual(['GET', 'POST'])
    const none = await postComment({ body: 'b', repo: 'o/r', pr: 5, token: '', fetchImpl: (() => { throw new Error('no network') }) as never })
    expect(none.ok).toBe(false)
  })
})

describe('the example workflow', () => {
  const text = readFileSync(new URL('../examples/github/meerkat.yml', import.meta.url), 'utf8')
  test('has no tabs and parses as plain block YAML (spaces only, key: value lines)', () => {
    expect(text).not.toMatch(/\t/)
    for (const l of text.split('\n')) {
      if (!l.trim() || l.trim().startsWith('#')) continue
      expect(l).toMatch(/^( *)(- )?[\w.-]+:( .*)?$|^ *- .+$|^ {10,}\S.*$/)
    }
  })
  test('runs on pull_request and push with full history and the real gate flags', () => {
    expect(text).toMatch(/^on:\n {2}pull_request:\n {2}push:/m)
    expect(text).toContain('fetch-depth: 0')
    expect(text).toContain('npx -y @samuelndce/meerkat gate --base "$BASE_SHA" --format github')
  })
  test('package name and flags are real', () => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
    expect(text).toContain(pkg.name)
  })
  test('actions are pinned by 40-character SHA and the only secret is GITHUB_TOKEN', () => {
    const uses = [...text.matchAll(/uses: (\S+)/g)].map((m) => m[1])
    expect(uses.length).toBeGreaterThan(0)
    for (const u of uses) expect(u).toMatch(/^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/)
    const secrets = [...text.matchAll(/secrets\.(\w+)/g)].map((m) => m[1])
    expect([...new Set(secrets)]).toEqual(['GITHUB_TOKEN'])
    expect(text).not.toMatch(/\bgh (pr|api|issue)\b/)
  })
})

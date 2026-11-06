// The accessibility gap module: each rule finds its broken case, stays quiet on the good case, gives line + evidence + fix text, never edits a file,
// and re-checks its own suggested fix (PASS). Also runs every rule's self-test fixture through the real command line.
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
// @ts-expect-error plain .mjs module
import { analyze, FIXTURES, GAPS, packChecks, recheck, RULE_IDS } from './a11y.mjs'

const SCRIPT = join(__dirname, 'a11y.mjs')
const one = (file: string, text: string, rule: string) => analyze({ [file]: text }, [rule])

const BROKEN: Record<string, [string, string]> = {
  'a11y-img-alt': ['a.html', '<p>x</p>\n<area shape="rect" coords="0,0,1,1" href="/a">\n'],
  'a11y-form-label': ['a.tsx', 'const A = () => (\n  <form>\n    <input type="text" name="q" />\n  </form>\n)\n'],
  'a11y-button-name': ['a.html', '<div>\n<button class="x"><svg viewBox="0 0 8 8"><path d="M0 0"/></svg></button>\n</div>\n'],
  'a11y-link-name': ['a.html', '<nav>\n<a href="/"><img src="l.png" alt=""></a>\n</nav>\n'],
  'a11y-html-lang': ['layout.tsx', 'export default () => (\n  <html>\n    <body />\n  </html>\n)\n'],
  'a11y-heading-order': ['P.svelte', '<h1>A</h1>\n<h2>B</h2>\n<h4>C</h4>\n'],
}
const LINES: Record<string, number> = { 'a11y-img-alt': 2, 'a11y-form-label': 3, 'a11y-button-name': 2, 'a11y-link-name': 2, 'a11y-html-lang': 2, 'a11y-heading-order': 3 }

describe('every rule: finding shape and self re-check', () => {
  for (const id of RULE_IDS) {
    test(`${id} reports rule id, file, line, evidence, fix text, and its fix re-checks PASS`, () => {
      const [file, text] = BROKEN[id]
      const found = one(file, text, id)
      expect(found).toHaveLength(1)
      const f = found[0]
      expect(f.rule).toBe(id)
      expect(f.file).toBe(file)
      expect(f.line).toBe(LINES[id])
      expect(f.evidence.length).toBeGreaterThan(3)
      expect(f.fix.length).toBeGreaterThan(10)
      expect(f.fixedSnippet).not.toBe('')
      expect(f.recheck).toBe('PASS')
    })
    test(`${id} re-check is real: a fix that does not fix FAILS`, () => {
      const [file, text] = BROKEN[id]
      const f = one(file, text, id)[0]
      const bad = { ...f, fixedSnippet: f.context ? f.fixedSnippet.replace(/h[1-6]/g, 'h6') : text }
      expect(recheck(bad)).toBe('FAIL')
    })
  }
})

describe('good markup raises nothing', () => {
  const GOOD: Record<string, [string, string]> = {
    'a11y-img-alt': ['a.html', '<area href="/a" alt="Map north"><input type="image" src="g.png" alt="Go"><span role="img" aria-label="ok"></span>'],
    'a11y-form-label': ['a.html', '<label for="q">Q</label><input id="q"><label>Name <textarea></textarea></label><select aria-label="Size"></select><input type="hidden"><input {...props}>'],
    'a11y-button-name': ['a.html', '<button>Save</button><button aria-label="Close"><svg/></button><button><img src="a.png" alt="Edit"></button><button>{label}</button><button><Icon /></button>'],
    'a11y-link-name': ['a.html', '<a href="/"><img src="l.png" alt="Home"></a><a href="/x" aria-label="X"><svg/></a><a href="/y"><svg><title>Why</title></svg></a>'],
    'a11y-html-lang': ['a.tsx', '<html lang="en"><body/></html>'],
    'a11y-heading-order': ['a.tsx', '<h2>a</h2><h3>b</h3><h2>c</h2>'],
  }
  for (const id of RULE_IDS) {
    test(`${id}: no findings`, () => {
      const [file, text] = GOOD[id]
      expect(one(file, text, id)).toEqual([])
    })
  }
})

describe('rule details', () => {
  test('img: a plain img with no alt is found with its line, and the fix adds alt', () => {
    const f = one('a.html', '<p>\n<img src="a.png">\n</p>', 'a11y-img-alt')[0]
    expect(f.line).toBe(2)
    expect(f.fixedSnippet).toContain('alt=')
    expect(f.recheck).toBe('PASS')
  })
  test('img: empty alt (decorative) and a spread are accepted', () => {
    expect(one('a.tsx', '<img src="a.png" alt="" /><img {...p} />', 'a11y-img-alt')).toEqual([])
  })
  test('img: role="img" with no name is found', () => {
    expect(one('a.html', '<div role="img"></div>', 'a11y-img-alt')).toHaveLength(1)
  })
  test('form: select and textarea are found, and a label for another id does not count', () => {
    const t = '<label for="a">A</label><select id="b"></select><textarea></textarea>'
    expect(one('a.html', t, 'a11y-form-label')).toHaveLength(2)
  })
  test('form: JSX htmlFor and an arrow function in an attribute are read correctly', () => {
    const t = '<label htmlFor="n">N</label><input id="n" onChange={(e) => set(e.target.value)} />'
    expect(one('a.tsx', t, 'a11y-form-label')).toEqual([])
    expect(one('a.tsx', '<input onChange={(e) => set(e.target.value)} />', 'a11y-form-label')).toHaveLength(1)
  })
  test('button: an empty button and role="button" div are found', () => {
    expect(one('a.html', '<button></button><div role="button"><svg/></div>', 'a11y-button-name')).toHaveLength(2)
  })
  test('link: an empty link is left to link-text (not duplicated here)', () => {
    expect(one('a.html', '<a href="/x"></a>', 'a11y-link-name')).toEqual([])
  })
  test('lang: .html without lang is left to ui-static, but an empty or malformed value is found', () => {
    expect(one('a.html', '<html><body/></html>', 'a11y-html-lang')).toEqual([])
    expect(one('a.html', '<html lang=""><body/></html>', 'a11y-html-lang')).toHaveLength(1)
    expect(one('a.html', '<html lang="english please"><body/></html>', 'a11y-html-lang')).toHaveLength(1)
    expect(one('a.svelte', '<html lang={locale}></html>', 'a11y-html-lang')).toEqual([])
  })
  test('heading: .html is left to html-structure; a component starting at h3 is allowed', () => {
    expect(one('a.html', '<h1>a</h1><h4>b</h4>', 'a11y-heading-order')).toEqual([])
    expect(one('a.vue', '<h3>a</h3><h4>b</h4>', 'a11y-heading-order')).toEqual([])
    expect(one('a.vue', '<h2>a</h2><h5>b</h5>', 'a11y-heading-order')[0].fixedSnippet).toBe('<h3>b</h3>')
  })
  test('comments and script blocks are not read', () => {
    expect(analyze({ 'a.html': '<!-- <img src="x"> -->\n<script>const s = "<img src=1>"</script>' }, ['a11y-img-alt'])).toEqual([])
  })
  test('the allow list drops a finding by file or file:line', () => {
    const files = { 'a.html': '<img src="a.png">' }
    expect(analyze(files, ['a11y-img-alt'], new Set(['a11y-img-alt a.html']))).toEqual([])
    expect(analyze(files, ['a11y-img-alt'], new Set(['a11y-img-alt a.html:1']))).toEqual([])
    expect(analyze(files, ['a11y-img-alt'])).toHaveLength(1)
  })
})

describe('command line and pack wiring', () => {
  for (const id of RULE_IDS) {
    test(`${id} --fixtures exits 1 and says "found" (the selfTest contract)`, () => {
      const r = spawnSync('node', [SCRIPT, id, '--fixtures'], { encoding: 'utf8' })
      expect(r.status).toBe(1)
      expect(r.stdout).toMatch(/found/)
      expect(r.stdout).toMatch(/Re-check of the fix: PASS/)
    })
  }
  test('a clean folder exits 0 and a broken file is never modified', () => {
    const dir = mkdtempSync(join(tmpdir(), 'a11y-test-'))
    try {
      execFileSync('git', ['init', '-q'], { cwd: dir })
      const src = '<img src="a.png">\n'
      writeFileSync(join(dir, 'p.html'), src)
      execFileSync('git', ['add', 'p.html'], { cwd: dir })
      const r = spawnSync('node', [SCRIPT, 'a11y-img-alt', '--root', dir], { encoding: 'utf8' })
      expect(r.status).toBe(1)
      expect(r.stdout).toContain('p.html:1')
      expect(readFileSync(join(dir, 'p.html'), 'utf8')).toBe(src)
      writeFileSync(join(dir, 'p.html'), '<img src="a.png" alt="A cat">\n')
      expect(spawnSync('node', [SCRIPT, 'a11y-img-alt', '--root', dir], { encoding: 'utf8' }).status).toBe(0)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
  test('pack entries carry a selfTest with expectFail and expectMatch, and every rule has a fixture and a gap note', () => {
    expect(packChecks).toHaveLength(RULE_IDS.length)
    for (const c of packChecks) {
      expect(c.selfTest.expectFail).toBe(true)
      expect(c.selfTest.expectMatch).toBeTruthy()
      expect(FIXTURES[c.id]).toBeTruthy()
      expect(GAPS[c.id]).toBeTruthy()
    }
  })
})

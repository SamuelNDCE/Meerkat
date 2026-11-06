// risky-code / innerhtml-assignment precision: values that are author-written (a constant table), escaped, or sanitised are not reported, and real injection still is.
// Each case builds a small folder of its own and runs the check script on it.
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, test } from 'vitest'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const made: string[] = []
afterAll(() => {
  for (const d of made) rmSync(d, { recursive: true, force: true })
})

// Runs risky-code on a folder with the given files and returns the exit code and output.
function run(files: Record<string, string>, extra: string[] = []): { code: number; out: string } {
  const dir = mkdtempSync(join(tmpdir(), 'meerkat-xss-'))
  made.push(dir)
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, name)), { recursive: true })
    writeFileSync(join(dir, name), text)
  }
  for (let attempt = 0; ; attempt++) {
    try {
      const out = execFileSync(process.execPath, ['thorough/static.mjs', 'risky-code', '--root', dir, ...extra], { cwd: ROOT, stdio: 'pipe', encoding: 'utf8' })
      return { code: 0, out }
    } catch (e: any) {
      // Windows reports 0xC0000142 when a process cannot start because the machine is out of resources: try again.
      if (e.status === 3221225794 && attempt < 3) continue
      return { code: e.status ?? -1, out: String(e.stdout ?? '') }
    }
  }
}
const js = (code: string, extra: Record<string, string> = {}) => run({ 'a.js': code + '\n', ...extra })
const TABLE = "const ICON = { close: '<svg></svg>', open: '<svg/>' }\n"

describe('shapes that take raw input are still reported', () => {
  const positives: Record<string, string> = {
    'location.hash': 'el.innerHTML = location.hash',
    'req.query.x': 'el.innerHTML = req.query.x',
    'a variable with no escape': 'el.innerHTML = name',
    'unescaped concatenation': "el.innerHTML = '<b>' + name + '</b>'",
    'unescaped template': 'el.innerHTML = `<b>${name}</b>`',
    'escaped part then a raw part': 'el.innerHTML = esc(a) + b',
    'raw part then an escaped part': 'el.innerHTML = b + esc(a)',
    'a sanitised part then raw markup from a variable': 'el.innerHTML = sanitize(a) + tail',
    'a sanitiser result followed by more member access': 'el.innerHTML = esc(a).foo',
    'a call whose argument is raw': 'el.innerHTML = render(text)',
    'a call with one escaped and one raw argument': 'el.innerHTML = render(esc(a), b)',
    'a computed key into a table': TABLE + 'el.innerHTML = ICON[name]',
    'a lower-case object that is not a constant table': 'el.innerHTML = icons.close',
    'a template with a raw part next to an escaped one': 'el.innerHTML = `<i>${esc(a)}</i>${b}`',
    'a name that only looks like a cleaner': 'el.innerHTML = escalate(text)',
    'a wrapper around esc (changed 2026-11-06: was accepted)': 'el.innerHTML = render(esc(text))',
    'esc nested two deep inside wrappers (changed 2026-11-06: was accepted)': 'el.innerHTML = wrap(render(esc(text)), "x")',
    'an append of raw input': 'el.innerHTML += userText',
  }
  for (const [label, code] of Object.entries(positives)) {
    test(`flags ${label}`, () => {
      const r = js(code)
      expect(r.code, r.out).toBe(1)
      expect(r.out).toContain('innerHTML assignment')
    })
  }
  test('a table that is also assigned to is not constant', () => {
    expect(js(TABLE + 'ICON.close = userHtml\nel.innerHTML = ICON.close').code).toBe(0) // ALL_CAPS convention, as before
    expect(js("const icons = { close: '<svg/>' }\nicons.close = userHtml\nel.innerHTML = icons.close").code).toBe(1)
  })
})

describe('shapes that are author-written, escaped or sanitised are not reported', () => {
  const negatives: Record<string, string> = {
    'a constant table lookup': TABLE + 'btn.innerHTML = ICON.close',
    'a lower-case constant table of strings': "const icons = { close: '<svg/>' }\nbtn.innerHTML = icons.close",
    'a constant array literal': "const ROWS = ['<li>a</li>', '<li>b</li>']\nlist.innerHTML = ROWS[0]",
    'an esc-wrapped call': 'el.innerHTML = esc(text)',
    'escape': 'el.innerHTML = escape(text)',
    'escapeHtml joined with literals': "el.innerHTML = '<b>' + escapeHtml(name) + '</b>'",
    'an escaped template part': 'el.innerHTML = `<b>${esc(name)}</b>`',
    'a sanitize call on any receiver': 'el.innerHTML = cleaner.sanitize(x)',
    'purify.sanitize with a config argument': 'el.innerHTML = purify.sanitize(chunk, CONFIG)',
    'DOMPurify.sanitize': 'el.innerHTML = DOMPurify.sanitize(x)',
    'a bare sanitize': 'el.innerHTML = sanitize(x)',
    'a bare purify': 'el.innerHTML = purify(x)',
    'a sanitised value followed by a comment': 'el.innerHTML = DOMPurify.sanitize(x) // cleaned',
    'a constant joined with an escaped value': TABLE + "el.innerHTML = ICON.close + esc(label)",
    'a multi-line join of safe parts': "el.innerHTML = '<b>' +\n  esc(a) +\n  '</b>'",
  }
  for (const [label, code] of Object.entries(negatives)) {
    test(`does not flag ${label}`, () => {
      const r = js(code)
      expect(r.code, r.out).toBe(0)
      expect(r.out).not.toContain('innerHTML')
    })
  }
  test('insertAdjacentHTML with an escaped value is not flagged, a raw one is', () => {
    expect(js("el.insertAdjacentHTML('beforeend', esc(row))").code).toBe(0)
    expect(js("el.insertAdjacentHTML('beforeend', row)").code).toBe(1)
  })
})

describe('.meerkat-xss-safe vouches for a project helper', () => {
  test('a name in the file is honoured', () => {
    const r = js('el.innerHTML = mine(x)', { '.meerkat-xss-safe': 'mine # strips every tag, reviewed\n' })
    expect(r.code, r.out).toBe(0)
  })
  test('a dotted call is honoured by its last part, and case is ignored', () => {
    expect(js('el.innerHTML = util.Mine(x)', { '.meerkat-xss-safe': 'mine # reviewed\n' }).code).toBe(0)
  })
  test('comment lines and blank lines are ignored, and the reason is optional', () => {
    expect(js('el.innerHTML = mine(x)', { '.meerkat-xss-safe': '# notes\n\nmine\n' }).code).toBe(0)
  })
  test('an unknown name still flags, with or without an allow file', () => {
    expect(js('el.innerHTML = other(x)').code).toBe(1)
    expect(js('el.innerHTML = other(x)', { '.meerkat-xss-safe': 'mine # reviewed\n' }).code).toBe(1)
  })
  test('a vouched name does not clean a raw part next to it', () => {
    expect(js('el.innerHTML = mine(a) + b', { '.meerkat-xss-safe': 'mine # reviewed\n' }).code).toBe(1)
  })
  test('a name only in a reason comment is not vouched', () => {
    expect(js('el.innerHTML = other(x)', { '.meerkat-xss-safe': 'mine # other is not vouched\n' }).code).toBe(1)
  })
})

describe('wrappers of a cleaner are not safe (fail closed)', () => {
  const vouch = (text: string) => ({ '.meerkat-xss-safe': text })
  test('unwrap(esc(x)) flags', () => {
    expect(js('el.innerHTML = unwrap(esc(x))').code).toBe(1)
  })
  test('render(esc(x)) flags unless render is vouched', () => {
    expect(js('el.innerHTML = render(esc(x))').code).toBe(1)
    expect(js('el.innerHTML = render(esc(x))', vouch('render # reviewed, only places text\n')).code).toBe(0)
  })
  test('a decoder wrapping a cleaner flags even when vouched', () => {
    expect(js('el.innerHTML = decodeURIComponent(esc(x))').code).toBe(1)
    expect(js('el.innerHTML = decodeURIComponent(esc(x))', vouch('decodeURIComponent\n')).code).toBe(1)
    expect(js('el.innerHTML = rawHtml(x)', vouch('rawHtml # reviewed\n')).code).toBe(1)
    expect(js('el.innerHTML = atob(x)', vouch('atob # reviewed\n')).code).toBe(1)
  })
})

describe('the scanner reads the value as JavaScript does', () => {
  test('a // comment then a continuation line with a raw variable flags', () => {
    expect(js("el.innerHTML = '<b>' // safe so far\n  + name").code).toBe(1)
    expect(js('el.innerHTML = esc(a) // note\n  // another note\n  + raw').code).toBe(1)
    expect(js('el.innerHTML = esc(a) // note\n  .concat(raw)').code).toBe(1)
  })
  test('a // comment then an unrelated statement still ends the value', () => {
    expect(js('el.innerHTML = esc(a) // note\nnext()').code).toBe(0)
  })
  test('a // comment between safe continuation lines is not flagged', () => {
    expect(js("el.innerHTML = '<b>' // open\n  + esc(a) // text\n  + '</b>'").code).toBe(0)
  })
})

describe('decoder names are judged on whole name parts', () => {
  const vouch = (text: string) => ({ '.meerkat-xss-safe': text })
  for (const name of ['unescapeHtml', 'decodeHtml', 'rawSafe', 'he.unescape']) {
    test(`${name} is a decoder: flagged even when vouched`, () => {
      expect(js(`el.innerHTML = ${name}(x)`, vouch(`${name}\n`)).code).toBe(1)
    })
  }
  for (const name of ['drawChart', 'withdrawHtml']) {
    test(`${name} is not a decoder: accepted when vouched and its argument is safe`, () => {
      expect(js(`el.innerHTML = ${name}(esc(x))`, vouch(`${name}\n`)).code).toBe(0)
      expect(js(`el.innerHTML = ${name}(esc(x))`).code).toBe(1) // not vouched
    })
  }
})

describe('comments are removed before the value is read', () => {
  test('a // comment inside a call parenthesis cannot hide a raw continuation', () => {
    expect(js('el.innerHTML = esc(a // )\n) + raw').code).toBe(1)
  })
  test('a /* */ comment between a safe value and a raw continuation flags', () => {
    expect(js("el.innerHTML = '<b>' /* c */ + raw").code).toBe(1)
    expect(js("el.innerHTML = esc(a) /* ) */ + raw").code).toBe(1)
  })
  test('a block comment on its own line before a raw continuation flags', () => {
    expect(js("el.innerHTML = '<b>'\n/* c */\n+ raw").code).toBe(1)
    expect(js("el.innerHTML = '<b>' /* c */\n+ raw").code).toBe(1)
  })
  test('comments between safe parts are still accepted', () => {
    expect(js("el.innerHTML = '<b>' /* open */ + esc(a) /* text */ + '</b>'").code).toBe(0)
    expect(js("el.innerHTML = '<b>'\n/* c */\n+ esc(a)").code).toBe(0)
  })
})

describe('the risky-code self-test', () => {
  test('--fixtures fails for the reasons it is meant to', () => {
    let out = ''
    let code = 0
    try {
      out = execFileSync(process.execPath, ['thorough/static.mjs', 'risky-code', '--fixtures'], { cwd: ROOT, stdio: 'pipe', encoding: 'utf8' })
    } catch (e: any) {
      code = e.status ?? -1
      out = String(e.stdout ?? '')
    }
    expect(code).toBe(1)
    expect(out).toContain('eval() runs text as code')
    expect(out).toContain('innerHTML assignment')
  })
})

describe('regex literals are not comments', () => {
  test('a regex holding // before a raw value still flags', () => {
    expect(js(String.raw`x = /\/\//; el.innerHTML = raw`).code).toBe(1)
  })
  test('a regex holding // before a safe value does not hide or swallow it', () => {
    expect(js(String.raw`const re = /\/\//; el.innerHTML = esc(a)`).code).toBe(0)
  })
  test('a regex holding /* before a safe value is not an unterminated comment', () => {
    expect(js(String.raw`const re = /a\/*b/; el.innerHTML = esc(a)` + '\nnext()').code).toBe(0)
  })
  test('a regex inside the value is judged as a raw part', () => {
    expect(js(String.raw`el.innerHTML = esc(a) + /a\/*b/.source + raw`).code).toBe(1)
    expect(js(String.raw`el.innerHTML = esc(a) + /\/\//.source + raw`).code).toBe(1)
    expect(js(String.raw`el.innerHTML = esc(a) + /a\/*b/.source`).code).toBe(1)
  })
  test('a regex holding a quote does not open a string', () => {
    expect(js("const re = /'/; el.innerHTML = esc(a) // it's\n  + raw").code).toBe(1)
  })
  test('an unterminated regex fails closed', () => {
    expect(js('x = /abc\nel.innerHTML = esc(a)').code).toBe(1)
  })
  test('a real // comment still blanks', () => {
    expect(js('el.innerHTML = esc(a) // note + raw').code).toBe(0)
    expect(js('el.innerHTML = esc(a) // note\n  + raw').code).toBe(1)
  })
  test('division is not a regex', () => {
    expect(js('el.innerHTML = esc(a / 2) // x').code).toBe(0)
  })
})

describe('decoder stems', () => {
  const vouch = (text: string) => ({ '.meerkat-xss-safe': text })
  for (const name of ['decodeHtmlEntities', 'unescapeAll', 'rawSafe', 'rawHtml', 'htmlDecode', 'decodingHtml', 'unescapingAll', 'rawsafe', 'decodeHTMLEntities']) {
    test(`${name} flags even when vouched`, () => {
      expect(js(`el.innerHTML = ${name}(esc(x))`, vouch(`${name}\n`)).code).toBe(1)
    })
  }
  test('decodeHtmlEntities(esc(x)) and unescapeAll(x) flag', () => {
    expect(js('el.innerHTML = decodeHtmlEntities(esc(x))', vouch('decodeHtmlEntities\n')).code).toBe(1)
    expect(js('el.innerHTML = unescapeAll(x)', vouch('unescapeAll\n')).code).toBe(1)
  })
  for (const name of ['drawChart', 'withdrawHtml', 'withdrawAll']) {
    test(`${name}(esc(x)) is accepted when vouched`, () => {
      expect(js(`el.innerHTML = ${name}(esc(x))`, vouch(`${name}\n`)).code).toBe(0)
    })
  }
})

describe('the scan window is measured on code, not on blanked text', () => {
  test('a value, 2500 characters of comment, then + raw flags', () => {
    expect(js(`el.innerHTML = esc(a) /* ${'x'.repeat(2500)} */ + raw`).code).toBe(1)
    expect(js(`el.innerHTML = esc(a) // ${'x'.repeat(2500)}\n  + raw`).code).toBe(1)
  })
  test('a value, 1500 characters of whitespace, then + raw flags', () => {
    expect(js(`el.innerHTML = esc(a)${' '.repeat(1500)}\n  + raw`).code).toBe(1)
  })
  test('a value followed by 1000 characters of whitespace and a clear end is accepted', () => {
    expect(js(`el.innerHTML = esc(a)${' '.repeat(1000)}\nnext()`).code).toBe(0)
    expect(js(`el.innerHTML = esc(a)${' '.repeat(1000)};`).code).toBe(0)
  })
  test('a long comment between safe parts is accepted', () => {
    expect(js(`el.innerHTML = '<b>' /* ${'x'.repeat(2500)} */ + esc(a)`).code).toBe(0)
  })
  test('a call whose arguments hold a long comment is judged, not abandoned', () => {
    expect(js(`el.innerHTML = esc(a /* ${'x'.repeat(900)} */)`).code).toBe(0)
  })
  test('a statement that does not end within 2000 characters of code fails closed', () => {
    const parts = Array.from({ length: 500 }, () => "'<i>'").join(' + ')
    expect(js(`el.innerHTML = ${parts}\nnext()`).code).toBe(1)
  })
})

// Five rules found missing by an end-to-end test on a planted app (thorough/gap-rules.mjs). Each: the broken folder fails for the right reason,
// its clean twin passes, narrowing cases stay quiet, and (when the planted app sits beside this repository) the real planted file is found.
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, test } from 'vitest'
// @ts-ignore plain .mjs module has no type declarations
import { BROKEN, CLEAN, IDS } from '../thorough/gap-rules.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const SCRIPT = join(ROOT, 'thorough', 'gap-rules.mjs')
const made: string[] = []
afterAll(() => {
  for (const d of made) rmSync(d, { recursive: true, force: true })
})
const folder = (files: Record<string, string>) => {
  const dir = mkdtempSync(join(tmpdir(), 'meerkat-gap-'))
  made.push(dir)
  for (const [name, body] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, name)), { recursive: true })
    writeFileSync(join(dir, name), body)
  }
  return dir
}
const run = (id: string, dir: string) => {
  const r = spawnSync(process.execPath, [SCRIPT, id, '--root', dir], { encoding: 'utf8' })
  const out = `${r.stdout}${r.stderr}`
  return { code: r.status, out, found: (out.match(/^MEERKAT-FINDING /gm) ?? []).length }
}
const EXPECT: Record<string, RegExp> = {
  'key-in-config': /looks like a (real key|key and also looks like a fake placeholder)/,
  'test-no-assert': /runs code but never asserts/,
  'img-alt-missing': /<img> has no alt attribute/,
  'scripts-binaries': /starts with "securitycheck-nope"/,
  'payment-status-unchecked': /candidate: "result" holds the result/,
}

describe.each(IDS as string[])('%s', (id) => {
  test('the broken folder fails for the right reason', () => {
    const r = run(id, folder(BROKEN[id]))
    expect(r.code).toBe(1)
    expect(r.out).toMatch(EXPECT[id])
    expect(r.found).toBeGreaterThan(0)
  })
  test('the clean twin passes', () => {
    const r = run(id, folder(CLEAN[id]))
    expect(r.out).not.toMatch(/MEERKAT-FINDING/)
    expect(r.code).toBe(0)
  })
  test('the allow file silences it', () => {
    const r = run(id, folder({ ...BROKEN[id], '.meerkat-gap-allow': `${id} *\n` }))
    expect(r.code).toBe(0)
  })
})

describe('key-in-config narrowing', () => {
  test('a fake-looking value says so, a real-looking one does not', () => {
    const fake = run('key-in-config', folder({ 'c.ts': "export const c = { paymentsKey: 'sk_test_FAKE_ONLY_1234567890' }\n" }))
    expect(fake.out).toMatch(/looks like a fake placeholder/)
    const real = run('key-in-config', folder({ 'c.ts': "export const c = { apiKey: 'AKIAABCDEFGHIJKLMNOP' }\n" }))
    expect(real.out).toMatch(/looks like a real key/)
    expect(real.out).not.toMatch(/fake placeholder/)
  })
  test('environment reads, short values, non-key names and test fixtures are quiet', () => {
    const r = run('key-in-config', folder({
      'a.ts': "export const a = { paymentsKey: process.env.PAYMENTS_KEY, name: 'sk_live_abcdefghijkl', apiKey: 'xyz' }\n",
      'b.json': '{"title": "ghp_abcdefghijklmnop"}\n',
      'test/fixtures/k.ts': "export const apiKey = 'sk_live_abcdefghijklmnop'\n",
    }))
    expect(r.code).toBe(0)
  })
  test('json and yaml configs are read', () => {
    expect(run('key-in-config', folder({ 'c.json': '{"slackToken": "xoxb-1234567890-abcdefghij"}\n' })).code).toBe(1)
    expect(run('key-in-config', folder({ 'c.yml': 'secret: ghp_abcdefghijklmnopqrstuv\n' })).code).toBe(1)
  })
})

describe('test-no-assert narrowing', () => {
  test('a helper that asserts, a todo, a skip and a test with no call are quiet', () => {
    const r = run('test-no-assert', folder({
      'a.test.ts': "import { test, expect } from 'vitest'\nconst same = (a: number, b: number) => expect(a).toBe(b)\ntest('x', () => {\n  same(add(1, 2), 3)\n})\ntest.todo('later')\ntest.skip('slow', () => {\n  add(1, 1)\n})\ntest('plain', () => {\n  const n = 3\n})\n",
    }))
    expect(r.code).toBe(0)
  })
  test('a second test with no assertion in a file that asserts elsewhere is found, with its line', () => {
    const r = run('test-no-assert', folder({ 'a.test.js': "import { test, expect } from 'vitest'\ntest('a', () => {\n  expect(add(1, 2)).toBe(3)\n})\ntest('b', () => {\n  add(2, 2)\n})\n" }))
    expect(r.out).toMatch(/a\.test\.js:5 test "b"/)
  })
  test('a non-test file is not read', () => {
    expect(run('test-no-assert', folder({ 'src/a.ts': "test('x', () => {\n  run()\n})\n" })).code).toBe(0)
  })
})

describe('img-alt-missing narrowing', () => {
  test('alt="" is decoration, a spread may carry alt, a role of presentation is fine', () => {
    const r = run('img-alt-missing', folder({
      'a.html': '<img src="a.png" alt="">\n<img src="b.png" role="presentation">\n<!-- <img src="c.png"> -->\n',
      'B.tsx': 'export const B = (p) => <img {...p} />\n',
      'C.vue': '<template><img :src="u" :alt="t"></template>\n',
    }))
    expect(r.code).toBe(0)
  })
  test('a multi-line tag and a JSX arrow function inside the tag are read whole', () => {
    const r = run('img-alt-missing', folder({ 'A.tsx': 'export const A = () => (\n  <img\n    src="a.png"\n    onLoad={() => go(1)}\n  />\n)\n' }))
    expect(r.out).toMatch(/A\.tsx:2 /)
  })
})

describe('scripts-binaries narrowing', () => {
  test('builtins, paths, env prefixes, declared dependencies and installed binaries are quiet', () => {
    const r = run('scripts-binaries', folder({
      'package.json': '{"scripts":{"a":"FOO=1 tsc -p .","b":"./scripts/x.sh","c":"rm -rf dist && mkdir dist","d":"cd sub && npm test","e":"$CMD run","f":"eslint ."},"devDependencies":{"typescript":"^5"}}\n',
      'node_modules/.bin/eslint': '',
      'node_modules/.bin/tsc': '',
    }))
    expect(r.code).toBe(0)
  })
  test('with node_modules installed, a binary that is not in .bin is found even if declared', () => {
    const r = run('scripts-binaries', folder({
      'package.json': '{"scripts":{"lint":"nope-lint src"},"devDependencies":{"nope-lint":"^1"}}\n',
      'node_modules/.bin/other': '',
    }))
    expect(r.out).toMatch(/starts with "nope-lint", which is not in node_modules\/\.bin/)
  })
  test('it never runs the script', () => {
    const dir = folder({ 'package.json': '{"scripts":{"boom":"audit-nope && node -e \\"require(\'fs\').writeFileSync(\'ran.txt\',\'x\')\\""}}\n' })
    run('scripts-binaries', dir)
    expect(existsSync(join(dir, 'ran.txt'))).toBe(false)
  })
})

describe('payment-status-unchecked narrowing', () => {
  test('status, ok, error checks and a try block are quiet; a bare await and other names are not read', () => {
    const r = run('payment-status-unchecked', folder({
      'a.ts': "async function a() {\n  const r = await refund(1)\n  if (!r.ok) throw new Error('x')\n}\nasync function b() {\n  try {\n    const r = await transfer(1, 2)\n    return r\n  } catch (e) {\n    return null\n  }\n}\nasync function c() {\n  await chargeCard(1)\n  const shot = await win.capture()\n  const d = await loadChargeList()\n}\n",
    }))
    expect(r.code).toBe(0)
  })
  test('an awaited stripe-style charges.create with no check is a candidate', () => {
    const r = run('payment-status-unchecked', folder({ 'a.ts': 'async function a() {\n  const c = await stripe.charges.create({ amount: 1 })\n  return c.id\n}\n' }))
    expect(r.out).toMatch(/a\.ts:2 candidate/)
    expect(r.out).toMatch(/MEERKAT-FINDING low/)
  })
})

// The real planted app, when it sits beside this repository (read-only): one finding per rule, none from the decoys.
const PLANTED = join(ROOT, '..', 'meerkat-e2e-fixture')
describe.skipIf(!existsSync(join(PLANTED, 'TRUTH.md')))('the planted app', () => {
  const WHERE: Record<string, string> = {
    'key-in-config': 'src/config.ts:4',
    'test-no-assert': 'test/users.test.ts:6',
    'img-alt-missing': 'templates/welcome.html:3',
    'scripts-binaries': 'package.json:10',
    'payment-status-unchecked': 'src/routes/payments.ts:13',
  }
  test.each(Object.entries(WHERE))('%s finds exactly its planted file and line', (id, where) => {
    const r = run(id, PLANTED)
    expect(r.found).toBe(1)
    expect(r.out).toContain(`${where} `)
  })
})

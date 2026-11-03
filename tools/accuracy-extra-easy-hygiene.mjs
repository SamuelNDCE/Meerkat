// Planted defects, EASY tier, code hygiene: a one-line pattern a rule finds without needing context (debug leftovers, focused or
// skipped tests, type-check escapes, loose equality, public IPs, whitespace, Makefile tabs, conflict markers).
// Each has a clean twin in `easy-hygiene-clean`. Keys are prefixed `easy-`.

export function projects(ctx) {
  const { d, tidy } = ctx
  const expect = {}
  const bad = {}
  const good = {}
  const add = (key, id, desc, file, pre, line, post, fix) => {
    const k = `easy-${key}`
    expect[k] = id
    bad[file] = [...pre, d(k, desc, line), ...post, '']
    good[file] = [...pre, fix, ...post, '']
  }

  // ---------------------------------------------------------------- debug leftovers
  add('debugger-statement', 'debug-leftovers', 'a debugger statement', 'src/dbg_statement.js', ['function total(items) {'], '  debugger', ['  return items.reduce((a, b) => a + b, 0)', '}'], '  // sum of all items')
  add('console-log-handler', 'debug-leftovers', 'console.log left in a library module', 'src/dbg_console.js', ['export function parseRow(row) {'], '  console.log("row", row)', ['  return row.split(",")', '}'], '  // split on commas')
  add('console-log-render', 'debug-leftovers', 'console.log left in a component', 'src/dbg_render.jsx', ['export function Badge({ count }) {'], '  console.log("render badge", count)', ['  return <span>{count}</span>', '}'], '  // render the count')
  add('py-debug-print', 'debug-leftovers', 'a debug print in Python', 'src/dbg_print.py', ['def price(order):'], '    print("DEBUG order", order)', ['    return order.total'], '    # price is the order total')
  add('rust-dbg-macro', 'debug-leftovers', 'dbg! left in Rust', 'src/dbg_macro.rs', ['pub fn area(w: u32, h: u32) -> u32 {'], '    dbg!(w * h)', ['}'], '    w * h')
  add('go-debug-println', 'debug-leftovers', 'a debug Println in Go', 'src/dbg_println.go', ['package main', '', 'import "fmt"', '', 'var _ = fmt.Sprint', '', 'func Add(a, b int) int {'], '\tfmt.Println("debug a", a)', ['\treturn a + b', '}'], '\t// add the two numbers')

  // ---------------------------------------------------------------- tests
  add('test-only', 'focused-tests', 'a test left focused with .only', 'spec/focus_test.js', ["import test from 'node:test'", "import assert from 'node:assert'", "import { sum } from '../src/sum.js'"], "test.only('adds', () => { assert.equal(sum(1, 1), 2) })", ["test('subtracts', () => { assert.equal(sum(2, -1), 1) })"], "test('adds', () => { assert.equal(sum(1, 1), 2) })")
  add('describe-only', 'focused-tests', 'a describe block left focused', 'spec/focus_describe.test.js', ["import { describe, it } from 'node:test'", "import assert from 'node:assert'", "import { sum } from '../src/sum.js'"], "describe.only('cart', () => {", ["  it('adds', () => { assert.equal(sum(1, 1), 2) })", '})'], "describe('cart', () => {")
  add('test-skip', 'skipped-tests', 'a test left skipped', 'spec/skip_test.js', ["import test from 'node:test'", "import assert from 'node:assert'", "import { sum } from '../src/sum.js'"], "test.skip('rejects empty input', () => { assert.equal(sum(0, 0), 0) })", ["test('accepts input', () => { assert.equal(sum(1, 2), 3) })"], "test('rejects empty input', () => { assert.equal(sum(0, 0), 0) })")
  add('it-skip', 'skipped-tests', 'an it() left skipped', 'spec/skip_it.test.js', ["import { describe, it } from 'node:test'", "import assert from 'node:assert'", "import { sum } from '../src/sum.js'", "describe('cart', () => {"], "  it.skip('totals the items', () => { assert.equal(sum(1, 2), 3) })", ["  it('adds', () => { assert.equal(sum(1, 1), 2) })", '})'], "  it('totals the items', () => { assert.equal(sum(1, 2), 3) })")

  // ---------------------------------------------------------------- type-check escapes and equality
  add('ts-ignore-line', 'ts-ignore-comments', 'a bare @ts-ignore', 'src/ts_ignore_line.ts', ['export const port: number = Number(process.env.PORT)', ''], '// @ts-ignore', ['export const host: string = process.env.HOST'], '// @ts-expect-error env value may be undefined in the type, checked at startup')
  add('ts-nocheck-file', 'ts-ignore-comments', 'a bare @ts-nocheck at the top of a file', 'src/ts_nocheck.ts', [], '// @ts-nocheck', ['export const legacy = (window as any).legacy'], '// legacy shim: typed in types/legacy.d.ts')
  add('loose-equality-role', 'js-eqeqeq', 'loose equality on a string', 'src/eq_role.js', ['function canEdit(user) {'], "  return user.role == 'editor'", ['}'], "  return user.role === 'editor'")
  add('loose-inequality-count', 'js-eqeqeq', 'loose inequality on a number', 'src/eq_count.js', ['function hasItems(cart) {'], '  return cart.items.length != 0', ['}'], '  return cart.items.length !== 0')
  add('loose-equality-id', 'js-eqeqeq', 'loose equality between two ids', 'src/eq_id.js', ['function same(a, b) {'], '  if (a.id == b.id) return true', ['  return false', '}'], '  if (a.id === b.id) return true')

  // ---------------------------------------------------------------- public IPs
  add('ip-in-js', 'hardcoded-ip', 'a public IP in a JavaScript constant', 'src/ip_js.js', [], "const API_HOST = '34.120.55.9'", ['module.exports = { API_HOST }'], "const API_HOST = process.env.API_HOST")
  add('ip-in-python', 'hardcoded-ip', 'a public IP in a Python setting', 'src/ip_py.py', ['import os', ''], 'DB_HOST = "52.14.201.77"', ['DB_PORT = 5432'], 'DB_HOST = os.environ["DB_HOST"]')
  add('ip-in-yaml', 'hardcoded-ip', 'a public IP in a YAML config', 'config/ip_yaml.yml', ['service:', '  name: sync'], '  upstream: 18.205.12.40', ['  retries: 3'], '  upstream: sync.internal.example.com')

  // ---------------------------------------------------------------- whitespace, Makefile, merge markers
  add('trailing-spaces-py', 'trailing-whitespace', 'trailing spaces at the end of a Python line', 'src/ws_py.py', ['def one():'], '    return 1      ', ['', 'def two():', '    return 2'], '    return 1')
  add('trailing-tab-js', 'trailing-whitespace', 'trailing tabs at the end of a JavaScript line', 'src/ws_js.js', ['function one() {'], '  return 1;\t\t', ['}'], '  return 1;')
  add('makefile-spaces', 'makefile-tabs', 'a Makefile recipe indented with spaces', 'Makefile', ['.PHONY: all clean', '', 'all:'], '    cc -o app main.c', ['', 'clean:', '\trm -f app'], '\tcc -o app main.c')
  // conflict markers: the clean twin has the merged text and no markers at all
  const conflict = (key, desc, file, before, ours, theirs, after) => {
    expect[`easy-${key}`] = 'conflict-markers'
    bad[file] = [...before, d(`easy-${key}`, desc, '<<<<<<< HEAD'), ours, '=======', theirs, '>>>>>>> topic', ...after, '']
    good[file] = [...before, ours, ...after, '']
  }
  conflict('conflict-in-js', 'a merge conflict marker left in a JavaScript file', 'src/conflict_js.js', ['const a = 1'], 'const b = 2', 'const b = 3', ['module.exports = { a, b }'])
  conflict('conflict-in-yaml', 'a merge conflict marker left in a YAML file', 'config/conflict.yml', ['name: app'], 'port: 8080', 'port: 9090', ['debug: false'])

  const name = 'easy-hygiene'
  return {
    projects: {
      [name]: { files: { ...tidy(name), ...bad } },
      [`${name}-clean`]: { files: { ...tidy(`${name}-clean`), ...good } },
    },
    expect,
  }
}

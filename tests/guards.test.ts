import { describe, expect, test } from 'vitest'
// @ts-ignore plain .mjs module has no type declarations
import { inDevOnlyBlock, isConstantMarkup, requireHelperOnlyFixed, shellPathIsChecked } from '../thorough/guards.mjs'

// False alarms found in a real scan (Plume, 2026-11-01): the code around a risky-looking call already limits it. Each guard must say "safe"
// for that shape and must still say "not safe" for the nearby shape that really is a risk.
const ctxAt = (code: string, needle: string) => {
  const lines = code.split('\n')
  const index = lines.findIndex((l) => l.includes(needle))
  return { lines, index, text: code }
}

describe('inDevOnlyBlock', () => {
  test('a call inside an if on a QA or packaged switch is dev only', () => {
    const code = ['const QA = !app.isPackaged', 'if (QA && process.env.STEPS) {', '  const st = load()', '  win.webContents.executeJavaScript(st.js)', '}'].join('\n')
    expect(inDevOnlyBlock(ctxAt(code, 'executeJavaScript'))).toBe(true)
  })
  test('a call outside any such block is not', () => {
    const code = ['ipcMain.handle("run", (e, js) => {', '  win.webContents.executeJavaScript(js)', '})'].join('\n')
    expect(inDevOnlyBlock(ctxAt(code, 'executeJavaScript'))).toBe(false)
  })
  test('an if on something else does not count', () => {
    const code = ['if (user.isAdmin) {', '  win.webContents.executeJavaScript(js)', '}'].join('\n')
    expect(inDevOnlyBlock(ctxAt(code, 'executeJavaScript'))).toBe(false)
  })
})

describe('shellPathIsChecked', () => {
  test('a path checked by need() just before is safe', () => {
    const code = ['ipc.handle("file:trash", async (_e, p) => {', '  need(p)', '  await shell.trashItem(p)', '})'].join('\n')
    expect(shellPathIsChecked('  await shell.trashItem(p)', ctxAt(code, 'shell.trashItem'))).toBe(true)
  })
  test('a constant folder is safe', () => {
    const code = ["const pluginsDir = path.join(app.getPath('userData'), 'plugins')", 'ipc.handle("open", () => shell.openPath(pluginsDir))'].join('\n')
    expect(shellPathIsChecked('ipc.handle("open", () => shell.openPath(pluginsDir))', ctxAt(code, 'shell.openPath'))).toBe(true)
  })
  test('an unchecked path from the caller is still reported', () => {
    const code = ['ipc.handle("file:trash", async (_e, p) => {', '  await shell.trashItem(p)', '})'].join('\n')
    expect(shellPathIsChecked('  await shell.trashItem(p)', ctxAt(code, 'shell.trashItem'))).toBe(false)
  })
  test('a guard on a different variable does not count', () => {
    const code = ['ipc.handle("x", async (_e, p, q) => {', '  need(q)', '  await shell.trashItem(p)', '})'].join('\n')
    expect(shellPathIsChecked('  await shell.trashItem(p)', ctxAt(code, 'shell.trashItem'))).toBe(false)
  })
})

describe('requireHelperOnlyFixed', () => {
  test('a helper called only with literals is fine', () => {
    const code = ['const optional = (name) => {', '  try { return require(name) } catch (e) { throw e }', '}', "const a = optional('./a.cjs')", "const b = optional('./b.cjs')"].join('\n')
    expect(requireHelperOnlyFixed('  try { return require(name) } catch (e) { throw e }', ctxAt(code, 'require(name)'))).toBe(true)
  })
  test('one call with a variable makes it a real risk', () => {
    const code = ['const optional = (name) => {', '  try { return require(name) } catch (e) { throw e }', '}', "const a = optional('./a.cjs')", 'const b = optional(req.query.m)'].join('\n')
    expect(requireHelperOnlyFixed('  try { return require(name) } catch (e) { throw e }', ctxAt(code, 'require(name)'))).toBe(false)
  })
  test('a bare require(name) with no helper is still reported', () => {
    const code = ['function f(x) {', '  return require(x)', '}'].join('\n')
    expect(requireHelperOnlyFixed('  return require(x)', ctxAt(code, 'require(x)'))).toBe(false)
  })
})

describe('isConstantMarkup', () => {
  test('a table of plain strings is constant', () => {
    expect(isConstantMarkup("const ICONS = {\n  save: '<svg viewBox=\"0 0 1 1\"></svg>',\n  open: '<svg></svg>',\n}\nfoo()\n", 'ICONS')).toBe(true)
  })
  test('a template with a value in it is not', () => {
    expect(isConstantMarkup('const ICON = `<b>${name}</b>`\nfoo()\n', 'ICON')).toBe(false)
  })
  test('a value built by a call or a join is not', () => {
    expect(isConstantMarkup("const ICON = build(name)\nfoo()\n", 'ICON')).toBe(false)
    expect(isConstantMarkup("const ICON = '<b>' + name\nfoo()\n", 'ICON')).toBe(false)
  })
  test('a name that is not declared at the top level is not constant', () => {
    expect(isConstantMarkup('function f(icon) {\n  el.innerHTML = icon\n}\n', 'icon')).toBe(false)
  })
})

describe('guards stay narrow (a bypass must not hide a real risk)', () => {
  test('a dev switch in an unrelated earlier block does not cover a later call', () => {
    const code = ['if (QA) {', '  setup()', '}', 'ipc.handle("run", (e, js) => {', '  win.webContents.executeJavaScript(js)', '})'].join('\n')
    expect(inDevOnlyBlock(ctxAt(code, 'executeJavaScript'))).toBe(false)
  })
  test('a callback written inside the dev block only exists when the block ran, so it is covered', () => {
    const code = ['if (QA) {', '  ipc.handle("run", (e, js) => {', '    win.webContents.executeJavaScript(js)', '  })', '}'].join('\n')
    expect(inDevOnlyBlock(ctxAt(code, 'executeJavaScript'))).toBe(true)
  })
  test('an or-condition, a negated switch, an else branch and a one-line if are not dev only', () => {
    expect(inDevOnlyBlock(ctxAt(['if (QA || user.ok) {', '  run(js)', '}'].join('\n'), 'run(js)'))).toBe(false)
    expect(inDevOnlyBlock(ctxAt(['if (!QA) {', '  run(js)', '}'].join('\n'), 'run(js)'))).toBe(false)
    expect(inDevOnlyBlock(ctxAt(['if (QA) {', '  a()', '} else {', '  run(js)', '}'].join('\n'), 'run(js)'))).toBe(false)
    expect(inDevOnlyBlock(ctxAt(['if (QA) setup()', 'run(js)'].join('\n'), 'run(js)'))).toBe(false)
  })
  test('an unrelated environment variable is not a dev switch', () => {
    expect(inDevOnlyBlock(ctxAt(['if (process.env.USER_CODE) {', '  run(js)', '}'].join('\n'), 'run(js)'))).toBe(false)
  })
  test('a guard in an earlier function does not cover a later handler', () => {
    const code = ['ipc.handle("a", (e, p) => {', '  need(p)', '})', 'ipc.handle("b", async (e, p) => {', '  await shell.trashItem(p)', '})'].join('\n')
    expect(shellPathIsChecked('  await shell.trashItem(p)', ctxAt(code, 'shell.trashItem'))).toBe(false)
  })
  test('a folder built from a value, or changed later, is not a constant', () => {
    const built = ["const dir = path.join(app.getPath('userData'), name)", 'ipc.handle("o", () => shell.openPath(dir))'].join('\n')
    expect(shellPathIsChecked('ipc.handle("o", () => shell.openPath(dir))', ctxAt(built, 'shell.openPath'))).toBe(false)
    const changed = ["let dir = '/plugins'", 'dir += extra', 'ipc.handle("o", () => shell.openPath(dir))'].join('\n')
    expect(shellPathIsChecked('ipc.handle("o", () => shell.openPath(dir))', ctxAt(changed, 'shell.openPath'))).toBe(false)
  })
  test('a helper that is exported, passed on or called with a joined string is not fixed', () => {
    const base = ['const load = (name) => {', '  return require(name)', '}']
    const line = '  return require(name)'
    expect(requireHelperOnlyFixed(line, ctxAt([...base, "load('a')", 'module.exports = { load }'].join('\n'), 'require(name)'))).toBe(false)
    expect(requireHelperOnlyFixed(line, ctxAt([...base, "load('./x/' + id)"].join('\n'), 'require(name)'))).toBe(false)
    expect(requireHelperOnlyFixed(line, ctxAt([...base, "load.call(null, id)"].join('\n'), 'require(name)'))).toBe(false)
  })
  test('a table with a variable value, or one that is assigned to, is not constant', () => {
    const nl = '\n'
    const tbl = (rows: string[], after = '') => ['const ICONS = {', ...rows, '}', after, 'foo()', ''].join(nl)
    expect(isConstantMarkup(tbl(['  a: userInput,']), 'ICONS')).toBe(false)
    expect(isConstantMarkup(tbl(["  a: '<i></i>',"], 'ICONS.a = input'), 'ICONS')).toBe(false)
    expect(isConstantMarkup(tbl(["  a: '<i></i>',"], 'function f(ICONS) {}'), 'ICONS')).toBe(false)
  })
})

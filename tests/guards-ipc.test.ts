import { describe, expect, test } from 'vitest'
// @ts-ignore plain .mjs module has no type declarations
import { ipcHandlerCallsSenderHelper, ipcMainIsGuardedParameter } from '../thorough/guards.mjs'

// False alarm found in a real scan (Plume, 2026-11-01): handlers registered through an ipcMain that is a function parameter, where the caller
// passes a wrapper that checks the sender. The guard must say "safe" for that shape and "not safe" for every shape that is really open.
const LINE = "  ipcMain.handle('plugins:list', () => {"
const mod = ["function register({ app, ipcMain }) {", LINE, '    return []', '  })', '}'].join('\n')
const wrapper = (body: string) => ["const ipc = {", `  handle: (ch, fn) => ipcMain.handle(ch, (e, ...a) => {`, body, '    return fn(e, ...a)', '  }),', '}', "require('./plugins-ipc.cjs').register({ app, ipcMain: ipc })"].join('\n')
const project = (main: string) => ({ files: ['main.cjs', 'plugins-ipc.cjs'], read: (f: string) => (f === 'main.cjs' ? main : mod) })
const ctx = (main: string) => ({ file: 'plugins-ipc.cjs', lines: mod.split('\n'), index: 1, text: mod, project: project(main) })

describe('ipcMainIsGuardedParameter', () => {
  test('safe: the caller passes a wrapper that checks the sender', () => {
    expect(ipcMainIsGuardedParameter(LINE, ctx(wrapper('    if (!e.senderFrame.url.startsWith("file:")) throw new Error("no")')))).toBe(true)
  })
  test('safe: the wrapper calls a helper declared in its file that checks the sender', () => {
    const main = ['const fromAppPage = (e) => ok(e.senderFrame.url)', wrapper('    if (!fromAppPage(e)) throw new Error("no")')].join('\n')
    expect(ipcMainIsGuardedParameter(LINE, ctx(main))).toBe(true)
  })
  test('not safe: the wrapper never looks at the sender', () => {
    expect(ipcMainIsGuardedParameter(LINE, ctx(wrapper('    log(ch)')))).toBe(false)
  })
  test('not safe: the caller passes the real ipcMain', () => {
    expect(ipcMainIsGuardedParameter(LINE, ctx("const { ipcMain } = require('electron')\nrequire('./plugins-ipc.cjs').register({ app, ipcMain: ipcMain })"))).toBe(false)
  })
  test('not safe: nobody calls the module, so nothing is known about what it gets', () => {
    expect(ipcMainIsGuardedParameter(LINE, ctx('console.log(1)'))).toBe(false)
  })
  test('not safe: the file imports ipcMain from electron itself', () => {
    const own = ["const { ipcMain } = require('electron')", LINE].join('\n')
    expect(ipcMainIsGuardedParameter(LINE, { file: 'plugins-ipc.cjs', lines: own.split('\n'), index: 1, text: own, project: project(wrapper('    if (!e.senderFrame) throw 1')) })).toBe(false)
  })
  test('not safe: one of two call sites passes an unguarded variable', () => {
    const main = [wrapper('    if (!e.senderFrame) throw 1'), "const open = { handle: (c, f) => ipcMain.handle(c, f) }", "require('./plugins-ipc.cjs').register({ app, ipcMain: open })"].join('\n')
    expect(ipcMainIsGuardedParameter(LINE, ctx(main))).toBe(false)
  })
})

describe('ipcHandlerCallsSenderHelper', () => {
  const at = (code: string) => {
    const lines = code.split('\n')
    return { lines, index: lines.findIndex((l) => l.includes('ipcMain.handle')), text: code }
  }
  test('safe: the first lines call a helper that checks senderFrame', () => {
    const code = ['const fromAppPage = (e) => ok(e.senderFrame.url)', "ipcMain.handle('x', (e) => {", '  if (!fromAppPage(e)) throw 1', '})'].join('\n')
    expect(ipcHandlerCallsSenderHelper('', at(code))).toBe(true)
  })
  test('not safe: the helper does not look at the sender', () => {
    const code = ['const fromAppPage = (e) => true', "ipcMain.handle('x', (e) => {", '  if (!fromAppPage(e)) throw 1', '})'].join('\n')
    expect(ipcHandlerCallsSenderHelper('', at(code))).toBe(false)
  })
  test('not safe: no helper is called', () => {
    expect(ipcHandlerCallsSenderHelper('', at("ipcMain.handle('x', () => 1)"))).toBe(false)
  })
})

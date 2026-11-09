// ep-execute-js-concat: a template whose holes are module constants is fixed text; a template built from a parameter still fires.
import { describe, expect, test } from 'vitest'
import { runCheck } from './fp057-run'

const ep = (files: Record<string, string>) => runCheck('thorough/electron-plus.mjs', 'ep-window', files, true)

describe('ep-execute-js-concat with constant holes', () => {
  test('a template of module constants is quiet', () => {
    const r = ep({
      'main.js': "const TITLE = 'Ready'\nconst N = 3\nwin.webContents.executeJavaScript(`window.t = '${TITLE}' + ${N}`)\n",
    })
    expect(r.out).not.toContain('main.js:3')
  })
  test('a template built from a parameter still fires', () => {
    const r = ep({
      'main.js': 'function run(input) {\n  win.webContents.executeJavaScript(`window.user = ${input}`)\n}\n',
    })
    expect(r.out).toContain('ep-execute-js-concat')
  })
})

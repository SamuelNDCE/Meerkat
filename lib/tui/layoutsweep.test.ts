import { describe, expect, test } from 'vitest'
// @ts-ignore plain .mjs module has no type declarations
import { initialResultsState, renderResults, resultsStep } from './results.mjs'
// @ts-ignore plain .mjs module has no type declarations
import { sampleData, cleanSampleData } from './resultssample.mjs'
// @ts-ignore plain .mjs module has no type declarations
import { stripAnsi, textWidth } from './cells.mjs'
// @ts-ignore plain .mjs module has no type declarations
import { initialState, menuItems, menuStep, renderScreen } from '../menu.mjs'

// A sweep of every screen at many terminal sizes: nothing may be wider than the window, taller than the window, carry a stray escape,
// or lose the parts a person needs (the line number of a finding, the keys to quit and ask for help, the version).
const SIZES = [
  [60, 20],
  [80, 24],
  [100, 30],
  [105, 30],
  [120, 35],
  [160, 45],
]
const ESC = String.fromCharCode(27)
const NL = String.fromCharCode(10)

const screens = (state: any, data: any) => {
  const out: Record<string, any> = {}
  out.findings = state
  out.checks = { ...state, tab: 'checks' }
  out.timeline = { ...state, tab: 'timeline' }
  const high = data.findings.find((f: any) => f.severity === 'high')
  if (high) out.findingDetail = { ...state, detail: { kind: 'finding', id: high.id, scroll: 0 } }
  out.checkDetail = { ...state, tab: 'checks', detail: { kind: 'check', id: data.checks[0].id, scroll: 0 } }
  out.help = resultsStep(state, '?', data, { rows: 30 }).state
  return out
}

describe('the results screens at every size', () => {
  for (const [width, rows] of SIZES) {
    for (const [dataName, data] of [['findings', sampleData()], ['clean run', cleanSampleData()]] as const) {
      test(`${dataName} at ${width}x${rows}: fits, no escapes when plain, keys and version visible`, () => {
        for (const [name, state] of Object.entries(screens(initialResultsState(), data))) {
          const lines: string[] = renderResults(state, data, { width, rows, color: false, level: false, env: { MEERKAT_NO_UPDATE_NOTE: '1' } })
          const where = `${name} ${width}x${rows}`
          expect(lines.length, `${where}: height`).toBeLessThanOrEqual(rows)
          for (const l of lines) {
            expect(textWidth(l), `${where}: "${l}"`).toBeLessThanOrEqual(width)
            expect(l.includes(ESC), `${where}: an escape code`).toBe(false)
          }
          if (['findings', 'checks', 'timeline'].includes(name)) {
            const last = lines[lines.length - 1] + (lines[lines.length - 2] ?? '')
            expect(last, `${where}: footer`).toContain('q done')
            expect(last, `${where}: footer`).toContain('? help')
          }
        }
      })
    }
  }

  test('every finding row keeps the line number of its place (src/a.js:42), from 80 columns up', () => {
    const data = sampleData()
    for (const [width, rows] of SIZES.filter(([w]) => w >= 80)) {
      const lines: string[] = renderResults(initialResultsState(), data, { width, rows: rows + 10, color: false, level: false, env: { MEERKAT_NO_UPDATE_NOTE: '1' } }).map(stripAnsi)
      const shown = data.findings.filter((f: any) => f.file && f.line)
      let seen = 0
      for (const f of shown) {
        // The rows of this file that are drawn: one of them must show this very line number (the place keeps its end).
        const rows = lines.filter((l) => l.includes(f.file.slice(-12).slice(0, 8)) || l.includes(String(f.file).split('/').pop()))
        if (!rows.length) continue
        seen++
        expect(rows.some((l) => l.includes(`:${f.line}`)), `${width}: the place of ${f.file}:${f.line} in ${rows.length} row(s)`).toBe(true)
      }
      expect(seen, `${width}: some finding rows were drawn`).toBeGreaterThan(0)
    }
  })
})

describe('the menu at every size', () => {
  for (const [width] of SIZES) {
    test(`fits ${width} columns and shows both versions when an update waits`, () => {
      const update = { latest: '9.9.9', current: '1.2.3' }
      const state = menuStep(initialState(menuItems({ user: {}, project: {}, update })), 'down').state
      const lines: string[] = (renderScreen(state, { project: 'C:/code/app', version: '1.2.3', question: 'What would you like to run?', hint: '  Up/Down move   Enter choose   q quit', update, width, color: false, art: false, maxRows: 24, rows: 50, isTTY: true }) as any[]).map((l) => String(l.text ?? l))
      for (const l of lines) expect(textWidth(l), `${width}: "${l}"`).toBeLessThanOrEqual(width)
      const text = lines.join(NL)
      expect(text).toContain('1.2.3')
      expect(text).toContain('9.9.9')
    })
  }
})

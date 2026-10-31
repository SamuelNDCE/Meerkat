// The results screen: the visible tab bar, the first-open hint, the small head, the fit at common sizes; the menu's Esc flow.
import { describe, expect, test } from 'vitest'
import { initialResultsState, renderResults, resultsStep, miniHead, showMiniHead, TAB_HELP, FIRST_HINT } from './results.mjs'
import { sampleData } from './resultssample.mjs'
import { stripAnsi, textWidth } from './cells.mjs'
// @ts-expect-error plain JS module
import { menuStep, presetMenuStep, pickerState, pickerStep, initialState } from '../menu.mjs'
// @ts-expect-error plain JS module
import { renderScreen } from '../menuscreen.mjs'

const data = sampleData()
const plain = (state: any, opts: any = {}) => renderResults(state, data, { width: 100, rows: 30, color: false, level: false, env: {}, ...opts }).map(stripAnsi)

describe('tab bar and first hint', () => {
  test('the bar names all three tabs and marks the active one', () => {
    const t = plain(initialResultsState()).find((l) => l.startsWith('<')) as string
    expect(t.replace(/ +/g, ' ')).toContain('< [Findings (60)] | Checks (157) | Timeline >')
    expect(plain({ ...initialResultsState(), tab: 'checks' }).find((l) => l.startsWith('<'))).toContain('[Checks (157)]')
    const colored = renderResults(initialResultsState(), data, { width: 100, rows: 30, color: true, level: 'truecolor', env: {} }).find((l) => stripAnsi(l).startsWith('<')) as string
    expect(colored).toContain('\x1b[1;7m Findings (60) ')
  })
  test('the dim line explains the keys and the first-open hint vanishes after one key', () => {
    const first = plain(initialResultsState())
    expect(first).toContain(TAB_HELP)
    expect(first).toContain(FIRST_HINT)
    const after = resultsStep(initialResultsState(), 'down', data).state
    expect(after.hint).toBe(false)
    const second = plain(after)
    expect(second).toContain(TAB_HELP)
    expect(second).not.toContain(FIRST_HINT)
  })
  test('Tab and the arrows switch tabs', () => {
    let s = initialResultsState()
    s = resultsStep(s, 'tab', data).state
    expect(s.tab).toBe('checks')
    s = resultsStep(s, 'right', data).state
    expect(s.tab).toBe('timeline')
    expect(resultsStep(s, 'left', data).state.tab).toBe('checks')
  })
})

describe('the small head', () => {
  test('it is 14 cells wide and 5 rows tall', () => {
    const h = miniHead('happy')
    expect(h.length).toBe(5)
    expect(h.every((r: string) => textWidth(stripAnsi(r)) === 14)).toBe(true)
  })
  test('only with colour and room', () => {
    const ok = { width: 70, rows: 24, color: true, env: {} }
    expect(showMiniHead(ok)).toBe(true)
    expect(showMiniHead({ ...ok, width: 69 })).toBe(false)
    expect(showMiniHead({ ...ok, rows: 23 })).toBe(false)
    expect(showMiniHead({ ...ok, color: false })).toBe(false)
    expect(showMiniHead({ ...ok, env: { NO_COLOR: '1' } })).toBe(false)
    const art = renderResults(initialResultsState(), data, { width: 100, rows: 30, color: true, level: 'truecolor', env: {} })
    expect(art.join('').includes('▀')).toBe(true)
    const none = renderResults(initialResultsState(), data, { width: 100, rows: 30, color: false, level: false, env: {} })
    expect(none.join('').includes('▀')).toBe(false)
    expect(stripAnsi(none[0])).toContain('MEERKAT')
  })
  test('no overflow at 70x24, 100x30, 120x40, in every tab', () => {
    for (const [width, rows] of [[70, 24], [100, 30], [120, 40]]) {
      for (const tab of ['findings', 'checks', 'timeline']) {
        for (const color of [true, false]) {
          const lines = renderResults({ ...initialResultsState(), tab }, data, { width, rows, color, level: color ? 'truecolor' : false, env: {} })
          expect(lines.length).toBeLessThanOrEqual(rows - 1)
          for (const l of lines) expect(textWidth(stripAnsi(l))).toBeLessThanOrEqual(width - 1)
        }
      }
    }
  })
})

describe('Esc in the menus', () => {
  const items = [{ kind: 'item', label: 'a', value: 1 }, { kind: 'item', label: 'b', value: 2 }]
  test('in the preset menu Esc changes project and q quits', () => {
    expect(presetMenuStep(initialState(items), 'escape').action).toEqual({ type: 'changeproject' })
    expect(presetMenuStep(initialState(items), 'q').action).toEqual({ type: 'quit' })
    expect(menuStep(initialState(items), 'escape').action).toEqual({ type: 'quit' })
  })
  test('in the project picker Esc quits (after clearing a filter)', () => {
    const s = pickerState({ here: null, recent: [], found: [] })
    expect(pickerStep(s, 'escape').action).toEqual({ type: 'quit' })
  })
  test('the preset menu header and footer say so', () => {
    const lines = renderScreen(initialState(items), { project: 'C:/code/shop', projectNote: 'Esc to change', hint: '  Esc change project   q quit   Up/Down move', color: false, width: 80, rows: 24, env: {}, isTTY: true }).map((l: any) => l.text)
    expect(lines.some((l: string) => l.includes('Project: C:/code/shop   Esc to change'))).toBe(true)
    expect(lines[lines.length - 1]).toContain('Esc change project   q quit')
  })
})

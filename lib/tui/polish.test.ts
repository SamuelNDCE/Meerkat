// The polish pass on the terminal UI: the happy all-clear screen, the header order, 10+ check rows at 30 lines, a scrolling timeline,
// the severity legend, and the rotating status line on the live board (real counters only).
// @ts-nocheck the .mjs modules under test have no type declarations
import { describe, expect, test } from 'vitest'
import { initialResultsState, renderResults, resultsStep, SEV_MEANING } from './results.mjs'
import { cleanSampleData, sampleData, SAMPLE_NOTE } from './resultssample.mjs'
import { stripAnsi } from './cells.mjs'
import { STATUS_EVERY, statusLine, statusLines } from './live.mjs'
import { buildProfile } from './pixelhead.mjs'

const opts = { width: 110, rows: 30, color: true, level: 'truecolor', env: { MEERKAT_NO_UPDATE_NOTE: '1' } }
const plain = (state, data, o = {}) => renderResults(state, data, { ...opts, ...o }).map(stripAnsi)

describe('the happy all-clear screen', () => {
  const clean = cleanSampleData()
  test('a clean run says ALL CLEAR in green with the counts, directly under the name', () => {
    const lines = renderResults(initialResultsState(), clean, opts)
    const t = lines.map(stripAnsi)
    expect(t[0]).toContain('MEERKAT')
    expect(t[1]).toContain('ALL CLEAR')
    expect(t[1]).toContain(`${clean.counts.pass} of ${clean.checks.length} checks passed`)
    expect(lines[1]).toContain('\x1b[1;32m')
    expect(t.join('\n')).toContain('Nothing was detected in this run')
  })
  test('the happy meerkat is a new sprite: eyes shut in a light-brown arc, no blush', () => {
    const joy = buildProfile('joy').join('')
    expect(joy).not.toContain('R')
    expect(joy).toContain('M')
    expect(buildProfile('happy').join('')).not.toContain('R')
  })
  test('failures keep the red look and no ALL CLEAR', () => {
    const t = plain(initialResultsState(), sampleData()).join('\n')
    expect(t).not.toContain('ALL CLEAR')
    expect(t).toContain('6 failed')
  })
})

describe('the header', () => {
  test('the counts and the severity chips sit on the two lines right under the name and version', () => {
    const t = plain(initialResultsState(), sampleData())
    expect(t[0]).toMatch(/MEERKAT v\S+/)
    expect(t[1]).toContain('passed')
    expect(t[2]).toContain('CRITICAL')
  })
})

describe('the checks tab and the timeline at 30 lines', () => {
  test('the checks tab shows at least 10 rows', () => {
    const t = plain({ ...initialResultsState(), tab: 'checks' }, sampleData())
    expect(t.filter((l) => /^\s+(PASS|FAIL|NOT RUN|SKIPPED)\s/.test(l)).length).toBeGreaterThanOrEqual(10)
  })
  test('the timeline scrolls with the keys, says where it is, and the footer names the keys', () => {
    const data = sampleData()
    let state = { ...initialResultsState(), tab: 'timeline' }
    const first = plain(state, data)
    expect(first.join('\n')).toMatch(/rows 1-\d+ of 33/)
    expect(first.join('\n')).toMatch(/scroll/)
    for (let i = 0; i < 40; i++) state = resultsStep(state, 'down', data).state
    const later = plain(state, data).join('\n')
    expect(later).not.toMatch(/rows 1-\d+ of 33/)
    expect(later).toContain('of 33')
  })
  test('a short timeline is shown whole', () => {
    const clean = cleanSampleData()
    const t = plain({ ...initialResultsState(), tab: 'timeline' }, clean, { rows: 60 }).join('\n')
    expect(t).toContain(`rows 1-${clean.checks.length} of ${clean.checks.length}`)
  })
})

describe('the findings legend', () => {
  test('each severity has its words, its meaning, and the rule and the why on every row', () => {
    const t = plain(initialResultsState(), sampleData()).join('\n')
    expect(t).toContain('critical = fix before shipping')
    expect(t).toContain('high = fix soon')
    expect(t).toContain('medium = should fix')
    expect(t).toContain('low, info = worth knowing')
    expect(t).toContain('hardcoded-secret')
    expect(t).toContain('A live Stripe secret key')
    expect(SEV_MEANING.critical).toBe('fix before shipping')
  })
})

describe('the live board status line', () => {
  const run = (id, extra = {}) => ({ id, status: 'RUNNING', lane: 'free', ...extra })
  test('rotates through lines about what is really running, with the real counters', () => {
    const rows = [run('secret-scan', { found: 0 }), run('sidecar-clippy', { filesDone: 3, filesTotal: 40 }), { id: 'x', status: 'PASS' }]
    const texts = statusLines(rows, { bugs: { total: 0 } }).map((l) => l.text)
    expect(texts[0]).toContain('Looking for bugs')
    expect(texts).toContain('Scanning for secrets: found 0 so far')
    expect(texts).toContain('Reading Rust code: 3/40 files read')
    expect(statusLine(rows, { tick: 0 }).text).toBe(texts[0])
    expect(statusLine(rows, { tick: STATUS_EVERY }).text).toBe(texts[1])
  })
  test('ends with Looks good, or Found N issues', () => {
    expect(statusLines([{ id: 'a', status: 'PASS' }]).map((l) => l.text)).toEqual(['Looks good'])
    expect(statusLines([{ id: 'a', status: 'FAIL' }], { bugs: { total: 4 } })[0].text).toBe('Found 4 issues')
  })
})

describe('the sample data is labelled', () => {
  test('the note and the project', () => {
    expect(SAMPLE_NOTE).toContain('SAMPLE DATA')
    expect(sampleData().project).toBe('C:/Users/SamuelNDCE/code/plume')
  })
})

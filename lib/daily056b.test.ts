// 0.5.6 daily-use fixes: header and footer name the command typed, doctor counts like a run, ignorePaths per preset.
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterAll, describe, expect, test } from 'vitest'
// @ts-expect-error plain .mjs module
import { main, presetAboutLine } from '../run.mjs'
// @ts-expect-error plain .mjs module
import { doctorReport } from './doctor.mjs'

const made: string[] = []
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), 'meerkat-d056b-'))
  made.push(d)
  return d
}
afterAll(() => {
  for (const d of made) rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})
const fake = `AKIA${'ABCDEFGHIJKLMNOP'}`
function project(config: any) {
  const d = tmp()
  const files: Record<string, string> = {
    'src/config.js': `const region = 'eu'\nconst key = '${fake}'\n`,
    'legacy/old.js': `const key = '${fake}'\n`,
    'meerkat.config.json': JSON.stringify(config),
  }
  for (const [n, b] of Object.entries(files)) {
    mkdirSync(dirname(join(d, n)), { recursive: true })
    writeFileSync(join(d, n), b)
  }
  return d
}
const run = async (d: string, logs: string, args: string[]) => {
  const lines: string[] = []
  const code = await main(['--app', d, '--plain', ...args], { log: (l: string) => lines.push(l), env: { ...process.env, MEERKAT_LOG_DIR: logs, MEERKAT_NO_PROJECT_CODE: '1' } })
  return { code, text: lines.join('\n') }
}
const findingsOf = (logs: string, suffix: string) => JSON.parse(readFileSync(join(logs, 'runs', readdirSync(join(logs, 'runs')).find((n) => n.endsWith(suffix))!, 'findings.json'), 'utf8'))
const lastSummary = (logs: string) => {
  const names = readdirSync(join(logs, 'runs')).sort()
  return JSON.parse(readFileSync(join(logs, 'runs', names[names.length - 1], 'summary.json'), 'utf8'))
}

describe('header and footer', () => {
  test('presetAboutLine drops the written time claim and adds a measured one only when a run exists', () => {
    const about = 'the everyday check, 5 to 10 minutes at most: every short static check'
    const line = presetAboutLine(about, {}, join(tmpdir(), 'no-such-folder'), 'quick')
    expect(line).toBe('the everyday check: every short static check')
    expect(line).not.toMatch(/minutes at most/)
  })
  test('a quick run says quick in the footer, and the second run header says how long the first took', async () => {
    const d = project({ packs: ['secrets-plus'] })
    const logs = tmp()
    const one = await run(d, logs, ['--preset', 'quick', '--only', 'secrets-plus'])
    expect(one.text).toMatch(/^MEERKAT quick:/m)
    expect(one.text).not.toMatch(/^MEERKAT fast:/m)
    expect(one.text).not.toMatch(/minutes at most/)
    expect(one.text).not.toMatch(/last run of this preset here took/)
    const two = await run(d, logs, ['--preset', 'quick', '--only', 'secrets-plus'])
    expect(two.text).toMatch(/preset quick: .*\(the last run of this preset here took [0-9.]+ s\)/)
  })
})

describe('doctor counts like a run', () => {
  test('the quick checks doctor reports equal the checks a quick run started', async () => {
    const d = project({ packs: ['secrets-plus', 'hygiene'] })
    const logs = tmp()
    await run(d, logs, ['--preset', 'quick'])
    const started = lastSummary(logs).selection.ran.length
    const r = await doctorReport(d, { env: { ...process.env, MEERKAT_LOG_DIR: logs, MEERKAT_NO_PROJECT_CODE: '1' } })
    expect(started).toBeGreaterThan(0)
    expect(r.quickChecks).toBe(started)
  })
})

describe('ignorePaths per preset', () => {
  test('left out in quick, still found in full, with one line saying how many and by which key', async () => {
    const d = project({ packs: ['secrets-plus'], presets: { quick: { ignorePaths: ['legacy/**'] } } })
    const logs = tmp()
    const q = await run(d, logs, ['--preset', 'quick', '--only', 'secrets-plus'])
    expect(q.text).toMatch(/ignorePaths: 1 file\(s\) left out \(presets\.quick\.ignorePaths: 1\)/)
    const doc = findingsOf(logs, '--quick')
    expect(doc.findings.map((f: any) => f.file)).toEqual(['src/config.js'])
    const f = await run(d, logs, ['--preset', 'full', '--only', 'secrets-plus'])
    expect(f.text).not.toMatch(/ignorePaths:/)
    const doc2 = findingsOf(logs, '--full')
    expect(doc2.findings.map((x: any) => x.file).sort()).toEqual(['legacy/old.js', 'src/config.js'])
  })
  test('a top-level ignorePaths applies to every preset', async () => {
    const d = project({ packs: ['secrets-plus'], ignorePaths: ['legacy/'] })
    const logs = tmp()
    const f = await run(d, logs, ['--preset', 'full', '--only', 'secrets-plus'])
    expect(f.text).toMatch(/ignorePaths: 1 file\(s\) left out \(ignorePaths: 1\)/)
  })
})

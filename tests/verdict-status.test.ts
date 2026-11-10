import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, test } from 'vitest'
import { INCOMPLETE_REASONS, STATUS, statusFields, statusOf } from '../lib/exitcodes.mjs'

describe('statusOf: HTTP-style status for a verdict answer', () => {
  test('PASS is 200', () => expect(statusOf({ exitCode: 0, verdict: 'PASS' })).toBe(200))
  test('FAIL is 422', () => expect(statusOf({ exitCode: 1, verdict: 'FAIL' })).toBe(422))
  test('USAGE is 400', () => expect(statusOf({ exitCode: 2, verdict: 'NO-RESULT' })).toBe(400))
  test('NO_RESULT with a ref, folder or config not found is 404', () => {
    expect(statusOf({ exitCode: 3, verdict: 'NO-RESULT', notFound: true })).toBe(404)
    expect(statusOf({ exitCode: 2, verdict: 'NO-RESULT', notFound: true })).toBe(404)
  })
  test('NO_RESULT for any other reason is 204', () => expect(statusOf({ exitCode: 3, verdict: 'NO-RESULT' })).toBe(204))
  test('STALE is 409', () => expect(statusOf({ exitCode: 4, verdict: 'STALE' })).toBe(409))
  test('INCOMPLETE by reason', () => {
    expect(statusOf({ exitCode: 75, incompleteReason: 'lock-held' })).toBe(423)
    expect(statusOf({ exitCode: 75, incompleteReason: 'timeout' })).toBe(408)
    expect(statusOf({ exitCode: 75, incompleteReason: 'interrupted' })).toBe(499)
    expect(statusOf({ exitCode: 75, incompleteReason: 'tool-missing' })).toBe(503)
  })
  test('PARTIAL (checks that ran passed, some did not finish) is 206 and exit stays 75', () => {
    expect(statusOf({ exitCode: 75, incompleteReason: 'check-unfinished' })).toBe(206)
    expect(statusOf({ exitCode: 75, partial: true })).toBe(206)
    expect(statusOf({ exitCode: 75 })).toBe(206)
  })
  test('Meerkat failing itself is 500', () => expect(statusOf({ exitCode: 1, internal: true })).toBe(500))
  test('the text phrases', () => {
    const text = (a: object) => statusFields(a).statusText
    expect(text({ exitCode: 0 })).toBe('OK')
    expect(text({ exitCode: 1, verdict: 'FAIL' })).toBe('Unprocessable')
    expect(text({ exitCode: 2 })).toBe('Bad Request')
    expect(text({ exitCode: 3, notFound: true })).toBe('Not Found')
    expect(text({ exitCode: 3 })).toBe('No Content')
    expect(text({ exitCode: 4 })).toBe('Conflict')
    expect(text({ exitCode: 75, incompleteReason: 'lock-held' })).toBe('Locked')
    expect(text({ exitCode: 75, incompleteReason: 'timeout' })).toBe('Request Timeout')
    expect(text({ exitCode: 75, incompleteReason: 'interrupted' })).toBe('Client Closed')
    expect(text({ exitCode: 75, incompleteReason: 'tool-missing' })).toBe('Service Unavailable')
    expect(text({ exitCode: 1, internal: true })).toBe('Internal Error')
    expect(text({ exitCode: 75, partial: true })).toBe('Partial Content')
  })
  test('every incomplete reason has a sentence and a status', () => {
    expect(Object.keys(INCOMPLETE_REASONS).sort()).toEqual(['check-unfinished', 'interrupted', 'lock-held', 'timeout', 'tool-missing'])
    for (const k of Object.keys(INCOMPLETE_REASONS)) {
      expect(INCOMPLETE_REASONS[k as keyof typeof INCOMPLETE_REASONS].length).toBeGreaterThan(10)
      expect(Object.values(STATUS)).toContain(statusOf({ exitCode: 75, incompleteReason: k }))
    }
  })
})

describe('verdict CLI carries the status', () => {
  const root = mkdtempSync(join(tmpdir(), 'meerkat-verdict-status-'))
  afterAll(() => rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
  const cli = join(__dirname, '..', 'bin', 'meerkat.mjs')
  const env = { ...process.env, MEERKAT_NO_PROJECT_CODE: '1', MEERKAT_LOG_DIR: join(root, 'logs'), NO_COLOR: '1' } as NodeJS.ProcessEnv
  const run = (...args: string[]) => {
    const r = spawnSync(process.execPath, [cli, ...args], { cwd: root, env, encoding: 'utf8', timeout: 60_000 })
    return { code: r.status, out: r.stdout.replace(/\r/g, '') }
  }
  test('a usage error gives status 400 in the JSON, exit code 2 unchanged', () => {
    const r = run('verdict', '--json', '--bogus')
    const doc = JSON.parse(r.out)
    expect(r.code).toBe(2)
    expect(doc.exitCode).toBe(2)
    expect(doc.status).toBe(400)
    expect(doc.statusText).toBe('Bad Request')
  })
  test('the text answer ends its first line with the status', () => {
    const r = run('verdict', '--bogus')
    expect(r.code).toBe(2)
    expect(r.out.split('\n')[0]).toMatch(/^NO-RESULT: unknown option --bogus.* \[400\]$/)
  })
})

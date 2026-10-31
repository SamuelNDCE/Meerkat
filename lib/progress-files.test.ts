// The file-progress protocol: a check prints MEERKAT-FILE / MEERKAT-FILES lines, the runner takes them out of the output and the board shows the file.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { createProgressEmitter, createThrottle, isProgressLine, MAX_PATH, parseProgressLine } from './progress-files.mjs'
import { readText, trackedFiles } from '../thorough/kit.mjs'
import { runCommand } from './exec.mjs'
import { runAll, runOne } from './runner.mjs'
import { createModel } from './tui/model.mjs'
import { filesCount, midTruncate, renderLive } from './tui/live.mjs'
import { createRecorder } from './runlog.mjs'

let dir = ''
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'meerkat-progress-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('parsing', () => {
  test('accepts the exact format', () => {
    expect(parseProgressLine('MEERKAT-FILE src/a.ts')).toEqual({ file: 'src/a.ts' })
    expect(parseProgressLine('MEERKAT-FILE src/with space/b.test.ts\r')).toEqual({ file: 'src/with space/b.test.ts' })
    expect(parseProgressLine('MEERKAT-FILES 412/940')).toEqual({ done: 412, total: 940 })
    expect(parseProgressLine('MEERKAT-FILES 0/0')).toEqual({ done: 0, total: 0 })
  })

  test('rejects control characters, long paths and every other line', () => {
    const bad = [
      'MEERKAT-FILE src/\u001b[31mred.ts',
      'MEERKAT-FILE a\u0007b',
      'MEERKAT-FILE a\u009bb',
      `MEERKAT-FILE ${'x'.repeat(MAX_PATH + 1)}`,
      'MEERKAT-FILE ',
      'MEERKAT-FILE',
      ' MEERKAT-FILE a.ts',
      'xMEERKAT-FILE a.ts',
      'meerkat-file a.ts',
      'MEERKAT-FILEa.ts',
      'MEERKAT-FILES a/b',
      'MEERKAT-FILES 5/3',
      'MEERKAT-FILES 5',
      'MEERKAT-FILES 5/3/1',
      'MEERKAT-FILES -1/3',
      'MEERKAT-FILES 1/99999999999',
      'hello world',
      '',
    ]
    for (const line of bad) expect(parseProgressLine(line), JSON.stringify(line)).toBeNull()
    expect(parseProgressLine(`MEERKAT-FILE ${'x'.repeat(MAX_PATH)}`)).not.toBeNull()
  })

  test('a line with the prefix is removed from output even when it is not valid', () => {
    expect(isProgressLine('MEERKAT-FILE a\u001b')).toBe(true)
    expect(isProgressLine('MEERKAT-FILES 1/2')).toBe(true)
    expect(isProgressLine('MEERKAT-FILESX')).toBe(false)
    expect(isProgressLine('MEERKAT run finished')).toBe(false)
  })
})

describe('throttle', () => {
  test('lets at most one line through per gap, using the injected clock', () => {
    let t = 1000
    const gate = createThrottle(50, () => t)
    expect(gate.ok()).toBe(true)
    expect(gate.ok()).toBe(false)
    t += 49
    expect(gate.ok()).toBe(false)
    t += 1
    expect(gate.ok()).toBe(true)
    // 20 per second: a thousand calls in one second let 20 through
    t = 5000
    const g2 = createThrottle(50, () => t)
    let passed = 0
    for (let i = 0; i < 1000; i++) {
      t = 5000 + i
      if (g2.ok()) passed++
    }
    expect(passed).toBe(20)
  })
})

describe('the kit side', () => {
  const lines = (fn: ReturnType<typeof vi.fn>) => fn.mock.calls.map((c) => String(c[0]))

  test('prints nothing when MEERKAT_PROGRESS is unset (default emitter, real stderr)', () => {
    const had = process.env.MEERKAT_PROGRESS
    delete process.env.MEERKAT_PROGRESS
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    try {
      writeFileSync(join(dir, 'a.txt'), 'hello')
      expect(readText(dir, 'a.txt')).toBe('hello')
      expect(readText(dir, 'missing.txt')).toBe('')
      expect(trackedFiles(dir)).toEqual(['a.txt'])
      expect(spy).not.toHaveBeenCalled()
    } finally {
      spy.mockRestore()
      if (had !== undefined) process.env.MEERKAT_PROGRESS = had
    }
  })

  test('trackedFiles returns the same array as before when progress is on', () => {
    mkdirSync(join(dir, 'sub'))
    writeFileSync(join(dir, 'sub', 'b.ts'), 'x')
    writeFileSync(join(dir, 'a.txt'), 'y')
    const had = process.env.MEERKAT_PROGRESS
    process.env.MEERKAT_PROGRESS = '1'
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    try {
      expect([...trackedFiles(dir)].sort()).toEqual(['a.txt', 'sub/b.ts'])
      expect(lines(spy as never)).toContain('MEERKAT-FILES 0/2\n')
    } finally {
      spy.mockRestore()
      if (had === undefined) delete process.env.MEERKAT_PROGRESS
      else process.env.MEERKAT_PROGRESS = had
    }
  })

  test('with MEERKAT_PROGRESS=1 it prints the file and the count, throttled to 20 lines a second', () => {
    let t = 0
    const write = vi.fn()
    const em = createProgressEmitter({ env: { MEERKAT_PROGRESS: '1' }, write, now: () => t })
    em.total(940)
    em.file('src/a.ts')
    em.file('src/b.ts') // same millisecond: dropped
    t = 49
    em.file('src/c.ts') // dropped
    t = 50
    em.file('src/d.ts')
    expect(lines(write)).toEqual(['MEERKAT-FILES 0/940\n', 'MEERKAT-FILE src/a.ts\nMEERKAT-FILES 1/940\n', 'MEERKAT-FILE src/d.ts\nMEERKAT-FILES 4/940\n'])
    for (const l of lines(write).join('').split('\n').filter(Boolean)) expect(parseProgressLine(l)).not.toBeNull()
  })

  test('count mode sends only the count; unset sends nothing; bad names are not sent', () => {
    const write = vi.fn()
    const count = createProgressEmitter({ env: { MEERKAT_PROGRESS: 'count' }, write })
    count.total(12)
    count.file('a.ts')
    expect(lines(write)).toEqual(['MEERKAT-FILES 0/12\n'])
    const none = vi.fn()
    const off = createProgressEmitter({ env: {}, write: none })
    off.total(5)
    off.file('a.ts')
    expect(none).not.toHaveBeenCalled()
    const on = vi.fn()
    const emitter = createProgressEmitter({ env: { MEERKAT_PROGRESS: '1' }, write: on })
    emitter.file('evil\nMEERKAT-FILE forged')
    emitter.file('x'.repeat(MAX_PATH + 1))
    expect(on).not.toHaveBeenCalled()
  })
})

// A check that is a real child process printing the protocol next to ordinary output.
const script = (body: string) => {
  const file = join(dir, `child-${Math.random().toString(36).slice(2)}.mjs`)
  writeFileSync(file, body)
  return file
}
const ctxFor = (extra = {}) => ({ repoRoot: dir, appDir: dir, env: process.env, platform: process.platform, exists: () => true, changedFiles: [], ...extra })
const checkOf = (file: string, id = 'scan') => ({ id, title: id, lane: 'free', group: 'functionality', tier: 'fast', run: { cmd: process.execPath, args: [file], cwd: 'repo' } })

describe('the runner side', () => {
  const noisy = `
    process.stderr.write('MEERKAT-FILES 0/3\\n')
    process.stderr.write('MEERKAT-FILE src/one.ts\\nMEERKAT-FILES 1/3\\n')
    console.log('real output line')
    process.stderr.write('MEERKAT-FI')
    setTimeout(() => {
      process.stderr.write('LE src/two.ts\\nMEERKAT-FILES 2/3\\n')
      process.stderr.write('MEERKAT-FILE bad\\u001b[2Jname.ts\\n')
      console.log('last real line')
    }, 30)
  `

  test('lines are parsed out of the stream, split across chunks, and never reach the output', async () => {
    const got: unknown[] = []
    const lastLines: string[] = []
    const r = await runCommand({ cmd: process.execPath, args: [script(noisy)], cwd: dir, onProgress: (l: string) => got.push(l), onLine: (l: string) => lastLines.push(l) })
    expect(r.code).toBe(0)
    expect(r.output).toContain('real output line')
    expect(r.output).toContain('last real line')
    expect(r.output).not.toContain('MEERKAT-FILE')
    expect(lastLines.join('\n')).not.toContain('MEERKAT-FILE')
    expect(got.map((l) => parseProgressLine(String(l))).filter(Boolean)).toEqual([
      { done: 0, total: 3 },
      { file: 'src/one.ts' },
      { done: 1, total: 3 },
      { file: 'src/two.ts' },
      { done: 2, total: 3 },
    ])
  })

  test('ordinary output with a half line at the end is kept whole', async () => {
    const r = await runCommand({ cmd: process.execPath, args: [script(`process.stdout.write('no newline MEERKAT-FILE x')`)], cwd: dir })
    expect(r.output).toBe('no newline MEERKAT-FILE x')
    const held = await runCommand({ cmd: process.execPath, args: [script(`process.stdout.write('MEERKAT-FILE')`)], cwd: dir })
    expect(held.output).toBe('MEERKAT-FILE')
  })

  test('the log the runner saves never contains the progress lines, and the result keeps files.total', async () => {
    const logDir = join(dir, 'logs')
    mkdirSync(logDir)
    const fail = script(noisy + `\nsetTimeout(() => process.exit(3), 60)`)
    const seen: unknown[] = []
    const r: any = await runOne(checkOf(fail) as never, ctxFor({ logDir, onProgress: (p: unknown) => seen.push(p) }))
    expect(r.status).toBe('FAIL')
    expect(r.files).toEqual({ total: 3 })
    expect(seen.length).toBe(5)
    const log = readFileSync(r.logFile, 'utf8')
    expect(log).toContain('real output line')
    expect(log).not.toMatch(/MEERKAT-FILE/)
    expect(readFileSync(r.outputFile, 'utf8')).not.toMatch(/MEERKAT-FILE/)
    // a check that reports no count has no files field at all
    const plain: any = await runOne(checkOf(script(`console.log('hi')`)) as never, ctxFor())
    expect(plain.status).toBe('PASS')
    expect('files' in plain).toBe(false)
  })

  test('the child is asked for file lines only when the board is on', async () => {
    const echo = script(`process.stdout.write('mode=' + process.env.MEERKAT_PROGRESS)`)
    const board: any = await runOne(checkOf(echo, 'board') as never, ctxFor({ progressFiles: true, logDir: dir }))
    const quiet: any = await runOne(checkOf(echo, 'quiet') as never, ctxFor({ logDir: dir }))
    expect(readFileSync(board.logFile, 'utf8')).toContain('mode=1')
    expect(readFileSync(quiet.logFile, 'utf8')).toContain('mode=count')
  })

  test('runAll sends progress to the progress hook and saves files.total in the timeline event', async () => {
    const got: unknown[] = []
    const recorder = createRecorder()
    const c = checkOf(script(noisy))
    const hooks = { progress: (_c: unknown, p: unknown) => got.push(p), settle: (...a: unknown[]) => (recorder.settle as any)(...a), start: (x: any) => recorder.start(x) }
    const results = await runAll([c] as never, ctxFor(), { hooks, progressFiles: true })
    expect(results[0].status).toBe('PASS')
    expect(got.some((p: any) => p.file === 'src/two.ts')).toBe(true)
    const end: any = recorder.events.find((e: any) => e.event === 'end')
    expect(end.files).toEqual({ total: 3 })
    const plain = createRecorder()
    plain.settle({ id: 'x' } as never, { status: 'PASS' }, 5)
    expect('files' in (plain.events[0] as object)).toBe(false)
  })
})

describe('the board', () => {
  const checks = [
    { id: 'scan', title: 'scan', lane: 'free', estSeconds: 30 },
    { id: 'done', title: 'done', lane: 'free', estSeconds: 5 },
  ]

  test('the model keeps the current file and the count for a running check, and clears the file when it ends', () => {
    const m = createModel({ checks })
    m.progress(checks[0], { file: 'src/early.ts' }) // not running yet: ignored
    m.start(checks[0], 1000)
    m.progress(checks[0], { file: 'src/vault/parser.test.ts' })
    m.progress(checks[0], { done: 412, total: 940 })
    m.progress(checks[0], { file: 'src/\u001b[31mevil.ts' })
    const row: any = m.snapshot(2000).find((r) => r.id === 'scan')
    expect(row.currentFile).toBe('src/[31mevil.ts')
    expect([row.filesDone, row.filesTotal]).toEqual([412, 940])
    m.settle(checks[0], { status: 'PASS' }, 900)
    const after: any = m.snapshot(3000).find((r) => r.id === 'scan')
    expect(after.currentFile).toBe('')
  })

  const board = (rows: unknown[], width = 110) => renderLive({ rows: rows as never, events: [], started: 0, now: 5000, tick: 3, fraction: 0.3, etaMs: 1000, width, color: false }).join('\n')

  test('a running check shows now: <file> and 412/940; a long path is cut in the middle', () => {
    const m = createModel({ checks })
    m.start(checks[0], 1000)
    m.progress(checks[0], { file: 'src/vault/parser.test.ts' })
    m.progress(checks[0], { done: 412, total: 940 })
    const text = board(m.snapshot(5000))
    expect(text).toContain('now: src/vault/parser.test.ts')
    expect(text).toContain('412/940')
    const long = 'packages/very/deep/folder/structure/that/goes/on/and/on/component-name.test.tsx'
    m.progress(checks[0], { file: long })
    const cut = board(m.snapshot(5000), 100)
    expect(cut).toContain('…')
    expect(cut).toContain('component-name.test.tsx'.slice(-12))
    for (const line of cut.split('\n')) expect([...line].length).toBeLessThanOrEqual(120)
    expect(midTruncate('abcdefghij', 6)).toHaveLength(6)
    expect(midTruncate('abc', 6)).toBe('abc')
    expect(filesCount({ filesDone: 3, filesTotal: 9 })).toBe('3/9')
    expect(filesCount({ filesDone: null, filesTotal: null })).toBe('')
  })

  test('a finished board is no taller than before and shows no file lines', () => {
    const m = createModel({ checks })
    m.start(checks[0], 0)
    m.start(checks[1], 0)
    const before = board(m.snapshot(5000)).split('\n').length
    m.progress(checks[0], { file: 'src/a.ts' })
    expect(board(m.snapshot(5000)).split('\n').length).toBe(before + 1) // only while it runs
    m.settle(checks[0], { status: 'PASS' }, 1000)
    m.settle(checks[1], { status: 'PASS' }, 1000)
    const done = board(m.snapshot(6000))
    expect(done).not.toContain('now:')
    expect(done).not.toContain('src/a.ts')
  })
})

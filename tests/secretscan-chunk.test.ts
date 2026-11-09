// thorough/secret-scan.mjs reads each file with a buffer no larger than the file (it used to allocate the full 1 MB chunk for every file), with the same findings.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, expect, test } from 'vitest'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const dir = mkdtempSync(join(tmpdir(), 'meerkat-ssc-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))
const key = 'AKIA' + 'IOSFODNN7EXAMPLQ'

function scan(env: Record<string, string> = {}): { code: number; out: string } {
  try {
    return { code: 0, out: execFileSync(process.execPath, ['thorough/secret-scan.mjs', '--root', dir], { cwd: ROOT, encoding: 'utf8', env: { ...process.env, ...env }, stdio: 'pipe' }) }
  } catch (e: any) {
    return { code: e.status ?? -1, out: String(e.stdout ?? '') }
  }
}

test('same findings whatever the chunk size, for an empty, a small and a multi-chunk file', () => {
  writeFileSync(join(dir, 'empty.txt'), '')
  writeFileSync(join(dir, 'small.js'), `const a = 1\nconst awsKey = "${key}"\n`)
  const filler = Array.from({ length: 400 }, (_, i) => `// line ${i}`).join('\n')
  writeFileSync(join(dir, 'big.js'), `${filler}\nconst k = "${key}"\n${filler}\n`)
  const normal = scan()
  const tiny = scan({ MEERKAT_SECRET_SCAN_CHUNK: '64' })
  expect(normal.code).toBe(tiny.code)
  expect(normal.out).toBe(tiny.out)
  expect(normal.out).toMatch(/small\.js:2/)
  expect(normal.out).toMatch(/big\.js:401/)
})

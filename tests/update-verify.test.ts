import { createHash } from 'node:crypto'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
// @ts-ignore plain .mjs module has no type declarations
import { parseChecksums, verifyRelease } from '../lib/releaseverify.mjs'
// @ts-ignore plain .mjs module has no type declarations
import { runUpdateCommand } from '../lib/update.mjs'

// No network: fetchImpl answers from a table. Updates are refused unless the release tarball matches a published SHA-256.
const TAR = Buffer.from('pretend tarball bytes')
const SUM = createHash('sha256').update(TAR).digest('hex')
const json = (o: unknown) => ({ ok: true, status: 200, json: async () => o, text: async () => JSON.stringify(o), arrayBuffer: async () => new ArrayBuffer(0) })
const bytes = (b: Buffer) => ({ ok: true, status: 200, json: async () => ({}), text: async () => b.toString(), arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) })
const fakeFetch = (table: Record<string, unknown>) => async (url: string) => {
  const hit = table[url]
  if (hit === undefined) return { ok: false, status: 404, json: async () => ({}), text: async () => '', arrayBuffer: async () => new ArrayBuffer(0) }
  return hit as never
}
const API = 'https://api.github.com/repos/SamuelNDCE/Meerkat/releases/tags/v0.5.3'
const TAR_URL = 'https://example.test/meerkat-0.5.3.tar.gz'
const SUMS_URL = 'https://example.test/SHA256SUMS'

describe('verifyRelease', () => {
  test('a matching checksum in a SHA256SUMS asset is accepted', async () => {
    const f = fakeFetch({ [API]: json({ assets: [{ name: 'meerkat-0.5.3.tar.gz', browser_download_url: TAR_URL }, { name: 'SHA256SUMS', browser_download_url: SUMS_URL }] }), [SUMS_URL]: bytes(Buffer.from(`${SUM}  meerkat-0.5.3.tar.gz\n`)), [TAR_URL]: bytes(TAR) })
    expect(await verifyRelease({ version: '0.5.3', fetchImpl: f })).toEqual({ ok: true, sha256: SUM })
  })
  test('a matching checksum in the release notes is accepted', async () => {
    const f = fakeFetch({ [API]: json({ body: `Notes\n${SUM}  meerkat-0.5.3.tar.gz`, assets: [{ name: 'meerkat-0.5.3.tar.gz', browser_download_url: TAR_URL }] }), [TAR_URL]: bytes(TAR) })
    expect((await verifyRelease({ version: '0.5.3', fetchImpl: f })).ok).toBe(true)
  })
  test('a mismatch is refused and nothing is accepted', async () => {
    const f = fakeFetch({ [API]: json({ body: `${'0'.repeat(64)}  meerkat-0.5.3.tar.gz`, assets: [{ name: 'meerkat-0.5.3.tar.gz', browser_download_url: TAR_URL }] }), [TAR_URL]: bytes(TAR) })
    const r = await verifyRelease({ version: '0.5.3', fetchImpl: f })
    expect(r.ok).toBe(false)
    expect(r.reason).toContain('does not match')
  })
  test('a release with no checksum is refused and the message says how to proceed', async () => {
    const f = fakeFetch({ [API]: json({ body: 'no sums here', assets: [{ name: 'meerkat-0.5.3.tar.gz', browser_download_url: TAR_URL }] }), [TAR_URL]: bytes(TAR) })
    const r = await verifyRelease({ version: '0.5.3', fetchImpl: f })
    expect(r.ok).toBe(false)
    expect(r.reason).toContain('SHA256SUMS')
    expect(r.reason).toContain('npm install -g @samuelndce/meerkat@latest')
  })
  test('no release for the version, or a network error, is refused (fails closed)', async () => {
    expect((await verifyRelease({ version: '0.5.3', fetchImpl: fakeFetch({}) })).ok).toBe(false)
    expect((await verifyRelease({ version: '0.5.3', fetchImpl: async () => { throw new Error('offline') } })).ok).toBe(false)
    expect((await verifyRelease({ version: null, fetchImpl: fakeFetch({}) })).ok).toBe(false)
  })
  test('parseChecksums reads sha256sum lines only', () => {
    expect(parseChecksums(`${SUM} *a.tgz\nnot a line\n`)).toEqual([{ hash: SUM, file: 'a.tgz' }])
  })
})

describe('meerkat update --yes', () => {
  const found = { ok: true }
  // A fake git: one commit behind, version 0.5.3 on origin/main, clean folder, fast-forwardable.
  const calls: string[][] = []
  const exec = (_c: string, args: string[]) => {
    calls.push(args)
    const k = args.join(' ')
    if (k === 'rev-parse --show-toplevel') return `${process.cwd()}\n`
    if (k.startsWith('symbolic-ref')) return 'origin/main\n'
    if (k.startsWith('rev-list --count')) return '1\n'
    if (k.startsWith('log --format=%s')) return 'Faster\n'
    if (k === 'show origin/main:package.json') return '{"version":"0.5.3"}'
    if (k === 'show HEAD:package.json') return '{"version":"0.5.2"}'
    if (k.startsWith('status --porcelain')) return ''
    return ''
  }
  const run = async (releaseCheck: unknown) => {
    calls.length = 0
    let text = ''
    const code = await runUpdateCommand({ kind: 'update', action: 'apply', yes: true }, { repoDir: process.cwd(), exec, releaseCheck, env: { MEERKAT_USER_CONFIG: join(mkdtempSync(join(tmpdir(), 'mk-upd-')), 'u.json') }, stdout: { write: (t: string) => ((text += t), true) } as never, home: process.cwd() })
    return { code, text }
  }
  test('a matching checksum installs (the fast-forward runs)', async () => {
    const r = await run(async () => ({ ok: true }))
    expect(r.code).toBe(0)
    expect(calls.some((a) => a[0] === 'merge')).toBe(true)
    void found
  })
  test('a refused release installs nothing and exits 1', async () => {
    const r = await run(async () => ({ ok: false, reason: 'could not verify this release (the release has no published checksum). To proceed: ...' }))
    expect(r.code).toBe(1)
    expect(r.text).toContain('Not updated')
    expect(calls.some((a) => a[0] === 'merge' || a[0] === 'checkout')).toBe(false)
  })
})

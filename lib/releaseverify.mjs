// Verifying an update before it is installed (fails closed).
//
// WHY: an update used to be a plain `git fetch` of origin with nothing proving the code was the code the maintainer released. Anyone
// who could push to the clone's remote, or sit in the way of the connection, could ship code that Meerkat then ran on the next start.
// DECISION (Samuel, 2026-11-08): refuse unless the release tarball for the target version matches a SHA-256 checksum that the maintainer
// published with the GitHub release. The checksum is read from a release asset named SHA256SUMS (or any asset with sha256 in its name),
// or, failing that, from lines in the release body (`<64 hex>  <file name>`). A signed tag is the accepted alternative source, but
// this module does not check tag signatures: with no checksum the update is refused and the message says how to proceed.
// Nothing here relaxes with a flag or an environment variable: there is no "skip verification" switch on purpose.
//
// The network call takes an injectable `fetchImpl` so tests never touch the network.
import { createHash } from 'node:crypto'
import { isVersion } from './version.mjs'

export const RELEASE_REPO = 'SamuelNDCE/Meerkat'
const API = 'https://api.github.com'
const TIMEOUT_MS = 30000
const MAX_TARBALL = 200 * 1024 * 1024

// "<hash>  <file>" lines (sha256sum format, `*` marks binary mode). Returns [{ hash, file }].
export function parseChecksums(text) {
  const out = []
  for (const raw of String(text ?? '').split('\n')) {
    const m = raw.replace(/\r$/, '').trim().match(/^([0-9a-fA-F]{64})\s+\*?(\S.*)$/)
    if (m) out.push({ hash: m[1].toLowerCase(), file: m[2].trim() })
  }
  return out
}

export const proceedText = (version) =>
  `To proceed: ask the maintainer to publish a SHA256SUMS asset (or checksum lines in the release notes) for v${version}, then run the update again. ` +
  'Or install the packaged copy, which npm verifies itself: npm install -g @samuelndce/meerkat@latest'

const refuse = (version, why) => ({
  ok: false,
  reason: `could not verify this release (${why}). Updates are refused unless the release tarball matches its published SHA-256 checksum. ${proceedText(version)}`,
})

async function get(fetchImpl, url, kind) {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS)
  try {
    const res = await fetchImpl(url, { signal: ctl.signal, headers: { 'User-Agent': 'meerkat-update', Accept: kind === 'json' ? 'application/vnd.github+json' : '*/*' }, redirect: 'follow' })
    if (!res.ok) throw new Error(`${url} answered ${res.status}`)
    if (kind === 'json') return await res.json()
    if (kind === 'text') return await res.text()
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.length > MAX_TARBALL) throw new Error('tarball is unexpectedly large')
    return buf
  } finally {
    clearTimeout(timer)
  }
}

// { ok: true, sha256 } when the tarball of v<version> matches a published checksum, else { ok: false, reason }.
export async function verifyRelease({ version, repo = RELEASE_REPO, fetchImpl = globalThis.fetch } = {}) {
  if (!isVersion(version)) return refuse(String(version), 'the new version number is not known')
  if (typeof fetchImpl !== 'function') return refuse(version, 'no way to reach GitHub from this Node')
  try {
    const rel = await get(fetchImpl, `${API}/repos/${repo}/releases/tags/v${version}`, 'json')
    const assets = Array.isArray(rel?.assets) ? rel.assets : []
    const sumsAsset = assets.find((a) => /sha256/i.test(String(a?.name ?? '')) && a.browser_download_url)
    const sums = [...parseChecksums(sumsAsset ? await get(fetchImpl, sumsAsset.browser_download_url, 'text') : ''), ...parseChecksums(rel?.body)]
    if (!sums.length) return refuse(version, 'the release has no published checksum')
    const isTar = (f) => /\.(tar\.gz|tgz)$/i.test(f)
    const entry = sums.find((s) => isTar(s.file) && s.file.includes(version)) ?? sums.find((s) => isTar(s.file))
    if (!entry) return refuse(version, 'the checksum file does not list a tarball')
    const asset = assets.find((a) => a?.name === entry.file && a.browser_download_url)
    const url = asset?.browser_download_url ?? rel?.tarball_url
    if (!url) return refuse(version, 'the release has no tarball to check')
    const got = createHash('sha256').update(await get(fetchImpl, url, 'binary')).digest('hex')
    if (got !== entry.hash) return { ok: false, reason: `the tarball for v${version} does not match its published SHA-256 checksum (expected ${entry.hash}, got ${got}). Nothing was installed. Do not use this release; tell the maintainer.` }
    return { ok: true, sha256: got }
  } catch (e) {
    return refuse(version, String(e?.message ?? e).split('\n')[0])
  }
}

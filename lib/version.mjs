// Meerkat's version, in one place. package.json is the single source: it is read once, here, and every place that shows, saves,
// reports or compares a version imports VERSION or these functions. Nothing else reads package.json for its version.
//
// Comparison follows semantic versioning precedence (https://semver.org, section 11): numbers compare as numbers (0.9.0 is older than
// 0.10.0), a pre-release is older than its release (1.0.0-rc.1 < 1.0.0), pre-release parts compare one by one (rc.2 > rc.1, alpha < alpha.1,
// numeric parts below text parts), and build metadata (+build.5) is ignored. Anything that is not a valid version gives null, never a throw.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// The official semver grammar, with no leading zeros and no spaces, so "1.4", "v1.4.0" and "1.4.0 " are not versions.
export const SEMVER_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/

export const isVersion = (v) => typeof v === 'string' && v.length <= 64 && SEMVER_RE.test(v)

// { core: [major, minor, patch] as strings, pre: [identifiers] or null }, or null for anything that is not a version.
export function parseVersion(v) {
  if (!isVersion(v)) return null
  const m = SEMVER_RE.exec(v)
  return { core: [m[1], m[2], m[3]], pre: m[4] ? m[4].split('.') : null }
}

// Compares two decimal digit strings without converting them to numbers, so a very long number cannot lose precision.
const cmpNum = (a, b) => (a.length !== b.length ? a.length - b.length : a < b ? -1 : a > b ? 1 : 0)
const cmpText = (a, b) => (a < b ? -1 : a > b ? 1 : 0)
const isNum = (s) => /^\d+$/.test(s)

function cmpPreId(a, b) {
  const an = isNum(a)
  const bn = isNum(b)
  if (an && bn) return cmpNum(a, b)
  if (an) return -1 // numeric identifiers sort below text identifiers
  if (bn) return 1
  return cmpText(a, b)
}

// 1 when a is newer than b, -1 when older, 0 when they have the same precedence. null when either is not a valid version.
export function compareVersions(a, b) {
  const x = parseVersion(a)
  const y = parseVersion(b)
  if (!x || !y) return null
  for (let i = 0; i < 3; i++) {
    const c = cmpNum(x.core[i], y.core[i])
    if (c) return c < 0 ? -1 : 1
  }
  if (!x.pre && !y.pre) return 0
  if (!x.pre) return 1 // a release is newer than its own pre-release
  if (!y.pre) return -1
  const n = Math.max(x.pre.length, y.pre.length)
  for (let i = 0; i < n; i++) {
    if (i >= x.pre.length) return -1 // the shorter list of pre-release parts is the older one
    if (i >= y.pre.length) return 1
    const c = cmpPreId(x.pre[i], y.pre[i])
    if (c) return c < 0 ? -1 : 1
  }
  return 0
}

// True only when a is a valid version and newer than b. Invalid input is never "newer", so a bad remote value shows no update bar.
export const isNewer = (a, b) => compareVersions(a, b) === 1

const PACKAGE_JSON = fileURLToPath(new URL('../package.json', import.meta.url))

// The version from package.json, or 'unknown' when it cannot be read or is not a valid version.
function readPackageVersion() {
  try {
    const v = JSON.parse(readFileSync(PACKAGE_JSON, 'utf8')).version
    return isVersion(v) ? v : 'unknown'
  } catch {
    return 'unknown'
  }
}

export const VERSION = readPackageVersion()

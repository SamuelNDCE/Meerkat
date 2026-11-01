// Cuts a new Meerkat version: bumps package.json (the single source of the version, lib/version.mjs reads it), adds a dated entry to CHANGELOG.md
// from the notes you give it, and redraws the version badge. It changes files only; you commit, push and merge as usual, and every Meerkat
// that looks for updates (lib/update.mjs reads package.json on main) then shows the new number.
//   node tools/release.mjs patch "Fixed the stuck-test guard"        0.9.0 -> 0.9.1
//   node tools/release.mjs minor "Added the happy results screen"    1.2.3 -> 1.3.0
//   node tools/release.mjs major "..."                               1.3.0 -> 2.0.0
//   node tools/release.mjs 1.4.0 "..."                               set an exact version (must be newer)
//   add --dry-run to print what would change
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { compareVersions, isVersion } from '../lib/version.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
export function nextVersion(current, kind) {
  if (isVersion(kind)) return kind
  const [a, b, c] = current.split(/[.+-]/).map(Number)
  if (kind === 'major') return `${a + 1}.0.0`
  if (kind === 'minor') return `${a}.${b + 1}.0`
  if (kind === 'patch') return `${a}.${b}.${c + 1}`
  return null
}

export function changelogEntry(version, notes, date) {
  const lines = notes.split(/\s*;\s*|\n/).map((s) => s.trim()).filter(Boolean)
  return `## ${version} (${date})\n\n${lines.map((l) => `- ${l}`).join('\n')}\n`
}

function main(argv) {
  const dry = argv.includes('--dry-run')
  const [kind, ...rest] = argv.filter((a) => a !== '--dry-run')
  const notes = rest.join(' ')
  const pkgPath = join(ROOT, 'package.json')
  const pkgText = readFileSync(pkgPath, 'utf8')
  const pkg = JSON.parse(pkgText)
  const next = kind ? nextVersion(pkg.version, kind) : null
  if (!next || !notes) {
    console.log('usage: node tools/release.mjs <patch|minor|major|x.y.z> "what changed; one point per semicolon" [--dry-run]')
    return 2
  }
  if (compareVersions(next, pkg.version) <= 0) {
    console.log(`${next} is not newer than ${pkg.version}`)
    return 2
  }
  const entry = changelogEntry(next, notes, new Date().toISOString().slice(0, 10))
  console.log(`${pkg.version} -> ${next}\n\n${entry}`)
  if (dry) return 0
  writeFileSync(pkgPath, pkgText.replace(/("version":\s*")[^"]+(")/, `$1${next}$2`))
  // package-lock.json repeats the version (top level and the root package); the lockfile-sync check fails when they disagree.
  const lockPath = join(ROOT, 'package-lock.json')
  if (existsSync(lockPath)) {
    const lock = JSON.parse(readFileSync(lockPath, 'utf8'))
    lock.version = next
    if (lock.packages?.['']) lock.packages[''].version = next
    writeFileSync(lockPath, JSON.stringify(lock, null, 2) + '\n')
  }
  const clPath = join(ROOT, 'CHANGELOG.md')
  const head = '# Changelog\n\nEvery released version of Meerkat, newest first. Versions follow semantic versioning: a patch fixes, a minor adds, a major changes how you use it.\n\n'
  const old = existsSync(clPath) ? readFileSync(clPath, 'utf8').replace(/^# Changelog[\s\S]*?\r?\n\r?\n(?=## )/, '') : ''
  writeFileSync(clPath, head + entry + '\n' + old)
  execFileSync(process.execPath, [join(ROOT, 'tools', 'make-badges.mjs')], { stdio: 'inherit' })
  console.log(`Done. Now commit package.json, CHANGELOG.md and docs/images/badges, push, and merge. Tag it: git tag v${next}`)
  return 0
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) process.exitCode = main(process.argv.slice(2))

// Changelog gate for a release: CHANGELOG.md has an Unreleased section, every version heading carries a real date, and the newest version
// heading is the version in package.json. Reads two files, writes nothing.
//   node tools/release/changelog-check.mjs [--root <dir>]       exit 0 clean (warnings may print), 1 a problem
// Heading forms accepted: "## 1.2.3 (2026-11-06)" and "## 1.2.3 - 2026-11-06" (a leading v and [brackets] are fine).
// A second "## Unreleased" heading is a warning, not a failure: the notes still read, but the release tool would carry it into the wrong place.
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT, isMain } from './common.mjs'

const realDate = (s) => {
  const m = /(\d{4})-(\d{2})-(\d{2})/.exec(s)
  if (!m) return false
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]))
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3]
}

// Returns { problems, warnings }. text: the CHANGELOG.md text; version: package.json's version.
export function checkChangelog(text, version) {
  const problems = []
  const warnings = []
  const heads = [...text.matchAll(/^##\s+(.+?)\s*$/gm)].map((m) => m[1].replace(/[[\]]/g, '').trim())
  const unreleased = heads.filter((h) => /^unreleased\b/i.test(h))
  if (!unreleased.length) problems.push('CHANGELOG.md has no "## Unreleased" section (new notes need somewhere to go)')
  if (unreleased.length > 1) warnings.push(`CHANGELOG.md has ${unreleased.length} "## Unreleased" headings; keep one`)
  const versions = heads.map((h) => ({ h, m: /^v?(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)\b(.*)$/.exec(h) })).filter((x) => x.m)
  if (!versions.length) problems.push('CHANGELOG.md has no version heading')
  for (const { h, m } of versions) {
    if (!realDate(m[2])) problems.push(`version heading "${h}" has no real date (write "## ${m[1]} (YYYY-MM-DD)")`)
  }
  if (versions.length && version && versions[0].m[1] !== version) {
    problems.push(`the newest version heading is ${versions[0].m[1]} but package.json says ${version}`)
  }
  return { problems, warnings }
}

export function checkChangelogAt(root) {
  const file = join(root, 'CHANGELOG.md')
  const pkg = join(root, 'package.json')
  if (!existsSync(file)) return { problems: ['CHANGELOG.md is missing'], warnings: [] }
  if (!existsSync(pkg)) return { problems: ['package.json is missing'], warnings: [] }
  return checkChangelog(readFileSync(file, 'utf8'), JSON.parse(readFileSync(pkg, 'utf8')).version)
}

function main(argv) {
  const i = argv.indexOf('--root')
  const { problems, warnings } = checkChangelogAt(i >= 0 ? argv[i + 1] : ROOT)
  for (const w of warnings) console.log(`changelog-check: warning: ${w}`)
  if (problems.length) {
    console.log(`changelog-check: FAIL, ${problems.length} problem(s)`)
    for (const p of problems) console.log(`  ${p}`)
    return 1
  }
  console.log('changelog-check: OK, Unreleased section present, versions dated, newest matches package.json')
  return 0
}
if (isMain(import.meta.url)) process.exitCode = main(process.argv.slice(2))

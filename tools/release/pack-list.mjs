// Pack file-list gate: what `npm pack` would put in the tarball is checked against an allow rule, so a secret-looking file, a .env, a test
// file, a stray fixture or a file outside the expected folders never ships. Nothing is published or written (`npm pack --dry-run`).
//   node tools/release/pack-list.mjs [--root <dir>]       exit 0 clean, 1 a file broke the rule, 75 npm pack could not run
// The rule (kept here, in one place):
//   expected top-level folders: bin, lib, packs, thorough, profiles, fixtures, examples, skills (the workflow profiles, the self-tests and the example packs ship on purpose)
//   expected top-level files:   package.json, README, LICENSE, CHANGELOG.md, llms.txt, run.mjs, meerkat.config.json
//   fixtures only under fixtures/ or examples/<name>/fixtures/ (planted-defect folders the self-tests read); a fixture anywhere else fails
//   never: .env files (except .env.example and .env.sample), key and certificate files, .npmrc, credentials and secrets files, test files and tests/ folders
import { ROOT, first, isMain, run } from './common.mjs'

export const TOP_DIRS = ['bin', 'lib', 'packs', 'thorough', 'profiles', 'fixtures', 'examples', 'skills']
export const TOP_FILES = /^(package\.json|README(\.[a-z]+)?|LICENSE(\.[a-z]+)?|CHANGELOG\.md|llms\.txt|run\.mjs|meerkat\.config\.json)$/i
const SECRET_NAME = [
  /(^|\/)\.env(\.(?!example$|sample$)[^/]*)?$/i,
  /\.(pem|key|p12|pfx|jks|keystore|ppk)$/i,
  /(^|\/)id_(rsa|dsa|ecdsa|ed25519)(\.pub)?$/i,
  /(^|\/)\.(npmrc|netrc|pypirc)$/i,
  /(^|\/)(credentials?|secrets?)(\.[a-z0-9]+)?$/i,
]
const TEST_FILE = /\.(test|spec)\.[cm]?[jt]sx?$|(^|\/)(__tests__|tests?)\//i
const FIXTURE_DIR = /(^|\/)(__fixtures__|fixtures?)\//i
const FIXTURE_OK = /^(fixtures\/|examples\/[^/]+\/fixtures\/)/

// paths: the file list as npm reports it (forward slashes). Returns one message per problem.
export function checkPackList(paths) {
  const problems = []
  if (!paths.length) return ['the tarball would be empty']
  for (const raw of paths) {
    const p = raw.split(String.fromCharCode(92)).join('/')
    const top = p.split('/')[0]
    const isDir = p.includes('/')
    if (SECRET_NAME.some((re) => re.test(p))) problems.push(`${p}: a secret-looking file name would be published`)
    else if (TEST_FILE.test(p)) problems.push(`${p}: a test file would be published`)
    else if (FIXTURE_DIR.test(p) && !FIXTURE_OK.test(p)) problems.push(`${p}: a fixture outside fixtures/ and examples/<name>/fixtures/ would be published`)
    else if (isDir ? !TOP_DIRS.includes(top) : !TOP_FILES.test(p)) problems.push(`${p}: outside the expected folders (${TOP_DIRS.join(', ')}) and files`)
  }
  return problems
}

// Runs `npm pack --dry-run --json` in root; returns { paths, error }.
export function packPaths(root) {
  const r = run('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], { cwd: root })
  if (r.code !== 0) return { paths: [], error: `npm pack --dry-run failed (exit ${r.code}): ${first(r.stderr || r.stdout)}` }
  try {
    const data = JSON.parse(r.stdout)
    return { paths: (data[0]?.files ?? []).map((f) => f.path) }
  } catch (e) {
    return { paths: [], error: `npm pack --dry-run --json did not give JSON: ${e.message}` }
  }
}

function main(argv) {
  const i = argv.indexOf('--root')
  const root = i >= 0 ? argv[i + 1] : ROOT
  const { paths, error } = packPaths(root)
  if (error) {
    console.log(`pack-list: NOT RUN. ${error}`)
    return 75
  }
  const problems = checkPackList(paths)
  if (problems.length) {
    console.log(`pack-list: FAIL, ${problems.length} problem(s) in the ${paths.length}-file tarball`)
    for (const p of problems.slice(0, 40)) console.log(`  ${p}`)
    return 1
  }
  console.log(`pack-list: OK, ${paths.length} files, all inside the allow rule`)
  return 0
}
if (isMain(import.meta.url)) process.exitCode = main(process.argv.slice(2))

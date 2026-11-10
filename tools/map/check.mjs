// Fails when the repo map is stale: MAP.md's generated block, a docs/map detail file, or the tracked-path digest in
// docs/map/CHECKPOINT.json no longer matches the tree. Also prints which folders changed since the checkpoint commit.
//   node tools/map/check.mjs [--root <repo>]      exit 0 current, 1 stale (lists the folders), 2 usage error
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { MAP_DIR, build, currentBlock, isGenerated, slug } from './generate.mjs'

const argv = process.argv.slice(2)
let root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--root' && argv[i + 1]) root = resolve(argv[++i])
  else { console.error('usage: node tools/map/check.mjs [--root <repo>]'); process.exit(2) }
}
const norm = (s) => s.replaceAll(String.fromCharCode(13, 10), String.fromCharCode(10))
const read = (p) => norm(readFileSync(join(root, p), 'utf8'))
const problems = []
const stale = new Set()

function diffNames(...args) {
  const r = spawnSync('git', ['-C', root, 'diff', '--name-only', ...args], { encoding: 'utf8', timeout: 30000, maxBuffer: 64 * 1024 * 1024 })
  return r.status === 0 ? r.stdout.split('\n').filter(Boolean) : []
}
const folderOf = (f) => (f.includes('/') ? f.split('/')[0] : 'root')

process.stderr.write('check: building the expected map\n')
const built = build(root)

process.stderr.write('check: comparing MAP.md and detail files\n')
if (!existsSync(join(root, 'MAP.md'))) problems.push('MAP.md is missing. Run: node tools/map/generate.mjs')
else {
  const cur = currentBlock(read('MAP.md'))
  if (cur === null) problems.push('MAP.md has no <!-- map:start --> ... <!-- map:end --> block')
  else if (cur !== norm(built.block)) problems.push('the MAP.md index block is out of date')
}
for (const [p, text] of built.files) {
  const name = p.slice(MAP_DIR.length + 1, -3)
  if (!existsSync(join(root, p)) || read(p) !== norm(text)) stale.add(name)
}

process.stderr.write('check: comparing the checkpoint\n')
let cp = null
try { cp = JSON.parse(readFileSync(join(root, MAP_DIR, 'CHECKPOINT.json'), 'utf8')) } catch { /* missing or bad */ }
const changed = new Set()
if (!cp) problems.push(`${MAP_DIR}/CHECKPOINT.json is missing or unreadable`)
else {
  const names = [...(cp.commit ? diffNames(cp.commit, 'HEAD') : []), ...diffNames('HEAD')]
  for (const f of names) if (!isGenerated(f)) changed.add(folderOf(f))
  if (cp.pathsSha256 !== built.checkpoint.pathsSha256) {
    problems.push('the set of tracked paths changed since the checkpoint')
    if (!changed.size) changed.add('(unknown, checkpoint commit not reachable)')
    for (const c of changed) stale.add(c)
  }
}

const dirNames = new Set(['root'])
for (const p of built.files.keys()) dirNames.add(p.slice(MAP_DIR.length + 1, -3))
const label = (n) => (n === 'root' ? 'root files' : dirNames.has(slug(n)) ? n + '/' : n)
if (changed.size) console.log(`changed since checkpoint ${cp && cp.commit ? cp.commit.slice(0, 7) : '?'}: ${[...changed].sort().map(label).join(', ')}`)
if (stale.size) problems.push(`stale folders (re-read, then run node tools/map/generate.mjs): ${[...stale].sort().map(label).join(', ')}`)
if (problems.length) { for (const p of problems) console.error(p); process.exit(1) }
console.log('map is current')

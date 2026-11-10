// Fails when MAP.md has drifted from the repo: a top-level tracked folder or a package.json bin entry is not mentioned, or the
// generated block between <!-- map:start --> and <!-- map:end --> is out of date.
//   node tools/map/check.mjs [--root <repo>]      exit 0 current, 1 drifted (lists what is missing), 2 usage error
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildBlock, currentBlock, tracked } from './generate.mjs'

const argv = process.argv.slice(2)
let root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--root' && argv[i + 1]) root = resolve(argv[++i])
  else { console.error('usage: node tools/map/check.mjs [--root <repo>]'); process.exit(2) }
}
const file = join(root, 'MAP.md')
if (!existsSync(file)) { console.error('MAP.md is missing. Run: node tools/map/generate.mjs'); process.exit(1) }
const text = readFileSync(file, 'utf8').replaceAll(String.fromCharCode(13, 10), String.fromCharCode(10))
const problems = []
const dirs = [...new Set(tracked(root).filter((f) => f.includes('/')).map((f) => f.split('/')[0]))].sort()
for (const d of dirs) if (!text.includes(d + '/')) problems.push(`top-level folder not mentioned in MAP.md: ${d}/`)
let pkg = {}
try { pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) } catch { /* none */ }
const bins = typeof pkg.bin === 'string' ? { [pkg.name]: pkg.bin } : pkg.bin || {}
for (const n of Object.keys(bins)) if (!text.includes(n)) problems.push(`package.json bin entry not mentioned in MAP.md: ${n}`)
const cur = currentBlock(text)
if (cur === null) problems.push('MAP.md has no <!-- map:start --> ... <!-- map:end --> block')
else if (cur !== buildBlock(root)) problems.push('the generated block is out of date (run: node tools/map/generate.mjs)')
if (problems.length) { for (const p of problems) console.error(p); process.exit(1) }
console.log('MAP.md is current')

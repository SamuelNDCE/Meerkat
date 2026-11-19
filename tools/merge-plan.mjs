// Prints the merge commands for a batch that PASSED, with a head-sha guard per branch. It merges nothing.
// Usage: node tools/merge-plan.mjs <batch summary.json> --repo <path> [--into <branch>]
// Refuses (exit 2) unless the batch is a fresh PASS: verdict PASS, union PASS, zero cache hits, at least one gate run, and every branch PASS.
// What it cannot see: per-check rows (NOT RUN, unclassified FAILs) are not in summary.json, so read the run folder's run.log for those before merging.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const args = process.argv.slice(2)
const file = args.find((a) => !a.startsWith('--'))
const flag = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d)
const repo = resolve(flag('--repo', '.'))
const into = flag('--into', 'the target branch')
if (!file) {
  process.stderr.write('usage: node tools/merge-plan.mjs <batch summary.json> --repo <path> [--into <branch>]\n')
  process.exit(2)
}
const s = JSON.parse(readFileSync(file, 'utf8'))
const problems = []
if (s.verdict !== 'PASS') problems.push(`batch verdict is ${s.verdict}, not PASS`)
if (s.unionVerdict && s.unionVerdict !== 'PASS') problems.push(`union verdict is ${s.unionVerdict}`)
if (!(s.gateRuns >= 1)) problems.push('no gate run recorded')
if (s.cacheHits > 0) problems.push(`${s.cacheHits} result(s) came from the cache, not a fresh gate`)
const notPass = (s.branches ?? []).filter((b) => b.verdict !== 'PASS' && b.verdict !== 'MERGEABLE')
for (const b of notPass) problems.push(`${b.branch} is ${b.verdict}`)
if (problems.length) {
  for (const p of problems) process.stdout.write(`NOT MERGE-READY: ${p}\n`)
  process.exit(2)
}
const ok = s.branches.filter((b) => b.verdict === 'PASS' || b.verdict === 'MERGEABLE')
process.stdout.write(`# Merge plan from ${s.batchId} (base ${s.base?.ref} ${String(s.base?.sha ?? '').slice(0, 12)}). Run these in order, one block per branch.\n`)
process.stdout.write('# Nothing below is run by this script. Check each guard prints OK before its merge.\n')
ok.forEach((b, i) => {
  const short = String(b.headSha).slice(0, 12)
  process.stdout.write(`\n# ${i + 1}. ${b.branch} (verdict ${b.verdict}, head ${short})\n`)
  process.stdout.write(`git -C "${repo}" rev-parse --verify -q ${b.branch} | node -e "const h=require('fs').readFileSync(0,'utf8').trim();if(!h.startsWith('${b.headSha}'))process.exit(1);console.log('OK head ${short}')"\n`)
  process.stdout.write(`git -C "${repo}" merge --no-ff ${b.branch} -m "Merge ${b.branch} (batch ${s.batchId})"\n`)
})

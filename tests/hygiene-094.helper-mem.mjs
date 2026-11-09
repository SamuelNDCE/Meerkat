// Helper for the memory test: node --expose-gc helper-mem.mjs <gate|verdict> <repo>. Runs the command in this process and prints one JSON line.
// gate: peak RSS sampled every 50 ms while one gate runs. verdict: heap used after gc before and after 5 consecutive runs in this process.
import { gateMain } from '../lib/gate.mjs'
import { runVerdict } from '../lib/branchcmds.mjs'
const [what, repo] = process.argv.slice(2)
const quiet = () => {}
const env = { ...process.env, MEERKAT_NO_PROJECT_CODE: '' }
if (what === 'gate') {
  let peak = process.memoryUsage().rss
  const t = setInterval(() => { peak = Math.max(peak, process.memoryUsage().rss) }, 50)
  const code = await gateMain(['--no-cache', '--base', 'main'], { env, cwd: repo, log: quiet, err: quiet, banner: false })
  clearInterval(t)
  peak = Math.max(peak, process.memoryUsage().rss)
  console.log(JSON.stringify({ code, peakRssMB: Math.round(peak / 1048576) }))
} else {
  const once = () => runVerdict(['--base', 'main'], { env, cwd: repo, out: quiet, err: quiet, memory: false })
  await once() // warm-up: modules, caches
  global.gc(); global.gc()
  const before = process.memoryUsage().heapUsed
  const codes = []
  for (let i = 0; i < 5; i++) codes.push(await once())
  global.gc(); global.gc()
  const after = process.memoryUsage().heapUsed
  console.log(JSON.stringify({ codes, growthMB: Math.round(((after - before) / 1048576) * 10) / 10 }))
}
process.exit(0)

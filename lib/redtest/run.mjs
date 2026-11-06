// Run the red-test suite, or one kind of it:  node lib/redtest/run.mjs --kind mutation|faults|adversarial|regression|cleantwin|all
// Each kind is its own file (lib/redtest/<kind>.test.ts) and runs on its own. Extra arguments go to vitest.
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const KINDS = { mutation: 'mutation.test.ts', faults: 'faults.test.ts', adversarial: 'adversarial.test.ts', regression: 'regression.test.ts', cleantwin: 'cleantwin.test.ts' }
const here = fileURLToPath(new URL('.', import.meta.url))
const root = join(here, '..', '..')

const args = process.argv.slice(2)
const at = args.indexOf('--kind')
const kind = at >= 0 ? args[at + 1] : 'all'
const rest = args.filter((_, i) => i !== at && i !== at + 1)
if (kind !== 'all' && !KINDS[kind]) {
  console.error(`unknown kind "${kind}". Kinds: ${Object.keys(KINDS).join(', ')}, all`)
  process.exit(2)
}
const files = (kind === 'all' ? Object.values(KINDS) : [KINDS[kind]]).map((f) => `lib/redtest/${f}`).filter((f) => existsSync(join(root, f)))
const vitest = join(root, 'node_modules', 'vitest', 'vitest.mjs')
const bin = existsSync(vitest) ? [process.execPath, vitest] : ['npx', 'vitest']
const r = spawnSync(bin[0], [...bin.slice(1), 'run', '--silent=false', ...files, ...rest], { cwd: root, stdio: 'inherit', shell: bin[0] === 'npx' && process.platform === 'win32' })
process.exit(r.status ?? 1)

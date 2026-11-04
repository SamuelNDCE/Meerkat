// Runs the slow accuracy corpus (lib/accuracy.test.ts) on its own: `npm run test:accuracy`.
// It sets MEERKAT_ACCURACY=1 for the child process and passes the exit code back.
import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const vitest = resolve(root, 'node_modules', 'vitest', 'vitest.mjs')
const r = spawnSync(process.execPath, [vitest, 'run', 'lib/accuracy.test.ts'], { cwd: root, stdio: 'inherit', env: { ...process.env, MEERKAT_ACCURACY: '1' } })
process.exit(r.status ?? 1)

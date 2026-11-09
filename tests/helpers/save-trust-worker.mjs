// Child process for tests/concurrency-067.test.ts: saves N trust records the way `meerkat trust` does (key <prefix>/<i>), then exits.
import { saveTrust } from '../../lib/trust.mjs'
const [prefix, count] = process.argv.slice(2)
for (let i = 0; i < Number(count); i++) saveTrust(process.env, `${prefix}/${i}`, `hash-${prefix}-${i}`)

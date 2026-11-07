// The worker thread behind lib/inproc.mjs. It runs one thorough/*.mjs check at a time as a plain function call, with the same arguments, environment and
// output a `node thorough/x.mjs <id> --root <dir>` process would have, and posts the output back as it is written.
// A worker lives for one run (lib/inproc.mjs closes the pool at the start and end of every run), so module-level caches in the scripts cannot go stale.
import { parentPort } from 'node:worker_threads'
import cp from 'node:child_process'
import { syncBuiltinESMExports } from 'node:module'
import { pathToFileURL } from 'node:url'

const post = (m) => parentPort.postMessage(m)
globalThis.__meerkatReadCache = true // thorough/kit.mjs readText may reuse text it already read this run (checked against mtime and size)

// Everything the script writes goes back to the caller, in order, tagged with the stream it was written to.
const writer = (stream) =>
  function write(chunk, enc, cb) {
    post({ t: 'out', s: stream, d: typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8') })
    const done = typeof enc === 'function' ? enc : cb
    if (typeof done === 'function') done()
    return true
  }
process.stdout.write = writer('stdout')
process.stderr.write = writer('stderr')

// A process would inherit the folder it was started in. A worker shares the main thread's folder, so a child a script starts without a `cwd` gets the task's folder.
let taskCwd = process.cwd()
const isOpts = (x) => x && typeof x === 'object' && !Array.isArray(x)
function withCwd(name, pairWithArgs) {
  const orig = cp[name]
  if (typeof orig !== 'function') return
  cp[name] = function patched(...a) {
    const i = a.findIndex((x, k) => k > 0 && isOpts(x))
    if (i > 0) {
      if (a[i].cwd == null) a[i] = { ...a[i], cwd: taskCwd }
    } else {
      const cb = typeof a[a.length - 1] === 'function' ? a.pop() : null
      const at = pairWithArgs && Array.isArray(a[1]) ? 2 : 1
      while (a.length < at) a.push(undefined)
      a.splice(at, 0, { cwd: taskCwd })
      if (cb) a.push(cb)
    }
    return orig.apply(this, a)
  }
}
for (const n of ['execFileSync', 'spawnSync', 'spawn', 'execFile']) withCwd(n, true)
for (const n of ['execSync', 'exec']) withCwd(n, false)
syncBuiltinESMExports()

function setEnv(env) {
  for (const k of Object.keys(process.env)) if (!(k in env)) delete process.env[k]
  for (const [k, v] of Object.entries(env)) if (process.env[k] !== v) process.env[k] = v
}

const loaded = new Map() // script path -> its checks table, or null when it registered none
let kit = null

parentPort.on('message', async (m) => {
  if (m.t !== 'run') return
  taskCwd = m.cwd
  setEnv(m.env)
  try {
    kit ??= await import('../thorough/kit.mjs')
    if (!loaded.has(m.script)) {
      let captured = null
      globalThis.__meerkatRegister = (c) => {
        captured = c
      }
      try {
        await import(pathToFileURL(m.script).href)
      } finally {
        delete globalThis.__meerkatRegister
      }
      loaded.set(m.script, captured)
    }
    const table = loaded.get(m.script)
    if (!table) return post({ t: 'unsupported' })
    const a = kit.parseArgs(['node', m.script, ...m.args])
    const check = table[a.check]
    let code
    if (!check) {
      process.stdout.write(`unknown check "${a.check}". Checks here: ${Object.keys(table).join(', ')}\n`)
      code = 2
    } else code = a.fixtures ? await check.fixture() : await check.run(a.root, a.rest)
    post({ t: 'done', code: Number.isInteger(code) ? code : 0 })
  } catch (e) {
    process.stderr.write(`${e?.stack ?? e}\n`)
    post({ t: 'done', code: 1 })
  }
})
post({ t: 'ready' })

// `meerkat memory`: hand the newest run's results to a memory adapter, a small module that writes them somewhere a project keeps its notes.
// This is only the hook. It reads "memory": { "adapter": "<name>" } from meerkat.config.json, finds the adapter under examples/, and calls it.
// With no "memory" setting nothing is loaded and nothing is written. The adapter decides where and what to write (see its own header).
//   meerkat memory [folder] [--app <folder>] [--run <run folder>] [--dry-run] [--json]
// An adapter is examples/<folder>/export.mjs exporting exportMemory({ appDir, runDir, env, dryRun, ...settings }) and summaryLine(result).
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { CONFIG_NAME, findConfig, readConfig } from './config.mjs'
import { MEERKAT_DIR, repoRootOf } from './paths.mjs'
import { examplePacks } from './example-packs.mjs'

// The adapters Meerkat can call, by the name used in the config: name -> file under Meerkat's own folder. Read from the example packs' pack.json files, so no adapter is named here.
export const ADAPTERS = Object.fromEntries(examplePacks().filter((p) => p.memoryAdapter).map((p) => [p.pack, `examples/${p.dir}/${p.memoryAdapter}`]))

const flagValue = (argv, name) => {
  const i = argv.indexOf(name)
  return i >= 0 ? argv[i + 1] : undefined
}

// meerkat memory. Exit 0 done, 1 the adapter refused or failed, 2 not configured or a usage error.
export async function runMemory(argv, { env = process.env, cwd = process.cwd(), out = (t) => process.stdout.write(`${t}\n`), err = (t) => process.stderr.write(`${t}\n`), root = MEERKAT_DIR } = {}) {
  const args = argv.slice(1)
  const known = new Set(['--app', '--run', '--dry-run', '--json'])
  const stray = args.filter((a) => a.startsWith('--') && !known.has(a))
  if (stray.length) return (err(`meerkat memory: unknown option ${stray[0]}. Use: meerkat memory [folder] [--app <folder>] [--run <run folder>] [--dry-run] [--json]`), 2)
  const positional = args.filter((a, i) => !a.startsWith('--') && !['--app', '--run'].includes(args[i - 1]))
  const appDir = resolve(cwd, flagValue(args, '--app') ?? positional[0] ?? '.')
  const file = findConfig({ appDir, repoRoot: repoRootOf(appDir) })
  const { config } = file ? readConfig(file) : { config: {} }
  const name = config.memory?.adapter
  if (!name) return (err(`meerkat memory: no memory adapter is set. Add "memory": { "adapter": "<name>" } to ${CONFIG_NAME}. Adapters: ${Object.keys(ADAPTERS).join(', ')}`), 2)
  if (!Object.prototype.hasOwnProperty.call(ADAPTERS, name)) return (err(`meerkat memory: unknown adapter "${name.slice(0, 40)}". Adapters: ${Object.keys(ADAPTERS).join(', ')}`), 2)
  const adapterFile = join(root, ADAPTERS[name])
  if (!existsSync(adapterFile)) return (err(`meerkat memory: the "${name}" adapter is not installed (${ADAPTERS[name]} is missing)`), 2)
  let adapter
  try {
    adapter = await import(pathToFileURL(adapterFile).href)
  } catch (e) {
    return (err(`meerkat memory: the "${name}" adapter could not be loaded: ${String(e?.message ?? e).split('\n')[0]}`), 1)
  }
  // Only these settings pass on: where the vault is never comes from the config file, so a copied config cannot point a write elsewhere.
  const settings = Object.fromEntries(['project', 'note'].filter((k) => typeof config.memory[k] === 'string').map((k) => [k, config.memory[k]]))
  const runArg = flagValue(args, '--run')
  const result = adapter.exportMemory({ appDir, runDir: runArg ? resolve(cwd, runArg) : undefined, env, dryRun: args.includes('--dry-run'), ...settings })
  if (args.includes('--json')) out(JSON.stringify({ ...result, text: undefined }, null, 2))
  else (result.ok ? out : err)(adapter.summaryLine(result))
  return result.ok ? 0 : 1
}

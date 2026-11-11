// ep-fuses-binary: reads the fuse state of the BUILT Electron binary (not the config), so a fuse set in an afterPack hook is judged by what it did.
// It uses @electron/fuses from the PROJECT's own node_modules, run as a child process with the project as cwd (Meerkat has no dependencies of its own).
//   node thorough/electron-fuse-binary.mjs [--root <dir>]       env MEERKAT_ELECTRON_BINARY=<path> names the binary when it is not in a usual place
// Exit 0: every fuse has its secure value. Exit 1: a fuse is wrong, or the binary could not be read (never a pass). Exit 75 (NOT RUN): no built binary
// (run the build first) or @electron/fuses is not installed in the project (tool missing).
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { formatFindingLine } from '../lib/findings.mjs'
import { hashFiles, isTrusted, trustedFiles } from '../lib/trust.mjs'

export const NOT_RUN = 75
// The secure value of each fuse, by the name @electron/fuses uses.
export const SECURE = { RunAsNode: 'off', EnableCookieEncryption: 'on', EnableNodeOptionsEnvironmentVariable: 'off', EnableNodeCliInspectArguments: 'off', EnableEmbeddedAsarIntegrityValidation: 'on', OnlyLoadAppFromAsar: 'on', GrantFileProtocolExtraPrivileges: 'off' }

const dirs = (p) => {
  try {
    return readdirSync(p).map((n) => join(p, n))
  } catch {
    return []
  }
}
// The built app: Windows <out>/win-unpacked/<App>.exe, macOS <out>/mac*/<App>.app/Contents/MacOS/<App>. The first one found, or null.
export function findBinary(root, env = process.env) {
  if (env.MEERKAT_ELECTRON_BINARY) return resolve(root, env.MEERKAT_ELECTRON_BINARY)
  for (const out of ['release', 'dist', 'out']) {
    for (const d of dirs(join(root, out))) {
      if (/win-unpacked$/.test(d)) {
        const exe = dirs(d).find((f) => /\.exe$/i.test(f) && !/^(uninstall|elevate|crashpad)/i.test(f.split(/[\\/]/).pop()))
        if (exe) return exe
      }
      if (/mac/i.test(d.split(/[\\/]/).pop())) {
        for (const app of dirs(d).filter((a) => /\.app$/i.test(a))) {
          const macos = join(app, 'Contents', 'MacOS')
          const bin = dirs(macos).find((f) => statSync(f).isFile())
          if (bin) return bin
        }
      }
    }
  }
  return null
}

const READER = "const f=require('@electron/fuses');const names={};for(const [k,v] of Object.entries(f.FuseV1Options)){if(typeof v==='number')names[v]=k}const st={0:'off',1:'on',2:'removed',3:'inherit'};f.getCurrentFuseWire(process.argv[1]).then((w)=>{const o={};for(const [k,v] of Object.entries(w)){if(names[k]!==undefined)o[names[k]]=st[v]??String(v)}console.log(JSON.stringify(o))},(e)=>{console.error(String(e&&e.message||e));process.exit(3)})"

// Returns { code, lines }.
// Reading the binary runs @electron/fuses from the PROJECT's node_modules, which is the project's own code. So it runs only where the project's
// own check code would run: not under MEERKAT_NO_PROJECT_CODE, and only when the folder is trusted (`meerkat trust`), or when whoever runs
// Meerkat set MEERKAT_TRUST_PROJECT=1. A project with no check code of its own has nothing to trust yet, so it needs that env var.
export function fusesReaderTrusted(root, env = process.env) {
  if (env.MEERKAT_NO_PROJECT_CODE === '1') return false
  if (env.MEERKAT_TRUST_PROJECT === '1') return true
  const path = resolve(root).replace(/\\/g, '/')
  const tf = trustedFiles({ projectDir: root, where: root, extraChecks: [] })
  if (tf.refuse || !tf.files.length) return false
  return isTrusted(env, path, hashFiles(tf.files, path))
}

export function fuseBinaryCheck(root, env = process.env) {
  try {
    if (!/electron/i.test(readFileSync(join(root, 'package.json'), 'utf8'))) return { code: 0, lines: ['not an Electron project, so there is no binary to read'] }
  } catch {
    return { code: 0, lines: ['no package.json, so this is not an Electron project'] }
  }
  const bin = findBinary(root, env)
  if (!bin || !existsSync(bin)) return { code: NOT_RUN, lines: [`NOT RUN: ${bin ? `the binary ${bin} does not exist` : 'no built Electron app was found (looked in release, dist and out for win-unpacked or a .app)'}. Run the build first, then run this check again.`] }
  if (!fusesReaderTrusted(root, env)) return { code: NOT_RUN, lines: ['NOT RUN: reading the binary runs @electron/fuses from this project, which is the project\'s own code, and this folder is not trusted (or MEERKAT_NO_PROJECT_CODE is set). Run meerkat trust in this folder, or set MEERKAT_TRUST_PROJECT=1 if whoever runs Meerkat owns the repository'] }
  if (!existsSync(join(root, 'node_modules', '@electron', 'fuses'))) return { code: NOT_RUN, lines: ['NOT RUN: @electron/fuses is not installed in this project (tool missing), so the fuse state of the built binary cannot be read. Install it with: npm install --save-dev @electron/fuses'] }
  const rel = relative(root, bin).split('\\').join('/') || 'binary'
  const r = spawnSync(process.execPath, ['-e', READER, bin], { cwd: root, encoding: 'utf8', timeout: 60_000 })
  let state = null
  try {
    state = r.status === 0 ? JSON.parse(String(r.stdout).trim().split('\n').pop()) : null
  } catch {
    state = null
  }
  if (!state) {
    const why = String(r.error?.message ?? r.stderr ?? 'no output').trim().split('\n')[0].slice(0, 200)
    return { code: 1, lines: [formatFindingLine('high', 'ep-fuse-binary-unreadable', rel, 0, `the fuse state of the built binary could not be read (${why}); this is not a pass`), `FAIL: could not read the fuses of ${rel}`] }
  }
  const lines = [`fuse state of ${rel}:`]
  let bad = 0
  for (const [name, want] of Object.entries(SECURE)) {
    const got = state[name] ?? 'not present'
    lines.push(`  ${name}: ${got}${got === want ? '' : ` (secure value: ${want})`}`)
    if (got !== want) {
      bad++
      lines.push(formatFindingLine(name === 'EnableEmbeddedAsarIntegrityValidation' || name === 'OnlyLoadAppFromAsar' || name === 'EnableCookieEncryption' ? 'low' : 'medium', `ep-fuse-binary-${name.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase()}`.slice(0, 60), rel, 0, `${name} is ${got} in the built binary; the secure value is ${want}`))
    }
  }
  lines.push(bad ? `FAIL: ${bad} fuse(s) in ${rel} do not have their secure value` : `PASS: every fuse in ${rel} has its secure value`)
  return { code: bad ? 1 : 0, lines }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const i = process.argv.indexOf('--root')
  const r = fuseBinaryCheck(resolve(i > 0 ? process.argv[i + 1] : '.'))
  for (const l of r.lines) console.log(l)
  process.exitCode = r.code
}

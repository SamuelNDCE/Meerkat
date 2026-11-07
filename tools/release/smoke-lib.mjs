// Pieces shared by tarball-smoke.mjs and upgrade-smoke.mjs: pack the repo, install something into a throwaway project, find the installed bin,
// and run it with a throwaway home folder so a smoke test never reads or writes the real ~/.meerkat.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { first, run } from './common.mjs'

// Packs the repo into dest (a folder). Returns { file, files, error }: file is the .tgz path, files the paths inside it as npm reports them.
export function packTarball(root, dest) {
  mkdirSync(dest, { recursive: true })
  const r = run('npm', ['pack', '--pack-destination', dest, '--json', '--ignore-scripts'], { cwd: root })
  if (r.code !== 0) return { error: `npm pack failed (exit ${r.code}): ${first(r.stderr || r.stdout)}` }
  try {
    const info = JSON.parse(r.stdout)[0]
    return { file: join(dest, info.filename), files: info.files.map((f) => f.path), info }
  } catch (e) {
    return { error: `npm pack gave no JSON: ${e.message}` }
  }
}

// A new empty project that installs go into.
export function makeProject(dir) {
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'meerkat-smoke-project', version: '1.0.0', private: true }, null, 2) + '\n')
  return dir
}

// `npm install <spec>` into the project. A folder spec is copied (--install-links), never symlinked. Offline by default: Meerkat has no
// dependencies, so a local tarball or folder installs without the registry; pass online: true for a registry spec.
export function install(project, spec, { online = false } = {}) {
  const args = ['install', spec, '--no-audit', '--no-fund', '--ignore-scripts', '--install-links', '--loglevel=error']
  if (!online) args.push('--offline')
  const r = run('npm', args, { cwd: project })
  return r.code === 0 ? { ok: true } : { ok: false, error: `npm install ${spec} failed (exit ${r.code}): ${first(r.stderr || r.stdout)}` }
}

// The installed package folder and its first bin file, read from the installed package.json (not from the repo).
export function installedBin(project, name = '@samuelndce/meerkat', binName = 'meerkat') {
  const dir = join(project, 'node_modules', ...name.split('/'))
  const pkgFile = join(dir, 'package.json')
  if (!existsSync(pkgFile)) return { error: `${name} is not installed in ${project}` }
  const pkg = JSON.parse(readFileSync(pkgFile, 'utf8'))
  const rel = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin?.[binName]
  if (!rel) return { error: `${name} has no "${binName}" bin in its package.json` }
  const file = join(dir, rel)
  if (!existsSync(file)) return { error: `the bin ${rel} named in package.json is missing from the installed package` }
  return { dir, file, version: pkg.version, shim: existsSync(join(project, 'node_modules', '.bin', process.platform === 'win32' ? `${binName}.cmd` : binName)) }
}

// Environment for a child that must not touch the real home folder.
export function isolatedEnv(home) {
  const env = { ...process.env, HOME: home, USERPROFILE: home, MEERKAT_HOME: join(home, '.meerkat'), CI: '1' }
  delete env.MEERKAT_LOG_DIR
  return env
}

export const runBin = (bin, args, { cwd, home, timeout = 180000 }) => run(process.execPath, [bin, ...args], { cwd, env: isolatedEnv(home), timeout })

// A tiny project to scan: a package.json, one source file, a git repo with both tracked (Meerkat reads the files git tracks).
export function makeFixtureApp(dir) {
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'smoke-fixture', version: '1.0.0', private: true }, null, 2) + '\n')
  writeFileSync(join(dir, 'index.js'), "console.log('hello')\n")
  run('git', ['init', '-q', '.'], { cwd: dir })
  run('git', ['add', '-A'], { cwd: dir })
  return dir
}

// Tarball install test: packs the repo exactly as npm would publish it, checks the file list, installs the .tgz into a fresh temp project,
// and runs the INSTALLED bin (not the source): --version, --help and a quick scan of a tiny fixture. Every temp folder is removed at the end.
//   node tools/release/tarball-smoke.mjs [--online] [--keep] [--scan-args "<preset> <folder-placeholder>"]
//   --online   let npm use the registry (default is --offline: Meerkat has no dependencies, so the local tarball alone installs)
//   --keep     do not delete the temp folders (to look at them); the paths are printed
// Exit 0 pass, 1 a step failed, 75 it could not start (npm missing), never a silent pass. A step that fails names itself and shows the output.
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT, first, isMain, removeDir, tempDir } from './common.mjs'
import { checkPackList } from './pack-list.mjs'
import { install, installedBin, isolatedEnv, makeFixtureApp, makeProject, packTarball, runBin } from './smoke-lib.mjs'

export const SCAN_SECONDS = 180

// opts: { root, online, keep, scanArgs (array, "{app}" is replaced by the fixture folder), log }. Returns { ok, steps, failed, leftovers }.
export function tarballSmoke(opts = {}) {
  const root = opts.root ?? ROOT
  const log = opts.log ?? ((s) => console.log(s))
  const scanArgs = opts.scanArgs ?? ['security-fast', '{app}', '--plain']
  const steps = []
  const step = (name, ok, detail = '') => {
    steps.push({ name, ok, detail })
    log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? `: ${detail}` : ''}`)
    return ok
  }
  const work = tempDir('tarball')
  const dirs = [work]
  try {
    const packed = packTarball(root, join(work, 'pack'))
    if (packed.error) return { ok: false, steps, failed: 'npm pack', notRun: true, error: packed.error, leftovers: [] }
    step('npm pack made a tarball', existsSync(packed.file), packed.file ? `${packed.files.length} files` : '')
    const problems = checkPackList(packed.files)
    if (!step('tarball file list is inside the allow rule', problems.length === 0, problems.slice(0, 5).join('; '))) return finish()

    const project = makeProject(join(work, 'project'))
    const inst = install(project, packed.file, { online: opts.online })
    if (!step(`npm install of the tarball${opts.online ? '' : ' (offline)'}`, inst.ok, inst.error)) return finish()

    const bin = installedBin(project)
    if (!step('installed package has a bin that exists', !bin.error, bin.error)) return finish()
    step('the .bin shim was created', bin.shim, bin.shim ? '' : 'node_modules/.bin has no meerkat link')

    const home = join(work, 'home')
    const wantVersion = packed.info.version
    const v = runBin(bin.file, ['--version'], { cwd: project, home })
    if (!step('--version exits 0 and prints the packed version', v.code === 0 && v.stdout.trim() === wantVersion, `exit ${v.code}, got "${v.stdout.trim()}", want "${wantVersion}"${v.stderr ? `, stderr: ${first(v.stderr, 200)}` : ''}`)) return finish()

    const h = runBin(bin.file, ['--help'], { cwd: project, home })
    if (!step('--help exits 0 and mentions meerkat', h.code === 0 && /meerkat/i.test(h.stdout), `exit ${h.code}${h.stderr ? `, stderr: ${first(h.stderr, 200)}` : ''}`)) return finish()

    const app = makeFixtureApp(join(work, 'app'))
    const s = runBin(bin.file, scanArgs.map((a) => a.replace('{app}', app)), { cwd: project, home, timeout: SCAN_SECONDS * 1000 })
    // 0 = clean, 1 = findings on the tiny fixture (a missing licence field is one); 2 or more means the tool itself broke or could not start.
    const summary = /MEERKAT\b[^\n]*\bpassed\b/.test(s.stdout)
    if (!step('a quick scan of a tiny fixture finishes with a summary line', (s.code === 0 || s.code === 1) && summary, `exit ${s.code}${summary ? '' : `, no summary line; output: ${first(s.stdout + s.stderr, 400)}`}`)) return finish()
    step('the scan wrote its logs under the temp home, not the real one', existsSync(join(isolatedEnv(home).HOME, '.meerkat')), '')
    return finish()
  } finally {
    if (!opts.keep) dirs.forEach(removeDir)
  }

  function finish() {
    const failed = steps.find((s) => !s.ok)
    return { ok: !failed, steps, failed: failed?.name, leftovers: opts.keep ? dirs : [], work }
  }
}

function main(argv) {
  const keep = argv.includes('--keep')
  const online = argv.includes('--online')
  const i = argv.indexOf('--scan-args')
  const scanArgs = i >= 0 ? argv[i + 1].split(/\s+/) : undefined
  console.log('tarball-smoke: pack, install the tarball in a fresh project, run the installed bin')
  const r = tarballSmoke({ keep, online, scanArgs })
  if (r.notRun) {
    console.log(`tarball-smoke: NOT RUN. ${r.error}`)
    return 75
  }
  if (r.leftovers.length) console.log(`kept: ${r.leftovers.join(', ')}`)
  console.log(r.ok ? `tarball-smoke: PASS (${r.steps.length} steps)` : `tarball-smoke: FAIL at "${r.failed}"`)
  return r.ok ? 0 : 1
}
if (isMain(import.meta.url)) process.exitCode = main(process.argv.slice(2))

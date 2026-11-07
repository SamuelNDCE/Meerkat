// Upgrade test: install the PREVIOUS version into a throwaway project, let it save state (a run in the run store, a baseline), plant a
// dismissal, install the NEW tarball over it, and check that the saved state is untouched and still reads. All state goes in a temp home
// folder, never the real ~/.meerkat. Without --previous nothing runs (it would need the registry), and that is said, not passed.
//   node tools/release/upgrade-smoke.mjs --previous <spec> [--new <tgz|folder>] [--online] [--keep] [--scan-args "<args with {app}>"]
//   --previous  what npm installs as the old version: a registry spec (@samuelndce/meerkat@<old version>, needs the network: add --online),
//               a folder holding an unpacked package, or a .tgz
//   --allow-same  do not fail when the new version number equals the old one (a rehearsal from the same commit)
//   --new       what goes over it (default: `npm pack` of this repo)
// Exit 0 pass, 1 a step failed, 75 not run (no --previous, or pack failed).
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { projectSlug } from '../../lib/findingshistory.mjs'
import { ROOT, first, isMain, removeDir, tempDir } from './common.mjs'
import { install, installedBin, makeFixtureApp, makeProject, packTarball, runBin } from './smoke-lib.mjs'

const STATE_DIRS = ['logs/runs', 'baselines', 'dismissals', 'findings']

// Every file under the saved-state folders of a home, as { 'relative/path': sha256 }.
export function snapshotState(home) {
  const out = {}
  const walk = (dir, rel) => {
    if (!existsSync(dir)) return
    for (const name of readdirSync(dir)) {
      const p = join(dir, name)
      if (statSync(p).isDirectory()) walk(p, `${rel}/${name}`)
      else out[`${rel}/${name}`] = createHash('sha256').update(readFileSync(p)).digest('hex')
    }
  }
  for (const d of STATE_DIRS) walk(join(home, '.meerkat', ...d.split('/')), d)
  return out
}

// What changed between two snapshots: files that vanished and files whose content changed (new files are fine).
export function stateDiff(before, after) {
  return { missing: Object.keys(before).filter((k) => !(k in after)), changed: Object.keys(before).filter((k) => k in after && after[k] !== before[k]) }
}

// opts: { previous, newSpec, root, online, keep, scanArgs, log }. Returns { ok, steps, failed, notRun, error }.
export function upgradeSmoke(opts) {
  const log = opts.log ?? ((s) => console.log(s))
  const steps = []
  const step = (name, ok, detail = '') => {
    steps.push({ name, ok, detail })
    log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? `: ${detail}` : ''}`)
    return ok
  }
  const done = () => {
    const failed = steps.find((s) => !s.ok)
    return { ok: !failed, steps, failed: failed?.name }
  }
  if (!opts.previous) return { ok: false, notRun: true, steps, error: 'no --previous given, so there is no old version to upgrade from (this test never uses the network on its own)' }
  const work = tempDir('upgrade')
  try {
    let newSpec = opts.newSpec
    let newVersion
    if (!newSpec) {
      const packed = packTarball(opts.root ?? ROOT, join(work, 'pack'))
      if (packed.error) return { ok: false, notRun: true, steps, error: packed.error }
      newSpec = packed.file
      newVersion = packed.info.version
    }
    const home = join(work, 'home')
    mkdirSync(home, { recursive: true })
    const project = makeProject(join(work, 'project'))
    const app = makeFixtureApp(join(work, 'app'))
    const scanArgs = (opts.scanArgs ?? ['security-fast', '{app}', '--plain']).map((a) => a.replace('{app}', app))

    const inst = install(project, opts.previous, { online: opts.online })
    if (!step(`install the previous version (${opts.previous})`, inst.ok, inst.error)) return done()
    const old = installedBin(project)
    if (!step('previous version has a bin', !old.error, old.error)) return done()
    const ov = runBin(old.file, ['--version'], { cwd: project, home })
    if (!step('previous --version runs', ov.code === 0 && ov.stdout.trim() === old.version, `exit ${ov.code}, got "${ov.stdout.trim()}", package.json says ${old.version}`)) return done()

    const scan = runBin(old.file, scanArgs, { cwd: project, home, timeout: 180000 })
    if (!step('previous version scans the fixture', scan.code === 0 || scan.code === 1, `exit ${scan.code} ${first(scan.stderr, 200)}`)) return done()
    const base = runBin(old.file, ['baseline', app], { cwd: project, home })
    step('previous version saved a baseline', base.code === 0, `exit ${base.code} ${first(base.stderr || base.stdout, 200)}`)

    // `meerkat dismiss <finding id>` needs an id that is not known in advance, so a dismissal is planted in the documented format
    // (schemaVersion 1, items with id and reason), under the name the project slug gives, for the new version to read.
    const dismissFile = join(home, '.meerkat', 'dismissals', `${projectSlug(app)}.json`)
    mkdirSync(join(home, '.meerkat', 'dismissals'), { recursive: true })
    writeFileSync(dismissFile, JSON.stringify({ schemaVersion: 1, items: [{ id: 'smoke-planted-1', rule: 'smoke-rule', check: 'smoke', file: 'index.js', title: 'planted by upgrade-smoke', reason: 'planted for the upgrade test', at: '2026-01-01T00:00:00.000Z' }] }, null, 2))

    const before = snapshotState(home)
    const runFiles = Object.keys(before).filter((k) => k.startsWith('logs/runs/'))
    if (!step('previous version left a run in the run store', runFiles.length > 0, `${Object.keys(before).length} saved files`)) return done()

    const up = install(project, newSpec, { online: false })
    if (!step('install the new version over it', up.ok, up.error)) return done()
    const fresh = installedBin(project)
    if (!step('new version has a bin', !fresh.error, fresh.error)) return done()
    step('the installed version changed', fresh.version !== old.version || !!opts.allowSame, `${old.version} -> ${fresh.version}`)
    const nv = runBin(fresh.file, ['--version'], { cwd: project, home })
    if (!step('new --version runs', nv.code === 0 && nv.stdout.trim() === (newVersion ?? fresh.version), `exit ${nv.code}, got "${nv.stdout.trim()}"`)) return done()

    const diff = stateDiff(before, snapshotState(home))
    if (!step('the install left every saved file in place and unchanged', !diff.missing.length && !diff.changed.length, [...diff.missing.map((m) => `missing ${m}`), ...diff.changed.map((m) => `changed ${m}`)].slice(0, 5).join('; '))) return done()

    const last = runBin(fresh.file, ['last'], { cwd: project, home })
    step('new version reads the run store (meerkat last)', last.code === 0 || last.code === 1, `exit ${last.code} ${first(last.stderr, 200)}`)
    const dis = runBin(fresh.file, ['dismissals', app], { cwd: project, home })
    step('new version reads the dismissals file', dis.code === 0 && /smoke-planted-1|planted for the upgrade test/.test(dis.stdout), `exit ${dis.code} ${first(dis.stdout + dis.stderr, 300)}`)
    const diff2 = stateDiff(before, snapshotState(home))
    step('reading the saved state did not rewrite it', !diff2.missing.length && !diff2.changed.length, [...diff2.missing, ...diff2.changed].slice(0, 5).join('; '))
    return done()
  } finally {
    if (!opts.keep) removeDir(work)
  }
}

function main(argv) {
  const opt = (name) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined)
  const scanArgs = opt('--scan-args')?.split(/\s+/)
  console.log('upgrade-smoke: install the previous version, save state, install the new one over it, read the state')
  const r = upgradeSmoke({ previous: opt('--previous'), newSpec: opt('--new'), online: argv.includes('--online'), keep: argv.includes('--keep'), scanArgs, allowSame: argv.includes('--allow-same') })
  if (r.notRun) {
    console.log(`upgrade-smoke: NOT RUN. ${r.error}`)
    return 75
  }
  console.log(r.ok ? `upgrade-smoke: PASS (${r.steps.length} steps)` : `upgrade-smoke: FAIL at "${r.failed}"`)
  return r.ok ? 0 : 1
}
if (isMain(import.meta.url)) process.exitCode = main(process.argv.slice(2))

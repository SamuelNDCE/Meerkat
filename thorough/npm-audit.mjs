// npm audit for every dependency (the npm-audit-all check). A folder with no package.json has no npm dependencies, so the check does not
// apply there and passes with a note; everywhere else it is `npm audit --audit-level=high` and its exit code.
//   node thorough/npm-audit.mjs [--root <dir>]
import { spawn, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

// --fixtures (the self-test): npm audit against a local stand-in registry that reports one high-severity advisory for a package the planted lockfile
// holds. It must exit 1 (the planted vulnerability was found). If npm audit exits 0 the planted case was missed, which is printed and exits 0 so the
// self-test fails; if the stand-in registry cannot be used at all it is NOT RUN (75), never a pass.
if (process.argv.includes('--fixtures')) {
  const { createServer } = await import('node:http')
  const { mkdtempSync, rmSync, writeFileSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const dir = mkdtempSync(join(tmpdir(), 'meerkat-npm-audit-'))
  const server = createServer((req, res) => {
    req.resume()
    req.on('end', () => {
      res.setHeader('content-type', 'application/json')
      // npm also reads the package's own page (to offer a fix); a GET gets a small package description.
      if (req.method === 'GET') return res.end(JSON.stringify({ name: 'meerkat-planted', 'dist-tags': { latest: '1.0.0' }, versions: { '1.0.0': { name: 'meerkat-planted', version: '1.0.0', dist: { tarball: 'http://127.0.0.1/x.tgz' } } } }))
      res.end(JSON.stringify({ 'meerkat-planted': [{ id: 1, url: 'http://127.0.0.1/advisory', title: 'planted high severity advisory', severity: 'high', vulnerable_versions: '<=1.0.0', cwe: [], cvss: { score: 8.1 } }] }))
    })
  })
  const done = (code, msg) => {
    console.log(msg)
    server.close()
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      /* a temp folder left behind is harmless */
    }
    process.exit(code)
  }
  server.listen(0, '127.0.0.1', () => {
    const url = `http://127.0.0.1:${server.address().port}/`
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'planted', version: '1.0.0', dependencies: { 'meerkat-planted': '1.0.0' } }))
    writeFileSync(join(dir, 'package-lock.json'), JSON.stringify({ name: 'planted', version: '1.0.0', lockfileVersion: 3, requires: true, packages: { '': { name: 'planted', version: '1.0.0', dependencies: { 'meerkat-planted': '1.0.0' } }, 'node_modules/meerkat-planted': { version: '1.0.0', resolved: `${url}meerkat-planted/-/meerkat-planted-1.0.0.tgz`, integrity: 'sha512-AAAA' } } }))
    // Asynchronous on purpose: the stand-in registry runs in this process, and a blocking spawnSync would stop it from answering.
    const child = spawn('npm', ['audit', '--audit-level=high', '--registry', url, '--no-progress'], { cwd: dir, shell: process.platform === 'win32' })
    let out = ''
    child.stdout.on('data', (d) => (out += d))
    child.stderr.on('data', (d) => (out += d))
    const timer = setTimeout(() => {
      child.kill()
      done(75, 'NOT RUN: npm audit did not answer within 60 seconds against the stand-in registry')
    }, 60000)
    child.on('error', (e) => done(75, `NOT RUN: npm audit could not run against the stand-in registry (${e.message})`))
    child.on('close', (status) => {
      clearTimeout(timer)
      if (status !== 0 && /high|vulnerabilit/i.test(out)) done(1, 'self-test: npm audit reported the planted high-severity vulnerability (expected: this is the fixture)')
      else if (status === 0) done(0, 'self-test FAILED: npm audit reported nothing for a planted high-severity vulnerability, so the audit cannot be trusted')
      else done(75, `NOT RUN: npm audit failed without reporting the planted vulnerability (exit ${status}): ${out.slice(0, 200)}`)
    })
  })
  await new Promise(() => {})
}
const i = process.argv.indexOf('--root')
const root = i > 0 ? process.argv[i + 1] : process.cwd()
if (!existsSync(join(root, 'package.json'))) {
  console.log('npm-audit-all: not applicable, there is no package.json here (no npm dependencies)')
  process.exit(0)
}
const r = spawnSync('npm', ['audit', '--audit-level=high'], { cwd: root, encoding: 'utf8', shell: process.platform === 'win32' })
process.stdout.write(r.stdout ?? '')
process.stderr.write(r.stderr ?? '')
// An unreachable registry means nothing was checked: NOT RUN, not a failure.
if (r.status !== 0 && /ENOTFOUND|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|audit endpoint returned an error|network/i.test(`${r.stdout}${r.stderr}`) && !/vulnerabilit(y|ies)/i.test(r.stdout ?? '')) {
  console.log('NOT RUN: the npm registry could not be reached; nothing was checked')
  process.exit(75)
}
process.exit(r.status ?? 1)

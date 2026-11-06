// Kind 4, regression: one test per past bug that CHANGELOG.md records with a clear "fixed" line. Each test names the bug by its changelog wording, rebuilds the
// situation as a tiny project, runs the real Meerkat on it, and asserts the fix still holds (and, where the changelog says so, that the real defect is still found).
// Only bugs that can be named from the changelog are here; add a test when a new "fix:" line lands under Unreleased.
import { afterAll, describe, expect, test, vi } from 'vitest'
import { defaultParallel } from '../priority.mjs'
import { wordRe } from '../../thorough/project-ctx.mjs'
import { cleanup, makeProject, meerkat, tinyNodeFiles } from './harness.mjs'

vi.setConfig({ testTimeout: 180_000 })
afterAll(cleanup)

const quick = (dir: string, only: string, extra: string[] = []) => meerkat(dir, ['--preset', 'quick', '--only', only, ...(extra.includes('--scope') ? [] : ['--all']), ...extra], { timeoutMs: 150_000 })
const hits = (run: any, pred: (f: any) => boolean) => (run.findings?.findings ?? []).filter(pred)
const reporters = (f: any) => [{ check: f.check, rule: f.rule }, ...(f.alsoReportedBy ?? [])]
const hasRule = (rule: string) => (f: any) => reporters(f).some((r: any) => r.rule === rule) || String(f.title ?? '').includes(rule)
const status = (run: any, id: string) => run.results.find((r: any) => r.id === id)?.status

describe('regression: bugs recorded in CHANGELOG.md', () => {
  test('Unreleased "fix: the path-traversal check crashed on a parameter name with a (": no crash, no broken-tool FAIL', () => {
    expect(() => wordRe('(')).not.toThrow()
    const dir = makeProject(tinyNodeFiles({ 'src/routes.js': "export function read(req, res) {\n  const f = req.query['a(b']\n  return res.sendFile(f)\n}\nexport const odd = ({ 'x(': y }) => y\n" }))
    const run = quick(dir, 'path-traversal-pattern')
    expect(run.summary, run.out.slice(-1500)).not.toBeNull()
    expect(run.results.some((r: any) => r.broken || /SyntaxError|Invalid regular expression/i.test(String(r.detail)))).toBe(false)
  })

  test('0.3.15 "js-timing-unsafe-compare no longer flags a confirm field next to a password", a real secret compare is still reported', () => {
    const fine = makeProject(tinyNodeFiles({ 'src/form.js': "export function same(password, confirm) {\n  if (password !== confirm) {\n    return 'mismatch'\n  }\n  return ''\n}\n" }))
    expect(hits(quick(fine, 'cp-js'), hasRule('js-timing-unsafe-compare'))).toEqual([])
    const real = makeProject(tinyNodeFiles({ 'src/auth.js': 'export function ok(req, expected) {\n  if (req.authToken === expected) {\n    return true\n  }\n  return false\n}\n' }))
    expect(hits(quick(real, 'cp-js'), hasRule('js-timing-unsafe-compare')).length).toBeGreaterThan(0)
  })

  test('0.3.15 "empty-catch ignores catch {} written inside comments", a real empty catch is still reported', () => {
    const fine = makeProject(tinyNodeFiles({ 'src/a.js': '// an old version had try { run() } catch {} here\nexport function run() {\n  return 1\n}\n' }))
    expect(hits(quick(fine, 'empty-catch'), (f) => f.file === 'src/a.js')).toEqual([])
    const real = makeProject(tinyNodeFiles({ 'src/b.js': 'export function run(f) {\n  try {\n    f()\n  } catch {}\n}\n' }))
    expect(hits(quick(real, 'empty-catch'), (f) => f.file === 'src/b.js').length).toBeGreaterThan(0)
  })

  test('0.4.0 "ui-static accepts rel=noreferrer as well as noopener", a bare target=_blank is still reported', () => {
    const jsx = (rel: string) => `export const A = () => <a href="/x" target="_blank"${rel}>Follow</a>\n`
    const fine = makeProject(tinyNodeFiles({ 'src/Social.jsx': jsx(' rel="noreferrer"') }))
    expect(hits(quick(fine, 'ui-static,target-blank-noopener'), (f) => f.file === 'src/Social.jsx' && /target|noopener|noreferrer/i.test(`${f.title} ${f.message}`))).toEqual([])
    const real = makeProject(tinyNodeFiles({ 'src/Social.jsx': jsx('') }))
    expect(hits(quick(real, 'ui-static,target-blank-noopener'), (f) => f.file === 'src/Social.jsx').length).toBeGreaterThan(0)
  })

  test('0.4.0 "sensitive-files ignores an environment file that holds only placeholders", a real secret in one is still reported', () => {
    const fine = makeProject(tinyNodeFiles({ '.env.production': 'NEXT_PUBLIC_SITE_NAME=Shopfront\nSTRIPE_SECRET_KEY=${STRIPE_SECRET_KEY}\nTOKEN=\n' }))
    expect(hits(quick(fine, 'sensitive-files'), (f) => f.file === '.env.production')).toEqual([])
    const real = makeProject(tinyNodeFiles({ '.env.production': 'NEXT_PUBLIC_SITE_NAME=Shopfront\nSTRIPE_SECRET_KEY=sk_live_abcdefghijklmnop\n' }))
    expect(status(quick(real, 'sensitive-files'), 'sensitive-files')).toBe('FAIL')
  })

  test('0.4.0 "install-scripts reports the install script of a development-only package as info", a runtime one still fails', () => {
    const lock = (extra: object) => JSON.stringify({ name: 'tiny-app', version: '1.0.0', lockfileVersion: 3, packages: { '': { name: 'tiny-app', version: '1.0.0' }, 'node_modules/thing': { version: '1.0.0', hasInstallScript: true, ...extra } } }, null, 2) + '\n'
    const dev = makeProject(tinyNodeFiles({ 'package-lock.json': lock({ dev: true }) }))
    expect(hits(quick(dev, 'install-scripts'), (f) => f.check === 'install-scripts' && ['critical', 'high', 'medium', 'low'].includes(f.severity))).toEqual([])
    const runtime = makeProject(tinyNodeFiles({ 'package-lock.json': lock({}) }))
    expect(status(quick(runtime, 'install-scripts'), 'install-scripts')).toBe('FAIL')
  })

  test('0.3.15 "no .dockerignore beside the Dockerfile also accepts the .dockerignore of the real build context"', () => {
    const base = {
      ...tinyNodeFiles(),
      'docker/app/Dockerfile': 'FROM node:20-alpine\nUSER node\nWORKDIR /app\nCOPY . .\nCMD ["node", "src/index.js"]\n',
      'docker/app/docker-compose.yml': 'services:\n  app:\n    build:\n      context: ../..\n      dockerfile: docker/app/Dockerfile\n',
    }
    const fine = makeProject({ ...base, '.dockerignore': 'node_modules\n.git\n' })
    expect(hits(quick(fine, 'ip-docker'), hasRule('docker-dockerignore-missing'))).toEqual([])
    const real = makeProject(base)
    expect(hits(quick(real, 'ip-docker'), hasRule('docker-dockerignore-missing')).length).toBeGreaterThan(0)
  })

  test('Unreleased "scope: a failing check whose every finding is outside the scope passes for that scope"', () => {
    const key = `const t = "ghp_${'a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8'}"\n`
    const dir = makeProject(tinyNodeFiles({ 'a/key.js': key, 'b/ok.js': 'export const ok = 1\n' }))
    const outside = quick(dir, 'secret-scan', ['--scope', 'b'])
    expect(status(outside, 'secret-scan'), outside.out.slice(-1200)).toBe('PASS')
    const inside = quick(dir, 'secret-scan', ['--scope', 'a'])
    expect(status(inside, 'secret-scan'), inside.out.slice(-1200)).toBe('FAIL')
  })

  test('Unreleased "--changed and --scope cannot be combined" is refused with a reason, not run', () => {
    const dir = makeProject(tinyNodeFiles())
    const run = meerkat(dir, ['--preset', 'quick', '--only', 'secret-scan', '--changed', '--scope', 'src'])
    expect(run.code).not.toBe(0)
    expect(run.out).toMatch(/cannot be used together/i)
    expect(run.out).not.toMatch(/\n\s+at .*\.mjs:\d+/)
  })

  test('0.3.15 "CI=false or CI=0 is not a CI runner"', () => {
    expect(defaultParallel(12, { CI: 'false' })).toBe(defaultParallel(12, {}))
    expect(defaultParallel(12, { CI: '0' })).toBe(defaultParallel(12, {}))
    expect(defaultParallel(12, { CI: 'true' })).toBeGreaterThan(defaultParallel(12, {}))
  })
})

// Grown planted defects, LOW impact, part 1: hygiene, documentation, configuration and manifest problems that do not expose data or run code.
// Each case is a planted project plus a "-clean" twin. Keys are prefixed `grow-low-`. Impact is always low; the difficulty is in tools/accuracy-tier-fragments/grow-low.txt.
// Case: [key, check id, description, files, options]. A file is a list of lines; a line is a string or V(bad, good) (the first V is the planted line).
// Options: root (the case gets its own project because the check only reads the repository root), absent (the file where the absence is reported),
// goodOnly / badOnly (extra files that only one side has).

export const V = (b, g) => ({ b, g })

const pair = (v) => v && typeof v === 'object' && !Array.isArray(v) && 'b' in v

export function build(ctx, cases, group) {
  const { d, a, tidy } = ctx
  const expect = {}
  const projects = {}
  const nest = { bad: { ...tidy(`grow-low-${group}`) }, good: { ...tidy(`grow-low-${group}-clean`) } }
  for (const c of cases) {
    const [slug, check, desc, files, o = {}] = c
    const key = `grow-low-${slug}`
    expect[key] = check
    const bad = {}
    const good = {}
    let planted = false
    for (const [path, lines] of Object.entries(files)) {
      const bl = []
      const gl = []
      for (const l of lines) {
        if (pair(l)) {
          if (!planted && !o.absent) {
            planted = true
            bl.push(d(key, desc, l.b))
          } else bl.push(l.b)
          gl.push(l.g)
        } else {
          bl.push(l)
          gl.push(l)
        }
      }
      bad[path] = bl
      good[path] = gl
    }
    for (const [p, l] of Object.entries(o.goodOnly ?? {})) good[p] = l
    for (const [p, l] of Object.entries(o.badOnly ?? {})) bad[p] = l
    const absent = o.absent ? [a(key, desc, o.absent === '*' ? '' : o.absent)] : []
    if (o.root) {
      projects[`grow-low-r-${slug}`] = { files: { ...tidy(`grow-low-r-${slug}`), ...bad }, absent }
      projects[`grow-low-r-${slug}-clean`] = { files: { ...tidy(`grow-low-r-${slug}-clean`), ...good } }
    } else {
      for (const [p, l] of Object.entries(bad)) nest.bad[`c/${slug}/${p}`] = l
      for (const [p, l] of Object.entries(good)) nest.good[`c/${slug}/${p}`] = l
      if (absent.length) {
        absent[0].file = o.absent === '*' ? '' : `c/${slug}/${o.absent}`
        projects[`grow-low-${group}`] = { files: nest.bad, absent: [...(projects[`grow-low-${group}`]?.absent ?? []), ...absent] }
      }
    }
  }
  projects[`grow-low-${group}`] = { files: nest.bad, absent: projects[`grow-low-${group}`]?.absent ?? [] }
  projects[`grow-low-${group}-clean`] = { files: nest.good }
  for (const k of Object.keys(projects)) if (!Object.keys(projects[k].files).length) delete projects[k]
  return { projects, expect }
}

const nb = (p) => JSON.stringify({ cells: [{ cell_type: 'code', execution_count: null, metadata: {}, outputs: [], source: ['import pandas as pd' + String.fromCharCode(10), `df = pd.read_csv('${p}')`] }], metadata: {}, nbformat: 4, nbformat_minor: 5 })
const J = (o) => [JSON.stringify(o, null, 2)]

export function projects(ctx) {
  const md = (...l) => l
  return build(ctx, [
    // ---------------- medium: one file, a rule with some context ----------------
    ['m-md-two-h1', 'markdown-headings', 'a guide with a second top-level heading', { 'docs/guide.md': md('# Guide', '', 'Intro text.', '', V('# Guide again', '## Next steps'), '', 'More text.') }],
    ['m-semver-short', 'semver-valid', 'a package version with two numbers', { 'package.json': ['{', '  "name": "low-semver", "license": "MIT", "private": true,', V('  "version": "1.2"', '  "version": "1.2.0"'), '}'] }],
    ['m-dev-dep-in-prod', 'dev-deps-in-prod', 'a linter listed under dependencies of an application', { 'package.json': ['{', '  "name": "low-devdep", "version": "1.0.0", "license": "MIT", "private": true,', V('  "dependencies": { "eslint": "9.1.0" }', '  "devDependencies": { "eslint": "9.1.0" }'), '}'] }],
    ['m-img-no-size', 'image-dimensions', 'an image with no width and height', { 'site/gallery.html': md('<!doctype html>', '<html lang="en">', '<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Gallery of the harbour boats</title></head>', '<body><main>', '<h1>Gallery</h1>', V('<img src="boat.jpg" alt="A sailing boat in the harbour">', '<img src="boat.jpg" alt="A sailing boat in the harbour" width="640" height="480">'), '</main></body>', '</html>') }],
    ['m-zoom-blocked', 'zoom-allowed', 'the viewport tag stops pinch zoom', { 'site/zoom.html': md('<!doctype html>', '<html lang="en">', '<head><meta charset="utf-8">', V('<meta name="viewport" content="width=device-width, initial-scale=1, user-scalable=no">', '<meta name="viewport" content="width=device-width, initial-scale=1">'), '<title>Opening hours of the shop</title></head>', '<body><main><h1>Hours</h1></main></body>', '</html>') }],
    ['m-motion-no-pref', 'reduced-motion', 'an infinite animation with no reduced-motion rule', { 'site/spin.css': md('.logo {', '  animation: spin 3s linear infinite;', '}', V('', '@media (prefers-reduced-motion: reduce) {\n  .logo { animation: none; }\n}'), '@keyframes spin { to { transform: rotate(360deg); } }') }],
    ['m-ts-ignore-bare', 'ts-ignore-comments', 'a ts-ignore with no reason', { 'src/total.ts': md('export function total(items: any[]) {', V('  // @ts-ignore', '  // @ts-ignore: items come from an untyped CSV reader'), '  return items.reduce((s, i) => s + i.price, 0)', '}') }],
    ['m-ci-no-timeout', 'ci-timeouts', 'a CI job with no time limit', { '.github/workflows/test.yml': md('name: test', 'on: [push]', 'permissions:', '  contents: read', 'jobs:', '  unit:', '    runs-on: ubuntu-24.04', V('    steps:', '    timeout-minutes: 15\n    steps:'), '      - uses: actions/checkout@692973e3d937129bcbf40652eb9f2f61becf3332', '      - run: npm test') }, { root: true }],
    ['m-ci-node-latest', 'ci-node-version-pinned', 'setup-node asks for the latest Node', { '.github/workflows/build.yml': md('name: build', 'on: [push]', 'permissions:', '  contents: read', 'jobs:', '  b:', '    runs-on: ubuntu-24.04', '    timeout-minutes: 10', '    steps:', '      - uses: actions/setup-node@60edb5dd545a775178f52524783378180af0d1f8', '        with:', V('          node-version: latest', '          node-version: 20.11.1'), '      - run: npm ci') }, { root: true }],
    ['m-precommit-branch', 'pre-commit-config', 'a pre-commit hook pinned to a branch name', { '.pre-commit-config.yaml': md('repos:', '  - repo: https://github.com/pre-commit/pre-commit-hooks', V('    rev: main', '    rev: v4.6.0'), '    hooks:', '      - id: end-of-file-fixer') }, { root: true }],
  ], 'med')
}

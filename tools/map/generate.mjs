// Generates the repo code map: a short index in MAP.md (inside <!-- map:start --> ... <!-- map:end -->), one detail file per
// top-level folder under docs/map/, and docs/map/CHECKPOINT.json.
//   node tools/map/generate.mjs [--root <repo>] [--stdout]
// Reads tracked files only (git ls-files, called once), each file once. No per-file git calls. Hand text outside the marked block
// in MAP.md is never touched. The checkpoint is a machine file, so it may hold counts; MAP.md and the detail files hold none.
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, openSync, readSync, closeSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve, extname, posix } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const START = '<!-- map:start -->'
export const END = '<!-- map:end -->'
export const DETAIL_MARK = '<!-- map:detail -->'
export const MAP_DIR = 'docs/map'
const SKIP_FILES = new Set(['package-lock.json'])
const TEXT_EXT = new Set(['.mjs', '.js', '.cjs', '.ts', '.py', '.sh', '.md', '.yml', '.yaml', '.toml'])
const CODE_EXT = new Set(['.mjs', '.js', '.cjs', '.ts'])
const GROUPED = new Set(['lib', 'tests'])

const DESCRIPTIONS = {
  lib: 'Core library: command planning, runner, verdicts, findings, MCP tool wiring, reports.',
  packs: 'Check packs: the detectors and rules that run per language, framework or area.',
  thorough: 'The slower, deeper checks run by the thorough preset.',
  tools: 'Maintenance scripts: code map, worktree doctor, release and docs helpers.',
  tests: 'Vitest suites for lib, packs, bin and tools.',
  bin: 'Executables: the meerkat command and the meerkat-mcp server.',
  profiles: 'Ready-made config profiles (solo, team, ai-agent, ci-only, legacy, monorepo).',
  examples: 'Example projects and configs used in docs and demos.',
  benchmarks: 'Accuracy benchmarks and the real-world repos they run against.',
  catalog: 'The test catalog: what each check covers, per language.',
  migrations: 'Config migration definitions between versions.',
  skills: 'Agent skills shipped with Meerkat (before-commit, before-PR, map, smoke).',
  docs: 'User, developer and AI-agent documentation.',
  fixtures: 'Planted-defect and sample inputs used by the tests.',
  '.github': 'GitHub Actions workflows, issue templates and dependabot config.',
  '.meerkat': 'Meerkat config for this repo itself (dismissals, baselines).',
}

const WHERE = [
  ['A new check or rule', '`packs/` (detectors), listed in `catalog/`'],
  ['A command or flag', '`lib/cli.mjs`, then `bin/meerkat.mjs`'],
  ['An MCP tool', '`bin/meerkat-mcp.mjs` and the `lib/mcp*` files'],
  ['Presets and profiles', '`profiles/`, `meerkat.config.json`, `meerkat.order.json`'],
  ['Docs for users or agents', '`docs/`, `llms.txt`, `skills/`'],
  ['This map', '`tools/map/generate.mjs`, then run it and commit `MAP.md` and `docs/map/`'],
]

export function tracked(root) {
  const r = spawnSync('git', ['-C', root, 'ls-files', '-z'], { encoding: 'utf8', timeout: 30000, maxBuffer: 64 * 1024 * 1024 })
  if (r.status !== 0) throw new Error(`git ls-files failed in ${root}: ${r.stderr || r.error}`)
  return r.stdout.split('\0').filter(Boolean).filter((f) => existsSync(join(root, f))).sort()
}

export const isGenerated = (f) => f === 'MAP.md' || f.startsWith(MAP_DIR + '/')
const tick = (s) => '`' + s + '`'
const clip = (s, n) => (s.length > n ? s.slice(0, n - 3) + '...' : s)
export const slug = (dir) => dir.replace(/^\./, '')

function readHead(path, n) {
  try {
    const fd = openSync(path, 'r')
    const buf = Buffer.alloc(n)
    const got = readSync(fd, buf, 0, n, 0)
    closeSync(fd)
    return buf.toString('utf8', 0, got).replace(/^﻿/, '')
  } catch { return '' }
}

// First non-empty comment line (markdown: first heading), clipped to 120 chars.
export function firstComment(text, ext) {
  const lines = text.split(/\r?\n/)
  if (ext === '.md') {
    const m = lines.find((x) => /^#\s+\S/.test(x))
    return m ? clip(m.replace(/^#\s+/, '').trim(), 120) : ''
  }
  const mark = ['.py', '.sh', '.yml', '.yaml', '.toml'].includes(ext) ? '#' : '//'
  let i = 0
  if (lines[0] && lines[0].startsWith('#!')) i = 1
  while (i < lines.length && !lines[i].trim()) i++
  if ((lines[i] || '').trim().startsWith('/*')) {
    for (; i < lines.length; i++) {
      const t = lines[i].replace(/^\s*\/\*+/, '').replace(/\*+\/\s*$/, '').replace(/^\s*\*\s?/, '').trim()
      if (t) return clip(t, 120)
      if (lines[i].includes('*/')) break
    }
    return ''
  }
  for (; i < lines.length && lines[i].trim().startsWith(mark); i++) {
    const t = lines[i].trim().replace(new RegExp('^' + mark + '+\\s?'), '').trim()
    if (t) return clip(t, 120)
  }
  return ''
}

const IMPORT_RE = /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\(\s*)(['"])(\.{1,2}\/[^'"\n]+)\1/g

export function localImports(file, text) {
  const out = new Set()
  for (const m of text.matchAll(IMPORT_RE)) out.add(posix.normalize(posix.join(posix.dirname(file), m[2])))
  return [...out].sort()
}

// One pass over the tracked files: header comment for every text file, local imports for code files.
export function scan(root, files) {
  const info = new Map()
  for (const f of files) {
    const ext = extname(f).toLowerCase()
    if (!TEXT_EXT.has(ext)) { info.set(f, { header: '', imports: [] }); continue }
    const p = join(root, f)
    if (CODE_EXT.has(ext)) {
      let text = ''
      try { text = readFileSync(p, 'utf8').replace(/^﻿/, '') } catch { /* unreadable */ }
      info.set(f, { header: firstComment(text, ext), imports: localImports(f, text) })
    } else info.set(f, { header: firstComment(readHead(p, 4096), ext), imports: [] })
  }
  return info
}

function prefixOf(file) {
  const b = file.slice(file.lastIndexOf('/') + 1)
  const m = b.match(/^([A-Za-z0-9_]+)[-.]/)
  return m ? m[1] : b.replace(/\.[^.]*$/, '')
}

const entry = (f, h) => `- ${tick(f)}${h ? ': ' + h : ''}`

export function detailFile(dir, files, info) {
  const title = dir === '' ? 'Root files' : dir + '/'
  const out = [DETAIL_MARK, `# ${tick(title)}`, '', '_Generated by `node tools/map/generate.mjs`. Back to [MAP.md](../../MAP.md)._', '', '## Files', '']
  if (dir !== '' && GROUPED.has(dir)) {
    const groups = new Map()
    for (const f of files) {
      const k = prefixOf(f)
      if (!groups.has(k)) groups.set(k, [])
      groups.get(k).push(f)
    }
    const other = []
    for (const [k, fs] of [...groups].sort((a, b) => a[0].localeCompare(b[0]))) {
      if (fs.length < 2) { other.push(...fs); continue }
      out.push(`### ${k}*`, '')
      for (const f of fs) out.push(entry(f, info.get(f).header))
      out.push('')
    }
    if (other.length) {
      out.push('### other', '')
      for (const f of other.sort()) out.push(entry(f, info.get(f).header))
      out.push('')
    }
  } else {
    for (const f of files) out.push(entry(f, info.get(f).header))
    out.push('')
  }
  out.push('## Imports', '', 'Local modules each file imports (relative imports only).', '')
  let any = false
  for (const f of files) {
    const im = info.get(f).imports
    if (im.length) { out.push(`- ${tick(f)}: ${im.map(tick).join(', ')}`); any = true }
  }
  if (!any) out.push('_No local imports._')
  out.push('')
  return out.join('\n')
}

const sha256 = (s) => createHash('sha256').update(s).digest('hex')

function gitHead(root) {
  const r = spawnSync('git', ['-C', root, 'log', '-1', '--format=%H%n%cI'], { encoding: 'utf8', timeout: 15000 })
  if (r.status !== 0) return { commit: null, commitDate: null }
  const [commit, commitDate] = r.stdout.trim().split('\n')
  return { commit, commitDate }
}

// Everything the map says, computed from the tracked tree. Returns { files: Map(path -> text), block, checkpoint }.
export function build(root) {
  process.stderr.write('map: listing tracked files\n')
  const all = tracked(root).filter((f) => !SKIP_FILES.has(f) && !isGenerated(f))
  process.stderr.write('map: scanning headers and imports\n')
  const info = scan(root, all)
  const dirs = [...new Set(all.filter((f) => f.includes('/')).map((f) => f.split('/')[0]))].sort()
  const rootFiles = all.filter((f) => !f.includes('/'))
  const files = new Map()
  process.stderr.write('map: building detail files\n')
  for (const d of dirs) files.set(`${MAP_DIR}/${slug(d)}.md`, detailFile(d, all.filter((f) => f.startsWith(d + '/')), info))
  files.set(`${MAP_DIR}/root.md`, detailFile('', rootFiles, info))

  let pkg = {}
  try { pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) } catch { /* none */ }
  const lines = [START, '', '_Generated by `node tools/map/generate.mjs`. Do not edit between the markers; edit outside them._', '', '## Entry points', '']
  const bins = typeof pkg.bin === 'string' ? { [pkg.name]: pkg.bin } : pkg.bin || {}
  for (const [n, p] of Object.entries(bins).sort()) lines.push(`- ${tick(n)} (command): ${tick(p)}`)
  if (all.includes('run.mjs')) lines.push(`- ${tick('run.mjs')}: script entry (npm run meerkat)`)
  if (pkg.scripts) lines.push(`- ${tick('package.json')} scripts: ${Object.keys(pkg.scripts).sort().map(tick).join(', ')}`)
  for (const w of all.filter((f) => /^\.github\/workflows\/.+\.ya?ml$/.test(f))) lines.push(`- Workflow ${tick(w)}`)
  lines.push('', '## Folders', '', 'Open the detail file for a folder to see its files, one line each, and what each imports.', '', '| Folder | What it holds | Detail |', '|---|---|---|')
  for (const d of dirs) {
    const first = all.find((f) => f.startsWith(d + '/') && info.get(f).header)
    const what = DESCRIPTIONS[d] || (first ? info.get(first).header : '') || 'Files'
    lines.push(`| ${tick(d + '/')} | ${what.replace(/\|/g, '/')} | [${slug(d)}.md](docs/map/${slug(d)}.md) |`)
  }
  lines.push('| root files | Config, license, readme and other top-level files. | [root.md](docs/map/root.md) |')
  lines.push('', '## Checkpoint', '', 'Checkpoint: `docs/map/CHECKPOINT.json` holds the commit and a digest of the tracked paths this map was built from. Run `node tools/map/check.mjs` to see which folders changed since, and re-read only those detail files.', '', END)

  const head = gitHead(root)
  const checkpoint = { commit: head.commit, commitDate: head.commitDate, trackedFiles: all.length, pathsSha256: sha256(all.join('\n')) }
  return { files, block: lines.join('\n'), checkpoint }
}

export const buildBlock = (root) => build(root).block

export function spliceBlock(existing, block) {
  const a = existing.indexOf(START)
  const b = existing.indexOf(END)
  if (a !== -1 && b > a) return existing.slice(0, a) + block + existing.slice(b + END.length)
  return existing.replace(/\s*$/, '\n\n') + block + '\n'
}

export function currentBlock(text) {
  const a = text.indexOf(START)
  const b = text.indexOf(END)
  return a !== -1 && b > a ? text.slice(a, b + END.length) : null
}

export const STUB = [
  '# Map',
  '',
  'Meerkat is a scanner for people and a tool for AI agents: it checks, maps and tests a project.',
  'This file is a short index. Read it first, then open only the folder detail file you need under `docs/map/`.',
  'Each detail file lists its files, one line each, and the local modules each file imports.',
  'The block below is generated by `node tools/map/generate.mjs`; text outside the markers is hand-written.',
  'Run `node tools/map/check.mjs` to see which folders changed since the checkpoint.',
  '',
  '## Where to change things',
  '',
  '| To change | Look in |',
  '|---|---|',
  ...WHERE.map(([a, b]) => `| ${a} | ${b} |`),
  '',
].join('\n')

function writeIfChanged(path, text) {
  if (existsSync(path) && readFileSync(path, 'utf8') === text) return false
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, text)
  return true
}

function main() {
  const argv = process.argv.slice(2)
  let root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
  let stdout = false
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--root') root = resolve(argv[++i] || '')
    else if (argv[i] === '--stdout') stdout = true
    else { console.error('usage: node tools/map/generate.mjs [--root <repo>] [--stdout]'); process.exit(2) }
  }
  const { files, block, checkpoint } = build(root)
  if (stdout) { console.log(block); return }
  const mapFile = join(root, 'MAP.md')
  const existing = existsSync(mapFile) ? readFileSync(mapFile, 'utf8') : STUB
  let changed = writeIfChanged(mapFile, spliceBlock(existing, block))
  const dir = join(root, MAP_DIR)
  mkdirSync(dir, { recursive: true })
  for (const [p, text] of files) changed = writeIfChanged(join(root, p), text) || changed
  for (const n of readdirSync(dir)) {
    if (n.endsWith('.md') && !files.has(`${MAP_DIR}/${n}`) && readFileSync(join(dir, n), 'utf8').startsWith(DETAIL_MARK)) { unlinkSync(join(dir, n)); changed = true }
  }
  writeIfChanged(join(dir, 'CHECKPOINT.json'), JSON.stringify(checkpoint, null, 2) + '\n')
  process.stderr.write('map: checkpoint written\n')
  console.log(`map ${changed ? 'written' : 'already current'}: ${mapFile}, ${files.size} detail files in ${dir}`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main()

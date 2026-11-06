// Documentation drift, structurally: README.md and docs/**/*.md are compared with the code, with no model call.
//   node thorough/doc-drift.mjs <check> [--root <dir>]      node thorough/doc-drift.mjs <check> --fixtures   (must exit 1)
// Every finding reads "<doc file>:<line> <what the doc says> (checked: <where in the code>; <what differs>)".
// A name that is deliberately documented but not defined here (a tool of someone else's, an example) goes in .meerkat-docdrift-allow,
// one per line, each with a reason line starting with # above it.
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, posix } from 'node:path'
import { finish, isFixture, isTestFile, listTrackedFiles, main, readText, trackedFiles, withFixture } from './kit.mjs'

const fx = (files, run) => ({ fixture: () => withFixture(files, run) })
const CODE_EXT = /\.(?:[cm]?[jt]sx?|py|rs|go|rb|php|java|cs|kt|swift|dart|sh|bash|ps1|cmd|bat|toml|ya?ml|json)$/i
const SKIP_DIRS = /(^|\/)(node_modules|dist|build|target|vendor|\.git|graphify-out)\//

export const docFiles = (files) => files.filter((f) => /\.md$/i.test(f) && (/^readme\.md$/i.test(f) || f.startsWith('docs/')) && !isFixture(f) && !SKIP_DIRS.test(f))

// ---- reading the Markdown: fenced lines and inline code spans, each with the line it sits on
const SHELL_LANG = /^(?:sh|bash|shell|zsh|console|terminal|powershell|ps1|pwsh|cmd|bat|batch)?$/i
export function parseDoc(text) {
  const fences = []
  const spans = []
  let fence = null
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = i + 1
    const open = /^\s*(`{3,}|~{3,})\s*([\w+-]*)/.exec(raw)
    if (fence) {
      if (open && open[1][0] === fence.mark && open[1].length >= fence.len && !open[2]) {
        fence.end = line
        fences.push(fence)
        fence = null
      } else fence.lines.push({ line, text: raw })
      return
    }
    if (open) {
      fence = { mark: open[1][0], len: open[1].length, lang: open[2].toLowerCase(), start: line, lines: [] }
      return
    }
    for (const m of raw.matchAll(/(`+)([^`\n]+?)\1/g)) spans.push({ line, text: m[2].trim(), context: raw })
  })
  if (fence) fences.push(fence)
  return { fences, spans }
}

const allowed = (root) => {
  const set = new Set()
  for (const l of readText(root, '.meerkat-docdrift-allow').split(/\r?\n/)) {
    const t = l.trim()
    if (t && !t.startsWith('#')) set.add(t)
  }
  return set
}

// The code the docs describe: tracked source, config and script files, but not tests, fixtures or Markdown.
function codeCorpus(root) {
  // .meerkatignore hides sample code from the scanners; a flag or variable defined there is still defined.
  const files = listTrackedFiles(root)
  const parts = []
  let n = 0
  for (const f of files) {
    if (!(CODE_EXT.test(f) || /(^|\/)\.env[\w.-]*$/.test(f)) || isTestFile(f) || SKIP_DIRS.test(f) || /(^|\/)package-lock\.json$/.test(f)) continue
    try {
      if (statSync(join(root, f)).size > 2_000_000) continue
    } catch {
      continue
    }
    parts.push(readText(root, f))
    n++
  }
  return { text: parts.join('\n'), files: n }
}

const readPkg = (root) => {
  try {
    return JSON.parse(readText(root, 'package.json'))
  } catch {
    return {}
  }
}

// Which command names are this project's own: its package name, its bin names, and `node <file>` / `npm run <script>`.
function ownCommand(line, root, pkg) {
  const l = line.replace(/^\s*(?:\$|>|PS>|#)\s+/, '').trim()
  const bins = new Set([...(typeof pkg.bin === 'string' ? [pkg.name] : Object.keys(pkg.bin ?? {})), pkg.name].filter(Boolean).map((n) => String(n).replace(/^@[^/]+\//, '')))
  const first = l.split(/\s+/)
  if (bins.has(first[0])) return true
  if (first[0] === 'npx' && bins.has(first[1])) return true
  if (first[0] === 'npm' && (first[1] === 'run' || first[1] === 'test' || first[1] === 'start')) return true
  if (first[0] === 'node' && first[1] && !first[1].startsWith('-')) return existsSync(join(root, first[1]))
  return false
}

const FLAG = /(?:^|[\s=(\[|,;])(--[a-z][a-z0-9]*(?:-[a-z0-9]+)*)(?![\w-])/g
const hasWord = (text, word) => new RegExp(`(?<![A-Za-z0-9_-])${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![A-Za-z0-9_-])`).test(text)

// ---- doc-drift-flags
function flagsDrift(root) {
  const files = trackedFiles(root)
  const docs = docFiles(files)
  if (!docs.length) return finish('doc-drift-flags', [], 'skipped: there is no README.md or docs/*.md')
  const code = codeCorpus(root)
  const pkg = readPkg(root)
  const ok = allowed(root)
  const f = []
  const seen = new Set()
  for (const d of docs) {
    const { fences, spans } = parseDoc(readText(root, d))
    const units = []
    for (const fence of fences) if (SHELL_LANG.test(fence.lang)) for (const l of fence.lines) units.push({ ...l, own: ownCommand(l.text, root, pkg) })
    for (const s of spans) units.push({ line: s.line, text: s.text, own: ownCommand(s.text, root, pkg) || /^(?:--[\w-]+(?:[ =][^\s]*)?)(?:\s*(?:,|\/|or)\s*--[\w-]+)*$/.test(s.text) })
    for (const u of units) {
      if (!u.own) continue
      for (const m of u.text.matchAll(FLAG)) {
        const flag = m[1]
        const key = `${d}:${u.line}:${flag}`
        if (seen.has(key) || ok.has(flag)) continue
        seen.add(key)
        if (!hasWord(code.text, flag)) f.push(`${d}:${u.line} documents ${flag}, but no source file defines it (checked: ${code.files} tracked code and config files, tests and docs excluded; the string ${flag} appears in none)`)
      }
    }
  }
  return finish('doc-drift-flags', f, `every flag the docs show for this project's own commands is defined in the code`)
}

// ---- doc-drift-env
const ENV_NAME = /\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/g
const EXTERNAL_ENV = new Set(['NODE_OPTIONS', 'NODE_ENV', 'NO_COLOR', 'FORCE_COLOR', 'GITHUB_TOKEN', 'GITHUB_ACTIONS', 'GITHUB_STEP_SUMMARY', 'GITHUB_OUTPUT', 'GITHUB_ENV', 'GITHUB_PATH', 'GITHUB_REPOSITORY', 'GITHUB_SHA', 'GITHUB_REF', 'GITHUB_WORKSPACE', 'LD_LIBRARY_PATH', 'NPM_TOKEN', 'NODE_AUTH_TOKEN', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'OPENROUTER_API_KEY', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'XDG_STATE_HOME', 'XDG_CACHE_HOME', 'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'APPDATA', 'LOCALAPPDATA', 'USERPROFILE'])
function envDrift(root) {
  const files = trackedFiles(root)
  const docs = docFiles(files)
  if (!docs.length) return finish('doc-drift-env', [], 'skipped: there is no README.md or docs/*.md')
  const code = codeCorpus(root)
  const ok = allowed(root)
  const f = []
  const seen = new Set()
  const report = (d, line, name) => {
    const key = `${d}:${line}:${name}`
    if (seen.has(key) || ok.has(name) || EXTERNAL_ENV.has(name) || hasWord(code.text, name)) return
    seen.add(key)
    f.push(`${d}:${line} documents the environment variable ${name}, but no source file reads or names it (checked: ${code.files} tracked code and config files, tests and docs excluded; ${name} appears in none)`)
  }
  for (const d of docs) {
    const { fences, spans } = parseDoc(readText(root, d))
    for (const fence of fences) {
      if (!SHELL_LANG.test(fence.lang) && !/^(?:js|javascript|ts|typescript|mjs|env|dotenv|ini)$/.test(fence.lang)) continue
      for (const l of fence.lines) for (const m of l.text.matchAll(/(?:\$env:|\$\{?|process\.env\.|(?:^|\s)export\s+|(?:^|\s)set\s+|^\s*)([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)\}?(?==|\b)/g)) if (/=|\$|env|export|set /i.test(l.text)) report(d, l.line, m[1])
    }
    for (const s of spans) {
      const whole = /^(?:\$env:|\$)?([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)(?:=\S*)?$/.exec(s.text)
      if (whole && /\b(?:env(?:ironment)?|variables?|export|set)\b/i.test(s.context)) report(d, s.line, whole[1])
    }
  }
  return finish('doc-drift-env', f, 'every environment variable the docs name appears in the code')
}

// ---- doc-drift-paths
const PATH_EXT = /\.(?:m?js|cjs|tsx?|jsx|json|md|ya?ml|toml|sh|ps1|py|rs|go|txt|html|css|gif|png|svg|lock)$/i
const isIgnored = (root, rel) => {
  try {
    execFileSync('git', ['check-ignore', '-q', '--', rel], { cwd: root, stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}
function pathsDrift(root) {
  const files = trackedFiles(root)
  const docs = docFiles(files)
  if (!docs.length) return finish('doc-drift-paths', [], 'skipped: there is no README.md or docs/*.md')
  const ok = allowed(root)
  const topDirs = new Set(listTrackedFiles(root).filter((x) => x.includes('/')).map((x) => x.split('/')[0]))
  const f = []
  const seen = new Set()
  for (const d of docs) {
    const { spans } = parseDoc(readText(root, d))
    for (const s of spans) {
      let p = s.text
      if (/[\s<>*{}$%|:=()[\]!?"'~^]|\.\.\.|^(?:[a-z]+:\/\/|\/|-|@|\.\.?$)/i.test(p)) continue
      p = p.replace(/\/+$/, '').replace(/^\.\//, '')
      if (!p || !(p.includes('/') || PATH_EXT.test(p)) || ok.has(p) || ok.has(s.text)) continue
      if (!/^[\w.@+-]+(?:\/[\w.@+-]+)*$/.test(p)) continue
      if (/^\d+(?:\.\d+)+$/.test(p) || /^\d+\/\d+$/.test(p)) continue
      // Only a path under a folder this repo really has is a claim about the repo; a bare name or an id with a slash is an example, an output or someone else's file.
      if (!p.includes('/') || p.startsWith('.') || !topDirs.has(p.split('/')[0])) continue
      const base = dirname(d)
      const candidates = [p, posix.normalize(posix.join(base === '.' ? '' : base, p)), `.meerkat/${p}`]
      if (candidates.some((c) => existsSync(join(root, c)))) continue
      // Something with a wildcard-like or per-user shape in a path part (`<name>`) is a template, and a file nobody tracks on purpose is not drift.
      if (isIgnored(root, p)) continue
      const key = `${d}:${s.line}:${p}`
      if (seen.has(key)) continue
      seen.add(key)
      f.push(`${d}:${s.line} points at ${s.text}, which does not exist (checked: ${p} from the repo root and from ${base === '.' ? 'the repo root' : base + '/'}; neither is a file or folder here)`)
    }
  }
  return finish('doc-drift-paths', f, 'every file path the docs name exists')
}

// ---- doc-drift-counts
const WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 }
const numOf = (w) => (/^\d+$/.test(w) ? Number(w) : WORDS[w.toLowerCase()])
const singular = (n) => n.replace(/ies$/, 'y').replace(/s$/, '')
// Entries of a folder: subfolders when it has any (packs/a, packs/b), else files.
function entriesOf(root, dir) {
  try {
    const all = readdirSync(join(root, dir)).filter((n) => !n.startsWith('.'))
    const dirs = all.filter((n) => statSync(join(root, dir, n)).isDirectory())
    return dirs.length ? dirs : all
  } catch {
    return []
  }
}
function countsDrift(root) {
  const files = trackedFiles(root)
  const docs = docFiles(files)
  if (!docs.length) return finish('doc-drift-counts', [], 'skipped: there is no README.md or docs/*.md')
  const topDirs = new Set(files.filter((x) => x.includes('/')).map((x) => x.split('/')[0]))
  const ok = allowed(root)
  const f = []
  for (const d of docs) {
    const lines = readText(root, d).split(/\r?\n/)
    let inFence = false
    lines.forEach((raw, i) => {
      if (/^\s*(`{3,}|~{3,})/.test(raw)) inFence = !inFence
      if (inFence) return
      const text = raw.replace(/`[^`]*`/g, (m) => m)
      // (a) "N things:" then a list right under it: the list has to have N items.
      const head = /\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+(?:[A-Za-z-]+\s+){0,2}?([A-Za-z-]+)\s*(?::|follow)\s*$/i.exec(text)
      if (head) {
        const stated = numOf(head[1])
        let n = 0
        let j = i + 1
        while (j < lines.length && !lines[j].trim()) j++
        const first = lines[j] ?? ''
        const bullet = /^\s*(?:[-*+]|\d+[.)])\s+/.test(first)
        const row = /^\s*\|/.test(first)
        if (bullet) for (; j < lines.length && (/^\s*(?:[-*+]|\d+[.)])\s+/.test(lines[j]) || /^\s{2,}\S/.test(lines[j]) || !lines[j].trim() && /^\s*(?:[-*+]|\d+[.)])\s+/.test(lines[j + 1] ?? '')); j++) if (/^(?:[-*+]|\d+[.)])\s+/.test(lines[j])) n++
        else if (row) for (; j < lines.length && /^\s*\|/.test(lines[j]); j++) n++
        if (row) n = Math.max(0, n - 2)
        if ((bullet || row) && stated && n && n !== stated) f.push(`${d}:${i + 1} says ${head[1]} ${head[2]}, but the list under it has ${n} ${row ? 'rows' : 'items'} (checked: ${d} lines ${i + 2}-${i + 1 + n}; ${stated} stated, ${n} listed)`)
      }
      // (b) "N packs" where a top-level folder of that name exists: it has to hold N entries.
      const NUM = '(\\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)'
      const phrases = [...text.matchAll(new RegExp(`(?<![\\w./-])${NUM}\\s+([A-Za-z-]+)\\b`, 'g')), ...text.matchAll(new RegExp(`(?<![\\w./-])${NUM}\\s+(?:[A-Za-z-]+\\s+)([A-Za-z-]+)\\b`, 'g'))]
      for (const m of phrases) {
        const stated = numOf(m[1])
        const noun = m[2].toLowerCase()
        if (!stated || ok.has(`${noun}`)) continue
        const dir = [noun, `${noun}s`].find((c) => topDirs.has(c) && (c === noun ? noun.endsWith('s') : true))
        if (!dir || !noun.endsWith('s')) continue
        if (!new RegExp(`${dir}/|\\b(?:bundled|folder|directory|ships?|shipped)\\b`, 'i').test(text)) continue
        const actual = entriesOf(root, dir).length
        if (actual && actual !== stated) f.push(`${d}:${i + 1} says ${m[0]}, but ${dir}/ holds ${actual} (checked: the entries of ${dir}/ at the repo root; ${stated} stated, ${actual} found)`)
      }
    })
  }
  return finish('doc-drift-counts', f, 'every count the docs state about a list or a folder matches it')
}

// ---- doc-drift-commands
// Quote and bracket balance of one shell line, ignoring what sits inside the quotes. Returns the problem or ''.
export function shellProblem(line) {
  let q = ''
  let paren = 0
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (q) {
      if (c === '\\' && q === '"') i++
      else if (c === q) q = ''
      continue
    }
    if (c === '\\') i++
    else if (c === '"' || c === "'") {
      // An apostrophe inside a word ("don't") is not a quote.
      if (c === "'" && /[A-Za-z]/.test(line[i - 1] ?? '') && /[A-Za-z]/.test(line[i + 1] ?? '')) continue
      q = c
    } else if (c === '#' && /\s/.test(line[i - 1] ?? ' ')) break
    else if (c === '(') paren++
    else if (c === ')') paren--
  }
  if (q) return `an unclosed ${q === '"' ? 'double' : 'single'} quote`
  if (paren > 0) return 'an unclosed parenthesis'
  if (paren < 0) return 'an unmatched closing parenthesis'
  if (/(?:&&|\|\||\|)\s*$/.test(line.replace(/\s+#.*$/, ''))) return 'an operator at the end with nothing after it'
  return ''
}
function commandsDrift(root) {
  const files = trackedFiles(root)
  const docs = docFiles(files)
  if (!docs.length) return finish('doc-drift-commands', [], 'skipped: there is no README.md or docs/*.md')
  const pkg = readPkg(root)
  const scripts = pkg.scripts ?? null
  const ok = allowed(root)
  const f = []
  for (const d of docs) {
    const { fences } = parseDoc(readText(root, d))
    for (const fence of fences) {
      if (fence.lang === 'json') {
        const body = fence.lines.map((l) => l.text).join('\n')
        if (/\.\.\.|\/\/|\/\*|<[^>]+>/.test(body) || !body.trim()) continue
        try {
          JSON.parse(body)
        } catch (e) {
          f.push(`${d}:${fence.start} has a json example that does not parse (checked: JSON.parse of lines ${fence.start + 1}-${fence.end ? fence.end - 1 : fence.start + fence.lines.length}; ${String(e.message).split('\n')[0]})`)
        }
        continue
      }
      if (!SHELL_LANG.test(fence.lang)) continue
      // Join continuation lines (a trailing backslash or backtick) into one command.
      const cmds = []
      for (const l of fence.lines) {
        const prev = cmds[cmds.length - 1]
        if (prev && /[\\`]\s*$/.test(prev.text)) prev.text = prev.text.replace(/[\\`]\s*$/, ' ') + l.text.trim()
        else cmds.push({ line: l.line, text: l.text })
      }
      for (const c of cmds) {
        const t = c.text.replace(/^\s*(?:\$|>|PS>|PS [^>]*>)\s+/, '').trim()
        if (!t || t.startsWith('#') || /^[<(]|\.\.\.|^\w+:\s|^[|+\-─-╿]/.test(t) && !/^[\w./-]+\s/.test(t)) continue
        if (!/^(?:npm|npx|node|git|meerkat|pnpm|yarn|cargo|python3?|pip|cd|curl|gh|docker|[\w.-]+\/[\w./-]+|\.\/[\w./-]+)\b/.test(t) && fence.lang === '') continue
        const problem = shellProblem(t)
        if (problem) {
          f.push(`${d}:${c.line} shows a command that does not parse: ${t.slice(0, 80)} (checked: quote, bracket and operator balance of the line; it has ${problem})`)
          continue
        }
        const run = /^npm\s+(?:run(?:-script)?\s+([\w:.-]+)|(test|start))\b/.exec(t)
        const script = run ? (run[1] ?? run[2]) : ''
        if (script && scripts && !/--prefix|-C\s/.test(t) && !(script in scripts) && !ok.has(script)) f.push(`${d}:${c.line} runs npm script "${script}", which package.json does not define (checked: scripts in package.json, which are ${Object.keys(scripts).join(', ') || 'none'})`)
        const node = /^node\s+(?!-)(\S+)/.exec(t)
        if (node && !/[<>$*{}]|^~/.test(node[1]) && !existsSync(join(root, node[1])) && !ok.has(node[1])) f.push(`${d}:${c.line} runs node ${node[1]}, which does not exist (checked: ${node[1]} from the repo root)`)
      }
    }
  }
  return finish('doc-drift-commands', f, 'every command example parses, and the npm scripts and node files it runs exist')
}

const PKG = '{"name":"demo","bin":{"demo":"cli.js"},"scripts":{"test":"vitest"}}\n'
main({
  'doc-drift-flags': { run: flagsDrift, ...fx({ 'package.json': PKG, 'cli.js': "if (a === '--real') run()\n", 'README.md': '# Demo\n\n```sh\ndemo --real\ndemo --ghost\n```\n' }, flagsDrift) },
  'doc-drift-env': { run: envDrift, ...fx({ 'package.json': PKG, 'cli.js': 'const a = process.env.DEMO_REAL\n', 'README.md': '# Demo\n\nSet the environment variable `DEMO_GHOST` to turn it on, or `DEMO_REAL`.\n' }, envDrift) },
  'doc-drift-paths': { run: pathsDrift, ...fx({ 'package.json': PKG, 'cli.js': '1\n', 'lib/real.mjs': '1\n', 'README.md': '# Demo\n\nThe entry is `lib/real.mjs`, the settings are in `lib/missing-file.mjs`.\n' }, pathsDrift) },
  'doc-drift-counts': { run: countsDrift, ...fx({ 'package.json': PKG, 'packs/a/a.js': '1\n', 'packs/b/b.js': '1\n', 'README.md': '# Demo\n\nThere are three bundled packs in this repo.\n\nIt has three options:\n\n- one\n- two\n' }, countsDrift) },
  'doc-drift-commands': { run: commandsDrift, ...fx({ 'package.json': PKG, 'README.md': '# Demo\n\n```sh\nnpm run build\nnode missing.js\necho "unclosed\n```\n' }, commandsDrift) },
})

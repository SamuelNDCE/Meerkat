// Config-file checks: YAML and TOML that read as valid, line endings and git-ignore state of the tracked files, Docker Compose
// hygiene, GitHub Actions timeouts and pinned runtimes, and the Node and TypeScript settings a project declares.
// Run through the config pack, or by hand:
//   node thorough/config.mjs <check> [--root <dir>]      node thorough/config.mjs <check> --fixtures   (must exit 1)
// A finding you accept goes in .meerkat-config-allow as "<check-id> <path>" (one per line, # starts a comment).
// These are tolerant line-based reads, not full parsers: each check says what it looks at, and a finding is a prompt to look, not a proof.
import { execFileSync } from 'node:child_process'
import { finish, isFixture, main, notRun, readText, trackedFiles, withFixture } from './kit.mjs'

const SKIP = /(^|\/)(node_modules|dist|build|vendor|target|fixtures?)\//i
const MINIFIED = /\.min\.(m?js|css)$/i
const GENERATED = /(^|\/)(package-lock\.json|Cargo\.lock|yarn\.lock|pnpm-lock\.yaml)$|\.(lock|snap)$/i
const TEST_FILE = /(^|\/)(tests?|__tests__)\/|\.(test|spec)\.[a-z]+$/i
const EOL_TEXT = /\.(m?[jt]sx?|cjs|json|md|mdx|html?|css|scss|rs|toml|ya?ml|py|go|sh|bash|txt|svelte|vue|java|cs|rb|php|kt|swift|dart|xml|cfg|ini)$|(^|\/)(Makefile|Dockerfile)$/i
const WORKFLOW = /^\.github\/workflows\/[^/]+\.ya?ml$/i
const COMPOSE = /(^|\/)(docker-)?compose[^/]*\.ya?ml$/i
const DB_IMAGE = /^(?:[^/\s]*\/)?(?:postgres(?:ql)?|postgis|mysql|mariadb|mongo(?:db)?|redis|mssql|cassandra|couchdb|elasticsearch|clickhouse(?:-server)?)(?=[:@\s"']|$)/i
const DB_PORTS = new Set(['5432', '3306', '27017', '6379', '1433', '9042', '5984', '9200', '8123'])

const allowSet = (root) => new Set(readText(root, '.meerkat-config-allow').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#')))
const accepted = (allow, id, x) => allow.has(`${id} ${x}`)
const files = (root, re) => trackedFiles(root).filter((x) => re.test(x) && !SKIP.test(x) && !MINIFIED.test(x) && !GENERATED.test(x) && !isFixture(x))
const indentOf = (line) => /^(\s*)/.exec(line)[1].length
const snip = (s) => s.trim().slice(0, 80)

// ---- yaml-valid: tabs used as indentation, a key given twice in one mapping, quotes that are never closed, flow sequences and mappings
// that are never closed (also across lines), and aliases (*name) with no anchor (&name) before them.
// Lines inside a block scalar (| or >) are text, so they are not checked for indentation.
const CLOSER = { '[': ']', '{': '}' }
// Scans one line of a flow collection. Returns false when a quote stays open at the end of the line (give up on this collection).
function scanFlow(s, from, stack, out, n) {
  let q = ''
  for (let i = from; i < s.length; i++) {
    const c = s[i]
    if (q) {
      if (c === '\\' && q === '"') i++
      else if (c === q) q = ''
      continue
    }
    if ((c === '"' || c === "'") && /[\s[{,:]/.test(i ? s[i - 1] : ' ')) q = c
    else if (c === '#' && /\s/.test(s[i - 1] ?? ' ')) break
    else if (c === '[' || c === '{') stack.push(c)
    else if (c === ']' || c === '}') {
      const open = stack.pop()
      if (open && CLOSER[open] !== c) {
        out.push(`line ${n} closes a flow ${open === '[' ? 'sequence' : 'mapping'} with "${c}" but it was opened with "${open}"`)
        return 'bad'
      }
      if (!stack.length) return 'closed'
    }
  }
  return q ? 'quote' : 'open'
}
const yamlProblems = (text) => {
  const out = []
  let seen = [] // [{ indent, keys:Set }] the mappings of the current document
  let anchors = new Set()
  let blockIndent = -1
  let flow = null // { stack, base, line }
  const template = /(?<!\$)\{\{/.test(text)
  const lines = text.replace(/\r/g, '').split('\n')
  const unclosed = () => {
    out.push(`line ${flow.line} opens a flow ${flow.stack[0] === '[' ? 'sequence' : 'mapping'} that is never closed`)
    flow = null
  }
  lines.forEach((raw, i) => {
    const n = i + 1
    if (/^(---|\.\.\.)\s*(#.*)?$/.test(raw)) {
      if (flow) unclosed()
      seen = []
      anchors = new Set()
      blockIndent = -1
      return
    }
    if (/^\s*$/.test(raw) || /^\s*#/.test(raw)) return
    if (blockIndent >= 0) {
      if (indentOf(raw) > blockIndent) return
      blockIndent = -1
    }
    if (flow) {
      if (indentOf(raw) <= flow.base && !/^\s*[\]}]/.test(raw)) unclosed()
      else {
        const r = scanFlow(raw, 0, flow.stack, out, n)
        if (r === 'closed' || r === 'bad' || r === 'quote') flow = null
        return
      }
    }
    if (/^[ \t]*\t/.test(raw)) out.push(`line ${n} is indented with a tab (YAML indentation must be spaces)`)
    const ind = indentOf(raw)
    const item = /^(\s*)-\s+/.exec(raw)
    if (item) seen = seen.filter((m) => m.indent <= ind)
    const keyAt = item ? item[0].length : ind
    const km = /^([A-Za-z_][\w.-]*|"[^"]*"|'[^']*')\s*:(\s|$)/.exec(raw.slice(keyAt))
    if (km && !template) {
      const name = km[1].replace(/^["']|["']$/g, '')
      seen = seen.filter((m) => m.indent <= keyAt)
      let m = seen[seen.length - 1]
      if (!m || m.indent !== keyAt) {
        m = { indent: keyAt, keys: new Set() }
        seen.push(m)
      }
      if (m.keys.has(name)) out.push(keyAt === 0 ? `line ${n} repeats the top-level key "${name}"` : `line ${n} repeats the key "${name}" in the same mapping`)
      m.keys.add(name)
    }
    if (/(?::|^\s*-)\s*[|>][-+0-9]*\s*(?:#.*)?$/.test(raw)) blockIndent = indentOf(raw)
    const open = /(?:^\s*-\s+|:\s+|^\s*)(["'])/.exec(raw)
    if (open) {
      const rest = raw.slice(open.index + open[0].length)
      if (!rest.includes(open[1])) out.push(`line ${n} opens a ${open[1] === '"' ? 'double' : 'single'} quote that is never closed`)
    }
    if (template) return
    const bare = raw.replace(/"(?:[^"\\]|\\.)*"|'[^']*'/g, (s) => ' '.repeat(s.length))
    const code = bare.replace(/(^|\s)#.*$/, '$1')
    for (const a of code.matchAll(/(?:^|[\s[{,:])&([^\s,\]}[{]+)/g)) anchors.add(a[1])
    for (const a of code.matchAll(/(?:^|[\s[{,])\*([A-Za-z_][\w-]*)(?=\s|$|[,\]}])/g)) if (!anchors.has(a[1])) out.push(`line ${n} uses the alias *${a[1]} but no &${a[1]} anchor comes before it`)
    const fm = /^(\s*(?:-\s+)*)(?:(?:[^\s#'"[{][^#]*?|"[^"]*"|'[^']*')\s*:\s+)?(?=[[{])/.exec(code)
    if (fm) {
      const stack = []
      const r = scanFlow(code, fm[0].length, stack, out, n)
      if (r === 'open') flow = { stack, base: ind, line: n }
    }
  })
  if (flow) unclosed()
  return out
}
const yamlValid = (root) => {
  const allow = allowSet(root)
  const f = []
  for (const x of files(root, /\.ya?ml$/i)) {
    if (accepted(allow, 'yaml-valid', x)) continue
    for (const p of yamlProblems(readText(root, x))) f.push(`${x}: ${p}`)
  }
  return finish('yaml-valid', f, 'every tracked YAML file reads as valid YAML structure')
}

// ---- toml-valid: strings never closed, a key given twice in one table, a table header given twice or malformed.
// A table name is bare keys and quoted keys joined by dots; a quoted key may hold any character, as in [target.'cfg(windows)'.dependencies].
const TOML_NAME = /^(?:[A-Za-z0-9_\-]+|"[^"]*"|'[^']*')(?:\s*\.\s*(?:[A-Za-z0-9_\-]+|"[^"]*"|'[^']*'))*$|^[A-Za-z0-9_.\-"' ]+$/
const brackets = (s) => {
  const t = s.replace(/"(?:[^"\\]|\\.)*"|'[^']*'/g, '').replace(/#.*$/, '')
  return (t.match(/\[/g) ?? []).length - (t.match(/\]/g) ?? []).length
}
const tomlProblems = (text) => {
  const out = []
  let multi = null
  let depth = 0
  let table = ''
  let keys = new Set()
  const tables = new Set()
  text.replace(/\r/g, '').split('\n').forEach((raw, i) => {
    const n = i + 1
    const line = raw.trim()
    if (multi) {
      if (raw.includes(multi)) multi = null
      return
    }
    if (depth > 0) {
      depth += brackets(line)
      return
    }
    if (!line || line.startsWith('#')) return
    if (line.startsWith('[')) {
      const arr = /^\[\[(.+?)\]\]\s*(#.*)?$/.exec(line)
      if (arr && TOML_NAME.test(arr[1].trim())) {
        table = arr[1].trim()
        keys = new Set()
        return
      }
      const tab = /^\[(.+?)\]\s*(#.*)?$/.exec(line)
      if (tab && TOML_NAME.test(tab[1].trim())) {
        const name = tab[1].trim()
        if (tables.has(name)) out.push(`line ${n} repeats the table [${name}]`)
        tables.add(name)
        table = name
        keys = new Set()
        return
      }
      out.push(`line ${n} is not a valid table header: ${snip(line)}`)
      return
    }
    const m = /^([A-Za-z0-9_.\-"']+)\s*=\s*(.*)$/.exec(line)
    if (!m) {
      out.push(`line ${n} is neither a key, a table header nor a comment: ${snip(line)}`)
      return
    }
    const name = m[1]
    if (keys.has(name)) out.push(`line ${n} repeats the key "${name}"${table ? ` in [${table}]` : ''}`)
    keys.add(name)
    const value = m[2]
    if (!value.trim() || value.startsWith('=')) {
      out.push(`line ${n} has no value after the key "${name}"`)
      return
    }
    const trip = /^("""|''')/.exec(value)
    if (trip) {
      if (!value.slice(3).includes(trip[1])) multi = trip[1]
      return
    }
    if (value.startsWith('"') && !/^"(?:[^"\\]|\\.)*"/.test(value)) out.push(`line ${n} has a basic string that is never closed`)
    else if (value.startsWith("'") && !/^'[^']*'/.test(value)) out.push(`line ${n} has a literal string that is never closed`)
    depth = Math.max(0, brackets(value))
  })
  return out
}
const tomlValid = (root) => {
  const allow = allowSet(root)
  const f = []
  for (const x of files(root, /\.toml$/i)) {
    if (accepted(allow, 'toml-valid', x)) continue
    for (const p of tomlProblems(readText(root, x))) f.push(`${x}: ${p}`)
  }
  return finish('toml-valid', f, 'every tracked TOML file reads as valid TOML structure')
}

// ---- gitattributes-eol: text files that mix CRLF and LF with no .gitattributes to make git store one style.
// A file that mixes both inside itself is the hygiene pack's job (whitespace), so it is not counted here.
const eolStyle = (t) => {
  const crlf = (t.match(/\r\n/g) ?? []).length
  const bare = (t.match(/\n/g) ?? []).length - crlf
  if (crlf && !bare) return 'CRLF'
  if (bare && !crlf) return 'LF'
  return null
}
const gitattributesEol = (root) => {
  if (/(^|\s)(text|eol)(=|\s|$)/m.test(readText(root, '.gitattributes'))) return finish('gitattributes-eol', [], '.gitattributes sets the line endings')
  const allow = allowSet(root)
  const by = { CRLF: [], LF: [] }
  for (const x of files(root, EOL_TEXT)) {
    if (accepted(allow, 'gitattributes-eol', x)) continue
    const s = eolStyle(readText(root, x))
    if (s) by[s].push(x)
  }
  if (!by.CRLF.length || !by.LF.length) return finish('gitattributes-eol', [], 'the text files all use one line-ending style')
  const major = by.CRLF.length >= by.LF.length ? 'CRLF' : 'LF'
  const minor = major === 'CRLF' ? 'LF' : 'CRLF'
  const f = [`${by.CRLF.length} text file(s) use CRLF and ${by.LF.length} use LF, and there is no .gitattributes to make git store one style`]
  for (const x of by[minor]) f.push(`${x} uses ${minor}, while most text files use ${major}`)
  return finish('gitattributes-eol', f, 'the text files all use one line-ending style')
}

// ---- gitignored-but-tracked: files git is told to ignore that are still in the index (the rule came after the file was added).
const gitignoredButTracked = (root) => {
  let out
  try {
    out = execFileSync('git', ['-C', root, 'ls-files', '-ci', '--exclude-standard', '-z'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 256 * 2 ** 20 })
  } catch {
    return notRun('the folder is not a git repository, so there is no index to compare with .gitignore')
  }
  const allow = allowSet(root)
  const f = out.split('\0').filter(Boolean).filter((x) => !accepted(allow, 'gitignored-but-tracked', x) && !isFixture(x))
    .map((x) => `${x} is tracked, but .gitignore says git should ignore it (remove it with git rm --cached, the disk copy can stay)`)
  return finish('gitignored-but-tracked', f, 'no ignored file is still tracked')
}

// ---- compose-hygiene: a Docker Compose file with an unpinned image, a privileged container, host networking, a database port
// open to every interface, or a password written into the file.
const composeProblems = (text) => {
  const out = []
  const lines = text.replace(/\r/g, '').split('\n')
  const images = lines.map((l) => /^\s*image:\s*["']?([^\s"'#]+)/.exec(l)?.[1]).filter((v) => v && !v.includes('${'))
  const dbFile = images.some((img) => DB_IMAGE.test(img))
  lines.forEach((raw, i) => {
    const n = i + 1
    const img = /^\s*image:\s*["']?([^\s"'#]+)/.exec(raw)?.[1]
    if (img && !img.includes('${') && !img.includes('@')) {
      const name = img.split('/').pop()
      if (!name.includes(':')) out.push(`line ${n} uses image ${img} with no tag, so it floats to whatever is newest`)
      else if (/:latest$/i.test(img)) out.push(`line ${n} uses image ${img}, the latest tag, which changes under you`)
    }
    if (/^\s*privileged:\s*(true|yes|on)\s*(#.*)?$/i.test(raw)) out.push(`line ${n} runs a container privileged (full access to the host)`)
    if (/^\s*network_mode:\s*["']?host["']?\s*(#.*)?$/i.test(raw)) out.push(`line ${n} uses host networking, which removes the container's network isolation`)
    const port = /^\s*-\s*["']?(\d[\d.:]*)(?:\/[a-z]+)?["']?\s*(?:#.*)?$/i.exec(raw)?.[1]
    if (port && dbFile) {
      const parts = port.split(':')
      const container = parts[parts.length - 1]
      if (DB_PORTS.has(container) && (parts.length < 3 || parts[0] === '0.0.0.0')) out.push(`line ${n} publishes database port ${container} on every interface (bind it to 127.0.0.1)`)
    }
    const secret = /^\s*-?\s*["']?([A-Za-z0-9_]*(?:PASSWORD|PASSWD|SECRET|TOKEN|API_KEY|ACCESS_KEY)[A-Za-z0-9_]*)["']?\s*(?::|=)\s*["']?([^"'\s#$][^"'\s#]*)["']?\s*(?:#.*)?$/i.exec(raw)
    if (secret && !secret[2].includes('/')) out.push(`line ${n} writes ${secret[1]} into the file (use an env file or a secret instead)`)
  })
  return out
}
const composeHygiene = (root) => {
  const allow = allowSet(root)
  const f = []
  for (const x of files(root, COMPOSE)) {
    if (accepted(allow, 'compose-hygiene', x)) continue
    for (const p of composeProblems(readText(root, x))) f.push(`${x}: ${p}`)
  }
  return finish('compose-hygiene', f, 'every Compose file pins its images and avoids the risky settings')
}

// ---- ci-timeouts: every GitHub Actions job (not a call to a reusable workflow) sets timeout-minutes, so a hung job cannot run for six hours.
const jobsWithoutTimeout = (text) => {
  const lines = text.replace(/\r/g, '').split('\n')
  const start = lines.findIndex((l) => /^jobs:\s*(#.*)?$/.test(l))
  if (start < 0) return []
  const missing = []
  let ji = -1
  let cur = null
  const close = () => {
    if (cur && !cur.timeout && !cur.uses) missing.push(cur.name)
  }
  for (let i = start + 1; i < lines.length; i++) {
    const l = lines[i]
    if (/^\s*$/.test(l) || /^\s*#/.test(l)) continue
    const ind = indentOf(l)
    if (ind === 0) break
    if (ji < 0) ji = ind
    if (ind === ji && /^\s*[A-Za-z_][\w-]*\s*:/.test(l)) {
      close()
      cur = { name: l.trim().split(':')[0], timeout: false, uses: false, childIndent: -1 }
      continue
    }
    if (!cur || ind <= ji) continue
    if (cur.childIndent < 0) cur.childIndent = ind
    if (ind !== cur.childIndent) continue
    if (/^\s*timeout-minutes\s*:/.test(l)) cur.timeout = true
    if (/^\s*uses\s*:/.test(l)) cur.uses = true
  }
  close()
  return missing
}
const ciTimeouts = (root) => {
  const allow = allowSet(root)
  const f = []
  for (const x of files(root, WORKFLOW)) {
    if (accepted(allow, 'ci-timeouts', x)) continue
    for (const job of jobsWithoutTimeout(readText(root, x))) f.push(`${x}: job "${job}" has no timeout-minutes, so a hung run can go on for the six-hour default`)
  }
  return finish('ci-timeouts', f, 'every workflow job sets a timeout')
}

// ---- ci-node-version-pinned: setup-node, setup-python and setup-go steps name a real version (or a version file), not a floating alias.
const SETUP = {
  'setup-node': { key: 'node-version', file: 'node-version-file' },
  'setup-python': { key: 'python-version', file: 'python-version-file' },
  'setup-go': { key: 'go-version', file: 'go-version-file' },
}
const FLOATING = /^(latest|\*|stable|lts\/\*|)$/i
const stepBlock = (lines, i) => {
  let s = i
  if (!/^\s*-\s/.test(lines[i])) {
    const ind = indentOf(lines[i])
    while (s > 0 && !(/^\s*-\s/.test(lines[s]) && indentOf(lines[s]) < ind)) s--
  }
  const base = indentOf(lines[s])
  let e = s + 1
  while (e < lines.length && (/^\s*$/.test(lines[e]) || indentOf(lines[e]) > base)) e++
  return lines.slice(s, e)
}
const setupPins = (text) => {
  const out = []
  const lines = text.replace(/\r/g, '').split('\n')
  lines.forEach((raw, i) => {
    const m = /uses\s*:\s*actions\/(setup-node|setup-python|setup-go)@/.exec(raw)
    if (!m) return
    const want = SETUP[m[1]]
    const block = stepBlock(lines, i)
    const hit = block.map((l) => new RegExp(`^\\s*-?\\s*(${want.key}|${want.file})\\s*:\\s*["']?([^"'\\s#]*)`).exec(l)).find(Boolean)
    if (!hit) {
      out.push(`line ${i + 1}: ${m[1]} sets no ${want.key} (or ${want.file}), so the runtime version is whatever the runner has`)
      return
    }
    if (hit[1] === want.key && (FLOATING.test(hit[2]) || hit[2] === '')) out.push(`line ${i + 1}: ${m[1]} asks for ${want.key} "${hit[2] || 'empty'}", a floating version that changes under the workflow`)
  })
  return out
}
const ciNodeVersionPinned = (root) => {
  const allow = allowSet(root)
  const f = []
  for (const x of files(root, WORKFLOW)) {
    if (accepted(allow, 'ci-node-version-pinned', x)) continue
    for (const p of setupPins(readText(root, x))) f.push(`${x}:${p}`)
  }
  return finish('ci-node-version-pinned', f, 'every setup action pins its runtime version')
}

// ---- node-engines: package.json declares engines.node, and a .nvmrc (when present) is at least that minimum major version.
const nodeEngines = (root) => {
  if (!trackedFiles(root).includes('package.json')) return finish('node-engines', [], 'skipped: there is no package.json at the top of the repo')
  let pkg
  try {
    pkg = JSON.parse(readText(root, 'package.json'))
  } catch {
    return finish('node-engines', [], 'skipped: package.json does not parse (json-valid reports it)')
  }
  const engines = typeof pkg.engines?.node === 'string' ? pkg.engines.node.trim() : ''
  const f = []
  if (!engines) f.push('package.json does not declare engines.node, so the Node version the code needs is not written down')
  const nvm = trackedFiles(root).includes('.nvmrc') ? readText(root, '.nvmrc').trim() : null
  if (nvm !== null && engines) {
    const want = Number(/(\d+)/.exec(engines)?.[1])
    const have = Number(/^v?(\d+)/.exec(nvm)?.[1])
    if (want && have && have < want) f.push(`.nvmrc pins Node ${have}, below the minimum in engines.node "${engines}" (major ${want})`)
  }
  return finish('node-engines', f, 'package.json declares a Node version and .nvmrc agrees with it')
}

// ---- tsconfig-strict: a repo with TypeScript source (test files alone do not count) has a tsconfig.json with strict on.
const parseJsonc = (t) => {
  try {
    // Walk the text so comment markers inside strings (tsconfig globs such as "**/*.ts" contain /*) are kept.
    let out = ''
    for (let i = 0; i < t.length; i++) {
      const c = t[i]
      if (c === '"') {
        let j = i + 1
        while (j < t.length && t[j] !== '"') j += t[j] === '\\' ? 2 : 1
        out += t.slice(i, j + 1)
        i = j
      } else if (c === '/' && t[i + 1] === '/') {
        while (i < t.length && t[i] !== '\n') i++
        out += '\n'
      } else if (c === '/' && t[i + 1] === '*') {
        const end = t.indexOf('*/', i + 2)
        i = end < 0 ? t.length : end + 1
        out += ' '
      } else out += c
    }
    return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'))
  } catch {
    return null
  }
}
const tsconfigStrict = (root) => {
  const all = trackedFiles(root)
  const src = all.filter((x) => /\.(m?ts|tsx|cts)$/i.test(x) && !/\.d\.ts$/i.test(x) && !SKIP.test(x) && !isFixture(x) && !TEST_FILE.test(x))
  if (!src.length) return finish('tsconfig-strict', [], 'skipped: the repo has no TypeScript source files')
  if (!all.includes('tsconfig.json')) return finish('tsconfig-strict', ['the repo has TypeScript source files but no tsconfig.json at the top, so strict checking is off'])
  const cfg = parseJsonc(readText(root, 'tsconfig.json'))
  if (cfg === null) return finish('tsconfig-strict', ['tsconfig.json does not parse'])
  const strict = cfg.compilerOptions?.strict
  if (strict === true) return finish('tsconfig-strict', [], 'tsconfig.json turns strict on')
  if (strict === undefined && cfg.extends) return finish('tsconfig-strict', [], 'skipped: tsconfig.json extends another file that may set strict; check that file')
  return finish('tsconfig-strict', [`tsconfig.json has strict ${strict === undefined ? 'unset (off by default)' : String(strict)}, so the strict type checks are not applied`])
}

const fx = (tree, fn) => ({ fixture: () => withFixture(tree, fn) })
const gitFx = (tree, add, fn) => ({
  fixture: () =>
    withFixture(tree, (dir) => {
      execFileSync('git', ['init', '-q'], { cwd: dir, stdio: 'ignore' })
      for (const f of add) execFileSync('git', ['-C', dir, 'add', '-f', f], { stdio: 'ignore' })
      return fn(dir)
    }),
})

main({
  'yaml-valid': { run: yamlValid, ...fx({ 'ci.yml': 'name: ci\njobs:\n\tbuild:\n\t\truns-on: ubuntu-latest\n' }, yamlValid) },
  'toml-valid': { run: tomlValid, ...fx({ 'config.toml': '[package]\nname = "demo\nversion = "1.0.0"\n' }, tomlValid) },
  'gitattributes-eol': { run: gitattributesEol, ...fx({ 'a.js': 'const a = 1\n', 'b.js': 'const b = 2\r\n' }, gitattributesEol) },
  'gitignored-but-tracked': { run: gitignoredButTracked, ...gitFx({ '.gitignore': 'debug.log\n', 'debug.log': 'x\n' }, ['debug.log'], gitignoredButTracked) },
  'compose-hygiene': {
    run: composeHygiene,
    ...fx({ 'docker-compose.yml': 'services:\n  db:\n    image: postgres\n    privileged: true\n    environment:\n      POSTGRES_PASSWORD: hunter2\n    ports:\n      - "5432:5432"\n' }, composeHygiene),
  },
  'ci-timeouts': { run: ciTimeouts, ...fx({ '.github/workflows/ci.yml': 'name: ci\non: push\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo hi\n' }, ciTimeouts) },
  'ci-node-version-pinned': {
    run: ciNodeVersionPinned,
    ...fx({ '.github/workflows/ci.yml': 'name: ci\non: push\njobs:\n  build:\n    timeout-minutes: 10\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/setup-node@v4\n        with:\n          node-version: latest\n' }, ciNodeVersionPinned),
  },
  'node-engines': { run: nodeEngines, ...fx({ 'package.json': '{"name":"x","version":"1.0.0"}\n' }, nodeEngines) },
  'tsconfig-strict': { run: tsconfigStrict, ...fx({ 'src/index.ts': 'export const a: number = 1\n', 'tsconfig.json': '{ "compilerOptions": { "strict": false } }\n' }, tsconfigStrict) },
})

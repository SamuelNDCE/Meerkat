// API, database and data-handling hygiene: OpenAPI and GraphQL schemas, SQL migrations, Prisma schemas, HTTP timeouts,
// rate limiting, error leaks and pagination bounds. Read-only, tracked files only, no dependencies. Run through the api pack, or by hand:
//   node thorough/api.mjs <check> [--root <dir>]      node thorough/api.mjs <check> --fixtures   (must exit 1)
// Limits are set in .meerkat-budgets.json under "api". A finding you accept goes in .meerkat-api-allow as "<check-id> <path>".
// Two checks only list their findings unless the budget asks for them: sql-missing-index-note (api.requireIndexes) and
// pagination-bounds (api.requirePaginationBounds). Framework checks pass with a note when the project has no such files.
import { posix } from 'node:path'
import { finish, isFixture, main, readBudgets, readText, trackedFiles, withFixture } from './kit.mjs'

const SELF = /(^|\/)thorough\/api\.mjs$/
const cfg = (root) => readBudgets(root)?.api ?? {}
const SKIP = /(^|\/)(node_modules|dist|build|vendor|target|fixtures?)\//i
const MINIFIED = /\.min\.(m?js|css)$/i
const GENERATED = /(^|\/)(package-lock\.json|Cargo\.lock|yarn\.lock|pnpm-lock\.yaml)$|\.(lock|snap)$/i
const CODE = /\.(m?[jt]sx?|cjs|py|go|rb|php|java|cs|kt|swift|dart|svelte|vue)$/i
const TEST_FILE = /(^|\/)(tests?|__tests__)\/|\.(test|spec)\.[a-z]+$|(^|\/)test_[^/]*\.py$|_test\.go$/i
const METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace']
const CLOSE = { '(': ')', '{': '}', '[': ']' }

const allowSet = (root) => new Set(readText(root, '.meerkat-api-allow').split('\n').map((l) => l.trim().replace(/\s+/g, ' ')).filter((l) => l && !l.startsWith('#')))
const allowed = (allow, id, x) => allow.has(`${id} ${x}`)
const lineOf = (text, index) => text.slice(0, index).split('\n').length
const snip = (s) => s.trim().slice(0, 80)
const files = (root, re) => trackedFiles(root).filter((x) => re.test(x) && !SKIP.test(x) && !MINIFIED.test(x) && !GENERATED.test(x) && !isFixture(x) && !SELF.test(x))
// Blanks a span of text but keeps its line breaks, so line numbers stay true after a removal.
const blank = (s) => s.replace(/[^\n]/g, ' ')
// The group opened at index open ("(", "{" or "["), including its brackets, up to the matching close (or the end of the text).
const groupOf = (t, open) => {
  const close = CLOSE[t[open]]
  let depth = 0
  for (let i = open; i < t.length; i++) {
    if (t[i] === t[open]) depth++
    else if (t[i] === close && --depth === 0) return t.slice(open, i + 1)
  }
  return t.slice(open)
}
// Splits on commas that sit outside any parentheses (a SQL column list, for example).
const splitTop = (s) => {
  const out = []
  let depth = 0
  let cur = ''
  for (const ch of s) {
    if (ch === '(') depth++
    if (ch === ')') depth--
    if (ch === ',' && depth === 0) {
      out.push(cur)
      cur = ''
    } else cur += ch
  }
  out.push(cur)
  return out
}
// An informational check lists what it sees and passes, unless the budget makes it a requirement.
const informational = (name, findings, required, flag, okNote) => {
  if (required) return finish(name, findings, okNote)
  if (!findings.length) {
    console.log(`${name}: ${okNote}`)
    return 0
  }
  console.log(`${name}: ${findings.length} to review (not enforced; set api.${flag} to true to fail on them)`)
  for (const f of findings.slice(0, 25)) console.log(`  ${f}`)
  if (findings.length > 25) console.log(`  ... and ${findings.length - 25} more`)
  return 0
}

// ---- OpenAPI and Swagger files: JSON is parsed, YAML is read by indentation (enough for the shape checks, no YAML parser needed)
const SPEC_NAME = /(^|\/)(openapi|swagger)[\w.-]*\.(json|ya?ml)$/i
const SPEC_HINT = /^\s*["']?(openapi|swagger)["']?\s*:/m
const specFiles = (root) => files(root, /\.(json|ya?ml)$/i).filter((x) => SPEC_NAME.test(x) || SPEC_HINT.test(readText(root, x).slice(0, 2000)))
const indentOf = (l) => l.match(/^ */)[0].length
const isContent = (l) => l.trim() !== '' && !l.trim().startsWith('#')
// The lines indented deeper than line index.
const yamlBlock = (lines, index) => {
  const out = []
  for (let i = index + 1; i < lines.length; i++) {
    if (isContent(lines[i]) && indentOf(lines[i]) <= indentOf(lines[index])) break
    out.push(lines[i])
  }
  return out
}
// The keys at the shallowest indent of a block, each with the index of its line inside that block.
const keysOf = (block) => {
  const content = block.map((l, index) => ({ l, index })).filter(({ l }) => isContent(l))
  if (!content.length) return []
  const top = Math.min(...content.map(({ l }) => indentOf(l)))
  return content
    .filter(({ l }) => indentOf(l) === top)
    .map(({ l, index }) => ({ key: l.trim().replace(/:.*$/, '').replace(/^-\s*/, '').replace(/^["']|["']$/g, ''), index }))
}
const walkJson = (node, visit) => {
  if (!node || typeof node !== 'object') return
  visit(node)
  for (const v of Object.values(node)) walkJson(v, visit)
}

const openapiValid = (root) => {
  const allow = allowSet(root)
  const f = []
  for (const x of specFiles(root)) {
    if (allowed(allow, 'openapi-valid', x)) continue
    const bad = (msg) => f.push(`${x}: ${msg}`)
    const t = readText(root, x)
    if (/\.json$/i.test(x)) {
      let j
      try {
        j = JSON.parse(t)
      } catch {
        bad('is not valid JSON')
        continue
      }
      if (!j || typeof j !== 'object') {
        bad('is not a JSON object')
        continue
      }
      if (!('openapi' in j) && !('swagger' in j)) bad('has no openapi or swagger version')
      if (typeof j.info?.title !== 'string') bad('info.title is missing')
      if (j.info?.version === undefined) bad('info.version is missing')
      if (!j.paths || typeof j.paths !== 'object' || Array.isArray(j.paths)) {
        bad('paths is missing or is not an object')
        continue
      }
      for (const [p, item] of Object.entries(j.paths)) {
        for (const m of METHODS) if (item?.[m] && !(item[m].responses && typeof item[m].responses === 'object')) bad(`${m.toUpperCase()} ${p} has no responses`)
      }
    } else {
      const lines = t.replace(/\r/g, '').split('\n')
      const top = keysOf(lines)
      if (!top.some(({ key }) => key === 'openapi' || key === 'swagger')) bad('has no openapi or swagger version')
      const info = top.find(({ key }) => key === 'info')
      const infoKeys = info ? keysOf(yamlBlock(lines, info.index)).map(({ key }) => key) : []
      if (!infoKeys.includes('title')) bad('info.title is missing')
      if (!infoKeys.includes('version')) bad('info.version is missing')
      const paths = top.find(({ key }) => key === 'paths')
      if (!paths) {
        bad('paths is missing')
        continue
      }
      const pathsBlock = yamlBlock(lines, paths.index)
      for (const p of keysOf(pathsBlock)) {
        const item = yamlBlock(pathsBlock, p.index)
        for (const m of keysOf(item)) {
          if (METHODS.includes(m.key) && !keysOf(yamlBlock(item, m.index)).some(({ key }) => key === 'responses')) bad(`${m.key.toUpperCase()} ${p.key} has no responses`)
        }
      }
    }
  }
  return finish('openapi-valid', f, 'every OpenAPI or Swagger file has its required parts (or there are none)')
}

const OPERATION_ID = /"operationId"\s*:\s*"([^"]+)"|^[ \t]*operationId\s*:\s*['"]?([^'"\s#]+)/gm
const openapiOperationIds = (root) => {
  const allow = allowSet(root)
  const f = []
  for (const x of specFiles(root)) {
    if (allowed(allow, 'openapi-operation-ids', x)) continue
    const t = readText(root, x)
    const seen = new Map()
    for (const m of t.matchAll(OPERATION_ID)) {
      const id = m[1] ?? m[2]
      const line = lineOf(t, m.index)
      if (seen.has(id)) f.push(`${x}:${line} repeats operationId "${id}" (first at line ${seen.get(id)})`)
      else seen.set(id, line)
    }
  }
  return finish('openapi-operation-ids', f, 'every operationId is unique (or there are none)')
}

const openapiSecurity = (root) => {
  const allow = allowSet(root)
  const f = []
  for (const x of specFiles(root)) {
    if (allowed(allow, 'openapi-security-defined', x)) continue
    const t = readText(root, x)
    const refs = new Set()
    const defined = new Set()
    let hasSecurity = false
    let urls = []
    if (/\.json$/i.test(x)) {
      let j
      try {
        j = JSON.parse(t)
      } catch {
        continue
      }
      walkJson(j, (node) => {
        for (const [k, v] of Object.entries(node)) {
          if (k === 'security') {
            hasSecurity = true
            if (Array.isArray(v)) for (const req of v) for (const name of Object.keys(req ?? {})) refs.add(name)
          }
          if ((k === 'securitySchemes' || k === 'securityDefinitions') && v && typeof v === 'object') for (const name of Object.keys(v)) defined.add(name)
        }
      })
      urls = (Array.isArray(j?.servers) ? j.servers : []).map((s) => s?.url).filter((u) => typeof u === 'string')
    } else {
      const lines = t.replace(/\r/g, '').split('\n')
      hasSecurity = lines.some((l) => /^\s*security\s*:/.test(l))
      for (const l of lines) {
        const m = /^\s*-\s*['"]?([\w.-]+)['"]?\s*:\s*\[\s*\]/.exec(l)
        if (m) refs.add(m[1])
      }
      for (const k of ['securitySchemes', 'securityDefinitions']) {
        const at = lines.findIndex((l) => new RegExp(`^\\s*${k}\\s*:\\s*$`).test(l))
        if (at >= 0) for (const { key } of keysOf(yamlBlock(lines, at))) defined.add(key)
      }
      urls = [...t.matchAll(/^\s*-?\s*url\s*:\s*['"]?(https?:\/\/[^'"\s]+)/gm)].map((m) => m[1])
    }
    for (const name of refs) if (!defined.has(name)) f.push(`${x} uses security scheme "${name}" but does not define it in securitySchemes`)
    const publicHttps = urls.some((u) => /^https:\/\/(?!localhost\b|127\.|0\.0\.0\.0|\[::1\])/i.test(u))
    if (publicHttps && !hasSecurity) f.push(`${x} lists a public https server but declares no security anywhere`)
  }
  return finish('openapi-security-defined', f, 'every referenced security scheme is defined and public APIs declare security')
}

// ---- GraphQL schema files: braces must balance and type names must be unique within a file
const stripGraphql = (t) =>
  t
    .replace(/"""[\s\S]*?"""/g, blank)
    .replace(/"(?:\\.|[^"\\\n])*"/g, (m) => '""'.padEnd(m.length))
    .replace(/#[^\n]*/g, blank)
const graphqlBasics = (root) => {
  const allow = allowSet(root)
  const f = []
  for (const x of files(root, /\.(graphqls?|gql)$/i)) {
    if (allowed(allow, 'graphql-schema-basics', x)) continue
    const code = stripGraphql(readText(root, x))
    const opens = (code.match(/\{/g) ?? []).length
    const closes = (code.match(/\}/g) ?? []).length
    if (opens !== closes) f.push(`${x} has unbalanced braces (${opens} opening, ${closes} closing)`)
    const seen = new Map()
    for (const m of code.matchAll(/^[ \t]*(?:type|input|enum|interface|union|scalar)\s+([A-Za-z_]\w*)/gm)) {
      const line = lineOf(code, m.index)
      if (seen.has(m[1])) f.push(`${x}:${line} repeats the type name "${m[1]}" (first at line ${seen.get(m[1])})`)
      else seen.set(m[1], line)
    }
  }
  return finish('graphql-schema-basics', f, 'every GraphQL schema has balanced braces and unique type names (or there are none)')
}

// ---- SQL migrations: numbering must be unique and gap-free, and destructive statements need a reason
const SQL_MIGRATION = /(^|\/)(migrations?|prisma\/migrations)\//i
const sqlMigrations = (root) => files(root, /\.sql$/i).filter((x) => SQL_MIGRATION.test(x))
const sqlMigrationOrder = (root) => {
  const allow = allowSet(root)
  const f = []
  const byDir = new Map()
  for (const x of sqlMigrations(root)) {
    const name = posix.basename(x) === 'migration.sql' ? posix.basename(posix.dirname(x)) : posix.basename(x)
    const m = /^(\d+)[_.-]/.exec(name)
    if (!m) continue
    const d = posix.dirname(x)
    if (!byDir.has(d)) byDir.set(d, [])
    byDir.get(d).push({ x, n: Number(m[1]), digits: m[1].length })
  }
  for (const list of byDir.values()) {
    const seen = new Map()
    for (const { x, n } of [...list].sort((a, b) => a.n - b.n)) {
      if (seen.has(n)) {
        if (!allowed(allow, 'sql-migrations-order', x)) f.push(`${x} repeats migration number ${n} (also ${seen.get(n)})`)
      } else seen.set(n, x)
    }
    // Timestamp-style names (long prefixes) are not sequential, so only short numbers are checked for gaps.
    const short = list.filter((m) => m.digits <= 6).sort((a, b) => a.n - b.n)
    for (let i = 1; i < short.length; i++) {
      const prev = short[i - 1].n
      const cur = short[i]
      if (cur.n - prev > 1 && !allowed(allow, 'sql-migrations-order', cur.x)) f.push(`${cur.x} is number ${cur.n} but the one before is ${prev} (numbers ${prev + 1} to ${cur.n - 1} are missing)`)
    }
  }
  return finish('sql-migrations-order', f, 'migration numbers are unique and have no gaps (or there are no numbered migrations)')
}

const SQL_DESTRUCTIVE = [
  [/\bDROP\s+(?:TABLE|COLUMN|SCHEMA|DATABASE)\b/gi, 'drops data (DROP TABLE, COLUMN, SCHEMA or DATABASE)'],
  [/\bTRUNCATE\b/gi, 'empties a whole table (TRUNCATE)'],
]
const sqlDestructive = (root) => {
  const allow = allowSet(root)
  const f = []
  for (const x of sqlMigrations(root)) {
    if (allowed(allow, 'sql-destructive-migrations', x)) continue
    const t = readText(root, x)
    if (/--\s*meerkat-allow\b/.test(t)) continue
    const code = t.replace(/--[^\n]*/g, blank)
    for (const [re, why] of SQL_DESTRUCTIVE) for (const m of code.matchAll(re)) f.push(`${x}:${lineOf(code, m.index)} ${why} (add "-- meerkat-allow" if this is intended)`)
    for (const m of code.matchAll(/\bDELETE\s+FROM\b[^;]*;/gi)) {
      if (!/\bWHERE\b/i.test(m[0])) f.push(`${x}:${lineOf(code, m.index)} DELETE FROM with no WHERE clause deletes every row`)
    }
  }
  return finish('sql-destructive-migrations', f, 'no migration drops, truncates or mass-deletes without a reason (or there are no migrations)')
}

// A *_id column is a probable foreign key; it should have an index or a constraint in the same file.
const sqlMissingIndex = (root) => {
  const allow = allowSet(root)
  const f = []
  for (const x of files(root, /\.sql$/i)) {
    if (allowed(allow, 'sql-missing-index-note', x)) continue
    const code = readText(root, x).replace(/--[^\n]*/g, blank)
    const statements = code.split(';')
    for (const m of code.matchAll(/\bCREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([\w."`]+)\s*\(/gi)) {
      const body = groupOf(code, m.index + m[0].length - 1).slice(1, -1)
      for (const item of splitTop(body)) {
        const col = /^\s*["`]?([A-Za-z_]\w*_id)["`]?\s+/i.exec(item)
        if (!col || /\bREFERENCES\b/i.test(item)) continue
        const name = col[1].toLowerCase()
        const covered = statements.some((s) => /\b(?:INDEX|FOREIGN\s+KEY)\b/i.test(s) && s.toLowerCase().includes(name))
        if (!covered) f.push(`${x}:${lineOf(code, m.index)} table ${m[1]} has ${col[1]} with no index or foreign key in this file`)
      }
    }
  }
  return informational('sql-missing-index-note', f, cfg(root).requireIndexes === true, 'requireIndexes', 'every *_id column has an index or a foreign key (or there are none)')
}

// ---- Prisma schemas: every model needs an id, and a datasource url must not carry a password as a literal
const prismaBasics = (root) => {
  const allow = allowSet(root)
  const f = []
  for (const x of files(root, /\.prisma$/i)) {
    if (allowed(allow, 'prisma-schema-basics', x)) continue
    const t = readText(root, x)
    for (const m of t.matchAll(/^[ \t]*model\s+(\w+)\s*\{/gm)) {
      if (!/@@?id\b/.test(groupOf(t, m.index + m[0].length - 1))) f.push(`${x}:${lineOf(t, m.index)} model ${m[1]} has no @id or @@id field`)
    }
    for (const m of t.matchAll(/^[ \t]*url\s*=\s*"([^"]*)"/gm)) {
      if (/^[a-z][\w+.-]*:\/\/[^/\s:@]+:[^/\s@]+@/i.test(m[1])) f.push(`${x}:${lineOf(t, m.index)} datasource url holds a password as a string literal (use env("...") instead)`)
    }
  }
  return finish('prisma-schema-basics', f, 'every Prisma model has an id and no datasource url holds a password (or there is no schema)')
}

// ---- HTTP calls with no timeout or signal: they can wait forever. Reported as a total, over the budget (api.maxUntimedCalls).
const HTTP_CALL = /(?<![\w.'"`])(fetch|axios(?:\.(?:get|post|put|patch|delete|request))?|requests\.(?:get|post|put|patch|delete|request|head))\s*\(/g
const httpTimeouts = (root) => {
  const allow = allowSet(root)
  const max = cfg(root).maxUntimedCalls ?? 10
  const f = []
  for (const x of files(root, CODE)) {
    if (TEST_FILE.test(x) || allowed(allow, 'http-timeouts', x)) continue
    const t = readText(root, x)
    for (const m of t.matchAll(HTTP_CALL)) {
      const args = groupOf(t, m.index + m[0].length - 1)
      if (!/\btimeout\b|\bsignal\b/i.test(args)) f.push(`${x}:${lineOf(t, m.index)} ${m[1]}() has no timeout or signal, so it can wait forever`)
    }
  }
  if (f.length <= max) return finish('http-timeouts', [], `${f.length} untimed HTTP call(s), within the budget of ${max}`)
  return finish('http-timeouts', f, `${f.length} untimed HTTP calls (budget api.maxUntimedCalls is ${max})`)
}

// ---- Servers with routes and no rate limiting anywhere in the project
const SERVER_APP = /\bexpress\(\s*\)|\bFastify\(|\bnew\s+Koa\(|\bFlask\(\s*__name__|\bFastAPI\(/
const ROUTE = /(?<![\w.])(?:app|router|server)\.(?:get|post|put|patch|delete|use)\s*\(|@(?:app|router)\.(?:get|post|put|patch|delete|route)\s*\(/
const RATE_LIMIT = /rate[-_]?limit|slowapi|limiter|throttl|slow-?down/i
const rateLimitPresent = (root) => {
  const allow = allowSet(root)
  const servers = files(root, CODE).filter((x) => !TEST_FILE.test(x) && !allowed(allow, 'rate-limit-present', x)).filter((x) => {
    const t = readText(root, x)
    return SERVER_APP.test(t) && ROUTE.test(t)
  })
  if (!servers.length) return finish('rate-limit-present', [], 'no HTTP server with routes, so nothing to rate limit')
  const mentioned = trackedFiles(root).some((x) => !SKIP.test(x) && /\.(m?[jt]sx?|cjs|py|json|ya?ml|toml|txt|md|cfg|ini|go|rb|php|java|cs|kt)$/i.test(x) && RATE_LIMIT.test(readText(root, x)))
  if (mentioned) return finish('rate-limit-present', [], `${servers.length} server file(s) and a rate limit is mentioned in the project`)
  return finish('rate-limit-present', servers.map((x) => `${x} starts an HTTP server with routes and no rate-limit library or middleware is mentioned anywhere`), '')
}

// ---- Error details sent to clients: stacks, messages and tracebacks in responses
// The Python patterns only run on .py files: a JavaScript file that quotes "app.run(debug=True)" as text is not a debug server.
const LEAK = [
  [/\b(?:res|response|reply)\s*(?:\.status\([^)\n]*\)\s*)?\.(?:send|json|render)\s*\([^\n]*\b(?:err|error|e|ex|exc|exception)\.(?:stack|message)\b/, 'sends the error stack or message to the client', false],
  [/\breturn\b[^\n]*\btraceback\.format_exc\s*\(/, 'returns a Python traceback to the client', true],
  [/\bjsonify\([^\n]*\btraceback\.format_exc\s*\(/, 'returns a Python traceback to the client', true],
  [/\bapp\.run\([^)\n]*\bdebug\s*=\s*True\b/, 'runs Flask in debug mode, which shows tracebacks in responses', true],
  [/\bapp\.config\[\s*['"]DEBUG['"]\s*\]\s*=\s*True\b/, 'turns on Flask DEBUG, which shows tracebacks in responses', true],
]
const errorLeak = (root) => {
  const allow = allowSet(root)
  const f = []
  for (const x of files(root, CODE)) {
    if (TEST_FILE.test(x) || allowed(allow, 'error-leak', x)) continue
    const py = /\.py$/i.test(x)
    readText(root, x).split('\n').forEach((line, i) => {
      for (const [re, why, pyOnly] of LEAK) if ((py || !pyOnly) && re.test(line)) f.push(`${x}:${i + 1} ${why}: ${snip(line)}`)
    })
  }
  return finish('error-leak', f, 'no handler sends error details to the client')
}

// ---- Page sizes read from the request with no upper bound in the next 10 lines (informational unless api.requirePaginationBounds)
const PAGE_READ = /\b(?:req|request|ctx)\.query\b[^\n]*\b(?:limit|pageSize|page_size|per_page)\b|\brequest\.args\b[^\n]*\b(?:limit|pageSize|page_size|per_page)\b/
const PAGE_BOUND = /Math\.min\(|\bmin\(|\bclamp\(|\bMAX_\w+|\bmax_?(?:limit|page|size|per)\w*|\bmaxPage\w*|\bmaxLimit\w*|\b(?:limit|pageSize|page_size|per_page)\s*>\s*(?:\d{2,}|[A-Z_]{3,})/i
const paginationBounds = (root) => {
  const allow = allowSet(root)
  const f = []
  for (const x of files(root, CODE)) {
    if (TEST_FILE.test(x) || allowed(allow, 'pagination-bounds', x)) continue
    const lines = readText(root, x).split('\n')
    lines.forEach((line, i) => {
      if (!PAGE_READ.test(line)) return
      if (!PAGE_BOUND.test(lines.slice(i, i + 11).join('\n'))) f.push(`${x}:${i + 1} reads a page size from the request with no upper bound within 10 lines`)
    })
  }
  return informational('pagination-bounds', f, cfg(root).requirePaginationBounds === true, 'requirePaginationBounds', 'every request-supplied page size has an upper bound (or there are none)')
}

const fx = (tree, fn) => ({ fixture: () => withFixture(tree, fn) })
const STRICT = { '.meerkat-budgets.json': '{"api":{"requireIndexes":true,"requirePaginationBounds":true}}' }
const untimed = Array.from({ length: 11 }, (_, i) => `export const c${i} = () => fetch('https://api.example.com/${i}')`).join('\n') + '\n'

main({
  'openapi-valid': { run: openapiValid, ...fx({ 'openapi.json': '{"openapi":"3.0.3","info":{"title":"Shop"},"paths":{"/items":{"get":{"operationId":"listItems"}}}}\n' }, openapiValid) },
  'openapi-operation-ids': { run: openapiOperationIds, ...fx({ 'openapi.json': '{"openapi":"3.0.3","info":{"title":"x","version":"1"},"paths":{"/a":{"get":{"operationId":"same","responses":{}}},"/b":{"get":{"operationId":"same","responses":{}}}}}\n' }, openapiOperationIds) },
  'openapi-security-defined': { run: openapiSecurity, ...fx({ 'openapi.json': '{"openapi":"3.0.3","info":{"title":"x","version":"1"},"servers":[{"url":"https://api.example.com"}],"security":[{"bearer":[]}],"paths":{}}\n' }, openapiSecurity) },
  'graphql-schema-basics': { run: graphqlBasics, ...fx({ 'schema.graphql': 'type Query {\n  items: [Item]\n\ntype Item {\n  id: ID!\n}\ntype Item {\n  name: String\n}\n' }, graphqlBasics) },
  'sql-migrations-order': { run: sqlMigrationOrder, ...fx({ 'migrations/001_init.sql': 'CREATE TABLE a (id INT);\n', 'migrations/001_more.sql': 'CREATE TABLE b (id INT);\n', 'migrations/004_later.sql': 'CREATE TABLE c (id INT);\n' }, sqlMigrationOrder) },
  'sql-destructive-migrations': { run: sqlDestructive, ...fx({ 'migrations/002_drop.sql': 'DROP TABLE users;\n' }, sqlDestructive) },
  'sql-missing-index-note': { run: sqlMissingIndex, ...fx({ ...STRICT, 'schema.sql': 'CREATE TABLE orders (\n  id INT PRIMARY KEY,\n  user_id INT NOT NULL\n);\n' }, sqlMissingIndex) },
  'prisma-schema-basics': { run: prismaBasics, ...fx({ 'prisma/schema.prisma': 'datasource db {\n  provider = "postgresql"\n  url = "postgresql://app:password@localhost:5432/app"\n}\n\nmodel User {\n  email String\n}\n' }, prismaBasics) },
  'http-timeouts': { run: httpTimeouts, ...fx({ 'client.js': untimed }, httpTimeouts) },
  'rate-limit-present': { run: rateLimitPresent, ...fx({ 'server.js': "const app = express()\napp.get('/items', (req, res) => res.json([]))\n" }, rateLimitPresent) },
  'error-leak': { run: errorLeak, ...fx({ 'app.js': "app.post('/x', (req, res) => {\n  res.status(500).send(err.stack)\n})\n" }, errorLeak) },
  'pagination-bounds': { run: paginationBounds, ...fx({ ...STRICT, 'routes.js': "app.get('/items', (req, res) => {\n  const limit = req.query.limit\n  res.json(db.find().limit(limit))\n})\n" }, paginationBounds) },
})

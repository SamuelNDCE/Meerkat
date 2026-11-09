// Rules that can propose an exact, safe replacement for one finding. A rule is keyed by the check id and receives
// { line, text }: the source line the finding points at and the whole file. It returns { to } (the whole replacement line)
// or { reason } (why there is no safe automatic fix). It never guesses: anything unusual is a reason, not a patch.

const PATH_AT = /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*|\[\d+\])*/
const PATH_ALL = new RegExp(`${PATH_AT.source}$`)
// A value can follow one of these (an operator or a keyword that takes a value). A table or column name cannot be bound as a value.
const VALUE_POSITION = /(?:=|<|>|!=|<>|\(|,|\blike|\blimit|\boffset|\bvalues|\bin|\bbetween|\band|\bor)\s*$/i

// The driver's placeholder style, read from the file itself. Unknown means no fix: a wrong placeholder would break the query.
function placeholderStyle(file) {
  if (/(?:require\(\s*['"]|from\s+['"])(?:pg|postgres|@neondatabase\/serverless|@vercel\/postgres)['"]/.test(file)) return 'dollar'
  if (/(?:require\(\s*['"]|from\s+['"])(?:mysql2?|mysql2\/promise|sqlite3|better-sqlite3)['"]/.test(file)) return 'question'
  return null
}

// The text between the opening quote at `i` and its matching close: { q, body, end } or null.
function readLiteral(s, i) {
  const q = s[i]
  for (let j = i + 1; j < s.length; j++) {
    if (s[j] === '\\') {
      j++
      continue
    }
    if (s[j] === q) return { q, body: s.slice(i + 1, j), end: j + 1 }
  }
  return null
}

// The index of the ")" that closes the "(" at `open`, skipping strings; -1 when it does not close on this line.
function closeParen(s, open) {
  let depth = 0
  for (let i = open; i < s.length; i++) {
    const c = s[i]
    if (c === '"' || c === "'" || c === '`') {
      const lit = readLiteral(s, i)
      if (!lit) return -1
      i = lit.end - 1
    } else if (c === '(') depth++
    else if (c === ')' && --depth === 0) return i
  }
  return -1
}

// pieces[k] is text, then values[k], then pieces[k+1] ... (one more piece than values). Returns { sql, params } or { reason }.
function build(q, pieces, values, style) {
  let sql = pieces[0]
  const params = []
  for (const [k, v] of values.entries()) {
    let before = sql
    let after = pieces[k + 1]
    const quoted = before.endsWith("'") && after.startsWith("'") && !before.endsWith("\\'")
    if (quoted) {
      if (q === "'") return { reason: 'the value sits inside escaped single quotes; rewrite the query by hand' }
      before = before.slice(0, -1)
      after = after.slice(1)
    } else if (/['"`]$/.test(before) || /^['"`]/.test(after)) return { reason: 'the value is only half inside quotes, so the intent is unclear' }
    if (!VALUE_POSITION.test(before)) return { reason: `the value follows "${before.trim().slice(-20)}", which is not a place a bound value can go (a table or column name cannot be a parameter)` }
    params.push(v)
    sql = before + (style === 'dollar' ? `$${params.length}` : '?') + after
  }
  return { sql, params }
}

// A template literal: `text ${a.b} text`.
function splitTemplate(arg) {
  const lit = readLiteral(arg, 0)
  if (!lit || lit.end !== arg.length) return { reason: 'the call has more arguments than the statement; it may already carry parameters' }
  const pieces = []
  const values = []
  let cur = ''
  const body = lit.body
  for (let i = 0; i < body.length; i++) {
    if (body[i] === '$' && body[i + 1] === '{') {
      const e = body.indexOf('}', i)
      if (e < 0) return { reason: 'a ${ } in the template does not close' }
      const expr = body.slice(i + 2, e).trim()
      if (!PATH_ALL.test(expr)) return { reason: `the value "${expr.slice(0, 40)}" is not a plain variable, so its meaning cannot be checked` }
      pieces.push(cur)
      values.push(expr)
      cur = ''
      i = e
    } else cur += body[i]
  }
  pieces.push(cur)
  return { q: '`', pieces, values }
}

// "text" + value + "more text": quoted pieces joined by +, with plain variables between them.
function splitConcat(arg) {
  const pieces = []
  const values = []
  let q = null
  let cur = ''
  let i = 0
  let prev = 'start' // what was just read: 'start', 'text' or 'value'
  const skip = () => {
    while (arg[i] === ' ') i++
  }
  for (;;) {
    skip()
    if (i >= arg.length) break
    if (prev !== 'start') {
      if (arg[i] !== '+') return { reason: 'the call has more arguments than the statement; it may already carry parameters' }
      i++
      skip()
    }
    if (/['"]/.test(arg[i] ?? '')) {
      const lit = readLiteral(arg, i)
      if (!lit) return { reason: 'a string in the statement does not close on this line' }
      if (q && lit.q !== q) return { reason: 'the statement mixes quote styles, so the text cannot be joined exactly' }
      q = lit.q
      cur += lit.body
      i = lit.end
      prev = 'text'
    } else {
      const m = PATH_AT.exec(arg.slice(i))
      if (!m) return { reason: 'the statement mixes text with an expression that is not a plain variable' }
      if (prev === 'value') return { reason: 'two values are joined with no text between them' }
      pieces.push(cur)
      values.push(m[0])
      cur = ''
      i += m[0].length
      prev = 'value'
    }
  }
  pieces.push(cur)
  if (!q) return { reason: 'there is no text in the statement' }
  return { q, pieces, values }
}

function sqlConcat({ line, text }) {
  const style = placeholderStyle(text)
  if (!style) return { reason: 'the database driver is not pg, mysql or sqlite in this file, so the placeholder style (? or $1) cannot be known' }
  const call = /\b[\w.]+\.(?:query|execute|all|get|run)\s*\(/.exec(line)
  if (!call) return { reason: 'the statement is not a single db.query(...) style call on one line' }
  const open = call.index + call[0].length - 1
  const close = closeParen(line, open)
  if (close < 0) return { reason: 'the call does not close on the same line' }
  const arg = line.slice(open + 1, close).trim()
  const parts = arg.startsWith('`') ? splitTemplate(arg) : splitConcat(arg)
  if (parts.reason) return parts
  if (!parts.values.length) return { reason: 'the statement has no joined value to turn into a parameter' }
  const b = build(parts.q, parts.pieces, parts.values, style)
  if (b.reason) return b
  return { to: `${line.slice(0, open + 1)}${parts.q}${b.sql}${parts.q}, [${b.params.join(', ')}]${line.slice(close)}` }
}

// Keyed by check id.
export const FIX_RULES = { 'sql-concat': sqlConcat }

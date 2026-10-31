// Mutation testing and a static test-quality proxy. Run through the mutation pack, or by hand:
//   (diff mode is on by default when a git base exists: --diff [ref], --no-diff; also --parallel N, --fail-fast, --no-coverage, --no-scope)
//   node thorough/mutation.mjs mutation-testing [--root <dir>] [--max-mutants N] [--total-seconds N] [--timeout N] [--min-score N] [--seed N] [--files a,b] [--test-command '["npm","test"]']
//   node thorough/mutation.mjs test-quality-static [--root <dir>]
//   node thorough/mutation.mjs <check> --fixtures      (must exit 1)
// mutation-testing changes the project's code in small ways, in a TEMPORARY COPY, and checks that the project's own tests notice.
// It never edits the project. See docs/mutation.md. Settings: "mutation" in .meerkat-budgets.json.
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, rmdirSync, statSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { cpus, tmpdir } from 'node:os'
import { basename, dirname, extname, join, relative, resolve } from 'node:path'
import { globToRegExp } from '../lib/glob.mjs'
import { NOT_RUN, finish, isFixture, main, notRun, progress, readBudgets, readText, trackedFiles, withFixture } from './kit.mjs'
import { evaluate, readAllow, selfProve } from './rules.mjs'
import { formatFindingLine } from '../lib/findings.mjs'
import { appendHistory, buildImportGraph, buildResults, cargoCrateOf, changedLines, deadLines, enclosingFunction, equivalentReason, historyHome, lineChanged, lineUncovered, loadCoverage, parseFailingTest, readHistory, resolveBase, slugOf, suggestionFor, summaryMarkdown, testsReaching, trendLine, writeResults } from './mutation-support.mjs'

// ============================================================ small helpers
// Everything printed goes through clean(): control characters (including ESC) become spaces.
export const clean = (s) => String(s ?? '').replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
export const scoreOf = (killed, survived) => (killed + survived === 0 ? null : Math.round((1000 * killed) / (killed + survived)) / 10)

// A small seeded PRNG (mulberry32), so a run with the same seed picks the same mutants.
export function prng(seed) {
  let a = (Number(seed) || 1) >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const LANG_BY_EXT = { js: 'js', mjs: 'js', cjs: 'js', jsx: 'js', ts: 'js', tsx: 'js', mts: 'js', cts: 'js', py: 'py', go: 'go', rs: 'rs', java: 'java', cs: 'cs' }
export const langOf = (file) => LANG_BY_EXT[extname(file).slice(1).toLowerCase()] ?? null

// Replaces comments and the insides of strings with spaces, keeping every column where it was, so a mutator never mutates text that is not code.
export function maskLines(lines, lang) {
  const hash = lang === 'py'
  const out = []
  let block = false
  let tpl = false
  let triple = null
  for (const line of lines) {
    let res = ''
    let i = 0
    const n = line.length
    while (i < n) {
      const c = line[i]
      const d = line[i + 1]
      if (block) {
        if (c === '*' && d === '/') {
          res += '  '
          i += 2
          block = false
        } else {
          res += ' '
          i++
        }
        continue
      }
      if (triple) {
        if (line.startsWith(triple, i)) {
          res += triple
          i += 3
          triple = null
        } else {
          res += ' '
          i++
        }
        continue
      }
      if (tpl) {
        if (c === '\\') {
          res += '  '
          i += 2
        } else if (c === '`') {
          res += '`'
          i++
          tpl = false
        } else {
          res += ' '
          i++
        }
        continue
      }
      if (hash && c === '#') {
        res += ' '.repeat(n - i)
        break
      }
      if (!hash && c === '/' && d === '/') {
        res += ' '.repeat(n - i)
        break
      }
      if (!hash && c === '/' && d === '*') {
        res += '  '
        i += 2
        block = true
        continue
      }
      if (hash && (line.startsWith('"""', i) || line.startsWith("'''", i))) {
        triple = line.slice(i, i + 3)
        res += triple
        i += 3
        continue
      }
      if (lang === 'js' && c === '`') {
        res += '`'
        i++
        tpl = true
        continue
      }
      if ((lang === 'rs' || lang === 'go') && c === "'") {
        const m = /^'(\\.[^']*|[^\\'])'/.exec(line.slice(i))
        if (m) {
          res += "'" + ' '.repeat(m[0].length - 2) + "'"
          i += m[0].length
        } else {
          res += c
          i++
        }
        continue
      }
      if (c === '"' || c === "'") {
        let j = i + 1
        while (j < n && line[j] !== c) j += line[j] === '\\' ? 2 : 1
        const end = Math.min(j, n - 1)
        res += c + ' '.repeat(Math.max(0, end - i - 1)) + (j < n ? c : '')
        i = j < n ? j + 1 : n
        continue
      }
      if (lang === 'js' && c === '/') {
        const prev = res.trimEnd().slice(-1)
        if (prev === '' || '(,=:[!&|?{};'.includes(prev)) {
          let j = i + 1
          let cls = false
          while (j < n && (cls || line[j] !== '/')) {
            if (line[j] === '\\') j++
            else if (line[j] === '[') cls = true
            else if (line[j] === ']') cls = false
            j++
          }
          if (j < n) {
            res += '/' + ' '.repeat(j - i - 1) + '/'
            i = j + 1
            continue
          }
        }
      }
      res += c
      i++
    }
    out.push(res)
  }
  return out
}

// Index of the bracket that closes the one at `open`, or -1.
export function matchClose(s, open) {
  const pairs = { '(': ')', '[': ']', '{': '}' }
  const stack = []
  for (let i = open; i < s.length; i++) {
    const c = s[i]
    if (pairs[c]) stack.push(pairs[c])
    else if (c === ')' || c === ']' || c === '}') {
      if (stack.pop() !== c) return -1
      if (!stack.length) return i
    }
  }
  return -1
}
const balanced = (s) => {
  let d = 0
  for (const c of s) {
    if ('([{'.includes(c)) d++
    else if (')]}'.includes(c)) d--
    if (d < 0) return false
  }
  return d === 0
}
const scan = (s, re, fn) => {
  const out = []
  re.lastIndex = 0
  let m
  while ((m = re.exec(s))) {
    const r = fn(m)
    if (r) out.push(r)
    if (m[0] === '') re.lastIndex++
  }
  return out
}

// ============================================================ the mutators
// { id, family, title, langs, find(maskedLine, lang) -> [{col, from, to}], bad, good [, lang] }
// `find` reads a line whose comments and string contents are blanked out. `bad` must produce a site, `good` must not.
const ALL = ['js', 'py', 'go', 'rs', 'java', 'cs']
const NOPY = ['js', 'go', 'rs', 'java', 'cs']
const spaced = (id, family, title, re, to, bad, good, langs = ALL) => ({
  id,
  family,
  title,
  langs,
  bad,
  good,
  find: (s) => scan(s, re, (m) => ({ col: m.index, from: m[0], to: typeof to === 'function' ? to(m[0]) : to })),
})
const ifCondition = (s, lang) => {
  if (lang === 'py') {
    const m = /^(\s*(?:el)?if\s+)(.+?):\s*$/.exec(s)
    return m ? { col: m[1].length, len: m[2].length } : null
  }
  const p = /^(\s*(?:\}\s*)?(?:else\s+)?if\s*)\(/.exec(s)
  if (p && lang !== 'go' && lang !== 'rs') {
    const open = p[1].length
    const close = matchClose(s, open)
    return close > open + 1 ? { col: open + 1, len: close - open - 1 } : null
  }
  if (lang === 'go' || lang === 'rs') {
    const m = /^(\s*(?:\}\s*)?(?:else\s+)?if\s+)(?!let\b)(.+?)\s*\{\s*$/.exec(s)
    return m ? { col: m[1].length, len: m[2].length } : null
  }
  return null
}
const condMutator = (value) => ({
  id: `conditional-${value}`,
  family: 'conditional',
  title: `an if condition is replaced by ${value}`,
  langs: ALL,
  bad: 'if (a > b) {',
  good: `if (${value}) {`,
  find: (s, lang = 'js') => {
    const c = ifCondition(s, lang)
    if (!c) return []
    const cond = s.slice(c.col, c.col + c.len).trim()
    if (!cond || /^(true|false|True|False)$/.test(cond)) return []
    const t = lang === 'py' ? (value === 'true' ? 'True' : 'False') : value
    return [{ col: c.col, from: s.slice(c.col, c.col + c.len), to: t }]
  },
})
const NULLISH = { py: 'None', js: 'undefined', java: 'null', cs: 'null' }
const NOT_STATEMENT = /^(if|for|while|switch|return|throw|catch|function|typeof|new|super|this|import|require|print|println|printf|console|log|logger|assert|expect|delete|del|yield|else|elif|with|def|class|raise|await)$/

const ARG_SKIP = /^(if|for|while|switch|catch|function|return|typeof|with|elif|print|assert|expect|def|fn|func|and|or|not|in|is|await|yield|throw|new|super|this)$/

export const MUTATORS = [
  spaced('arith-plus-minus', 'arithmetic', '+ becomes -', /(?<= )\+(?= )/g, '-', 'const c = a + b', 'const c = a'),
  spaced('arith-times-divide', 'arithmetic', '* becomes /', /(?<= )\*(?= )/g, '/', 'const c = a * b', 'const c = a'),
  spaced('arith-modulo-times', 'arithmetic', '% becomes *', /(?<= )%(?= )/g, '*', 'const c = a % b', 'const c = a'),
  spaced('arith-minus-plus', 'arithmetic', '- becomes +', /(?<= )-(?= )/g, '+', 'const c = a - b', 'const c = a'),
  spaced('boundary-less', 'comparison', '< and <= swap', /(?<= )<=?(?= )/g, (f) => (f === '<' ? '<=' : '<'), 'if (a < b) {', 'if (a) {'),
  spaced('boundary-greater', 'comparison', '> and >= swap', /(?<= )>=?(?= )/g, (f) => (f === '>' ? '>=' : '>'), 'if (a >= b) {', 'const f = (a) => a'),
  spaced('equality-flip', 'comparison', '== and != swap', /(?<= )(===|!==|==|!=)(?= )/g, (f) => ({ '===': '!==', '!==': '===', '==': '!=', '!=': '==' })[f], 'return a === b', 'const a = b'),
  spaced('logical-and-or', 'logical', '&& becomes ||', /(?<= )(&&|and)(?= )/g, (f) => (f === 'and' ? 'or' : '||'), 'if (a && b) {', 'if (a) {'),
  spaced('logical-or-and', 'logical', '|| becomes &&', /(?<= )(\|\||or)(?= )/g, (f) => (f === 'or' ? 'and' : '&&'), 'const c = a || b', 'const c = a'),
  {
    id: 'logical-not-removed',
    family: 'logical',
    title: 'a negation is removed',
    langs: ALL,
    bad: 'if (!ready) {',
    good: 'if (a !== b) {',
    find: (s) => [...scan(s, /(?<![\w)\]!])!(?=[\w(])/g, (m) => ({ col: m.index, from: '!', to: '' })), ...scan(s, /(?<![\w.])not(?= )/g, (m) => ({ col: m.index, from: 'not', to: '' }))],
  },
  spaced('literal-boolean', 'literal', 'true and false swap', /(?<![\w.$])(true|false|True|False)(?![\w$])/g, (f) => ({ true: 'false', false: 'true', True: 'False', False: 'True' })[f], 'const ok = true', 'const ok = yes'),
  spaced('literal-zero-one', 'literal', '0 becomes 1', /(?<![\w.$'"])0(?![\w.])/g, '1', 'let n = 0', 'let n = 5'),
  {
    id: 'literal-empty-string',
    family: 'literal',
    title: 'an empty string becomes "x"',
    langs: ALL,
    bad: "const s = ''",
    good: "const s = 'a'",
    find: (s) => scan(s, /(?<![\w'"`])(''|"")(?!['"])/g, (m) => ({ col: m.index, from: m[0], to: `${m[0][0]}x${m[0][0]}` })),
  },
  {
    id: 'literal-array-emptied',
    family: 'literal',
    title: 'a non-empty array literal becomes empty',
    langs: ['js', 'py'],
    bad: 'const xs = [1, 2, 3]',
    good: 'const xs = []',
    find: (s) => scan(s, /(?<=[=:]\s|return\s)(\[[^[\]\n]*\S[^[\]\n]*\])(?=\s*[;,]?\s*$)/g, (m) => ({ col: m.index, from: m[1], to: '[]' })),
  },
  condMutator('true'),
  condMutator('false'),
  {
    id: 'return-nulled',
    family: 'return',
    title: 'a returned value becomes null, None or undefined',
    langs: ['js', 'py', 'java', 'cs'],
    bad: 'return total + 1;',
    good: 'return null;',
    find: (s, lang = 'js') => {
      const m = /^(\s*return\s+)([^;]+?)\s*;?\s*$/.exec(s)
      if (!m || !balanced(m[2]) || /^(null|undefined|None|true|false|True|False|nil)$/.test(m[2])) return []
      return [{ col: m[1].length, from: m[2], to: NULLISH[lang] ?? 'null' }]
    },
  },
  {
    id: 'statement-removed',
    family: 'statement',
    title: 'a standalone call statement is removed',
    langs: ['js', 'py', 'java', 'cs', 'rs'],
    bad: '  save(items);',
    good: '  const x = save(items);',
    find: (s, lang = 'js') => {
      const py = lang === 'py'
      const m = py ? /^(\s*)([A-Za-z_][\w.]*\(.*\))\s*$/.exec(s) : /^(\s*)((?:await\s+)?[A-Za-z_$][\w$.]*(?:\?\.)?\(.*\))\s*;\s*$/.exec(s)
      if (!m || !balanced(m[2])) return []
      const head = m[2].replace(/^await\s+/, '').split('(')[0]
      if (NOT_STATEMENT.test(head.split('.')[0]) || /(^|\.)(log|info|warn|error|debug|trace|print)$/.test(head)) return []
      return [{ col: m[1].length, from: py ? m[2] : `${m[2]};`, to: py ? 'pass' : ';' }]
    },
  },
  {
    id: 'increment-flip',
    family: 'increment',
    title: '++ and -- swap',
    langs: ['js', 'go', 'java', 'cs'],
    bad: 'i++',
    good: 'i += 1',
    find: (s) => [...scan(s, /(?<!\+)\+\+(?!\+)/g, (m) => ({ col: m.index, from: '++', to: '--' })), ...scan(s, /(?<!-)--(?![->])/g, (m) => ({ col: m.index, from: '--', to: '++' }))],
  },
  {
    id: 'string-method-swap',
    family: 'string-method',
    title: 'startsWith and endsWith swap',
    langs: ['js', 'py', 'java', 'cs'],
    bad: 'if (name.startsWith(prefix)) {',
    good: 'if (name.includes(prefix)) {',
    find: (s) => scan(s, /\.(startsWith|endsWith|startswith|endswith)\(/g,(m) => ({ col: m.index + 1, from: m[1], to: /^starts/i.test(m[1]) ? m[1].replace(/^starts/i, (x) => (x[0] === 'S' ? 'Ends' : 'ends')) : m[1].replace(/^ends/i, (x) => (x[0] === 'E' ? 'Starts' : 'starts')) })),
  },
  {
    id: 'args-swap',
    family: 'argument',
    title: 'two simple arguments of a call swap places',
    langs: ALL,
    bad: 'const r = pow(base, exp)',
    good: 'const r = pow(base, 2)',
    find: (s) =>
      scan(s, /(?<![\w$.])([A-Za-z_$][\w$]*)\(\s*([A-Za-z_$][\w$]*)\s*,\s*([A-Za-z_$][\w$]*)\s*\)/g, (m) => {
        if (m[2] === m[3] || ARG_SKIP.test(m[1])) return null
        if (/\b(function|def|fn|func|class|interface|new|void|int|string|bool|public|private)\s+$/.test(s.slice(0, m.index))) return null
        if (/^\s*(\{|:\s*$|=>|:\s*[\w<>[\]|. ]+\s*\{)/.test(s.slice(m.index + m[0].length))) return null
        const inner = m[0].slice(m[1].length + 1, -1)
        const lead = inner.length - inner.trimStart().length
        const t = inner.trim()
        const sep = t.slice(m[2].length, t.length - m[3].length)
        return { col: m.index + m[1].length + 1 + lead, from: t, to: `${m[3]}${sep}${m[2]}` }
      }),
  },
  {
    id: 'await-removed',
    family: 'async',
    title: 'an await is removed',
    langs: ['js'],
    bad: 'const x = await load()',
    good: 'const x = load()',
    find: (s) => scan(s, /(?<![\w$.])(?<!\bfor\s)await\s+(?=[\w$(])/g, (m) => ({ col: m.index, from: m[0], to: '' })),
  },
  {
    id: 'return-guard-removed',
    family: 'control',
    title: 'the return of a one-line guard (if (x) return y) is removed',
    langs: ['js', 'py', 'java', 'cs'],
    bad: 'if (!ok) return null;',
    good: 'return null;',
    find: (s, lang = 'js') => {
      if (lang === 'py') {
        const p = /^(\s*(?:el)?if\s+.+?:\s*)(return\b.*)$/.exec(s)
        return p ? [{ col: p[1].length, from: p[2], to: 'pass' }] : []
      }
      const m = /^(\s*(?:\}\s*)?(?:else\s+)?if\s*\(.*\)\s*)(return\b[^;{}]*;)\s*$/.exec(s)
      return m && balanced(m[2]) ? [{ col: m[1].length, from: m[2], to: ';' }] : []
    },
  },
  {
    id: 'index-shift',
    family: 'index',
    title: 'an index [i] becomes [i + 1] or [i - 1]',
    langs: ALL,
    bad: 'const v = items[i];',
    good: 'const v = items[0];',
    find: (s) => {
      if (/^\s*(export\s+)?(type|interface)\b/.test(s)) return []
      const out = []
      for (const m of s.matchAll(/(?<=[\w)\]])\[([a-z_$][\w$]*)\]/g)) out.push({ col: m.index + 1, from: m[1], to: `${m[1]} + 1` }, { col: m.index + 1, from: m[1], to: `${m[1]} - 1` })
      return out
    },
  },
  {
    id: 'numeric-negated',
    family: 'literal',
    title: 'a number assigned, returned or passed becomes negative',
    langs: ALL,
    bad: 'const limit = 100;',
    good: 'const limit = -100;',
    find: (s) => scan(s, /(?<=(?:=|\breturn|,|\()\s*)(?:[1-9]\d*(?:\.\d+)?|0\.\d+)(?![\w.])/g, (m) => ({ col: m.index, from: m[0], to: `-${m[0]}` })),
  },
  {
    id: 'minmax-swap',
    family: 'argument',
    title: 'min and max swap',
    langs: ALL,
    bad: 'const m = Math.min(a, b);',
    good: 'const m = Math.abs(a);',
    find: (s, lang = 'js') => {
      const flip = (w) => ({ min: 'max', max: 'min', Min: 'Max', Max: 'Min' })[w]
      const res = lang === 'py' ? [/(?<![\w.])(min|max)(?=\()/g] : lang === 'rs' ? [/\.(min|max)(?=\()/g] : lang === 'go' ? [/\bmath\.(Min|Max)(?=\()/g] : [/\bMath\.(min|max|Min|Max)(?=\()/g]
      return res.flatMap((re) => scan(s, re, (m) => ({ col: m.index + m[0].length - m[1].length, from: m[1], to: flip(m[1]) })))
    },
  },
  {
    id: 'collection-contains-negated',
    family: 'string-method',
    title: 'a .includes(x) test is negated',
    langs: ['js', 'java', 'cs'],
    bad: 'if (list.includes(item)) {',
    good: 'if (list.has(item)) {',
    find: (s, lang = 'js', raw = s) => {
      const name = lang === 'java' ? 'contains' : lang === 'cs' ? 'Contains' : 'includes'
      return scan(s, new RegExp(`(?<![\\w$.])([A-Za-z_$][\\w$.]*)\\.${name}\\(`, 'g'), (m) => {
        if (s[m.index - 1] === '!') return null
        const close = matchClose(s, m.index + m[0].length - 1)
        if (close < 0) return null
        const from = raw.slice(m.index, close + 1)
        return { col: m.index, from, to: `!${from}` }
      })
    },
  },
  spaced('compare-reversed', 'comparison', 'a comparison is reversed (< becomes >, <= becomes >=, and back)', /(?<= )(<=|>=|<|>)(?= )/g, (f) => ({ '<': '>', '>': '<', '<=': '>=', '>=': '<=' })[f], 'if (a > b) {', 'if (a) {'),
  spaced('assign-logical-flip', 'assign', '&&=, ||= and ??= change', /(?<= )(&&=|\|\|=|\?\?=)(?= )/g, (f) => ({ '&&=': '||=', '||=': '&&=', '??=': '||=' })[f], 'x ||= 5', 'x = 5', ['js']),
  {
    id: 'default-param-changed',
    family: 'default',
    title: 'a default parameter value changes (a number plus one, a flag flipped)',
    langs: ['js', 'py'],
    bad: 'function page(size = 10) {',
    good: 'function page(size) {',
    find: (s, lang = 'js') => {
      const flip = (v) => (/^\d/.test(v) ? String(Number(v) + 1) : { true: 'false', false: 'true', True: 'False', False: 'True' }[v])
      const inParams = (params, off) => scan(params, /([\w$]+(?:\s*:\s*[\w.[\]|<> ]+?)?\s*=\s*)(\d+|true|false|True|False)(?![\w.])/g, (m) => ({ col: off + m.index + m[1].length, from: m[2], to: flip(m[2]) }))
      const out = []
      if (lang === 'py') {
        const h = /^\s*(?:async\s+)?def\s+\w+\s*\(/.exec(s)
        if (h) {
          const open = h[0].length - 1
          const close = matchClose(s, open)
          if (close > open) out.push(...inParams(s.slice(open + 1, close), open + 1))
        }
        return out
      }
      for (const m of s.matchAll(/\bfunction\s*\*?\s*[\w$]*\s*\(/g)) {
        const open = m.index + m[0].length - 1
        const close = matchClose(s, open)
        if (close > open) out.push(...inParams(s.slice(open + 1, close), open + 1))
      }
      for (const m of s.matchAll(/\(([^()]*)\)\s*(?::[^=]*)?=>/g)) out.push(...inParams(m[1], m.index + 1))
      return out
    },
  },
  {
    id: 'optional-chain-removed',
    family: 'null-safety',
    title: 'a ?. becomes .',
    langs: ['js', 'cs'],
    bad: 'const n = user?.name;',
    good: 'const n = user.name;',
    find: (s) => scan(s, /\?\.(?=[A-Za-z_$])/g, (m) => ({ col: m.index, from: '?.', to: '.' })),
  },
  spaced('nullish-to-or', 'null-safety', '?? becomes ||', /(?<= )\?\?(?= )/g, '||', 'const n = a ?? b;', 'const n = a || b;', ['js']),
  {
    id: 'loop-control-swap',
    family: 'control',
    title: 'break and continue swap',
    langs: ['js', 'go', 'java', 'cs', 'rs', 'py'],
    bad: 'if (done) break;',
    good: 'const breaker = 1;',
    find: (s) => scan(s, /(?<![\w$.-])(break|continue)(?![\w$-])/g, (m) => ({ col: m.index, from: m[1], to: m[1] === 'break' ? 'continue' : 'break' })),
  },
  {
    id: 'loop-bound-shrunk',
    family: 'control',
    title: 'a for loop bound n becomes n - 1',
    langs: ['js', 'java', 'cs', 'go'],
    bad: 'for (let i = 0; i < n; i++) {',
    good: 'for (const x of xs) {',
    find: (s) => scan(s, /\bfor\b[^;{]*;\s*[\w$]+\s*<\s*([A-Za-z_$][\w$.]*)(?=\s*;)/g, (m) => ({ col: m.index + m[0].length - m[1].length, from: m[1], to: `${m[1]} - 1` })),
  },
  {
    id: 'literal-string-emptied',
    family: 'literal',
    title: 'a non-empty string assigned or returned becomes empty',
    langs: ALL,
    bad: "const label = 'ready';",
    good: "const label = '';",
    find: (s, lang, raw = '') =>
      scan(s, /(?<=(?:=|\breturn)\s*)(['"])( +)\1/g, (m) => {
        const r = raw.slice(m.index, m.index + m[0].length)
        if (r.length !== m[0].length || r.slice(1, -1).trim() === '') return null
        return { col: m.index, from: r, to: `${m[1]}${m[1]}` }
      }),
  },
  {
    id: 'else-removed',
    family: 'control',
    title: 'a one-line else branch is emptied',
    langs: ['js', 'java', 'cs', 'rs', 'go'],
    bad: 'if (a) { x = 1 } else { x = 2 }',
    good: 'if (a) { x = 1 }',
    find: (s) =>
      scan(s, /\belse\s+(?!if\b)(\{[^{}]*\}|[^;{}]+;)/g, (m) => (m[1] === '{}' ? null : { col: m.index + m[0].length - m[1].length, from: m[1], to: m[1].startsWith('{') ? '{}' : ';' })),
  },
  {
    id: 'py-is-flip',
    family: 'python',
    title: 'is and is not swap',
    langs: ['py'],
    lang: 'py',
    bad: 'if x is None:',
    good: 'if x == None:',
    find: (s) => scan(s, /(?<= )is(?: not)?(?= )/g, (m) => ({ col: m.index, from: m[0], to: m[0] === 'is' ? 'is not' : 'is' })),
  },
  {
    id: 'py-in-flip',
    family: 'python',
    title: 'in and not in swap',
    langs: ['py'],
    lang: 'py',
    bad: 'if key in cache:',
    good: 'for key in cache:',
    find: (s) => (/\bfor\b/.test(s) ? [] : scan(s, /(?<= )(?:not in|in)(?= )/g, (m) => ({ col: m.index, from: m[0], to: m[0] === 'in' ? 'not in' : 'in' }))),
  },
  {
    id: 'py-range-extended',
    family: 'python',
    title: 'range(n) becomes range(n + 1)',
    langs: ['py'],
    lang: 'py',
    bad: 'for i in range(n):',
    good: 'for i in range(1, n):',
    find: (s, lang, raw = s) => {
      const out = []
      for (const m of s.matchAll(/(?<![\w.])range\(/g)) {
        const open = m.index + m[0].length - 1
        const close = matchClose(s, open)
        if (close < 0) continue
        const inner = raw.slice(open + 1, close)
        if (inner.includes(',') || !inner.trim()) continue
        out.push({ col: open + 1 + (inner.length - inner.trimStart().length), from: inner.trim(), to: `${inner.trim()} + 1` })
      }
      return out
    },
  },
  {
    id: 'py-return-keyword-removed',
    family: 'python',
    title: 'the return keyword is removed, so the function gives back None',
    langs: ['py'],
    lang: 'py',
    bad: '    return a + b',
    good: '    a + b',
    find: (s) => {
      const m = /^(\s*)return (?=\S)/.exec(s)
      return m ? [{ col: m[1].length, from: 'return ', to: '' }] : []
    },
  },
  {
    id: 'go-err-flip',
    family: 'null-safety',
    title: 'err != nil and err == nil swap',
    langs: ['go'],
    lang: 'go',
    bad: 'if err != nil {',
    good: 'if err == x {',
    find: (s) => scan(s, /\berr (!=|==) nil\b/g, (m) => ({ col: m.index + 4, from: m[1], to: m[1] === '!=' ? '==' : '!=' })),
  },
  {
    id: 'plusone-removed',
    family: 'arithmetic',
    title: 'a + 1 or - 1 is dropped',
    langs: ALL,
    bad: 'let n = len + 1;',
    good: 'let n = len + 2;',
    find: (s) => scan(s, /(?<= )[+-] 1(?![\w.])/g, (m) => ({ col: m.index, from: m[0], to: '' })),
  },
  {
    id: 'rs-some-none',
    family: 'null-safety',
    title: 'a returned Some(x) becomes None',
    langs: ['rs'],
    lang: 'rs',
    bad: '    Some(value)',
    good: '    None',
    find: (s) => {
      const m = /^(\s*(?:return\s+)?)Some\(/.exec(s)
      if (!m) return []
      const close = matchClose(s, m[0].length - 1)
      return close > 0 && /^\s*[;,]?\s*$/.test(s.slice(close + 1)) ? [{ col: m[1].length, from: s.slice(m[1].length, close + 1), to: 'None' }] : []
    },
  },
  {
    id: 'rs-try-removed',
    family: 'null-safety',
    title: 'a ? that passes an error up is removed',
    langs: ['rs'],
    lang: 'rs',
    bad: 'let v = parse(s)?;',
    good: 'let v = parse(s);',
    find: (s) => scan(s, /(?<=[\w)\]>])\?(?=\s*[;).,\]]|\s*$)/g, (m) => ({ col: m.index, from: '?', to: '' })),
  },
  {
    id: 'conditional-negated',
    family: 'conditional',
    title: 'an if condition is negated',
    langs: ALL,
    bad: 'if (a > b) {',
    good: 'if (!(a > b)) {',
    find: (s, lang = 'js', raw = s) => {
      const c = ifCondition(s, lang)
      if (!c) return []
      const cond = raw.slice(c.col, c.col + c.len)
      const t = cond.trim()
      if (!t || /^(true|false|True|False)$/.test(t) || /^!\(.*\)$/.test(t) || /^not\b/.test(t)) return []
      return [{ col: c.col, from: cond, to: lang === 'py' ? `not (${t})` : `!(${t})` }]
    },
  },
]

// The Go error check goes before the generic equality flip, so a duplicate site keeps the more specific name.
{
  const i = MUTATORS.findIndex((m) => m.id === 'go-err-flip')
  const j = MUTATORS.findIndex((m) => m.id === 'equality-flip')
  MUTATORS.splice(j, 0, ...MUTATORS.splice(i, 1))
}

export const FAMILIES = ['arithmetic', 'comparison', 'logical', 'literal', 'conditional', 'return', 'statement', 'increment', 'string-method', 'argument', 'async', 'control', 'index', 'null-safety', 'default', 'assign', 'python']

const SKIP_LINE = /^\s*(import\b|export\s+(\*|\{)|from\s+\S+\s+import|use\s|using\s|package\s|#include|#\[|@|\}?\s*$)/
const NOISE_LINE = /\b(console\.\w+|print|println!?|printf|eprintln!?|logger?\.\w+|log\.\w+|debug\w*)\s*\(/

// Every site of every mutator in a text, in a stable order. `raw` text keeps its own line endings.
export function findSites(file, text, lang = langOf(file)) {
  if (!lang) return []
  const lines = text.split('\n')
  const masked = maskLines(lines, lang)
  const out = []
  const seen = new Set()
  for (let i = 0; i < lines.length; i++) {
    if (lang === 'rs' && /#\[cfg\(test\)\]/.test(masked[i])) break
    if (SKIP_LINE.test(masked[i]) || NOISE_LINE.test(masked[i])) continue
    for (const m of MUTATORS) {
      if (!m.langs.includes(lang)) continue
      for (const s of m.find(masked[i], lang, lines[i])) {
        if (!s.from || s.col < 0 || lines[i].slice(s.col, s.col + s.from.length).length !== s.from.length) continue
        const key = `${i}:${s.col}:${s.from.length}:${s.to}`
        if (seen.has(key)) continue
        seen.add(key)
        out.push({ file, line: i + 1, col: s.col, from: lines[i].slice(s.col, s.col + s.from.length), len: s.from.length, to: s.to, mutator: m.id, family: m.family })
      }
    }
  }
  return out
}

// Sites of one line, for the proofs: [{col, from, to}] with `from` read from the original text.
export function findInLine(mutator, line, lang = 'js') {
  const masked = maskLines([line], lang)[0]
  return mutator.find(masked, lang, line).map((s) => ({ ...s, from: line.slice(s.col, s.col + s.from.length) }))
}

export const applyMutant = (text, m) => {
  const lines = text.split('\n')
  const l = lines[m.line - 1]
  lines[m.line - 1] = l.slice(0, m.col) + m.to + l.slice(m.col + m.len)
  return lines.join('\n')
}

// Picks up to `max` sites. A seeded weighted draw: files with fewer sites and recently changed files are more likely, so the sample spreads over the project.
export function sampleSites(sites, { max = 40, seed = 1, recent = new Set() } = {}) {
  const sorted = [...sites].sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : a.line - b.line || a.col - b.col || (a.mutator < b.mutator ? -1 : 1)))
  const perFile = new Map()
  for (const s of sorted) perFile.set(s.file, (perFile.get(s.file) ?? 0) + 1)
  const rnd = prng(seed)
  const keyed = sorted.map((s) => {
    const w = (recent.has(s.file) ? 3 : 1) / Math.sqrt(perFile.get(s.file))
    return { s, key: Math.pow(Math.max(rnd(), 1e-12), 1 / w) }
  })
  keyed.sort((a, b) => b.key - a.key)
  return keyed.slice(0, Math.max(0, max)).map((k) => k.s).sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : a.line - b.line || a.col - b.col))
}

// ============================================================ test command
const readJson = (p) => {
  try {
    return JSON.parse(readFileSync(p, 'utf8'))
  } catch {
    return null
  }
}
export function detectTestCommand(root) {
  const has = (f) => existsSync(join(root, f))
  const pkg = readJson(join(root, 'package.json'))
  if (pkg) {
    const t = pkg.scripts?.test
    const deps = { ...pkg.dependencies, ...pkg.devDependencies }
    if (typeof t === 'string' && t.trim() && !/no test specified/i.test(t)) {
      const runner = /\bvitest\b/.test(t) ? 'vitest' : /\bjest\b/.test(t) ? 'jest' : /\bmocha\b/.test(t) ? 'mocha' : /\bnode\b[^&|;]*--test\b/.test(t) ? 'node-test' : null
      return { cmd: 'npm', args: ['test', '--silent'], kind: 'node', label: 'npm test', runner }
    }
    if (deps.vitest) return { cmd: 'npx', args: ['vitest', 'run', '--bail', '1'], kind: 'node', label: 'npx vitest run', runner: 'vitest' }
    if (deps.jest) return { cmd: 'npx', args: ['jest', '--bail'], kind: 'node', label: 'npx jest', runner: 'jest' }
    if (deps.mocha) return { cmd: 'npx', args: ['mocha', '--bail'], kind: 'node', label: 'npx mocha', runner: 'mocha' }
  }
  if (has('go.mod')) return { cmd: 'go', args: ['test', '-failfast', './...'], kind: 'go', label: 'go test ./...' }
  if (has('Cargo.toml')) return { cmd: 'cargo', args: ['test', '--quiet'], kind: 'rs', label: 'cargo test' }
  if (has('pom.xml')) return { cmd: 'mvn', args: ['-q', '-B', 'test'], kind: 'java', label: 'mvn -q test' }
  if (['build.gradle', 'build.gradle.kts', 'settings.gradle', 'settings.gradle.kts'].some(has)) {
    const wrapper = process.platform === 'win32' ? 'gradlew.bat' : 'gradlew'
    const cmd = has(wrapper) ? (process.platform === 'win32' ? join(root, wrapper) : `./${wrapper}`) : 'gradle'
    return { cmd, args: ['test', '--console=plain', '-q'], kind: 'java', label: 'gradle test' }
  }
  const top = (() => {
    try {
      return readdirSync(root)
    } catch {
      return []
    }
  })()
  if (top.some((f) => /\.(sln|csproj)$/.test(f))) return { cmd: 'dotnet', args: ['test', '--nologo', '-v', 'q'], kind: 'cs', label: 'dotnet test' }
  const py = has('pytest.ini') || has('conftest.py') || has('tox.ini') || has('setup.cfg') || has('pyproject.toml') || top.some((f) => /^test_.*\.py$/.test(f)) || (has('tests') && statSync(join(root, 'tests')).isDirectory())
  if (py && top.some((f) => f.endsWith('.py') || ['src', 'tests', 'pyproject.toml'].includes(f))) return { cmd: process.platform === 'win32' ? 'python' : 'python3', args: ['-m', 'pytest', '-x', '-q'], kind: 'py', label: 'python -m pytest -x -q' }
  return null
}
const KIND_LANG = { node: ['js'], py: ['py'], go: ['go'], rs: ['rs'], java: ['java'], cs: ['cs'], custom: ['js', 'py', 'go', 'rs', 'java', 'cs'] }

// ============================================================ files and the copy
const SKIP_DIR = /(^|\/)(node_modules|\.git|target|dist|build|venv|\.venv|__pycache__|obj|\.next|coverage)(\/|$)/
export const TEST_FILE = /(^|\/)(tests?|__tests__|spec|specs|e2e)\/|\.(test|spec)\.[a-z]+$|(^|\/)test_[^/]*\.py$|_test\.(go|py)$|(^|\/)conftest\.py$|(Tests?|IT)\.(java|cs)$|(^|\/)tests?\.rs$/i
const CONFIG_FILE = /(\.config|\.conf|\.setup|\.d)\.[a-z]+$|(^|\/)(setup|conftest|manage)\.py$|\.min\.[a-z]+$/i
const MAX_FILE = 2 * 2 ** 20
const MAX_TOTAL = 200 * 2 ** 20

export function listFiles(root) {
  try {
    const out = execFileSync('git', ['-C', root, 'ls-files', '-z', '--cached', '--others', '--exclude-standard'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 256 * 2 ** 20 })
    const list = out.split('\0').filter(Boolean).filter((f) => existsSync(join(root, f)))
    if (list.length) return list.filter((f) => !SKIP_DIR.test(f)).map((f) => f.split('\\').join('/'))
  } catch {
    /* not a repository */
  }
  const files = []
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name)
      const rel = relative(root, p).split('\\').join('/')
      if (e.isDirectory()) {
        if (!SKIP_DIR.test(`${rel}/`)) walk(p)
      } else if (e.isFile()) files.push(rel)
    }
  }
  walk(root)
  return files
}

// Copies the project into a fresh temporary folder. Returns { dir, files, bytes, links } or { error }.
export function copyProject(root) {
  const list = listFiles(root)
  let bytes = 0
  const keep = []
  for (const f of list) {
    let st
    try {
      st = lstatSync(join(root, f))
    } catch {
      continue
    }
    if (!st.isFile() || st.size > MAX_FILE) continue
    bytes += st.size
    if (bytes > MAX_TOTAL) return { error: `the project is over ${MAX_TOTAL / 2 ** 20} MB, too big to copy for mutation testing` }
    keep.push(f)
  }
  const dir = mkdtempSync(join(tmpdir(), 'meerkat-mut-'))
  try {
    for (const f of keep) {
      const to = join(dir, f)
      mkdirSync(dirname(to), { recursive: true })
      copyFileSync(join(root, f), to)
    }
  } catch (e) {
    removeTemp(dir)
    return { error: `the project could not be copied (${e.code ?? 'error'})` }
  }
  const links = []
  for (const f of ['package.json', ...keep.filter((x) => x.endsWith('/package.json'))]) {
    const d = dirname(f) === '.' ? '' : dirname(f)
    if (keep.includes(f) && existsSync(join(root, d, 'node_modules'))) links.push(posixJoin(d, 'node_modules'))
  }
  return { dir, files: keep.length, bytes, links, keep }
}
const posixJoin = (a, b) => (a ? `${a}/${b}` : b)

export function removeTemp(dir, links = []) {
  // Take a node_modules link out first, on its own, so removing the copy can never reach into the real folder.
  for (const l of links) {
    const p = join(dir, l)
    try {
      rmdirSync(p)
    } catch {
      try {
        unlinkSync(p)
      } catch {
        /* already gone */
      }
    }
  }
  // A killed test process can hold the folder for a moment on Windows, so try a few times.
  for (let i = 0; i < 10 && existsSync(dir); i++) {
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 300)
    }
  }
}

// ============================================================ running the tests
const liveChildren = new Set()
function killTree(pid) {
  if (!pid) return
  try {
    if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true })
    else {
      try {
        process.kill(-pid, 'SIGKILL')
      } catch {
        process.kill(pid, 'SIGKILL')
      }
    }
  } catch {
    /* already gone */
  }
}

function resolveSpawn(cmd, args) {
  if (process.platform === 'win32' && (cmd === 'npm' || cmd === 'npx')) {
    const cli = join(dirname(process.execPath), 'node_modules', 'npm', 'bin', `${cmd}-cli.js`)
    if (existsSync(cli)) return { cmd: process.execPath, args: [cli, ...args] }
  }
  return { cmd, args }
}

// Runs a test command without a shell, kills the whole process tree on timeout. Never throws.
export function runTests(spec, cwd, timeoutMs) {
  return new Promise((resolve) => {
    const mine = []
    let tail = ''
    let timedOut = false
    let done = false
    let timer
    const started = Date.now()
    const fin = (r) => {
      if (done) return
      done = true
      clearTimeout(timer)
      for (const c of mine) liveChildren.delete(c)
      resolve({ tail, timedOut, ms: Date.now() - started, ...r })
    }
    const take = (b) => {
      tail = (tail + b.toString()).slice(-20000)
    }
    const launch = (cmd, args) => {
      const env = { ...process.env, CI: '1', NO_COLOR: '1', FORCE_COLOR: '0' }
      for (const k of Object.keys(env)) if (k.startsWith('MEERKAT_')) delete env[k]
      const child = spawn(cmd, args, { cwd, env, windowsHide: true, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'], shell: false })
      mine.push(child)
      liveChildren.add(child)
      child.stdout.on('data', take)
      child.stderr.on('data', take)
      child.on('error', (e) => {
        if (process.platform === 'win32' && e.code === 'EINVAL' && !done && !args.some((a) => /[&|<>^%"\r\n]/.test(a))) {
          take('')
          launch('cmd.exe', ['/d', '/s', '/c', cmd, ...args])
        } else fin({ code: 127, spawnError: e.code ?? 'ERROR' })
      })
      child.on('close', (code) => fin({ code: code ?? 1 }))
      return child
    }
    let child
    try {
      const r = resolveSpawn(spec.cmd, spec.args)
      child = launch(r.cmd, r.args)
    } catch (e) {
      if (process.platform === 'win32' && e.code === 'EINVAL' && !spec.args.some((a) => /[&|<>^%"\r\n]/.test(a))) {
        try {
          child = launch('cmd.exe', ['/d', '/s', '/c', spec.cmd, ...spec.args])
        } catch (e2) {
          fin({ code: 127, spawnError: e2.code ?? 'ERROR' })
          return
        }
      } else {
        fin({ code: 127, spawnError: e.code ?? 'ERROR' })
        return
      }
    }
    timer = setTimeout(() => {
      timedOut = true
      killTree(child?.pid)
      setTimeout(() => fin({ code: 124 }), 500)
    }, timeoutMs)
  })
}

const ERROR_PATTERN = /SyntaxError|IndentationError|Transform failed|ParseError|Parse error|error TS\d+|error\[E\d+\]|could not compile|\[build failed\]|COMPILATION ERROR|error CS\d+|cannot find symbol|Unexpected token|Unexpected end of/i
function precheck(spec, file, copyPath) {
  const lang = langOf(file)
  try {
    if (lang === 'js' && /\.(m?js|cjs)$/.test(file)) return spawnSync(process.execPath, ['--check', copyPath], { stdio: 'ignore', windowsHide: true }).status === 0
    if (lang === 'py') {
      const py = process.platform === 'win32' ? 'python' : 'python3'
      const r = spawnSync(py, ['-m', 'py_compile', copyPath], { stdio: 'ignore', windowsHide: true })
      return r.error ? true : r.status === 0
    }
  } catch {
    /* no precheck available */
  }
  return true
}

// ============================================================ config
export function mutationConfig(root, cli = {}) {
  let env = {}
  try {
    env = JSON.parse(process.env.MEERKAT_MUTATION || '{}')
  } catch {
    env = {}
  }
  const c = { ...(readBudgets(root)?.mutation ?? {}), ...env, ...cli }
  const num = (v, d, lo, hi) => (Number.isFinite(Number(v)) && v !== undefined && v !== null && v !== '' ? Math.min(hi, Math.max(lo, Number(v))) : d)
  const yes = (v, d) => (v === undefined || v === null || v === '' ? d : !(v === false || v === 'false' || v === 0 || v === 'off'))
  const maxPar = Math.max(1, cpus().length - 1)
  const d = c.diff
  return {
    testCommand: Array.isArray(c.testCommand) && c.testCommand.length && c.testCommand.every((x) => typeof x === 'string') ? c.testCommand : null,
    maxMutants: Math.floor(num(c.maxMutants, 40, 1, 500)),
    timeoutSeconds: num(c.timeoutSeconds, 60, 1, 3600),
    totalSeconds: num(c.totalSeconds, 600, 5, 7200),
    minScore: num(c.minScore, 60, 0, 100),
    seed: Math.floor(num(c.seed, 1, 1, 2 ** 31)),
    files: Array.isArray(c.files) ? c.files.filter((x) => typeof x === 'string') : [],
    // diff: 'auto' (on when a git base exists), 'off', or a git ref to compare with
    diff: d === false || d === 'false' || d === 'off' ? 'off' : typeof d === 'string' && d.trim() && d !== 'true' && d !== 'auto' ? d.trim() : 'auto',
    parallel: Math.floor(num(c.parallel, Math.min(2, maxPar), 1, maxPar)),
    failFast: yes(c.failFast, false) && c.failFast !== undefined,
    coverage: yes(c.coverage, true),
    coverageFile: typeof c.coverageFile === 'string' && c.coverageFile ? c.coverageFile : null,
    scopeTests: yes(c.scopeTests, true),
    confirmScoped: yes(c.confirmScoped, true),
  }
}

function recentFiles(root) {
  try {
    const out = execFileSync('git', ['-C', root, 'log', '-n', '40', '--name-only', '--format='], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
    return new Set(out.split('\n').map((x) => x.trim()).filter(Boolean))
  } catch {
    return new Set()
  }
}

export function pickSources(root, files, cfg, langs) {
  const res = cfg.files.map(globToRegExp)
  return files.filter((f) => {
    const lang = langOf(f)
    if (!lang || !langs.includes(lang)) return false
    if (TEST_FILE.test(f) || CONFIG_FILE.test(f) || SKIP_DIR.test(f) || isFixture(f) || /\.d\.ts$/.test(f)) return false
    if (res.length && !res.some((r) => r.test(f))) return false
    try {
      return statSync(join(root, f)).size <= MAX_FILE
    } catch {
      return false
    }
  })
}

// Which tests to run for a mutant in this file, or null for the full command (a custom command is never narrowed).
function scopedSpec(spec, file, ctx) {
  if (spec.kind === 'custom' || !ctx.scope) return null
  if (spec.kind === 'go') {
    const d = dirname(file).split('\\').join('/')
    return d === '.' ? null : { ...spec, args: ['test', '-failfast', `./${d}/...`], label: `go test ./${d}/...` }
  }
  if (spec.kind === 'rs') {
    const crate = cargoCrateOf(ctx.dir, file)
    return crate && /^[\w-]+$/.test(crate) ? { ...spec, args: ['test', '--quiet', '-p', crate], label: `cargo test -p ${crate}` } : null
  }
  if (spec.kind === 'node' && spec.runner && ctx.graph) {
    const hits = testsReaching(ctx.graph, ctx.tests, file).slice(0, 40)
    return hits.length ? { ...spec, args: [...spec.args, ...(spec.cmd === 'npm' ? ['--'] : []), ...hits] } : null
  }
  return null
}

// Mutants that usually fail a test run first, so a deadline or fail-fast stop leaves the slow, doubtful ones undone.
const FAMILY_WEIGHT = { conditional: 9, return: 9, statement: 8, logical: 7, arithmetic: 7, 'null-safety': 7, python: 6, async: 6, control: 6, argument: 6, comparison: 5, increment: 5, 'string-method': 5, index: 5, assign: 5, literal: 4, default: 3 }

// ============================================================ the run
// Returns { status: 'ok' | 'notrun', message, mutants, killed, survived, errors, score, partial, tmpDir, ... }. Prints nothing itself except through `log`.
export async function runMutation(rootArg, cli = {}, log = () => {}) {
  const root = resolve(rootArg)
  const cfg = mutationConfig(root, cli)
  const started = Date.now()
  const deadline = started + cfg.totalSeconds * 1000
  const result = { status: 'notrun', message: '', mutants: [], killed: 0, survived: 0, errors: 0, equivalent: 0, notCovered: 0, score: null, partial: false, cfg, tmpDir: null, tmpDirs: [], command: null, mode: 'full', base: null, noChanged: false, stoppedEarly: '', coverage: null }
  const bail = (m) => ({ ...result, message: m })

  const spec = cfg.testCommand ? { cmd: cfg.testCommand[0], args: cfg.testCommand.slice(1), kind: 'custom', label: cfg.testCommand.join(' ') } : detectTestCommand(root)
  if (!spec) return bail('no test command found (set "mutation": { "testCommand": ["cmd", "arg"] } in .meerkat-budgets.json)')
  result.command = spec.label
  const langs = KIND_LANG[spec.kind] ?? KIND_LANG.custom

  const all = listFiles(root)
  const sources = pickSources(root, all, cfg, langs)
  const sites = []
  const texts = new Map()
  const info = new Map()
  for (const f of sources) {
    progress.file(f)
    let t
    try {
      t = readFileSync(join(root, f), 'utf8')
    } catch {
      continue
    }
    texts.set(f, t)
    const lang = langOf(f)
    const lines = t.split('\n')
    const masked = maskLines(lines, lang)
    info.set(f, { lines, masked, dead: deadLines(masked, lang) })
    sites.push(...findSites(f, t))
  }
  if (!sites.length) return bail('no source lines to mutate were found (test files, config files and comments are left out)')
  result.sitesFound = sites.length

  // Diff mode: only the lines changed against a base.
  let pool = sites
  if (cfg.diff !== 'off') {
    let base = resolveBase(root, cfg.diff === 'auto' ? null : cfg.diff)
    if (base?.error) return bail(base.error)
    if (base) {
      let map = changedLines(root, base.sha)
      let use = sites.filter((s) => lineChanged(map, s.file, s.line))
      if (!use.length && cfg.diff === 'auto' && base.fallback) {
        const map2 = changedLines(root, base.fallback)
        const use2 = sites.filter((s) => lineChanged(map2, s.file, s.line))
        if (use2.length) {
          map = map2
          use = use2
          base = { ...base, ref: 'HEAD~10', sha: base.fallback, how: 'the last 10 commits' }
        }
      }
      result.mode = 'diff'
      result.base = { ref: base.ref, how: base.how }
      result.changedFiles = [...new Set(use.map((s) => s.file))].length
      if (!use.length) return { ...result, status: 'ok', noChanged: true, message: 'no changed source lines' }
      pool = use
    }
  }

  // Likely equivalent mutants leave the sample and are listed on their own.
  const eq = []
  const real = []
  for (const s of pool) {
    const inf = info.get(s.file)
    const why = equivalentReason(s, { lines: inf.lines, masked: inf.masked, dead: inf.dead, noise: NOISE_LINE })
    if (why) eq.push({ ...s, why })
    else real.push(s)
  }
  result.equivalent = eq.length
  const picked = sampleSites(real, { max: cfg.maxMutants, seed: cfg.seed, recent: recentFiles(root) })
  if (!picked.length) return bail('every candidate mutant was flagged as likely equivalent, so there is nothing to test')

  const cov = cfg.coverage ? loadCoverage(root, cfg.coverageFile) : null
  result.coverage = cov?.file ?? null
  const rows = picked.map((m, i) => {
    const inf = info.get(m.file)
    return { idx: i, id: `m${String(i + 1).padStart(3, '0')}`, file: m.file, line: m.line, from: clean(m.from).slice(0, 60), to: clean(m.to).slice(0, 60), mutator: m.mutator, family: m.family, result: 'PENDING', status: '', why: '', durationMs: 0, killedBy: '', fn: enclosingFunction(inf.masked, m.line), site: m, raw: inf.lines[m.line - 1] }
  })
  let finished = 0
  const tally = (row) => {
    if (row.result === 'KILLED') result.killed++
    else if (row.result === 'SURVIVED') result.survived++
    else result.errors++
  }
  const say = (row) => log(`[${++finished}/${rows.length}] ${row.result}${row.why ? ` (${row.why})` : ''} ${row.family} ${row.file}:${row.line} ${row.from} -> ${row.to}`)
  const toRun = []
  for (const row of rows) {
    if (cov && lineUncovered(cov, root, row.file, row.line)) {
      Object.assign(row, { result: 'SURVIVED', status: 'survived', notCovered: true, why: 'not covered' })
      result.notCovered++
      tally(row)
      say(row)
    } else toRun.push(row)
  }

  if (toRun.length) {
    const copies = []
    const cleanupAll = () => {
      for (const c of copies) removeTemp(c.dir, c.links)
    }
    const onSignal = () => {
      for (const c of liveChildren) killTree(c.pid)
      cleanupAll()
      process.exit(130)
    }
    process.once('SIGINT', onSignal)
    process.once('SIGTERM', onSignal)
    process.once('exit', cleanupAll)
    try {
      const n = Math.max(1, Math.min(cfg.parallel, toRun.length))
      for (let k = 0; k < n; k++) {
        const c = copyProject(root)
        if (c.error) return bail(c.error)
        copies.push(c)
        result.tmpDirs.push(c.dir)
        result.tmpDir ??= c.dir
        for (const l of c.links) {
          try {
            symlinkSync(join(root, l), join(c.dir, l), process.platform === 'win32' ? 'junction' : 'dir')
          } catch (e) {
            if (spec.kind === 'node' || spec.kind === 'custom') return bail(`node_modules cannot be linked into the copy (${e.code ?? 'error'}), so the tests cannot run there`)
          }
        }
      }
      const c0 = copies[0]
      log(`copied ${c0.files} files (${(c0.bytes / 2 ** 20).toFixed(1)} MB) to ${n} temporary folder${n === 1 ? '' : 's'}; test command: ${spec.label}`)
      const base = await runTests(spec, c0.dir, Math.min(300_000, Math.max(5000, deadline - Date.now())))
      if (base.spawnError) return bail(`the test command could not start (${base.spawnError}): ${spec.cmd} is not installed or not on the PATH`)
      if (base.timedOut) return bail('the baseline test run timed out before any mutation')
      if (base.code !== 0) {
        const last = clean(base.tail.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(-12).join(' | ')).slice(0, 700)
        return bail(`tests fail before mutation, fix them first (last output: ${last})`)
      }
      log(`baseline: tests pass (${(base.ms / 1000).toFixed(1)}s)`)
      const perTimeout = Math.min(cfg.timeoutSeconds * 1000, Math.max(5000, base.ms * 3 + 3000))
      const tests = c0.keep.filter((f) => TEST_FILE.test(f) && langOf(f) === 'js')
      const graph = cfg.scopeTests && spec.kind === 'node' && spec.runner ? buildImportGraph(c0.dir, c0.keep) : null
      const okCache = new Map()
      const order = [...toRun].sort((a, b) => (FAMILY_WEIGHT[b.family] ?? 5) - (FAMILY_WEIGHT[a.family] ?? 5) || a.idx - b.idx)
      let next = 0
      let stop = false
      let ran = 0

      const runOne = async (w, row) => {
        const m = row.site
        const p = join(w.dir, m.file)
        const orig = texts.get(m.file)
        const t0 = Date.now()
        row.result = 'ERROR'
        row.status = 'error'
        try {
          writeFileSync(p, applyMutant(orig, m))
          if (!okCache.has(m.file)) okCache.set(m.file, precheck(spec, m.file, join(root, m.file)))
          if (okCache.get(m.file) && !precheck(spec, m.file, p)) {
            row.why = 'did not parse'
          } else {
            const ctx = { scope: cfg.scopeTests, dir: w.dir, graph, tests }
            const scoped = scopedSpec(spec, m.file, ctx)
            const left = () => Math.min(perTimeout, Math.max(1000, deadline - Date.now()))
            let r = await runTests(scoped ?? spec, w.dir, left())
            if (scoped && cfg.confirmScoped && !r.spawnError && !r.timedOut && r.code === 0) {
              r = await runTests(spec, w.dir, left())
              row.confirmed = true
            }
            if (r.spawnError) row.why = 'test command could not start'
            else if (r.timedOut) {
              row.result = 'KILLED'
              row.status = 'timeout'
              row.why = 'timed out'
            } else if (r.code === 0) {
              row.result = 'SURVIVED'
              row.status = 'survived'
            } else if (ERROR_PATTERN.test(r.tail) && okCache.get(m.file) === false) row.why = 'did not compile'
            else if (ERROR_PATTERN.test(r.tail) && /\.(ts|tsx|go|rs|java|cs)$/.test(m.file) && /error TS\d+|error\[E|\[build failed\]|COMPILATION ERROR|error CS\d+|cannot find symbol/i.test(r.tail)) row.why = 'did not compile'
            else {
              row.result = 'KILLED'
              row.status = 'killed'
              row.killedBy = parseFailingTest(r.tail)
            }
          }
        } finally {
          row.durationMs = Date.now() - t0
          try {
            writeFileSync(p, orig)
          } catch {
            /* the copy is deleted anyway */
          }
        }
        tally(row)
        say(row)
        ran++
        if (cfg.failFast) {
          const pending = order.length - ran
          const best = ((result.killed + pending) / Math.max(1, result.killed + result.survived + pending)) * 100
          if (best < cfg.minScore) {
            stop = true
            result.stoppedEarly = `the minimum score of ${cfg.minScore}% can no longer be reached, so the remaining ${pending} mutant(s) were not run`
          }
        }
      }
      const worker = async (w) => {
        while (!stop) {
          const k = next++
          if (k >= order.length) return
          if (deadline - Date.now() < 2000) {
            result.partial = true
            stop = true
            return
          }
          await runOne(w, order[k])
        }
      }
      await Promise.all(copies.map(worker))
    } finally {
      process.removeListener('SIGINT', onSignal)
      process.removeListener('SIGTERM', onSignal)
      cleanupAll()
      if (copies.every((c) => !existsSync(c.dir))) process.removeListener('exit', cleanupAll)
    }
  }

  const done = rows.filter((r) => r.result !== 'PENDING')
  const out = done.map((r) => {
    const { site, raw, idx, ...row } = r
    return { ...row, ...(r.result === 'SURVIVED' ? { suggestion: suggestionFor(r, r.fn, raw) } : {}) }
  })
  eq.slice(0, 50).forEach((s, i) => out.push({ id: `e${String(i + 1).padStart(3, '0')}`, file: s.file, line: s.line, from: clean(s.from).slice(0, 60), to: clean(s.to).slice(0, 60), mutator: s.mutator, family: s.family, result: 'EQUIVALENT', status: 'equivalent', why: s.why, durationMs: 0, killedBy: '', fn: enclosingFunction(info.get(s.file).masked, s.line) }))
  result.mutants = out
  result.score = scoreOf(result.killed, result.survived)
  const tested = result.killed + result.survived
  if (result.partial && tested < 5) return { ...result, status: 'notrun', message: `the time cap of ${cfg.totalSeconds}s was reached after only ${tested} tested mutants (at least 5 are needed)` }
  if (tested === 0) return { ...result, status: 'notrun', message: 'no mutant could be tested (all of them failed to parse or compile)' }
  return { ...result, status: 'ok', message: '' }
}

const groupScores = (rowsIn, keyOf) => {
  const g = new Map()
  for (const m of rowsIn) {
    if (m.result !== 'KILLED' && m.result !== 'SURVIVED') continue
    const e = g.get(keyOf(m)) ?? { killed: 0, survived: 0 }
    e[m.result === 'KILLED' ? 'killed' : 'survived']++
    g.set(keyOf(m), e)
  }
  return [...g.entries()]
    .filter(([, e]) => e.survived > 0)
    .map(([k, e]) => ({ key: k, ...e, score: scoreOf(e.killed, e.survived) }))
    .sort((a, b) => a.score - b.score || b.survived - a.survived || (a.key < b.key ? -1 : 1))
    .slice(0, 10)
}

// Prints the sub-check lines and the report; returns the exit code.
export function report(r, say = console.log) {
  if (r.status === 'notrun') {
    say(clean(`NOT RUN: ${r.message}`))
    return NOT_RUN
  }
  if (r.noChanged) {
    for (const fam of FAMILIES) say(`MEERKAT-SUB NA ${fam} no changed source lines to mutate`)
    say('MEERKAT-SUB PASS mutation-score no changed source lines to mutate')
    say(clean(`mutation-testing: PASS, no changed source lines (compared with ${r.base?.how ?? 'the base'})`))
    return 0
  }
  const live = r.mutants.filter((m) => m.result !== 'EQUIVALENT')
  for (const fam of FAMILIES) {
    const mine = live.filter((m) => m.family === fam && m.result !== 'ERROR')
    const bad = mine.filter((m) => m.result === 'SURVIVED').length
    if (!mine.length) say(`MEERKAT-SUB NA ${fam} no mutants of this kind were tested here`)
    else if (bad) say(`MEERKAT-SUB FAIL ${fam} ${bad} of ${mine.length} survived`)
    else say(`MEERKAT-SUB PASS ${fam} all ${mine.length} killed`)
  }
  const below = r.score < r.cfg.minScore
  say(`MEERKAT-SUB ${below ? 'FAIL' : 'PASS'} mutation-score ${r.score}% against a minimum of ${r.cfg.minScore}%`)
  say(`mutation score: ${r.score}% (${r.killed} killed, ${r.survived} survived, ${r.errors} ignored because they did not compile; ${r.killed + r.survived} tested${r.partial ? ', stopped early at the time cap' : ''})`)
  if (r.mode === 'diff') say(clean(`mode: diff against ${r.base?.how ?? 'the base'}: only changed lines were mutated, so this score is for the changed code`))
  if (r.stoppedEarly) say(clean(`stopped early: ${r.stoppedEarly}`))
  if (r.notCovered) say(clean(`coverage hint ${r.coverage ?? ''}: ${r.notCovered} mutant(s) sit on lines no test runs; they count as survived and were not run`))
  if (r.trend) say(clean(r.trend))
  const eq = r.mutants.filter((m) => m.result === 'EQUIVALENT')
  if (eq.length || r.equivalent) {
    say(`likely equivalent (${r.equivalent ?? eq.length}, left out of the score): changing these cannot be seen by a test`)
    for (const m of eq.slice(0, 10)) say(clean(`  ${m.file}:${m.line} '${m.from}' -> '${m.to}'  (${m.why})`))
    if (eq.length > 10) say(`  ... and ${eq.length - 10} more`)
  }
  const files = groupScores(live, (m) => m.file)
  if (files.length) {
    say('weakest files (score, killed of tested):')
    for (const f of files) say(clean(`  ${String(f.score).padStart(5)}%  ${f.killed}/${f.killed + f.survived}  ${f.key}`))
  }
  const fns = groupScores(live, (m) => `${m.file} ${m.fn ?? '(top level)'}()`)
  if (fns.length) {
    say('weakest functions:')
    for (const f of fns) say(clean(`  ${String(f.score).padStart(5)}%  ${f.killed}/${f.killed + f.survived}  ${f.key}`))
  }
  const surv = live.filter((m) => m.result === 'SURVIVED')
  if (surv.length) {
    say(`SURVIVED mutants (${surv.length}): the tests still passed with the code changed here`)
    for (const m of surv.slice(0, 25)) {
      say(clean(`  ${m.file}:${m.line} '${m.from}' -> '${m.to}'  (${m.mutator})${m.notCovered ? ' [not covered]' : ''}`))
      if (m.suggestion) say(clean(`    suggestion: ${m.suggestion}`))
    }
    if (surv.length > 25) say(`  ... and ${surv.length - 25} more`)
    for (const m of surv.slice(0, 500)) {
      const line = formatFindingLine('medium', `mut-${m.mutator}`, m.file, m.line, `mutant survived: '${m.from}' -> '${m.to}' (${m.notCovered ? 'line not covered by any test' : 'no test failed'})`)
      if (line) say(line)
    }
  }
  say(below ? `mutation-testing: score ${r.score}% is below the minimum ${r.cfg.minScore}%` : `mutation-testing: score ${r.score}% meets the minimum ${r.cfg.minScore}%`)
  return below ? 1 : 0
}

export function parseCli(rest) {
  const cli = {}
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i]
    const v = () => rest[++i]
    if (a === '--max-mutants') cli.maxMutants = v()
    else if (a === '--total-seconds') cli.totalSeconds = v()
    else if (a === '--timeout') cli.timeoutSeconds = v()
    else if (a === '--min-score') cli.minScore = v()
    else if (a === '--seed') cli.seed = v()
    else if (a === '--parallel') cli.parallel = v()
    else if (a === '--max-files') cli.maxFiles = v()
    else if (a === '--files') cli.files = String(v()).split(',')
    else if (a === '--diff') cli.diff = rest[i + 1] && !rest[i + 1].startsWith('--') ? v() : 'auto'
    else if (a === '--no-diff') cli.diff = false
    else if (a === '--fail-fast') cli.failFast = true
    else if (a === '--no-coverage') cli.coverage = false
    else if (a === '--no-scope') cli.scopeTests = false
    else if (a === '--test-command') {
      try {
        cli.testCommand = JSON.parse(v())
      } catch {
        /* ignored: reported as no command */
      }
    }
  }
  return cli
}

// The markdown table of every mutator, generated from the registry (docs/mutation.md holds a copy between markers; a test keeps it equal).
export function renderMutatorDocs() {
  const rows = ['| Family | Mutator | Languages | Change |', '|---|---|---|---|']
  for (const m of MUTATORS) rows.push(`| ${m.family} | \`${m.id}\` | ${m.langs.join(', ')} | ${m.title.replace(/\|/g, '\\|')} |`)
  return rows.join('\n')
}

// Runs the check, records the history, writes mutation.json and mutation.md. MEERKAT_RUN_DIR is the folder when set.
async function runCheck(root, rest) {
  const r = await runMutation(root, parseCli(rest), (l) => console.log(clean(l)))
  if (r.status === 'ok' && r.score !== null) {
    try {
      r.trend = trendLine(readHistory(root), r.score, r.mode)
    } catch {
      /* no history */
    }
  }
  const code = report(r)
  if (r.status === 'ok') {
    try {
      if (r.score !== null) appendHistory(root, { date: new Date().toISOString(), score: r.score, mutants: r.killed + r.survived, killed: r.killed, survived: r.survived, mode: r.mode, base: r.base?.ref })
      const results = buildResults(r)
      const dir = process.env.MEERKAT_RUN_DIR ? resolve(process.env.MEERKAT_RUN_DIR) : join(historyHome(), `${slugOf(root)}.last`)
      console.log(clean(`results: ${writeResults(dir, results, summaryMarkdown(results))}`))
    } catch (e) {
      console.log(`results could not be written (${clean(e.code ?? 'error')})`)
    }
  }
  return code
}

// ============================================================ test-quality-static
export const SRC_TEST = /(^|\/)(tests?|__tests__|spec|specs)\/|\.(test|spec)\.[a-z]+$|(^|\/)test_[^/]*\.py$|_test\.(go|py)$|(Tests?|IT)\.(java|cs)$|(^|\/)tests?\.rs$/i
export const CODE_EXT = /\.(m?[jt]sx?|cjs|py|go|rs|java|cs)$/i
const NO_COMMENT = /^\s*(\/\/|#|\*|\/\*)/
const ms = (n) => Number(String(n).replace(/_/g, ''))

export const LINE_RULES = [
  {
    id: 'tautology-assert',
    title: 'a test asserts something that is always true',
    ext: ['js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs', 'py', 'rs', 'java', 'cs'],
    skipLine: NO_COMMENT,
    sample: 'a.test.js',
    bad: 'expect(true).toBe(true)',
    good: 'expect(add(1, 2)).toBe(3)',
    test: (line) =>
      /\bexpect\(\s*(true|false|1|0|null|undefined)\s*\)\s*\.\s*(toBe|toEqual|toStrictEqual)\(\s*\1\s*\)/.test(line) ||
      /\bexpect\(\s*true\s*\)\s*\.\s*toBeTruthy\(\)/.test(line) ||
      /^\s*assert\s+(True|1)\s*(#.*)?$/.test(line) ||
      /^\s*assert\s+(\d+)\s*==\s*\1\s*$/.test(line) ||
      /\bassert\s*\.\s*(ok|isTrue|equal|strictEqual)\(\s*(true|1)\s*(,\s*(true|1)\s*)?[,)]/.test(line) ||
      /\bassertTrue\(\s*true\s*\)|\bassert(Equals|That)\(\s*1\s*,\s*1\s*\)/.test(line) ||
      /\bassert!\(\s*true\s*\)|\bassert_eq!\(\s*1\s*,\s*1\s*\)/.test(line),
  },
  {
    id: 'commented-out-test',
    title: 'a test is commented out instead of fixed or deleted',
    ext: ['js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs', 'py', 'go', 'rs', 'java', 'cs'],
    sample: 'a.test.js',
    bad: "// it('adds two numbers', () => {",
    good: "it('adds two numbers', () => {",
    re: /^\s*(\/\/\s*(it|test|describe)(\.\w+)?\s*\(|#\s*def\s+test_|\/\/\s*func\s+Test|\/\/\s*#\[test\]|\/\/\s*@Test\b)/,
  },
  {
    id: 'sleep-based-test',
    title: 'a test waits for a fixed time longer than one second',
    ext: ['js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs', 'py', 'go', 'rs', 'java', 'cs'],
    skipLine: NO_COMMENT,
    sample: 'a.test.js',
    bad: 'await new Promise((r) => setTimeout(r, 3000))',
    good: 'await new Promise((r) => setTimeout(r, 50))',
    test: (line, ctx) => {
      const js = /\.(m?[jt]sx?|cjs)$/i.test(ctx.file)
      const checks = [
        [/\bsetTimeout\([^;]*?,\s*(\d[\d_]*)\s*\)/, 1, js],
        [/\b(?:sleep|delay|waitForTimeout|wait)\(\s*(\d[\d_]*)\s*\)/, 1, js],
        [/\b(?:time|asyncio)\.sleep\(\s*(\d+(?:\.\d+)?)\s*\)/, 1000, true],
        [/\bThread\.sleep\(\s*(\d+)/, 1, true],
        [/\btime\.Sleep\(\s*(\d+)\s*\*\s*time\.Second/, 1000, true],
        [/\bthread::sleep\(\s*Duration::from_secs\(\s*(\d+)/, 1000, true],
        [/\bthread::sleep\(\s*Duration::from_millis\(\s*(\d+)/, 1, true],
      ]
      return checks.some(([re, k, on]) => {
        const m = on ? re.exec(line) : null
        return m && ms(m[1]) * k > 1000
      })
    },
  },
  {
    id: 'network-in-unit-test',
    title: 'a unit test calls a real network address',
    ext: ['js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs', 'py', 'go'],
    skipLine: NO_COMMENT,
    sample: 'a.test.js',
    bad: "const r = await fetch('https://api.example.org/v1/users')",
    good: "const r = await fetch('http://localhost:3000/users')",
    test: (line) => !/mock|stub|nock/i.test(line) && /\b(fetch|axios\.(get|post|put|delete)|requests\.(get|post|put|delete)|httpx\.(get|post)|http\.(Get|Post))\(\s*['"`]https?:\/\/(?!localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)/.test(line),
  },
]

// Pulls the tests out of a file: [{ name, line, body, mbody, skipped, empty, opaque, modifiers }].
const JS_TEST = /(?<![\w.$])(x?)(it|test)((?:\.(?:only|skip|concurrent|fails|todo|sequential))*)\s*\(\s*(['"`])((?:\\.|(?!\4).)*)\4\s*,/g
export function extractTests(text, lang) {
  const lines = text.split('\n')
  const mlines = maskLines(lines, lang)
  const mtext = mlines.join('\n')
  const lineAt = (idx) => text.slice(0, idx).split('\n').length
  const out = []
  if (lang === 'js') {
    // Names live inside strings, which the mask blanks, so match names on the raw text and read the body from the same offsets.
    for (const m of text.matchAll(JS_TEST)) {
      if (mtext[m.index] === ' ' && text[m.index] !== ' ') continue
      const openIdx = text.indexOf('(', m.index)
      const close = matchClose(mtext, openIdx)
      if (close < 0) continue
      const from = m.index + m[0].length
      const body = text.slice(from, close)
      const mbody = mtext.slice(from, close)
      const mods = m[3]
      out.push({ name: m[5], line: lineAt(m.index), body, mbody, modifiers: mods, skipped: Boolean(m[1]) || /\.(skip|todo)/.test(mods), start: m.index, empty: /^\s*(async\s*)?(function\s*\w*\s*)?\(\s*\)\s*(=>)?\s*\{\s*\}\s*(,\s*\d+\s*)?$/.test(mbody), opaque: /^\s*[\w.$]+\s*(,\s*\d+\s*)?$/.test(mbody) })
    }
  } else if (lang === 'py') {
    for (let i = 0; i < lines.length; i++) {
      const m = /^([ \t]*)(?:async\s+)?def\s+(test\w*)\s*\(/.exec(lines[i])
      if (!m) continue
      const ind = m[1].length
      let j = i + 1
      const body = []
      const mb = []
      for (; j < lines.length; j++) {
        const ln = lines[j]
        if (ln.trim() && ln.search(/\S/) <= ind) break
        body.push(ln)
        mb.push(mlines[j])
      }
      let k = i - 1
      let skipped = false
      while (k >= 0 && /^\s*@/.test(lines[k])) skipped ||= /@(pytest\.mark\.(skip|xfail)|unittest\.skip)/.test(lines[k]), k--
      const bodyText = body.join('\n')
      const code = mb.join('\n').replace(/^\s*(pass|\.\.\.)\s*$/gm, '').replace(/"""\s*"""|'''\s*'''/g, '')
      out.push({ name: m[2], cls: nearestPyClass(lines, i, ind), line: i + 1, body: bodyText, mbody: mb.join('\n'), skipped, empty: !code.trim(), opaque: false, start: 0 })
    }
  } else {
    const heads = {
      go: /^func\s+(Test\w+)\s*\(\s*\w+\s+\*testing\.T\s*\)\s*\{/gm,
      java: /@Test\b[^\n]*\n(?:\s*@\w+(?:\([^)]*\))?\s*)*\s*(?:public\s+|protected\s+|private\s+)?(?:static\s+)?void\s+(\w+)\s*\([^)]*\)[^{]*\{/g,
      cs: /\[(?:Fact|Test|TestMethod|Theory)[^\]]*\]\s*(?:\[[^\]]*\]\s*)*(?:public\s+)?(?:async\s+)?(?:Task|void)\s+(\w+)\s*\([^)]*\)\s*\{/g,
      rs: /#\[test\][^\n]*\n(?:\s*#\[[^\]]*\]\s*)*\s*(?:async\s+)?fn\s+(\w+)\s*\([^)]*\)[^{]*\{/g,
    }[lang]
    if (!heads) return out
    for (const m of mtext.matchAll(heads)) {
      const open = m.index + m[0].length - 1
      const close = matchClose(mtext, open)
      if (close < 0) continue
      const head = m[0]
      out.push({
        name: m[1],
        line: lineAt(m.index + (lang === 'go' ? 0 : head.length - 1)),
        body: text.slice(open + 1, close),
        mbody: mtext.slice(open + 1, close),
        skipped: /@Disabled|@Ignore|#\[ignore|\[Ignore|Skip\s*=/.test(head) || (lang === 'go' && /\bt\.Skip(f|Now)?\(/.test(mtext.slice(open, close))),
        shouldFail: /should_panic|expected\s*=/.test(head),
        empty: !mtext.slice(open + 1, close).trim(),
        opaque: false,
        start: m.index,
      })
    }
  }
  return out
}
const nearestPyClass = (lines, i, ind) => {
  for (let k = i - 1; k >= 0; k--) {
    const m = /^(\s*)class\s+(\w+)/.exec(lines[k])
    if (m && m[1].length < ind) return m[2]
  }
  return ''
}

const ASSERT = {
  js: /\b(expect|assert|should)\b|\.(toBe|toEqual|toThrow|toMatch|rejects|resolves)\b|\bt\.(is|true|false|deepEqual|equal|throws|ok|plan|pass|fail|notThrows)\b|\bthrow\b|\bfail\s*\(|\b(check|verify|ensure|assert|expect)\w*\s*\(|\bdone\s*\(/,
  py: /\bassert\b|self\.assert|\bpytest\.(raises|fail|warns)|\.assert_\w+|\braise\b|\bassert_\w+\(|\bcheck\w*\(|\bverify\w*\(/,
  go: /\bt\.(Fatal|Fatalf|Error|Errorf|Fail|FailNow)\b|\b(assert|require)\.|\bpanic\(|\b(check|verify|assert)\w*\(/i,
  java: /\b(assert\w*|verify|fail|expect\w*)\s*\(|assertThrows|\bthrow\b/,
  cs: /\bAssert\.|\.Should\(|\bThrows\b|\bThrow\b|\bVerify\(/,
  rs: /\bassert\w*!|\bpanic!|\bunreachable!|\.unwrap\(\)|\.expect\(|\?\s*;/,
}
const asserts = (t, lang) => Boolean(t.shouldFail) || ASSERT[lang].test(t.mbody)
export const testable = (t) => !t.skipped && !t.empty && !t.opaque

// Logic rules: { id, title, langs, bad, good, sample, find(text, file, lang, ctx) -> [{line, msg}] }
const catchBlocks = (m) => {
  const blocks = []
  for (const c of m.matchAll(/\bcatch\s*(\([^)]*\))?\s*\{/g)) {
    const open = c.index + c[0].length - 1
    const close = matchClose(m, open)
    if (close > open) blocks.push([open, close])
  }
  return blocks
}
export const LOGIC_RULES = [
  {
    id: 'file-without-assertions',
    title: 'a test file has tests but none of them asserts anything',
    langs: ['js', 'py', 'go', 'java', 'cs', 'rs'],
    sample: 'a.test.js',
    bad: "test('runs', () => {\n  add(1, 2)\n})\n",
    good: "test('runs', () => {\n  expect(add(1, 2)).toBe(3)\n})\n",
    find: (text, file, lang) => {
      const ts = extractTests(text, lang).filter(testable)
      return ts.length && !ts.some((t) => asserts(t, lang)) ? [{ line: ts[0].line, msg: `${ts.length} test(s) and none asserts anything` }] : []
    },
  },
  {
    id: 'test-without-assertion',
    title: 'a test in a file that does assert elsewhere has no assertion of its own',
    langs: ['js', 'py', 'go', 'java', 'cs', 'rs'],
    sample: 'a.test.js',
    bad: "test('a', () => {\n  expect(add(1, 2)).toBe(3)\n})\ntest('b', () => {\n  add(2, 2)\n})\n",
    good: "test('a', () => {\n  expect(add(1, 2)).toBe(3)\n})\ntest('b', () => {\n  expect(add(2, 2)).toBe(4)\n})\n",
    find: (text, file, lang) => {
      const ts = extractTests(text, lang).filter(testable)
      return ts.some((t) => asserts(t, lang)) ? ts.filter((t) => !asserts(t, lang)).map((t) => ({ line: t.line, msg: `test "${t.name}" has no assertion` })) : []
    },
  },
  {
    id: 'empty-test-body',
    title: 'a test has an empty body and always passes',
    langs: ['js', 'py', 'go', 'java', 'cs', 'rs'],
    sample: 'a.test.js',
    bad: "test('does something', () => {})\n",
    good: "test('does something', () => {\n  expect(1 + 1).toBe(2)\n})\n",
    find: (text, file, lang) => extractTests(text, lang).filter((t) => t.empty && !t.skipped).map((t) => ({ line: t.line, msg: `test "${t.name}" is empty` })),
  },
  {
    id: 'snapshot-only',
    title: 'a test file checks only snapshots and nothing else',
    langs: ['js'],
    sample: 'a.test.js',
    bad: "test('renders', () => {\n  expect(render()).toMatchSnapshot()\n})\n",
    good: "test('renders', () => {\n  expect(render()).toMatchSnapshot()\n  expect(render().length).toBe(3)\n})\n",
    find: (text, file, lang) => {
      const m = maskLines(text.split('\n'), lang).join('\n')
      const snaps = (m.match(/\.toMatch(Inline|File)?Snapshot\(/g) ?? []).length
      const all = (m.match(/\bexpect\(|\bassert\b|\bassert\./g) ?? []).length
      return snaps > 0 && all - snaps <= 0 ? [{ line: 1, msg: `${snaps} snapshot check(s) and no other assertion` }] : []
    },
  },
  {
    id: 'swallowed-failure',
    title: 'a test catches an error and ignores it, so it cannot fail',
    langs: ['js', 'py'],
    sample: 'a.test.js',
    bad: "test('x', async () => {\n  try {\n    await run()\n  } catch (e) {}\n})\n",
    good: "test('x', async () => {\n  await expect(run()).rejects.toThrow()\n})\n",
    find: (text, file, lang) => {
      const out = []
      for (const t of extractTests(text, lang)) {
        if (lang === 'js') {
          const re = /\bcatch\s*(?:\(\s*[\w$]*\s*\))?\s*\{\s*(?:console\.\w+\([^()]*\)\s*;?\s*)?\}|\.catch\(\s*\(\s*[\w$]*\s*\)\s*=>\s*(?:\{\s*\}|null|undefined|void 0)\s*\)/g
          for (const m of t.mbody.matchAll(re)) out.push({ line: t.line + t.mbody.slice(0, m.index).split('\n').length - 1, msg: `test "${t.name}" swallows an error` })
        } else {
          const ls = t.mbody.split('\n')
          ls.forEach((l, i) => {
            if (/^\s*except\b.*:\s*(pass|\.\.\.|continue)\s*$/.test(l) || (/^\s*except\b.*:\s*$/.test(l) && /^\s*(pass|\.\.\.|continue)\s*$/.test(ls[i + 1] ?? ''))) out.push({ line: t.line + i, msg: `test "${t.name}" swallows an error` })
          })
        }
      }
      return out
    },
  },
  {
    id: 'assertion-only-in-catch',
    title: 'a test asserts only inside catch, so it passes when nothing is thrown',
    langs: ['js'],
    sample: 'a.test.js',
    bad: "test('throws', async () => {\n  try {\n    await run()\n  } catch (e) {\n    expect(e.message).toBe('boom')\n  }\n})\n",
    good: "test('throws', async () => {\n  expect.assertions(1)\n  try {\n    await run()\n  } catch (e) {\n    expect(e.message).toBe('boom')\n  }\n})\n",
    find: (text, file, lang) =>
      extractTests(text, lang)
        .filter((t) => testable(t) && /\btry\s*\{/.test(t.mbody) && !/expect\.(assertions|hasAssertions)|\bfail\s*\(|\bthrow\b/.test(t.mbody))
        .filter((t) => {
          const blocks = catchBlocks(t.mbody)
          if (!blocks.length) return false
          let outside = t.mbody
          for (const [a, b] of [...blocks].reverse()) outside = outside.slice(0, a) + ' '.repeat(b - a + 1) + outside.slice(b + 1)
          return !ASSERT.js.test(outside) && blocks.some(([a, b]) => ASSERT.js.test(t.mbody.slice(a, b)))
        })
        .map((t) => ({ line: t.line, msg: `test "${t.name}" asserts only inside catch` })),
  },
  {
    id: 'never-imports-source',
    title: 'a test file never imports anything from the project it tests',
    langs: ['js', 'py'],
    sample: 'a.test.js',
    bad: "import { test } from 'node:test'\ntest('x', () => {\n  if (1 + 1 !== 2) throw new Error('no')\n})\n",
    good: "import { test } from 'node:test'\nimport { add } from './add.js'\ntest('x', () => {\n  if (add(1, 1) !== 2) throw new Error('no')\n})\n",
    find: (text, file, lang, ctx = {}) => {
      if (!extractTests(text, lang).length) return []
      if (lang === 'js') {
        const local = /(?:from\s+|require\(\s*|import\(\s*|import\s+)['"](\.{1,2}\/|\.{1,2}['"]|@\/|~\/|#)/.test(text) || (ctx.pkgName && text.includes(`'${ctx.pkgName}`)) || (ctx.pkgName && text.includes(`"${ctx.pkgName}`))
        const external = /\b(execFile|execFileSync|execSync|spawn|spawnSync|fork)\s*\(|child_process|\bfetch\(|supertest|playwright|puppeteer|\bcy\.|\bpage\.goto|createRequire/.test(text)
        return local || external ? [] : [{ line: 1, msg: 'no import from the project and no program is started' }]
      }
      const mods = [...text.matchAll(/^\s*(?:from\s+([\w.]+)\s+import|import\s+([\w.]+))/gm)].map((m) => m[1] ?? m[2])
      const local = mods.some((x) => x.startsWith('.') || (ctx.localModules ?? new Set()).has(x.split('.')[0]))
      const external = /subprocess|os\.system|requests\.|httpx|TestClient|importlib/.test(text)
      return local || external ? [] : [{ line: 1, msg: 'no import from the project' }]
    },
  },
  {
    id: 'skip-ratio',
    title: 'a quarter or more of a file\'s tests are skipped or only planned',
    langs: ['js', 'py', 'go', 'java', 'cs', 'rs'],
    sample: 'a.test.js',
    bad: "test('a', () => { expect(1).toBe(1) })\ntest.skip('b', () => { expect(1).toBe(1) })\ntest.skip('c', () => { expect(1).toBe(1) })\n",
    good: "test('a', () => { expect(1).toBe(1) })\ntest('b', () => { expect(1).toBe(1) })\ntest.skip('c', () => { expect(1).toBe(1) })\n",
    find: (text, file, lang) => {
      const ts = extractTests(text, lang)
      let skipped = ts.filter((t) => t.skipped).length
      let total = ts.length
      if (lang === 'js') {
        const todos = (text.match(/(?<![\w.])(?:it|test)\.todo\(\s*['"`][^'"`]*['"`]\s*\)/g) ?? []).length
        skipped += todos
        total += todos
      }
      return total && skipped >= 2 && skipped / total >= 0.25 ? [{ line: 1, msg: `${skipped} of ${total} tests are skipped` }] : []
    },
  },
  {
    id: 'duplicate-test-name',
    title: 'two tests in one place share the same name, so a failure is ambiguous',
    langs: ['js', 'py'],
    sample: 'a.test.js',
    bad: "test('adds', () => { expect(1).toBe(1) })\ntest('adds', () => { expect(2).toBe(2) })\n",
    good: "test('adds', () => { expect(1).toBe(1) })\ntest('subtracts', () => { expect(2).toBe(2) })\n",
    find: (text, file, lang) => {
      const seen = new Set()
      const out = []
      const describes = lang === 'js' ? [...text.matchAll(/(?<![\w.$])describe(?:\.\w+)*\s*\(\s*(['"`])((?:\\.|(?!\1).)*)\1/g)].map((m) => ({ at: m.index, name: m[2] })) : []
      for (const t of extractTests(text, lang)) {
        const ctx = lang === 'js' ? (describes.filter((d) => d.at < t.start).pop()?.name ?? '') : (t.cls ?? '')
        const key = `${ctx}\u0000${t.name}`
        if (seen.has(key)) out.push({ line: t.line, msg: `test name "${t.name}" is used twice` })
        seen.add(key)
      }
      return out
    },
  },
]

export const ALL_TQ_RULES = [...LINE_RULES.map((r) => r.id), ...LOGIC_RULES.map((r) => r.id)]

// Proves every logic rule: its bad sample is found, its good sample is not. Returns problems.
export function proveLogic(rules = LOGIC_RULES) {
  const problems = []
  for (const r of rules) {
    const lang = langOf(r.sample)
    const ctx = { pkgName: 'zzz', localModules: new Set() }
    if (!r.find(r.bad, r.sample, lang, ctx).length) problems.push(`${r.id}: its bad sample is not found`)
    if (r.find(r.good, r.sample, lang, ctx).length) problems.push(`${r.id}: its good sample is found (false positive)`)
  }
  return problems
}

export function testQuality(root) {
  const all = trackedFiles(root).filter((f) => CODE_EXT.test(f) && !isFixture(f) && !/(^|\/)(node_modules|vendor|dist|build|target)\//.test(f))
  const tests = all.filter((f) => SRC_TEST.test(f))
  const found = []
  if (!tests.length) {
    for (const id of ALL_TQ_RULES) console.log(`MEERKAT-SUB NA ${id} this project has no test files`)
    console.log('test-quality-static: no test files found')
    return 0
  }
  const allow = readAllow(root, '.meerkat-test-quality-allow')
  const hit = new Map()
  const na = new Set()
  const ev = evaluate(root, LINE_RULES, { files: tests, allow })
  for (const f of ev.found) {
    hit.set(f.rule, (hit.get(f.rule) ?? 0) + 1)
    found.push(f.text)
  }
  for (const id of ev.na) na.add(id)
  const pkg = readJson(join(root, 'package.json'))
  const sources = all.filter((f) => !SRC_TEST.test(f))
  const localModules = new Set()
  for (const f of sources) {
    if (f.endsWith('.py')) {
      localModules.add(basename(f, '.py'))
      for (const seg of f.split('/').slice(0, -1)) localModules.add(seg)
    }
  }
  const ctx = { pkgName: typeof pkg?.name === 'string' ? pkg.name : '', localModules }
  const texts = new Map(tests.map((f) => [f, readText(root, f)]))
  for (const r of LOGIC_RULES) {
    const mine = tests.filter((f) => r.langs.includes(langOf(f)))
    if (!mine.length) {
      na.add(r.id)
      continue
    }
    for (const f of mine) {
      if (allow.has(`${r.id} ${f}`) || allow.has(`${r.id} *`)) continue
      for (const x of r.find(texts.get(f), f, langOf(f), ctx)) {
        hit.set(r.id, (hit.get(r.id) ?? 0) + 1)
        found.push(`${f}:${x.line} ${clean(x.msg)}`)
      }
    }
  }
  const titles = new Map([...LINE_RULES, ...LOGIC_RULES].map((r) => [r.id, clean(r.title).slice(0, 120)]))
  for (const id of ALL_TQ_RULES) {
    if (na.has(id)) console.log(`MEERKAT-SUB NA ${id} ${titles.get(id)}`)
    else if (hit.has(id)) console.log(`MEERKAT-SUB FAIL ${id} ${hit.get(id)} found: ${titles.get(id)}`)
    else console.log(`MEERKAT-SUB PASS ${id} ${titles.get(id)}`)
  }
  return finish('test-quality-static', found.map(clean), `${tests.length} test file(s) look like they check something`)
}

// ============================================================ fixtures
const WEAK_PKG = '{\n  "name": "weak",\n  "version": "1.0.0",\n  "type": "module"\n}\n'
export const WEAK_SRC = 'export function add(a, b) {\n  return a + b\n}\n\nexport function isAdult(age) {\n  return age >= 18\n}\n\nexport function sign(n) {\n  if (n < 0) {\n    return -1\n  }\n  if (n > 0) {\n    return 1\n  }\n  return 0\n}\n\nexport function isEven(n) {\n  return n % 2 === 0\n}\n\nexport function mul(a, b) {\n  return a * b\n}\n'
export const WEAK_TEST = "import { test } from 'node:test'\nimport { add, isAdult, sign, isEven, mul } from './index.js'\n\ntest('runs without crashing', () => {\n  add(1, 2)\n  isAdult(20)\n  sign(3)\n  isEven(4)\n  mul(2, 3)\n})\n"
export const STRONG_TEST =
  "import { test } from 'node:test'\nimport assert from 'node:assert/strict'\nimport { add, isAdult, sign, isEven, mul } from './index.js'\n\ntest('add', () => {\n  assert.equal(add(2, 3), 5)\n  assert.equal(add(-1, 1), 0)\n})\ntest('isAdult', () => {\n  assert.equal(isAdult(17), false)\n  assert.equal(isAdult(18), true)\n  assert.equal(isAdult(19), true)\n})\ntest('sign', () => {\n  assert.equal(sign(-5), -1)\n  assert.equal(sign(0), 0)\n  assert.equal(sign(5), 1)\n  assert.equal(sign(1), 1)\n})\ntest('isEven', () => {\n  assert.equal(isEven(4), true)\n  assert.equal(isEven(3), false)\n})\ntest('mul', () => {\n  assert.equal(mul(2, 3), 6)\n})\n"
export const BUDGET = (extra = {}) => `${JSON.stringify({ mutation: { testCommand: [process.execPath, '--test'], maxMutants: 30, totalSeconds: 15, timeoutSeconds: 8, ...extra } }, null, 2)}\n`

// ============================================================ the checks
const CHECKS = {
  'mutation-testing': {
    run: async (root, rest) => runCheck(root, rest),
    fixture: () => withFixture({ 'package.json': WEAK_PKG, 'index.js': WEAK_SRC, 'index.test.js': WEAK_TEST, '.meerkat-budgets.json': BUDGET() }, async (dir) => {
      const r = await runMutation(dir, {}, () => {})
      return r.status === 'ok' && r.score !== null && r.score < r.cfg.minScore ? 1 : r.status === 'notrun' ? NOT_RUN : 0
    }),
  },
  'test-quality-static': {
    run: async (root) => testQuality(root),
    fixture: () => withFixture({ 'src/add.js': 'export const add = (a, b) => a + b\n', 'src/add.test.js': "import { test } from 'node:test'\n\ntest('adds', () => {\n  expect(true).toBe(true)\n})\n" }, (dir) => testQuality(dir)),
  },
  'list-mutators': {
    run: async () => {
      console.log(renderMutatorDocs())
      return 0
    },
    fixture: async () => 0,
  },
}

// Proofs run on every start of the static check: a rule that stops matching its own sample is a bug, not a clean project.
const problems = [...selfProve(LINE_RULES), ...proveLogic()]
if (problems.length && process.argv[2] === 'test-quality-static') {
  console.log(`test-quality-static: internal rule proof failed: ${problems.join('; ')}`)
  process.exit(2)
}

if (process.argv[1] && (process.argv[1].endsWith('mutation.mjs') )) await main(CHECKS)

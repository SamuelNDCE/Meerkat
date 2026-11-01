// Built-in, zero-dependency fallbacks for a few optional outside tools. They run ONLY when the real tool is not found, they check a small
// honest subset (so they can only miss things, never invent them), and every result says "built-in fallback" so the report never passes
// them off as the real tool. Each takes { root, files } (files: paths relative to root, forward slashes) and returns
// { findings: ['file:line message'], checked: n, unavailable?: 'why' }.
import { existsSync, readFileSync, statSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { findBinary } from './which.mjs'

const read = (root, f) => {
  try {
    if (statSync(join(root, f)).size > 2_000_000) return null
    return readFileSync(join(root, f), 'utf8')
  } catch {
    return null
  }
}
const isFixturePath = (f) => /(^|\/)(fixtures?|testdata|__fixtures__|test-fixtures)\//i.test(f)

// ---- typos: a short list of well-known misspellings, in documents and in whole-line comments only ----
export const MISSPELLINGS = {
  recieve: 'receive', recieved: 'received', recieving: 'receiving', seperate: 'separate', seperately: 'separately', seperated: 'separated',
  teh: 'the', occured: 'occurred', occurence: 'occurrence', occurences: 'occurrences', definately: 'definitely', accomodate: 'accommodate',
  untill: 'until', becuase: 'because', beleive: 'believe', existance: 'existence', enviroment: 'environment', goverment: 'government',
  independant: 'independent', neccessary: 'necessary', necesary: 'necessary', occassion: 'occasion', publically: 'publicly', refered: 'referred',
  relevent: 'relevant', succesful: 'successful', succesfully: 'successfully', tommorow: 'tomorrow', truely: 'truly', wierd: 'weird',
  arguement: 'argument', begining: 'beginning', calender: 'calendar', concious: 'conscious', dissapear: 'disappear', embarass: 'embarrass',
  foriegn: 'foreign', gaurd: 'guard', immediatly: 'immediately', knowlege: 'knowledge', libary: 'library', maintainance: 'maintenance',
  millenium: 'millennium', noticable: 'noticeable', persistant: 'persistent', posession: 'possession', prefered: 'preferred', recomend: 'recommend',
  reciept: 'receipt', thier: 'their', writting: 'writing', paramter: 'parameter', paramters: 'parameters', langauge: 'language', adn: 'and',
  taht: 'that', wich: 'which', dependancy: 'dependency', dependancies: 'dependencies', sucess: 'success', suceed: 'succeed',
  charcter: 'character', adress: 'address', overriden: 'overridden', comparision: 'comparison', refrence: 'reference', transfered: 'transferred',
}
const DOC = /\.(md|markdown|txt|rst)$/i
const CODE = /\.(m?[jt]sx?|py|rs|go|sh|bash|rb|java|c|h|cpp|cs|css|scss|php|swift|kt|dart)$/i
const COMMENT = /^\s*(\/\/|#(?!!)|\/\*|\*|--|;)\s?(.*)$/

export function typos({ root, files }) {
  const findings = []
  let checked = 0
  for (const f of files) {
    const doc = DOC.test(f)
    if (!doc && !CODE.test(f)) continue
    if (isFixturePath(f)) continue
    const text = read(root, f)
    if (text === null) continue
    checked++
    let fence = null
    const lines = text.split(/\r?\n/)
    for (let i = 0; i < lines.length; i++) {
      let line = lines[i]
      if (/typos:\s*ignore/i.test(line)) continue
      if (doc) {
        const m = /^\s*(```+|~~~+)/.exec(line)
        if (m) {
          fence = fence ? (m[1][0] === fence[0] && m[1].length >= fence.length ? null : fence) : m[1]
          continue
        }
        if (fence) continue
        line = line.replace(/`[^`]*`/g, ' ')
      } else {
        const c = COMMENT.exec(line)
        if (!c) continue
        line = c[2]
      }
      line = line.replace(/https?:\/\/\S+/g, ' ').replace(/\]\([^)]*\)/g, ' ')
      for (const w of line.match(/[A-Za-z]+/g) ?? []) {
        const fix = Object.hasOwn(MISSPELLINGS, w.toLowerCase()) ? MISSPELLINGS[w.toLowerCase()] : null
        if (fix) findings.push(`${f}:${i + 1} "${w}" should be "${fix}"`)
      }
    }
  }
  return { findings, checked }
}

// ---- YAML: tab indentation and duplicate keys in one mapping (the two errors that make a file wrong, not just ugly) ----
export function yamlProblems(text) {
  const out = []
  if (/\{\{|\{%/.test(text)) return out // a template, not plain YAML
  const lines = text.split(/\r?\n/)
  let stack = []
  let block = -1 // indent of a line that opened a block scalar (| or >): its more-indented lines are text, not YAML
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]
    if (/^(---|\.\.\.)(\s|$)/.test(raw)) {
      stack = []
      block = -1
      continue
    }
    if (!raw.trim() || /^\s*#/.test(raw)) continue
    const indent = /^ */.exec(raw)[0].length
    if (block >= 0) {
      if (indent > block) continue
      block = -1
    }
    if (/^ *\t/.test(raw)) {
      out.push(`line ${i + 1}: a tab used for indentation (YAML allows only spaces)`)
      continue
    }
    const m = /^( *)(- +)?("(?:[^"\\]|\\.)*"|'[^']*'|[^\s#'"\[\]{},&*!|>%@`-][^:#]*?|-[^\s:][^:#]*?)[ \t]*:(?:[ \t]|$)(.*)$/.exec(raw)
    if (!m) {
      if (/^ *(- +)?[^#]*[|>][+-]?[0-9]*\s*(#.*)?$/.test(raw)) block = indent
      continue
    }
    const keyIndent = m[1].length + (m[2] ? m[2].length : 0)
    if (m[2]) stack = stack.filter((e) => e.indent < keyIndent && e.indent < m[1].length + 1)
    else stack = stack.filter((e) => e.indent <= keyIndent)
    let top = stack[stack.length - 1]
    if (!top || top.indent !== keyIndent) {
      top = { indent: keyIndent, keys: new Set() }
      stack.push(top)
    }
    const key = m[3].replace(/^["']|["']$/g, '').trim()
    if (top.keys.has(key)) out.push(`line ${i + 1}: duplicate key "${key}" in the same mapping`)
    top.keys.add(key)
    if (/^[|>][+-]?[0-9]*\s*(#.*)?$/.test(m[4].trim())) block = m[1].length
  }
  return out
}

export function yaml({ root, files }) {
  const findings = []
  let checked = 0
  for (const f of files) {
    if (!/\.ya?ml$/i.test(f) || isFixturePath(f)) continue
    const text = read(root, f)
    if (text === null) continue
    checked++
    for (const p of yamlProblems(text)) findings.push(`${f}: ${p}`)
  }
  return { findings, checked }
}

// ---- Markdown structure: an unclosed code fence, a heading that jumps down more than one level, an empty link target ----
export function markdownProblems(text) {
  const out = []
  const lines = text.split(/\r?\n/)
  let fence = null
  let fenceLine = 0
  let level = 0
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const m = /^ {0,3}(`{3,}|~{3,})/.exec(line)
    if (m) {
      if (!fence) {
        fence = m[1]
        fenceLine = i + 1
      } else if (m[1][0] === fence[0] && m[1].length >= fence.length && /^ {0,3}(`+|~+)\s*$/.test(line)) fence = null
      continue
    }
    if (fence) continue
    const h = /^(#{1,6})\s+\S/.exec(line)
    if (h) {
      if (level && h[1].length > level + 1) out.push(`line ${i + 1}: heading jumps from level ${level} to ${h[1].length}`)
      level = h[1].length
    }
    if (/\[[^\]]+\]\(\s*\)/.test(line.replace(/`[^`]*`/g, ''))) out.push(`line ${i + 1}: a link with an empty target`)
  }
  if (fence) out.push(`line ${fenceLine}: a code fence that is never closed`)
  return out
}

export function markdown({ root, files }) {
  const findings = []
  let checked = 0
  for (const f of files) {
    if (!/\.md$/i.test(f) || isFixturePath(f)) continue
    const text = read(root, f)
    if (text === null) continue
    checked++
    for (const p of markdownProblems(text)) findings.push(`${f}: ${p}`)
  }
  return { findings, checked }
}

// ---- Links between documents, offline: a relative link in a .md file whose target file or folder does not exist ----
export function links({ root, files }) {
  const findings = []
  let checked = 0
  for (const f of files) {
    if (!/\.md$/i.test(f) || isFixturePath(f)) continue
    const text = read(root, f)
    if (text === null) continue
    checked++
    let fence = null
    text.split(/\r?\n/).forEach((line, i) => {
      const m = /^ {0,3}(`{3,}|~{3,})/.exec(line)
      if (m) {
        fence = fence ? (m[1][0] === fence[0] && m[1].length >= fence.length ? null : fence) : m[1]
        return
      }
      if (fence) return
      for (const l of line.replace(/`[^`]*`/g, ' ').matchAll(/\]\(\s*<?([^)\s>]+)/g)) {
        let t = l[1]
        if (/^[a-z][a-z0-9+.-]*:/i.test(t) || t.startsWith('#') || t.startsWith('//') || /[{}$]/.test(t)) continue
        t = t.split('#')[0].split('?')[0]
        if (!t) continue
        try {
          t = decodeURIComponent(t)
        } catch {
          // keep the raw text
        }
        const target = t.startsWith('/') ? resolve(root, '.' + t) : resolve(root, dirname(f), t)
        if (!existsSync(target)) findings.push(`${f}:${i + 1} link to a file that does not exist: ${t}`)
      }
    })
  }
  return { findings, checked }
}

// ---- Shell scripts: bash -n (parse only, nothing is run). Catches syntax errors, not the style problems shellcheck finds. ----
export function shellBinary(env = process.env, platform = process.platform) {
  if (platform === 'win32') {
    for (const base of [env.ProgramFiles, env['ProgramFiles(x86)'], env.LOCALAPPDATA && join(env.LOCALAPPDATA, 'Programs')]) {
      const p = base && join(base, 'Git', 'bin', 'bash.exe')
      if (p && existsSync(p)) return p
    }
    return null // the bash.exe in System32 is WSL, which is not a plain shell
  }
  return findBinary('bash', env, platform) ?? findBinary('sh', env, platform)
}

export function shell({ root, files, env = process.env, platform = process.platform }) {
  const scripts = files.filter((f) => /\.(sh|bash)$/i.test(f) && !isFixturePath(f))
  if (!scripts.length) return { findings: [], checked: 0 }
  const bin = shellBinary(env, platform)
  if (!bin) return { findings: [], checked: 0, unavailable: 'no bash or sh found' }
  const findings = []
  for (const f of scripts) {
    const text = read(root, f)
    if (text === null) continue
    // Read from stdin with CRLF line ends removed: a script checked out with Windows line ends is not a syntax error.
    const r = spawnSync(bin, ['-n'], { cwd: root, input: text.split(String.fromCharCode(13)).join(''), encoding: 'utf8', timeout: 10000 })
    if (r.error) return { findings: [], checked: 0, unavailable: `could not start ${bin}` }
    if (r.status !== 0) findings.push(`${f}: ${String(r.stderr || 'syntax error').split(/\r?\n/)[0].replace(/^.*?: line /, 'line ')}`)
  }
  return { findings, checked: scripts.length }
}

export const FALLBACKS = { typos, yaml, markdown, links, shell }

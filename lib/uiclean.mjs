// UI cleanliness: design tips as checks that are provable from CSS source alone, with no browser and no rendering.
// It recommends and never edits. A pass means "no violation found in what the source declares", NEVER "the page looks clean":
// see NOT_CHECKABLE, which every report repeats.
//
// Checks:
//   ui-contrast-aa     a rule that declares both a text colour and a background colour, both resolvable to opaque sRGB, below WCAG AA.
//   ui-spacing-scale   a margin, padding or gap length that is off the spacing scale the project itself declares.
//
// Contrast: WCAG 2.2, 1.4.3 Contrast (Minimum). Ratio = (L1 + 0.05) / (L2 + 0.05), L1 the lighter relative luminance.
// Relative luminance L = 0.2126 R + 0.7152 G + 0.0722 B, each channel c8/255 mapped by c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ^ 2.4.
// Source: https://www.w3.org/TR/WCAG22/#dfn-contrast-ratio and #dfn-relative-luminance. Threshold 4.5:1, or 3:1 for large-scale text
// (at least 18 point = 24px, or 14 point bold = 18.66px), https://www.w3.org/TR/WCAG22/#contrast-minimum.
//
// The spacing scale is read from the project, never invented: a "spacingScale" array of px numbers in .meerkat-uiclean.json, or the
// custom properties --space-*, --spacing-* and --sp-* holding px or rem lengths. No declared scale means the check is not applicable.
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export const NOT_CHECKABLE = [
  'This module reads CSS source only. It cannot see the rendered page, so a pass does NOT mean the UI looks clean.',
  'Not checked: the colour a rule actually inherits or gets from a parent, images, gradients, overlays or transparency behind text,',
  'which rule wins the cascade, JavaScript-set styles, hover/focus/disabled states, alignment, visual hierarchy, whitespace balance,',
  'overflow and wrapping at real viewport sizes, font rendering and the real font size in em or percent. Look at the page.',
].join(' ')

export const RULE_CONTRAST = 'ui-contrast-aa'
export const RULE_SPACING = 'ui-spacing-scale'
const REM_PX = 16 // assumed browser default; stated in every spacing finding

// ---- colour maths (WCAG 2.2)
const NAMED = { white: [255, 255, 255], black: [0, 0, 0] }

// Returns [r, g, b] for an opaque colour, or null when the value is not a plain opaque sRGB colour this module can resolve.
export function parseColor(raw) {
  const v = String(raw).trim().toLowerCase()
  if (NAMED[v]) return NAMED[v]
  let m = /^#([0-9a-f]{3,8})$/.exec(v)
  if (m) {
    let h = m[1]
    if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join('')
    if (h.length !== 6 && h.length !== 8) return null
    if (h.length === 8 && h.slice(6) !== 'ff') return null // translucent: depends on what is behind it
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16))
  }
  m = /^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/.exec(v)
  if (m) return [m[1], m[2], m[3]].map(Number).every((n) => n <= 255) ? [m[1], m[2], m[3]].map(Number) : null
  return null
}

const channel = (c8) => {
  const s = c8 / 255
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
}
export const luminance = ([r, g, b]) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
export function contrastRatio(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}
const hex = ([r, g, b]) => `#${[r, g, b].map((n) => n.toString(16).padStart(2, '0')).join('')}`

// ---- a small CSS reader: declarations with their line numbers and the at-rules they sit in
const blankComments = (t) => t.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' '))

export function parseCss(text) {
  const src = blankComments(text)
  const lineAt = (i) => src.slice(0, i).split('\n').length
  const stack = []
  const rules = []
  let seg = ''
  let segStart = 0
  let paren = 0
  const top = () => stack[stack.length - 1]
  const flushDecl = () => {
    const frame = top()
    const i = seg.indexOf(':')
    if (frame && i > 0) {
      const prop = seg.slice(0, i).trim().toLowerCase()
      const value = seg.slice(i + 1).trim()
      if (prop && value && /^-{0,2}[a-z][-a-z0-9_]*$/.test(prop)) frame.decls.push({ prop, value, line: lineAt(segStart + seg.search(/\S/)) })
    }
    seg = ''
  }
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]
    if (ch === '(') paren++
    else if (ch === ')') paren = Math.max(0, paren - 1)
    if (paren === 0 && ch === '{') {
      const frame = { selector: seg.trim().replace(/\s+/g, ' '), decls: [], at: stack.map((f) => f.selector).filter((s) => s.startsWith('@')) }
      stack.push(frame)
      rules.push(frame)
      seg = ''
      segStart = i + 1
    } else if (paren === 0 && ch === '}') {
      flushDecl()
      stack.pop()
      segStart = i + 1
    } else if (paren === 0 && ch === ';') {
      flushDecl()
      segStart = i + 1
    } else {
      if (seg === '') segStart = i
      seg += ch
    }
  }
  return rules.filter((r) => !r.selector.startsWith('@') || r.decls.length)
}

// ---- custom properties: usable only when the file gives one unambiguous value
function customProps(rules) {
  const seen = new Map()
  for (const r of rules) for (const d of r.decls) if (d.prop.startsWith('--')) {
    const set = seen.get(d.prop) ?? new Set()
    set.add(d.value.trim().toLowerCase())
    seen.set(d.prop, set)
  }
  const out = new Map()
  for (const [k, set] of seen) if (set.size === 1) out.set(k, [...set][0])
  return { values: out, ambiguous: new Set([...seen].filter(([, s]) => s.size > 1).map(([k]) => k)) }
}

const resolve = (value, props, depth = 0) => {
  const v = value.trim().toLowerCase().replace(/\s*!important$/, '')
  const m = /^var\(\s*(--[a-z0-9_-]+)\s*(?:,[^)]*)?\)$/.exec(v)
  if (!m) return v
  if (depth > 5 || !props.values.has(m[1])) return null
  return resolve(props.values.get(m[1]), props, depth + 1)
}

const isCssFile = (p) => /\.(css|scss)$/i.test(p) && !/(^|\/)(node_modules|dist|build|vendor)\//.test(p)

const pxOf = (value) => {
  const m = /^(-?\d*\.?\d+)(px|rem)$/.exec(value.trim().toLowerCase())
  if (!m) return null
  return Math.abs(Number(m[1])) * (m[2] === 'rem' ? REM_PX : 1)
}

// The project's declared scale in px (sorted, de-duplicated), or null.
export function declaredScale(files, config = {}) {
  if (Array.isArray(config.spacingScale) && config.spacingScale.length) return { values: [...new Set(config.spacingScale.map(Number))].sort((a, b) => a - b), from: '.meerkat-uiclean.json spacingScale' }
  const vals = new Set()
  for (const f of files.filter((x) => isCssFile(x.path))) for (const r of parseCss(f.text)) for (const d of r.decls) {
    if (!/^--(space|spacing|sp)(-|$)/.test(d.prop)) continue
    const px = pxOf(d.value)
    if (px !== null) vals.add(px)
  }
  return vals.size ? { values: [...vals].sort((a, b) => a - b), from: '--space-*/--spacing-*/--sp-* custom properties' } : null
}

// ---- the checks. Each run(files, config) returns { findings, applicable, note }.
const largeText = (decls, props) => {
  const size = decls.find((d) => d.prop === 'font-size')
  const weight = decls.find((d) => d.prop === 'font-weight')
  const px = size ? pxOf(resolve(size.value, props) ?? '') : null
  if (px === null) return false
  const bold = weight && /^(bold|bolder|[6-9]00)$/.test(resolve(weight.value, props) ?? '')
  return px >= 24 || (bold && px >= 18.66)
}

function runContrast(files) {
  const findings = []
  let pairs = 0
  let skipped = 0
  const css = files.filter((f) => isCssFile(f.path))
  for (const f of css) {
    const rules = parseCss(f.text)
    const props = customProps(rules)
    for (const r of rules) {
      const fg = r.decls.filter((d) => d.prop === 'color').pop()
      const bg = r.decls.filter((d) => d.prop === 'background-color' || (d.prop === 'background' && !/gradient|url\(/i.test(d.value))).pop()
      if (!fg || !bg) continue
      const bgVal = bg.prop === 'background' ? (bg.value.match(/#[0-9a-f]{3,8}\b|rgb\([^)]*\)|var\([^)]*\)|\b(?:white|black)\b/i) ?? [null])[0] : bg.value
      const a = bgVal ? parseColor(resolve(bgVal, props) ?? '') : null
      const t = parseColor(resolve(fg.value, props) ?? '')
      if (!a || !t) { skipped++; continue }
      pairs++
      const ratio = contrastRatio(t, a)
      const large = largeText(r.decls, props)
      const need = large ? 3 : 4.5
      if (ratio < need) {
        findings.push({
          rule: RULE_CONTRAST,
          file: f.path,
          line: fg.line,
          evidence: `text ${hex(t)} on background ${hex(a)} gives ${ratio.toFixed(2)}:1 in "${r.selector}"; WCAG 2.2 AA needs ${need}:1${large ? ' (large text)' : ''}`,
          fix: `Darken the text or lighten the background (or the reverse on a dark theme) until the pair reaches at least ${need}:1. Check the new pair with the same formula before adopting it.`,
        })
      }
    }
  }
  return { findings, applicable: css.length > 0, note: `${pairs} colour pair(s) computed, ${skipped} not resolvable from source (inheritance, gradients, transparency, ambiguous variables) and not checked` }
}

const SPACING_PROP = /^(margin|padding)(-(top|right|bottom|left|inline|block)(-(start|end))?)?$|^(gap|row-gap|column-gap)$/

function runSpacing(files, config) {
  const scale = declaredScale(files, config)
  if (!scale) return { findings: [], applicable: false, note: 'no spacing scale declared (no spacingScale in .meerkat-uiclean.json, no --space-*/--spacing-*/--sp-* properties); nothing to compare against' }
  const findings = []
  let checked = 0
  for (const f of files.filter((x) => isCssFile(x.path))) {
    for (const r of parseCss(f.text)) for (const d of r.decls) {
      if (!SPACING_PROP.test(d.prop)) continue
      for (const tok of d.value.replace(/\s*!important$/, '').split(/\s+/)) {
        const px = pxOf(tok)
        if (px === null || px === 0) continue
        checked++
        if (scale.values.some((s) => Math.abs(s - px) < 0.01)) continue
        const near = [...scale.values].sort((a, b) => Math.abs(a - px) - Math.abs(b - px)).slice(0, 2)
        findings.push({
          rule: RULE_SPACING,
          file: f.path,
          line: d.line,
          evidence: `${d.prop}: ${tok} is ${px}px (rem taken as ${REM_PX}px) and not on the declared scale [${scale.values.join(', ')}] from ${scale.from}; nearest ${near.join(' or ')}px`,
          fix: `Use the scale: replace ${tok} with the nearest step (${near.join(' or ')}px), ideally through the project's own spacing variable. If ${px}px is intended, add it to the scale.`,
        })
      }
    }
  }
  return { findings, applicable: true, note: `${checked} length(s) compared to a ${scale.values.length}-step scale; em, %, calc() and var() lengths are not compared` }
}

// Each check carries a selfTest: a small broken fixture, and expectMatch for the reason it must be reported.
export const CHECKS = [
  {
    id: RULE_CONTRAST,
    title: 'Text and background colours declared together in one CSS rule meet WCAG 2.2 AA contrast',
    run: runContrast,
    selfTest: {
      files: [{ path: 'broken.css', text: '.note {\n  color: #999999;\n  background: #ffffff;\n}\n' }],
      expectMatch: /ui-contrast-aa broken\.css:2 .*#999999.*#ffffff.*2\.85:1/,
    },
  },
  {
    id: RULE_SPACING,
    title: 'Margins, paddings and gaps use the spacing scale the project declares',
    run: runSpacing,
    selfTest: {
      files: [{ path: 'broken.css', text: ':root { --space-1: 4px; --space-2: 8px; --space-3: 16px; }\n.card { padding: 13px; margin: 8px 0; }\n' }],
      expectMatch: /ui-spacing-scale broken\.css:2 .*padding: 13px.*nearest 16 or 8px/,
    },
  },
]

export const formatFinding = (f) => `MEERKAT-FINDING medium ${f.rule} ${f.file}:${f.line} ${f.evidence}. Suggested fix: ${f.fix}`

// Runs one check on its own broken fixture. ok only when it reports a finding AND the finding text matches expectMatch.
export function selfTest(check) {
  const { findings } = check.run(check.selfTest.files, check.selfTest.config ?? {})
  const text = findings.map(formatFinding).join('\n')
  return { ok: findings.length > 0 && check.selfTest.expectMatch.test(text), text }
}

// files: [{ path, text }]. Returns every finding plus the per-check applicability notes and the standing not-checkable notice.
export function runUiclean(files, config = {}) {
  const findings = []
  const notes = []
  for (const c of CHECKS) {
    const r = c.run(files, config)
    findings.push(...r.findings)
    notes.push({ id: c.id, applicable: r.applicable, note: r.note })
  }
  return { findings, notes, notCheckable: NOT_CHECKABLE }
}

export function report(result) {
  const lines = result.findings.map(formatFinding)
  for (const n of result.notes) lines.push(`${n.applicable ? 'ran' : 'not applicable'} ${n.id}: ${n.note}`)
  lines.push(`NOT CHECKABLE: ${result.notCheckable}`)
  lines.push(result.findings.length ? `${result.findings.length} recommendation(s). Nothing was changed.` : 'No violations found in the declared CSS. This is not a statement that the UI looks clean.')
  return lines.join('\n')
}

// Reads the git-tracked CSS files and the optional .meerkat-uiclean.json from a project root.
export function scanDir(root) {
  const list = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' }).split('\n').filter((p) => p && isCssFile(p))
  const files = list.map((p) => ({ path: p, text: readFileSync(join(root, p), 'utf8') }))
  let config = {}
  try { config = JSON.parse(readFileSync(join(root, '.meerkat-uiclean.json'), 'utf8')) } catch { /* no config */ }
  return runUiclean(files, config)
}

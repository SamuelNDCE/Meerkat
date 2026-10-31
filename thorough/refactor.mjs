// Refactor checks: is the code itself in good shape? They are separate from "does the app work" and run in the thorough tier.
//   node thorough/refactor.mjs <check> [--root <dir>]      node thorough/refactor.mjs <check> --fixtures   (must exit 1)
//   duplicate-code  repeated blocks of code across the repository (copy and paste)
//   dead-code       exported names nothing else uses, JS and TS (the Rust compiler and clippy already report dead Rust code)
//   file-length     files too long to read in one sitting
// Limits live in .meerkat-budgets.json under "refactor". Accepted dead names go in .meerkat-dead-allow, one per line.
import { extname } from 'node:path'
import { finish, isText, main, readBudgets, readText, trackedFiles, withFixture } from './kit.mjs'

const cfg = (root) => readBudgets(root)?.refactor ?? {}
const CODE = new Set(['.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.rs', '.py', '.go', '.svelte', '.vue', '.java', '.cs', '.c', '.cpp', '.h', '.rb', '.php', '.swift', '.kt'])
const SKIP = /(^|\/)(node_modules|dist|build|target|vendor|generated|__snapshots__|fixtures?|\.svelte-kit)\//i
const sources = (root) => trackedFiles(root).filter((x) => CODE.has(extname(x)) && !SKIP.test(x) && !/\.(min|d)\.(js|ts)$|\.lock$/.test(x))

// Lines that carry no meaning on their own: braces, imports, blank lines, one-word lines.
const trivial = (l) => l.length < 12 || /^(import|export \{|use |from |#include|\}|\)|\]|\/\/|\*|\/\*)/.test(l) || /^[)}\],;]+$/.test(l)

const duplicates = (root) => {
  const window = cfg(root).duplicateWindow ?? 8 // consecutive meaningful lines that must match
  const maxPct = cfg(root).maxDuplicatePct ?? 10
  const seen = new Map() // hash -> first place
  let total = 0
  let dup = 0
  const spots = new Map() // "file" -> duplicated line count
  const examples = []
  for (const x of sources(root)) {
    const lines = readText(root, x).split('\n').map((l, i) => ({ t: l.trim().replace(/\s+/g, ' '), n: i + 1 })).filter((l) => !trivial(l.t))
    total += lines.length
    const mark = new Set()
    for (let i = 0; i + window <= lines.length; i++) {
      const key = lines.slice(i, i + window).map((l) => l.t).join('\n')
      const first = seen.get(key)
      if (first && first.file !== x) {
        for (let k = i; k < i + window; k++) mark.add(k)
        if (examples.length < 40 && !examples.some((e) => e.a === first.where)) examples.push({ a: first.where, b: `${x}:${lines[i].n}` })
      } else if (!first) seen.set(key, { file: x, where: `${x}:${lines[i].n}` })
    }
    dup += mark.size
    if (mark.size) spots.set(x, mark.size)
  }
  const pct = total ? (dup / total) * 100 : 0
  console.log(`  ${dup} of ${total} meaningful lines sit in a block of ${window}+ that also appears in another file (${pct.toFixed(1)}%, limit ${maxPct}%)`)
  const f = []
  if (pct > maxPct) {
    f.push(`${pct.toFixed(1)}% of the code is duplicated, over the ${maxPct}% limit. Worst files: ${[...spots].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, v]) => `${k} (${v})`).join(', ')}`)
    for (const e of examples.slice(0, 5)) f.push(`same block: ${e.a}  and  ${e.b}`)
  }
  return finish('duplicate-code', f, 'duplication is inside the limit')
}

const deadCode = (root) => {
  const allow = new Set(readText(root, '.meerkat-dead-allow').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#')))
  const max = cfg(root).maxDeadExports ?? 0
  const files = trackedFiles(root).filter((x) => /\.(m?[jt]sx?|svelte|vue)$/.test(x) && !/(^|\/)(node_modules|dist|build)\//.test(x))
  const texts = new Map(files.map((x) => [x, readText(root, x)]))
  const all = [...texts.values()].join('\n')
  const f = []
  for (const [x, t] of texts) {
    if (/\.(test|spec)\./.test(x) || /(^|\/)(index|main|entry)\.[a-z]+$/.test(x) || /(^|\/)(pages|routes|app)\//.test(x)) continue
    const names = new Set()
    for (const m of t.matchAll(/^\s*export\s+(?:default\s+)?(?:async\s+)?(?:function\*?|const|let|var|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)/gm)) names.add(m[1])
    for (const m of t.matchAll(/^\s*export\s*\{([^}]+)\}/gm)) for (const n of m[1].split(',')) names.add(n.trim().split(/\s+as\s+/).pop())
    for (const n of names) {
      if (!n || allow.has(n) || allow.has(`${x}:${n}`)) continue
      const uses = all.match(new RegExp(`(?<![\\w$])${n.replace(/\$/g, '\\$')}(?![\\w$])`, 'g'))?.length ?? 0
      if (uses <= 1) f.push(`${x}: "${n}" is exported but nothing else mentions it`)
    }
  }
  console.log(`  ${f.length} exported name(s) nothing else uses (limit ${max})`)
  return finish('dead-code', f.length > max ? f : [], 'no unused exports above the limit')
}

const fileLength = (root) => {
  const max = cfg(root).maxFileLines ?? 2000
  const f = []
  for (const x of sources(root)) {
    const n = readText(root, x).split('\n').length
    if (n > max) f.push(`${x} is ${n} lines (limit ${max}); split it by responsibility`)
  }
  return finish('file-length', f, `no file is over ${max} lines`)
}

main({
  'duplicate-code': { run: duplicates, fixture: () => withFixture({ 'a.js': Array.from({ length: 12 }, (_, i) => `const value${i} = compute(${i}, 'alpha');`).join('\n'), 'b.js': Array.from({ length: 12 }, (_, i) => `const value${i} = compute(${i}, 'alpha');`).join('\n') }, duplicates) },
  'dead-code': { run: deadCode, fixture: () => withFixture({ 'lib.js': 'export function neverCalledAnywhere() { return 1 }\n', 'main.js': 'console.log(1)\n' }, deadCode) },
  'file-length': { run: fileLength, fixture: () => withFixture({ 'big.js': 'x\n'.repeat(2500), '.meerkat-budgets.json': '{}' }, fileLength) },
})

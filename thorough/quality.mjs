// Quality checks that need no tool installed: stray whitespace, leftover debug code, skipped or focused tests, swallowed errors,
// versions, shell scripts, Makefiles and TODO hygiene. Run through the quality pack, or by hand:
//   node thorough/quality.mjs <check> [--root <dir>]      node thorough/quality.mjs <check> --fixtures   (must exit 1)
// Limits are set in .meerkat-budgets.json under "quality". A finding you accept goes in .meerkat-quality-allow (a path, or path:line).
import { posix } from 'node:path'
import { finish, isFixture, main, readBudgets, readText, trackedFiles, withFixture } from './kit.mjs'

const cfg = (root) => readBudgets(root)?.quality ?? {}
const SKIP = /(^|\/)(node_modules|dist|build|vendor|target|fixtures?)\//i
const MINIFIED = /\.min\.(m?js|css)$/i
const GENERATED = /(^|\/)(package-lock\.json|Cargo\.lock|yarn\.lock|pnpm-lock\.yaml)$|\.(lock|snap)$/i
const TEXT = /\.(m?[jt]sx?|cjs|json|md|mdx|html?|css|scss|rs|toml|ya?ml|py|go|sh|bash|bat|cmd|ps1|txt|svelte|vue|java|cs|rb|php|kt|swift|dart|cfg|ini|xml)$|(^|\/)(Makefile|makefile|GNUmakefile)$|\.mk$/i
const SOURCE = /\.(m?[jt]sx?|cjs|py|rs|go|rb|php|java|cs|kt|swift|dart|svelte|vue)$/i
const TEST_FILE = /(^|\/)(tests?|__tests__)\/|\.(test|spec)\.[a-z]+$|(^|\/)test_[^/]*\.py$|_test\.go$/i
const MAKEFILE = /(^|\/)(GNUmakefile|Makefile|makefile)$|\.mk$/
const allowSet = (root) => new Set(readText(root, '.meerkat-quality-allow').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#')))
const allowed = (allow, x, line) => allow.has(x) || allow.has(`${x}:${line}`)
const lineOf = (text, index) => text.slice(0, index).split('\n').length
const files = (root, re) => trackedFiles(root).filter((x) => re.test(x) && !SKIP.test(x) && !MINIFIED.test(x) && !GENERATED.test(x) && !isFixture(x))
const snip = (s) => s.trim().slice(0, 80)
const stemOf = (x) => posix.basename(x).replace(/\.[^.]+$/, '')
const testStem = (x) => stemOf(x).replace(/\.(test|spec)$/, '').replace(/^test_/, '').replace(/_test$/, '')

// ---- trailing-whitespace: spaces or tabs at the end of a line (Markdown's two-space hard line break is allowed)
const trailingWhitespace = (root) => {
  const allow = allowSet(root)
  const f = []
  for (const x of files(root, TEXT)) {
    const md = /\.(md|mdx)$/i.test(x)
    readText(root, x).split('\n').forEach((raw, i) => {
      const line = raw.replace(/\r$/, '')
      if (!/[ \t]$/.test(line) || allowed(allow, x, i + 1)) return
      if (md && /[^ \t]  $/.test(line)) return
      f.push(`${x}:${i + 1} ends with spaces or tabs`)
    })
  }
  return finish('trailing-whitespace', f, 'no line ends with stray spaces or tabs')
}

// ---- final-newline: a file that stops without a newline, or ends with more than one blank line
const finalNewline = (root) => {
  const allow = allowSet(root)
  const f = []
  for (const x of files(root, TEXT)) {
    const t = readText(root, x)
    if (!t || allow.has(x)) continue
    if (!t.endsWith('\n')) f.push(`${x} does not end with a newline`)
    else if (/\n[ \t\r]*\n[ \t\r]*\n$/.test(t)) f.push(`${x} ends with more than one blank line`)
  }
  return finish('final-newline', f, 'every text file ends with exactly one newline')
}

// ---- indent-consistency: one file indented partly with tabs and partly with spaces (lines inside template strings are skipped)
const indentConsistency = (root) => {
  const allow = allowSet(root)
  const f = []
  for (const x of files(root, SOURCE)) {
    if (allow.has(x) || /\.go$/i.test(x)) continue
    let tabs = 0
    let spaces = 0
    let inTemplate = false
    for (const line of readText(root, x).split('\n')) {
      const skip = inTemplate
      if ((line.match(/`/g) ?? []).length % 2 === 1) inTemplate = !inTemplate
      if (skip) continue
      if (/^\t+\S/.test(line)) tabs++
      else if (/^ {2,}\S/.test(line)) spaces++
    }
    if (tabs && spaces) f.push(`${x} indents ${tabs} line(s) with tabs and ${spaces} with spaces`)
  }
  return finish('indent-consistency', f, 'each file indents with one character only')
}

// ---- line-length: source lines over the budget (default 200), excluding lines that carry a URL or a data URI
const lineLength = (root) => {
  const max = cfg(root).maxLineLength ?? 200
  const allow = allowSet(root)
  const f = []
  for (const x of files(root, SOURCE)) {
    if (allow.has(x)) continue
    readText(root, x).split('\n').forEach((raw, i) => {
      const line = raw.replace(/\r$/, '')
      if (line.length > max && !/https?:\/\/|data:[a-z]+\//i.test(line) && !allowed(allow, x, i + 1)) f.push(`${x}:${i + 1} is ${line.length} characters (limit ${max})`)
    })
  }
  return finish('line-length', f, `no source line is over ${max} characters`)
}

// ---- debug-leftovers: debugger statements, console.log, Python debug prints, Rust dbg!/todo!, Go debug prints
// True when an enclosing block (a line above with less indentation, up to 6 levels up) opens with an if that tests process.env or DEBUG.
const indentOf = (l) => l.length - l.trimStart().length
const guardedBlock = (lines, i) => {
  let ind = indentOf(lines[i])
  for (let k = i - 1, levels = 0; k >= 0 && levels < 6 && ind > 0; k--) {
    if (!lines[k].trim() || indentOf(lines[k]) >= ind) continue
    if (/\bif\s*\(.*(?:process\.env\b|\b(?:DEBUG|VERBOSE)\b)/.test(lines[k])) return true
    ind = indentOf(lines[k])
    levels++
  }
  return false
}
const debugWhy = (x, line, prev, testy, cliish, guarded = () => false) => {
  if (/\.(m?[jt]sx?|cjs)$/.test(x)) {
    if (/\bdebugger\s*;|(?:^|[;{}])\s*debugger\s*(?:$|\/[/*])/.test(line)) return 'has debugger; left in (it stops the program when a debugger is attached)'
    // A console.log behind an environment flag or a DEBUG / VERBOSE switch on the same line is a deliberate, switchable log.
    const log = /\bconsole\.log\s*\(/.exec(line)
    if (!testy && !cliish && log && !/process\.env\b|\b(?:DEBUG|VERBOSE)\b/.test(line.slice(0, log.index)) && !guarded()) return 'has console.log() left in'
  }
  if (/\.py$/.test(x) && /\bprint\(/.test(line) && (/print\(\s*f?["']\s*DEBUG/i.test(line) || /#\s*debug/i.test(prev))) return 'has a debug print() left in'
  if (/\.rs$/.test(x)) {
    const m = /\b(dbg|todo)!\s*\(/.exec(line)
    if (m) return `has ${m[1]}!() left in`
  }
  if (/\.go$/.test(x) && !/_test\.go$/.test(x) && /fmt\.Println\(\s*"debug/i.test(line)) return 'has a debug fmt.Println() left in'
  return null
}
// The files package.json names under "bin": a command-line program prints on purpose.
const binFiles = (root) => {
  try {
    const bin = JSON.parse(readText(root, 'package.json')).bin
    return new Set((typeof bin === 'string' ? [bin] : Object.values(bin ?? {})).map((p) => posix.normalize(String(p))))
  } catch {
    return new Set()
  }
}
const debugLeftovers = (root) => {
  const allow = allowSet(root)
  const bins = binFiles(root)
  const f = []
  for (const x of files(root, SOURCE)) {
    const testy = TEST_FILE.test(x)
    const cliish = /(^|\/)(bin|scripts|tools|cli)\//i.test(x) || bins.has(x) || /^#!/.test(readText(root, x))
    const lines = readText(root, x).split('\n')
    lines.forEach((line, i) => {
      const why = debugWhy(x, line, lines[i - 1] ?? '', testy, cliish, () => guardedBlock(lines, i))
      if (why && !allowed(allow, x, i + 1)) f.push(`${x}:${i + 1} ${why}`)
    })
  }
  return finish('debug-leftovers', f, 'no debugging code is left in')
}

// ---- skipped-tests: a test that is switched off, so it never runs
const SKIPPED = [
  /\b(?:it|test|describe|suite|context)\.skip\s*\(/,
  /(?<![\w.])(?:xit|xtest|xdescribe)\s*\(/,
  /@(?:Ignore|Disabled)\b/,
  /#\[ignore\]/,
  /\bpytest\.mark\.skip\w*|\bunittest\.skip\w*/,
  /\bt\.Skip(?:Now)?\s*\(/,
]
const skippedTests = (root) => {
  const allow = allowSet(root)
  const f = []
  for (const x of files(root, SOURCE)) {
    readText(root, x).split('\n').forEach((line, i) => {
      if (SKIPPED.some((re) => re.test(line)) && !allowed(allow, x, i + 1)) f.push(`${x}:${i + 1} skips a test: ${snip(line)}`)
    })
  }
  return finish('skipped-tests', f, 'no test is skipped')
}

// ---- focused-tests: a test left focused, so every other test in the run is silently skipped
const FOCUSED = [/\b(?:it|test|describe|suite|context)\.only\s*\(/, /@FocusedTest\b/]
// fit( and fdescribe( are only focus markers inside test files: elsewhere they are ordinary function names (a text "fit" helper, for example).
const FOCUSED_IN_TESTS = /(?<![\w.])(?:fit|fdescribe|ftest)\s*\(/
const focusedTests = (root) => {
  const allow = allowSet(root)
  const f = []
  for (const x of files(root, SOURCE)) {
    readText(root, x).split('\n').forEach((line, i) => {
      const focused = FOCUSED.some((re) => re.test(line)) || (TEST_FILE.test(x) && FOCUSED_IN_TESTS.test(line))
      if (focused && !allowed(allow, x, i + 1)) f.push(`${x}:${i + 1} is focused, so the other tests are skipped: ${snip(line)}`)
    })
  }
  return finish('focused-tests', f, 'no test is left focused')
}

// ---- empty-catch: an error handler that does nothing (a comment inside the block makes it deliberate, so it is not matched)
const EMPTY_CATCH = [
  /\bcatch\s*(?:\([^)]*\))?\s*\{\s*\}/g,
  /\bexcept(?:\s+[\w.()[\], ]+?)?(?:\s+as\s+\w+)?\s*:\s*pass(?![ \t]*#)\b/g,
]
const emptyCatch = (root) => {
  const allow = allowSet(root)
  const f = []
  for (const x of files(root, SOURCE)) {
    if (allow.has(x)) continue
    const t = readText(root, x)
    for (const re of EMPTY_CATCH) {
      for (const m of t.matchAll(re)) {
        const line = lineOf(t, m.index)
        if (!allowed(allow, x, line)) f.push(`${x}:${line} swallows an error with an empty handler`)
      }
    }
  }
  return finish('empty-catch', f, 'no error handler is empty')
}

// ---- test-presence: a project with source and no tests, and folders of source with no matching test file
const testPresence = (root) => {
  const minRatio = cfg(root).minTestRatio ?? 0
  const all = files(root, SOURCE)
  const tests = all.filter((x) => TEST_FILE.test(x))
  const src = all.filter((x) => !TEST_FILE.test(x))
  const f = []
  if (src.length > 5 && tests.length === 0) f.push(`there are ${src.length} source files and no test files`)
  const testNames = new Set(tests.map(testStem))
  const dirs = new Map()
  for (const x of src) {
    const d = posix.dirname(x)
    if (!dirs.has(d)) dirs.set(d, [])
    dirs.get(d).push(x)
  }
  for (const [d, list] of dirs) {
    if (list.length > 10 && !list.some((x) => testNames.has(stemOf(x)))) f.push(`${d}/ has ${list.length} source files and no test file for any of them`)
  }
  const matched = src.filter((x) => testNames.has(stemOf(x))).length
  if (minRatio > 0 && src.length && matched / src.length < minRatio) f.push(`only ${matched} of ${src.length} source files have a matching test (budget quality.minTestRatio is ${minRatio})`)
  return finish('test-presence', f, 'the source has tests')
}

// ---- duplicate-test-names: two tests in one file with the same title
const TEST_TITLES = [/\b(?:it|test)\s*\(\s*(['"`])(.+?)\1/g, /^\s*def\s+(test_\w+)\s*\(/gm, /^func\s+(Test\w+)\s*\(/gm]
const duplicateTestNames = (root) => {
  const allow = allowSet(root)
  const f = []
  for (const x of files(root, SOURCE)) {
    if (!TEST_FILE.test(x) || allow.has(x)) continue
    const t = readText(root, x)
    const seen = new Map()
    for (const re of TEST_TITLES) {
      for (const m of t.matchAll(re)) {
        const name = m[2] ?? m[1]
        const line = lineOf(t, m.index)
        if (seen.has(name)) f.push(`${x}:${line} repeats the test name "${name}" (first at line ${seen.get(name)})`)
        else seen.set(name, line)
      }
    }
  }
  return finish('duplicate-test-names', f, 'every test in a file has its own name')
}

// ---- semver-valid: package, Rust and Python versions must be real version numbers; 0.0.0 is a finding when the changelog has a release
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/
const PEP440 = /^\d+(?:\.\d+)*(?:(?:a|b|rc)\d+)?(?:\.post\d+)?(?:\.dev\d+)?$/
const cmpVersion = (a, b) => {
  const pa = a.split('.').slice(0, 3).map(Number)
  const pb = b.split('.').slice(0, 3).map(Number)
  for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0)
  return 0
}
const semverValid = (root) => {
  const allow = allowSet(root)
  const f = []
  for (const x of trackedFiles(root).filter((p) => !SKIP.test(p))) {
    const base = posix.basename(x)
    let version = null
    let valid = SEMVER
    if (base === 'package.json') {
      let j
      try {
        j = JSON.parse(readText(root, x))
      } catch {
        continue
      }
      version = typeof j.version === 'string' ? j.version : null
    } else if (base === 'Cargo.toml') {
      version = /^version\s*=\s*"([^"]+)"/m.exec(readText(root, x))?.[1] ?? null
    } else if (base === 'pyproject.toml') {
      version = /^version\s*=\s*"([^"]+)"/m.exec(readText(root, x))?.[1] ?? null
      valid = PEP440
    } else continue
    if (version === null || allow.has(x)) continue
    if (!valid.test(version)) {
      f.push(`${x}: version "${version}" is not a valid ${valid === SEMVER ? 'semantic version (x.y.z)' : 'Python version (PEP 440)'}`)
    } else if (version === '0.0.0') {
      const changelog = posix.join(posix.dirname(x), 'CHANGELOG.md')
      let top = null
      for (const m of readText(root, changelog).matchAll(/^#{1,3}\s*\[?v?(\d+\.\d+\.\d+)/gm)) if (!top || cmpVersion(m[1], top) > 0) top = m[1]
      if (top && cmpVersion(top, version) > 0) f.push(`${x}: version is 0.0.0 but ${changelog} has a release ${top}`)
    }
  }
  return finish('semver-valid', f, 'every version number is valid')
}

// ---- shell-hygiene: shell scripts need a shebang, "set -e" near the top, and LF line endings
const shellHygiene = (root) => {
  const allow = allowSet(root)
  const f = []
  for (const x of files(root, /\.(sh|bash)$/i)) {
    if (allow.has(x)) continue
    const t = readText(root, x)
    if (t.includes('\r\n')) f.push(`${x} has Windows (CRLF) line endings, which break it on Linux (save it with LF)`)
    const lines = t.replace(/\r/g, '').split('\n')
    if (!lines[0].startsWith('#!')) f.push(`${x} has no shebang line (for example #!/usr/bin/env bash) on its first line`)
    if (!lines.slice(0, 20).some((l) => /^\s*set\s+(-[a-zA-Z]*e[a-zA-Z]*|-o\s+errexit)\b/.test(l))) f.push(`${x} has no "set -e" near the top, so a failed step is ignored`)
  }
  return finish('shell-hygiene', f, 'every shell script stops on errors and uses LF line endings')
}

// ---- makefile-tabs: recipe lines must start with a tab; all, clean and test should be listed as .PHONY when defined
const MAKE_RULE = /^([A-Za-z0-9_./%$()-]+(?:\s+[A-Za-z0-9_./%$()-]+)*)\s*:(?!=)/
const makefileTabs = (root) => {
  const allow = allowSet(root)
  const f = []
  for (const x of files(root, MAKEFILE)) {
    if (allow.has(x)) continue
    const defined = new Set()
    const phony = new Set()
    let inRule = false
    readText(root, x).split('\n').map((l) => l.replace(/\r$/, '')).forEach((line, i) => {
      if (/^\t/.test(line) || /^\s*$/.test(line) || /^\s*#/.test(line)) return
      if (/^ +\S/.test(line)) {
        if (inRule) f.push(`${x}:${i + 1} a recipe line is indented with spaces (it must start with a tab)`)
        return
      }
      if (/^\.PHONY\s*:/.test(line)) {
        for (const n of line.split(':')[1].trim().split(/\s+/)) phony.add(n)
        inRule = true
        return
      }
      const m = MAKE_RULE.exec(line)
      inRule = Boolean(m)
      if (m) for (const n of m[1].split(/\s+/)) defined.add(n)
    })
    for (const t of ['all', 'clean', 'test']) if (defined.has(t) && !phony.has(t)) f.push(`${x}: the ${t} target is not listed in .PHONY`)
  }
  return finish('makefile-tabs', f, 'recipes use tabs and the common targets are .PHONY')
}

// ---- todo-hygiene: to-do style comments (the four marker words) that name nobody. Reported only when budget quality.todoNeedsOwner is true.
const TODO = /(\/\/|#|\/\*|^\s*\*|<!--)\s*(TO[D]O|FIX[M]E|HA[C]K|X[X]X)\b/
const OWNER = /\([^)\s][^)]*\)|#\d+|https?:\/\//
const todoHygiene = (root) => {
  const allow = allowSet(root)
  const f = []
  for (const x of files(root, TEXT)) {
    readText(root, x).split('\n').forEach((line, i) => {
      const m = TODO.exec(line)
      if (m && !OWNER.test(line) && !allowed(allow, x, i + 1)) f.push(`${x}:${i + 1} ${m[2]} names no owner or issue: ${snip(line)}`)
    })
  }
  if (cfg(root).todoNeedsOwner === true) return finish('todo-hygiene', f, 'every TODO names an owner or an issue')
  if (!f.length) {
    console.log('todo-hygiene: every TODO names an owner or an issue')
    return 0
  }
  console.log(`todo-hygiene: ${f.length} TODO, FIXME, HACK or XXX comment(s) name no owner or issue (not enforced; set quality.todoNeedsOwner to true to fail on them)`)
  for (const line of f.slice(0, 20)) console.log(`  ${line}`)
  if (f.length > 20) console.log(`  ... and ${f.length - 20} more`)
  return 0
}

const fx = (tree, fn) => ({ fixture: () => withFixture(tree, fn) })
const SIX = Object.fromEntries([1, 2, 3, 4, 5, 6].map((n) => [`a${n}.js`, 'export const v = 1\n']))

main({
  'trailing-whitespace': { run: trailingWhitespace, ...fx({ 'a.js': 'const a = 1; \n' }, trailingWhitespace) },
  'final-newline': { run: finalNewline, ...fx({ 'a.js': 'const a = 1' }, finalNewline) },
  'indent-consistency': { run: indentConsistency, ...fx({ 'a.js': 'function f() {\n\treturn 1\n}\nfunction g() {\n  return 2\n}\n' }, indentConsistency) },
  'line-length': { run: lineLength, ...fx({ 'a.js': 'const long = "' + 'x'.repeat(250) + '"\n' }, lineLength) },
  'debug-leftovers': { run: debugLeftovers, ...fx({ 'app.js': 'debugger;\n' }, debugLeftovers) },
  'skipped-tests': { run: skippedTests, ...fx({ 'app.test.js': "it.skip('works', () => {})\n" }, skippedTests) },
  'focused-tests': { run: focusedTests, ...fx({ 'app.test.js': "it.only('works', () => {})\n" }, focusedTests) },
  'empty-catch': { run: emptyCatch, ...fx({ 'app.js': 'try { run() } catch (e) {}\n' }, emptyCatch) },
  'test-presence': { run: testPresence, ...fx(SIX, testPresence) },
  'duplicate-test-names': { run: duplicateTestNames, ...fx({ 'app.test.js': "test('adds', () => {})\ntest('adds', () => {})\n" }, duplicateTestNames) },
  'semver-valid': { run: semverValid, ...fx({ 'package.json': '{"name":"x","version":"1.0"}\n' }, semverValid) },
  'shell-hygiene': { run: shellHygiene, ...fx({ 'run.sh': 'echo hi\n' }, shellHygiene) },
  'makefile-tabs': { run: makefileTabs, ...fx({ 'Makefile': 'build:\n  go build\n' }, makefileTabs) },
  'todo-hygiene': { run: todoHygiene, ...fx({ '.meerkat-budgets.json': '{"quality":{"todoNeedsOwner":true}}', 'a.js': '// TODO fix this later\n' }, todoHygiene) },
})

// Five narrow rules found missing by an end-to-end test on a planted app. Run through the hygiene pack, or by hand:
//   node thorough/gap-rules.mjs <check> [--root <dir>]      node thorough/gap-rules.mjs <check> --fixtures   (must exit 1)
// Checks: key-in-config, test-no-assert, img-alt-missing, scripts-binaries, payment-status-unchecked.
// A finding you accept goes in .meerkat-gap-allow: "<check-id> <file>" (or "<check-id> *"), one per line, # for comments.
// Every check reads only tracked files, runs nothing from the project, and prints file:line findings with what the reader should check.
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { findBinary } from '../lib/which.mjs'
import { finding, finish, isFixture, isTestFile, main, readText, trackedFiles, withFixture } from './kit.mjs'
import { readAllow } from './rules.mjs'
import { ASSERT, SRC_TEST, extractTests, maskLines, testable } from './mutation.mjs'

const ALLOW = '.meerkat-gap-allow'
const SKIP_DIR = /(^|\/)(node_modules|vendor|dist|build|target|coverage|\.next|out)\//
const lineOf = (text, index) => text.slice(0, index).split('\n').length

// Runs one scan over the tracked files, drops what the allow file accepts, prints a finding line per hit, and returns the exit code.
function report(root, id, okNote, scan) {
  const allow = readAllow(root, ALLOW)
  const hits = []
  scan((file, line, severity, message) => {
    if (allow.has(`${id} ${file}`) || allow.has(`${id} *`)) return
    hits.push({ file, line, severity, message })
  })
  for (const h of hits) finding(h.severity, id, h.file, h.line, h.message)
  return finish(id, hits.map((h) => `${h.file}:${h.line} ${h.message}`), okNote)
}

// ============================================================ key-in-config
// A string assigned to a key-like name whose value starts like a real key (sk_, rk_, ghp_, AKIA, xox...). process.env reads and test fixtures are left alone.
const KEY_NAME = /(?:api[_-]?key|secret|token|passw(?:or)?d|private[_-]?key|access[_-]?key|[a-z0-9]key)$/i
const KEY_VALUE = /^(?:sk_(?:live|test)_|rk_(?:live|test)_|ghp_|gho_|ghs_|ghu_|github_pat_|AKIA[0-9A-Z]{8}|ASIA[0-9A-Z]{8}|xox[abprs]-)[\w-]{6,}$/
const KEY_ASSIGN = /(?<![\w$.])["']?([A-Za-z_][\w-]*)["']?\s*(?::|=|=>)\s*["'`]([^"'`\s]{10,})["'`]/g
const KEY_FILES = /\.(?:[cm]?[jt]sx?|json|ya?ml|toml|py|rb|go|php|cs|java|kt)$/i
// [_, name, value] for each assignment on a line; a YAML file also holds unquoted values (secret: ghp_...).
const YAML_PLAIN = /^\s*-?\s*([A-Za-z_][\w-]*)\s*:\s*([^\s"'`#]{10,})\s*(?:#.*)?$/
const assignments = (file, line) => {
  const quoted = [...line.matchAll(KEY_ASSIGN)]
  const plain = /\.ya?ml$/i.test(file) ? YAML_PLAIN.exec(line) : null
  return plain ? [...quoted, plain] : quoted
}
const looksFake =(value) => /FAKE|TEST|fake|placeholder|dummy/.test(value)

function keyInConfig(root) {
  return report(root, 'key-in-config', 'no key-shaped string is assigned to a key-like name', (add) => {
    for (const f of trackedFiles(root)) {
      if (!KEY_FILES.test(f) || SKIP_DIR.test(f) || isTestFile(f) || /\.d\.ts$|package-lock\.json$/.test(f)) continue
      const lines = readText(root, f).split(/\r?\n/)
      lines.forEach((l, i) => {
        if (/^\s*(?:\/\/|#|\*|\/\*)/.test(l)) return
        for (const m of assignments(f, l)) {
          if (!KEY_NAME.test(m[1]) || !KEY_VALUE.test(m[2])) continue
          if (looksFake(m[2])) add(f, i + 1, 'medium', `"${m[1]}" is a hardcoded string that looks like a key and also looks like a fake placeholder (the value contains FAKE or TEST): check it is not real, then read it from an environment variable or move it to a test fixture`)
          else add(f, i + 1, 'high', `"${m[1]}" is a hardcoded string that looks like a real key: check whether it is live (revoke it if so) and read it from an environment variable instead`)
        }
      })
    }
  })
}

// ============================================================ test-no-assert
// Names of helpers defined in the file whose own body asserts (quiet(...), hits(...), checkRow(...)): a test that calls one of them does assert.
function assertingHelpers(text) {
  const names = new Set()
  const parts = text.split(/^(?=(?:export\s+)?(?:async\s+)?(?:const|let|function)\s+[\w$]+)/m)
  for (const part of parts) {
    const name = /^(?:export\s+)?(?:async\s+)?(?:const|let|function)\s+([\w$]+)/.exec(part)?.[1]
    if (name && ASSERT.js.test(part)) names.add(name)
  }
  return names
}

// A JavaScript or TypeScript test that calls functions and never asserts. Skipped, todo and empty tests are left to other rules.
function testNoAssert(root) {
  return report(root, 'test-no-assert', 'every test asserts something', (add) => {
    for (const f of trackedFiles(root)) {
      if (!/\.[cm]?[jt]sx?$/i.test(f) || !SRC_TEST.test(f) || isFixture(f) || SKIP_DIR.test(f)) continue
      const text = readText(root, f)
      // The test parser reads bodies by column; a line its masking shifts (a nested template string) makes every later body wrong, so such a file is left alone.
      const lines = text.split('\n')
      if (maskLines(lines, 'js').some((m, i) => m.length !== lines[i].length)) continue
      const helpers = assertingHelpers(text)
      for (const t of extractTests(text, 'js').filter(testable)) {
        if (t.shouldFail || /^(?:clean ?up|tear ?down|set ?up)\b/i.test(t.name) || ASSERT.js.test(t.mbody) || !/[\w$\])]\s*\(/.test(t.mbody)) continue
        if ([...helpers].some((h) => new RegExp(String.raw`(?<![\w$.])${h.replace(/\$/g, '\\$')}\s*\(`).test(t.mbody))) continue
        add(f, t.line, 'medium', `test "${t.name}" runs code but never asserts (no expect, assert or should): check what it is meant to prove, and add the assertion (use expect(...).not.toThrow() if "does not throw" is the point)`)
      }
    }
  })
}

// ============================================================ img-alt-missing
// An <img> with no alt attribute in a template. alt="" is a deliberate decorative image and passes.
const IMG_FILES = /\.(?:html?|[jt]sx|vue|svelte)$/i
function imgTags(text) {
  const out = []
  for (const m of text.matchAll(/<img(?=[\s/>])/gi)) {
    let i = m.index + 4
    let quote = ''
    let depth = 0
    for (; i < text.length; i++) {
      const c = text[i]
      if (quote) {
        if (c === quote) quote = ''
      } else if (depth === 0 && (c === '"' || c === "'")) quote = c
      else if (c === '{') depth++
      else if (c === '}') depth = Math.max(0, depth - 1)
      else if (c === '>' && depth === 0 && text[i - 1] !== '=') break
    }
    out.push({ index: m.index, tag: text.slice(m.index, i + 1) })
  }
  return out
}
const HAS_ALT = /(?<![\w:.-])(?:v-bind:|:)?alt(?=\s*=|\s|\/|>|$)|\{\s*alt\s*\}|\{\s*\.\.\./i

function imgAltMissing(root) {
  return report(root, 'img-alt-missing', 'every image has an alt attribute', (add) => {
    for (const f of trackedFiles(root)) {
      if (!IMG_FILES.test(f) || SKIP_DIR.test(f) || isTestFile(f) || /(^|\/)(mockups?|prototypes?|wireframes?)\//i.test(f)) continue
      const text = readText(root, f).replace(/<!--[\s\S]*?-->|\{\/\*[\s\S]*?\*\//g, (s) => s.replace(/[^\n]/g, ' '))
      for (const { index, tag } of imgTags(text)) {
        if (HAS_ALT.test(tag) || /\{\{|\{%|<%|<\?/.test(tag)) continue
        if (/\brole\s*=\s*["']?(?:presentation|none)\b|aria-hidden\s*=\s*["']?true/i.test(tag)) continue
        add(f, lineOf(text, index), 'medium', '<img> has no alt attribute: describe the picture for screen readers, or write alt="" if it is only decoration')
      }
    }
  })
}

// ============================================================ scripts-binaries
// A package.json script whose command starts with a program that is not installed (not in node_modules/.bin, not on PATH, not a shell builtin). Never runs the script.
const BUILTINS = new Set(`npm npx yarn pnpm bun bunx node nodejs deno corepack cd echo exit true false test [ set export unset source . : eval exec if then else fi for do done while case esac read printf pwd wait trap type command hash alias ulimit umask
  sh bash zsh cmd powershell pwsh rm cp mv mkdir rmdir cat ls touch grep egrep sed awk find xargs curl wget git tar unzip zip sleep env head tail sort uniq wc tee chmod chown diff open date clear ln which
  python python3 pip pip3 py cargo rustc go docker docker-compose make cmake java javac mvn gradle ruby bundle dotnet php composer gcc g++ clang tsc-watch`.split(/\s+/))
// Binary names whose package has a different name (used only when node_modules is not installed, so the dependency list is all there is).
const BIN_PACKAGE = { tsc: 'typescript', tsserver: 'typescript', ng: '@angular/cli', sb: 'storybook', 'vue-cli-service': '@vue/cli-service', 'react-scripts': 'react-scripts', 'run-s': 'npm-run-all', 'run-p': 'npm-run-all', 'ts-node': 'ts-node', playwright: '@playwright/test', 'svelte-kit': '@sveltejs/kit', changeset: '@changesets/cli', biome: '@biomejs/biome', tauri: '@tauri-apps/cli', 'graphql-codegen': '@graphql-codegen/cli', dotenv: 'dotenv-cli', 'lint-staged': 'lint-staged', 'eslint_d': 'eslint_d' }

function binDirs(root, dir) {
  const out = []
  for (let d = dir; ; d = dirname(d)) {
    const bin = join(root, d === '.' ? '' : d, 'node_modules', '.bin')
    if (existsSync(bin)) out.push(bin)
    if (d === '.' || d === dirname(d)) break
  }
  return out
}
const inBin = (bins, name) => bins.some((b) => ['', '.cmd', '.ps1', '.exe'].some((ext) => existsSync(join(b, name + ext))))
const depNames = (pkg) => Object.keys({ ...pkg.dependencies, ...pkg.devDependencies, ...pkg.optionalDependencies, ...pkg.peerDependencies })
const declared = (names, bin) => names.some((n) => n === bin || n === BIN_PACKAGE[bin] || n.split(/[/@-]+/).includes(bin))
const firstWords = (cmd) =>
  String(cmd)
    .split(/&&|\|\||;|\|/)
    .map((seg) => seg.trim().replace(/^(?:[A-Za-z_]\w*=\S*\s+)+/, '').split(/\s+/)[0])
    .filter(Boolean)

function scriptsBinaries(root) {
  return report(root, 'scripts-binaries', 'every program an npm script starts with is installed', (add) => {
    const rootPkg = (() => {
      try {
        return JSON.parse(readText(root, 'package.json') || '{}')
      } catch {
        return {}
      }
    })()
    for (const f of trackedFiles(root)) {
      if (!/(^|\/)package\.json$/.test(f) || SKIP_DIR.test(f) || isFixture(f)) continue
      const text = readText(root, f)
      let pkg
      try {
        pkg = JSON.parse(text)
      } catch {
        continue
      }
      const dir = dirname(f)
      const bins = binDirs(root, dir)
      const names = [...depNames(pkg), ...depNames(rootPkg)]
      const seen = new Set()
      for (const [script, cmd] of Object.entries(pkg.scripts ?? {})) {
        for (const w of firstWords(cmd)) {
          if (seen.has(`${script} ${w}`) || BUILTINS.has(w) || /[$%`"'()\\/*{}<>=~@!]|^[.-]/.test(w)) continue
          seen.add(`${script} ${w}`)
          if (inBin(bins, w) || findBinary(w)) continue
          if (!bins.length && declared(names, w)) continue
          const why = bins.length ? 'is not in node_modules/.bin, not on PATH' : 'is provided by no dependency (node_modules is not installed here, so this is judged from the dependency list) and is not on PATH'
          const at = text.split('\n').findIndex((l) => l.includes(`"${script}"`)) + 1
          add(f, at || 1, 'medium', `script "${script}" starts with "${w}", which ${why}, and is not a shell builtin: check the name, install the package that provides it, or delete the script`)
        }
      }
    }
  })
}

// ============================================================ payment-status-unchecked (candidate)
// A payment, transfer or refund call that is awaited and assigned, where the result is never checked (.status, .ok, .success, .error ...) and no try block surrounds it.
const PAY_FN = '(?:charge(?:Card|Customer|User|Payment)?|createCharge|transfer(?:Funds|Money)?|createTransfer|refund(?:Payment|Charge|Order)?|createRefund|payout|createPayout|capturePayment)'
const PAY_CALL = new RegExp(String.raw`^(\s*)(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*await\s+(?:[\w$.?]+\.)?${PAY_FN}\s*\(|^(\s*)(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*await\s+[\w$.?]*\.(?:charges|transfers|refunds|payouts|paymentIntents)\.(?:create|capture)\s*\(`)
const CHECKED = (v) => new RegExp(String.raw`(?<![\w$])${v.replace(/\$/g, '\\$')}\s*\??\.\s*(?:status|ok|success|succeeded|paid|error|errors|failed|declined|outcome)\b|\bif\s*\(\s*!?\s*${v.replace(/\$/g, '\\$')}\s*[)&|=!]|(?:assert|expect|check|verify|ensure)\w*\([^)]*(?<![\w$])${v.replace(/\$/g, '\\$')}\b|(?<![\w$])${v.replace(/\$/g, '\\$')}\s*\??\.\s*\w*(?:Status|Error)\b`)

function insideTry(lines, index) {
  let depth = 0
  for (let i = index - 1; i >= 0 && i >= index - 80; i--) {
    const l = lines[i]
    for (let k = l.length - 1; k >= 0; k--) {
      if (l[k] === '}') depth++
      else if (l[k] === '{' && --depth < 0) {
        depth = 0
        if (/\btry\s*\{/.test(l)) return true
        if (/\bfunction\b|=>/.test(l)) return false
        break
      }
    }
  }
  return false
}

function paymentStatusUnchecked(root) {
  return report(root, 'payment-status-unchecked', 'every awaited payment call has its result or error checked', (add) => {
    for (const f of trackedFiles(root)) {
      if (!/\.[cm]?[jt]sx?$/i.test(f) || SKIP_DIR.test(f) || isTestFile(f)) continue
      const lines = readText(root, f).split(/\r?\n/)
      lines.forEach((l, i) => {
        const m = PAY_CALL.exec(l)
        if (!m) return
        const v = m[2] ?? m[4]
        const indent = (m[1] ?? m[3] ?? '').length
        let rest = ''
        for (let j = i + 1; j < lines.length && j < i + 40; j++) {
          if (lines[j].trim() && lines[j].search(/\S/) < indent) break
          rest += `${lines[j]}\n`
        }
        if (CHECKED(v).test(rest) || insideTry(lines, i)) return
        add(f, i + 1, 'low', `candidate: "${v}" holds the result of an awaited payment call and is never checked for .status, .ok or an error, and no try block surrounds it: check that a declined or failed payment cannot be treated as paid (the code after it may already have updated a balance)`)
      })
    }
  })
}

// ============================================================ fixtures: one broken folder and one clean twin per check
export const BROKEN = {
  'key-in-config': { 'src/config.ts': "export const config = {\n  port: 3000,\n  paymentsKey: 'sk_test_FAKE_ONLY_1234567890',\n  githubToken: 'ghp_abcdefghijklmnopqrstuvwxyz0123456789',\n}\n" },
  'test-no-assert': { 'test/a.test.ts': "import { it } from 'vitest'\nimport { name } from '../src/a'\n\nit('shows the name', () => {\n  const n = name({ id: 1 })\n  console.log(n)\n})\n" },
  'img-alt-missing': { 'templates/a.html': '<main><img src="/hero.png" width="400"></main>\n', 'src/B.tsx': 'export const B = () => <img src={logo} />\n' },
  'scripts-binaries': { 'package.json': '{"name":"a","scripts":{"audit":"securitycheck-nope src","build":"node build.js"},"devDependencies":{"vitest":"^2.0.0"}}\n' },
  'payment-status-unchecked': { 'src/pay.ts': "export async function pay(user, amount) {\n  const result = await chargeCard(user, amount)\n  await setBalance(user, amount)\n  return { ok: true }\n}\n" },
}
export const CLEAN = {
  'key-in-config': { 'src/config.ts': "export const config = {\n  paymentsKey: process.env.PAYMENTS_KEY ?? '',\n  label: 'sk_short',\n}\n", 'test/fixtures/keys.fixture.ts': "export const FAKE_KEY_FOR_TESTS = 'sk_test_FAKE_FIXTURE_ONLY_0000000000'\nexport const apiKey = 'sk_test_FAKE_FIXTURE_ONLY_0000000000'\n" },
  'test-no-assert': { 'test/a.test.ts': "import { it, expect } from 'vitest'\nimport { name } from '../src/a'\n\nit('shows the name', () => {\n  expect(name({ id: 1 })).toBe('Ann')\n})\n\nit.todo('later')\nit.skip('slow', () => {\n  name({ id: 2 })\n})\n" },
  'img-alt-missing': { 'templates/a.html': '<main><img src="/hero.png" width="400" alt="A meerkat on a rock"><img src="/line.png" alt=""></main>\n', 'src/B.tsx': 'export const B = () => <img src={logo} alt="Company logo" />\n' },
  'scripts-binaries': { 'package.json': '{"name":"a","scripts":{"build":"tsc -p .","test":"vitest run","start":"node dist/index.js","clean":"rm -rf dist","ci":"echo ok && npm test"},"devDependencies":{"typescript":"^5","vitest":"^2.0.0"}}\n' },
  'payment-status-unchecked': { 'src/pay.ts': "export async function pay(user, amount) {\n  const result = await chargeCard(user, amount)\n  if (result.status !== 'succeeded') throw new Error('payment failed')\n  await setBalance(user, amount)\n  return { ok: true }\n}\n\nexport async function pay2(user, amount) {\n  try {\n    const r = await charge(user, amount)\n    return r\n  } catch (err) {\n    return null\n  }\n}\n" },
}

const RUN = { 'key-in-config': keyInConfig, 'test-no-assert': testNoAssert, 'img-alt-missing': imgAltMissing, 'scripts-binaries': scriptsBinaries, 'payment-status-unchecked': paymentStatusUnchecked }
export const runOn = (id, root) => RUN[id](root)
export const IDS = Object.keys(RUN)

const checks = Object.fromEntries(IDS.map((id) => [id, { run: RUN[id], fixture: () => withFixture(BROKEN[id], RUN[id]) }]))
if (process.argv[1] && process.argv[1].endsWith('gap-rules.mjs')) await main(checks)

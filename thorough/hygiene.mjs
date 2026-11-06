// Project hygiene checks that fit any repository. Run through packs/hygiene, or by hand:
//   node thorough/hygiene.mjs <check> [--root <dir>]      node thorough/hygiene.mjs <check> --fixtures   (must exit 1)
// Limits can be changed in .meerkat-budgets.json under "hygiene" (see docs/customizing.md).
import { existsSync, statSync, readdirSync } from 'node:fs'
import { dirname, extname, join } from 'node:path'
import { envFileHoldsSecret, finish, isFixture, keyFileHasContent, isTestFile, isText, main, readBudgets, readText, trackedFiles as allTracked, withFixture } from './kit.mjs'

// The hygiene checks leave folders of deliberately broken test files (fixtures/) alone.
const trackedFiles = (root) => allTracked(root).filter((f) => !isFixture(f))
// Checks about secrets, unsafe code, size and the licence look at every tracked file, fixtures included: nothing hides under a folder name.
const everyFile = allTracked

const limits = (root) => readBudgets(root)?.hygiene ?? {}
// A path glob: ** crosses folders (and may match none), * stays inside one folder.
const globToRe = (g) => new RegExp('^' + g.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\/\*\*$/, '\u0001').replace(/\*\*\/?/g, '\u0000').replace(/\*/g, '[^/]*').replace(/\u0000/g, '(?:.*/)?').replace(/\u0001/g, '(?:/.*)?') + '$')
const BINARY = /\.(exe|dll|so|dylib|zip|7z|rar|tar|gz|iso|dmg|msi|jar|class|pdb|node|wasm)$/i

const license = (root) => {
  const files = everyFile(root)
  const f = []
  const hasLicense = files.some((x) => /^(licen[sc]e|copying|unlicense)(\.[a-z]+)?$/i.test(x))
  if (!hasLicense) f.push('no LICENSE file at the top of the repository (without one, nobody may legally reuse the code)')
  const pkg = readText(root, 'package.json')
  if (pkg) {
    try {
      if (!JSON.parse(pkg).license) f.push('package.json has no "license" field')
    } catch {
      f.push('package.json is not valid JSON')
    }
  }
  const cargo = readText(root, 'Cargo.toml')
  if (/\[package\]/.test(cargo) && !/^\s*license(-file)?(\.workspace)?\s*=/m.test(cargo)) f.push('Cargo.toml has no license or license-file')
  const nm = join(root, 'node_modules')
  if (existsSync(nm)) {
    const copyleft = /\b(A?GPL|SSPL|BUSL|Commons Clause)/i
    const scan = (dir) => {
      for (const name of readdirSync(dir)) {
        if (name.startsWith('.')) continue
        const p = join(dir, name)
        if (name.startsWith('@')) scan(p)
        else {
          try {
            const j = JSON.parse(readText(p, 'package.json').replace(/^﻿/, '') || '{}')
            const l = typeof j.license === 'string' ? j.license : j.license?.type
            // "MIT OR GPL-3.0" lets you choose MIT, so an expression is a problem only when every choice is copyleft ("AND" needs both).
            const strong = (alt) => copyleft.test(alt) && !/LGPL/i.test(alt)
            const choices = l ? String(l).replace(/[()]/g, ' ').split(/\s+OR\s+/i) : []
            if (choices.length && choices.every(strong)) f.push(`dependency ${name} is ${l} (check it fits how you ship)`)
          } catch {
            /* unreadable package.json: not this check's job */
          }
        }
      }
    }
    scan(nm)
  }
  return finish('license', f, 'a license is declared and no copyleft dependency was found')
}

const largeFiles = (root) => {
  const max = (limits(root).largeFileMB ?? 5) * 2 ** 20
  const f = []
  for (const x of everyFile(root)) {
    let size = 0
    try {
      size = statSync(join(root, x)).size
    } catch {
      continue
    }
    if (size > max) f.push(`${x} is ${(size / 2 ** 20).toFixed(1)} MB (limit ${(max / 2 ** 20).toFixed(0)} MB)`)
    else if (BINARY.test(x) && !/(^|\/)(fixtures?|assets|vendor)\//i.test(x)) f.push(`${x} is a compiled or packed file committed to the repository`)
  }
  return finish('large-files', f)
}

const markers = (root) => {
  const bad = limits(root).markers ?? ['FIXME', 'XXX']
  // A marker is a whole word that is not part of a code such as NV-XXX-000 or XXX_ID (no - _ or letter/digit on either side).
  const re = new RegExp(`(?<![\\w-])(${bad.join('|')})(?![\\w-])`)
  // The start of a comment on a line: // , # , /* , <!-- or a leading * , outside a string literal (an even number of quotes before it).
  const commentAt = (l) => {
    for (const m of l.matchAll(/\/\/|#|\/\*|<!--|^\s*\*/g)) if (((l.slice(0, m.index).match(/(?<!\\)["'`]/g) ?? []).length % 2) === 0) return m.index
    return -1
  }
  const f = []
  let todo = 0
  for (const x of trackedFiles(root)) {
    if (!isText(x) || /(^|\/)(CHANGELOG|node_modules|vendor)/i.test(x) || x.endsWith('hygiene.mjs')) continue
    const lines = readText(root, x).split('\n')
    lines.forEach((l, i) => {
      if (/\bTODO\b/.test(l)) todo++
      // Only the comment text counts: a marker in code or in a string literal is a value, not a note.
      const at = commentAt(l)
      if (at >= 0 && re.test(l.slice(at))) f.push(`${x}:${i + 1} ${l.trim().slice(0, 90)}`)
    })
  }
  console.log(`(${todo} TODO notes counted; they do not fail the check)`)
  return finish('markers', f, `no ${bad.join('/')} notes left in the code`)
}

const lockfiles = (root) => {
  const files = new Set(trackedFiles(root))
  const f = []
  if (files.has('package.json') && !['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lockb', 'bun.lock'].some((l) => files.has(l))) f.push('package.json without a tracked lockfile: installs are not reproducible')
  const cargo = readText(root, 'Cargo.toml')
  if (cargo && (existsSync(join(root, 'src/main.rs')) || /\[\[bin\]\]/.test(cargo) || /\[workspace\]/.test(cargo)) && !files.has('Cargo.lock')) f.push('Cargo.toml for a program without a tracked Cargo.lock')
  return finish('lockfiles', f, 'every manifest has its lockfile')
}

const links = (root) => {
  const f = []
  for (const x of trackedFiles(root)) {
    if (!/\.md$/i.test(x)) continue
    const text = readText(root, x).replace(/```[\s\S]*?```/g, '')
    for (const m of text.matchAll(/\]\((?!https?:|mailto:|#|data:)([^)\s#]+)(#[^)]*)?\)/g)) {
      const target = decodeURIComponent(m[1])
      const p = target.startsWith('/') ? join(root, target) : join(root, dirname(x), target)
      if (!existsSync(p)) f.push(`${x}: link to ${target} goes nowhere`)
    }
  }
  return finish('links', f, 'every relative link in the documents resolves')
}

const sensitive = (root) => {
  const f = []
  for (const x of everyFile(root)) {
    const base = x.split('/').pop()
    // An environment file of placeholders (${VAR}) and plain settings documents what to set; only one that holds a secret is a leak.
    if (/^\.env(\..+)?$/.test(base) && !/example|sample|template/.test(base)) {
      if (envFileHoldsSecret(readText(root, x))) f.push(`${x} is an environment file tracked by git`)
    } else if (/\.(pem|p12|pfx|key|keystore|jks)$/i.test(base) || /^id_(rsa|ed25519|ecdsa)$/.test(base)) {
      // A .pem or .key that holds only comments is a stub ("mounted at runtime"), not a key.
      if (!/\.(pem|key)$/i.test(base) || keyFileHasContent(readText(root, x))) f.push(`${x} looks like a private key or keystore`)
    }
    else if (base === '.npmrc' && /_authToken=(?!\$\{)/.test(readText(root, x))) f.push(`${x} holds an npm token`)
  }
  return finish('sensitive-files', f, 'no environment files, keys or tokens are tracked')
}

// A desktop shell (Electron, Tauri, NW.js) shows its pages in a window on a computer, so "no viewport meta tag (breaks on phones)" does not apply to them.
const isDesktopApp = (root, files) => /"(electron|electron-builder|electron-forge|@electron-forge\/[\w-]+|@tauri-apps\/[\w-]+|nw)"\s*:/.test(readText(root, 'package.json')) || files.some((x) => /(^|\/)(tauri\.conf\.json|electron-builder\.(ya?ml|json))$/.test(x))
const uiStatic = (root) => {
  const f = []
  const files = trackedFiles(root)
  const desktop = isDesktopApp(root, files)
  // Paths the project says are not pages: hygiene.uiStaticSkip in .meerkat-budgets.json, globs such as "tools/gen-og-card.html" or "**/emails/**".
  const skip = (limits(root).uiStaticSkip ?? []).filter((g) => typeof g === 'string').map(globToRe)
  for (const x of files) {
    if (skip.some((re) => re.test(x))) continue
    if (!/\.(html?|tsx|jsx|vue|svelte)$/i.test(x) || /(^|\/)(node_modules|dist|build)\//.test(x)) continue
    // Tests and design mockups/prototypes are not shipped pages: their markup is sample input or a sketch.
    if (isTestFile(x) || /(^|\/)(mockups?|prototypes?|wireframes?)\//i.test(x)) continue
    const t = readText(root, x)
    for (const m of t.matchAll(/<img\b[^>]*>/gi)) if (!/\balt\s*=/.test(m[0])) f.push(`${x}: an <img> with no alt text`)
    for (const m of t.matchAll(/<a\b[^>]*target\s*=\s*["']_blank["'][^>]*>/gi)) if (!/rel\s*=\s*["'][^"']*no(?:opener|referrer)/.test(m[0])) f.push(`${x}: a link that opens a new tab without rel="noopener"`)
    // An HTML email template (an emails/ folder) is mail-client markup, not a page: it has no tab title and no viewport of its own.
    const emailTemplate = /(^|\/)(emails?|email-templates?|mail-templates?)\//i.test(x)
    if (/\.html?$/i.test(x) && /<html\b/i.test(t)) {
      if (!/<html\b[^>]*\blang\s*=/i.test(t)) f.push(`${x}: <html> has no lang attribute`)
      if (!desktop && !emailTemplate && !/<meta[^>]+viewport/i.test(t)) f.push(`${x}: no viewport meta tag (breaks on phones)`)
      if (!emailTemplate && !/<title>\s*\S/i.test(t)) f.push(`${x}: no page <title>`)
    }
    for (const m of t.matchAll(/<[a-z][\w-]*\b[^>]*\btabindex\s*=\s*["']?\s*([1-9]\d*)/gi)) f.push(`${x}:${t.slice(0, m.index).split('\n').length} a positive tabindex (${m[1]}) breaks the natural tab order`)
    for (const m of t.matchAll(/<button\b[^>]*>\s*<\/button>/gi)) f.push(`${x}: an empty <button> (no name for a screen reader) ${m[0].slice(0, 40)}`)
  }
  return finish('ui-static', f, 'images have alt text, pages have a language, title and viewport')
}

const jsonValid = (root) => {
  const f = []
  for (const x of trackedFiles(root)) {
    if (!/\.json$/i.test(x) || /(^|\/)(tsconfig[^/]*|jsconfig[^/]*|\.eslintrc|\.vscode\/[^/]+|devcontainer)\.json$/i.test(x) || /\.vscode\//.test(x)) continue
    try {
      JSON.parse(readText(root, x).replace(/^﻿/, ''))
    } catch (e) {
      f.push(`${x}: ${String(e.message).slice(0, 80)}`)
    }
  }
  return finish('json-valid', f, 'every tracked JSON file parses')
}

const conflicts = (root) => {
  const f = []
  for (const x of trackedFiles(root)) {
    if (!isText(x) || x.endsWith('hygiene.mjs')) continue
    const lines = readText(root, x).split('\n')
    lines.forEach((l, i) => {
      if (/^(<{7}|>{7})( |$)/.test(l) || /^={7}$/.test(l.replace('\r', '')) && /^(<{7} )/.test(lines[i - 2] ?? '')) f.push(`${x}:${i + 1} leftover merge-conflict marker`)
    })
  }
  return finish('conflict-markers', f, 'no merge-conflict markers left in files')
}

const scriptsResolve = (root) => {
  const f = []
  let pkg
  try {
    pkg = JSON.parse(readText(root, 'package.json') || '{}')
  } catch {
    return finish('scripts-resolve', ['package.json is not valid JSON'])
  }
  for (const [name, cmd] of Object.entries(pkg.scripts ?? {})) {
    for (const m of String(cmd).matchAll(/\bnode\s+(?:--[\w-]+\s+)*([^\s&|;"']+\.(?:m?js|cjs|ts))/g)) {
      if (/[$*{]/.test(m[1])) continue
      if (!existsSync(join(root, m[1]))) f.push(`script "${name}" runs ${m[1]}, which does not exist`)
    }
  }
  return finish('scripts-resolve', f, 'every file an npm script runs exists')
}

const unsafeRust = (root) => {
  const f = []
  for (const x of everyFile(root)) {
    if (extname(x) !== '.rs') continue
    const lines = readText(root, x).split('\n')
    lines.forEach((l, i) => {
      if (/\bunsafe\s*(\{|fn|impl|trait)/.test(l) && !/^\s*(\/\/|\*)/.test(l) && !lines.slice(Math.max(0, i - 3), i + 1).some((p) => /SAFETY:/i.test(p))) f.push(`${x}:${i + 1} unsafe with no "// SAFETY:" note explaining why it is sound`)
    })
  }
  return finish('unsafe-rust', f, 'every unsafe block says why it is safe (or there are none)')
}

const fixture = (files, fn) => ({ fixture: () => withFixture(files, fn) })

main({
  license: { run: license, ...fixture({ 'package.json': '{"name":"x"}' }, license) },
  'large-files': { run: largeFiles, ...fixture({ 'a.zip': 'PK' }, largeFiles) },
  markers: { run: markers, ...fixture({ 'a.js': '// FIXME: broken\n' }, markers) },
  lockfiles: { run: lockfiles, ...fixture({ 'package.json': '{}' }, lockfiles) },
  links: { run: links, ...fixture({ 'README.md': 'see [x](missing.md)\n' }, links) },
  'sensitive-files': { run: sensitive, ...fixture({ '.env': 'API_SECRET=abc123def456\n' }, sensitive) },
  'ui-static': { run: uiStatic, ...fixture({ 'p.html': '<html><body><img src="a.png"></body></html>' }, uiStatic) },
  'json-valid': { run: jsonValid, ...fixture({ 'c.json': '{ not json' }, jsonValid) },
  'conflict-markers': { run: conflicts, ...fixture({ 'a.js': 'x\n<<<<<<< HEAD\ny\n' }, conflicts) },
  'scripts-resolve': { run: scriptsResolve, ...fixture({ 'package.json': '{"scripts":{"go":"node nope.mjs"}}' }, scriptsResolve) },
  'unsafe-rust': { run: unsafeRust, ...fixture({ 'a.rs': 'fn f() { unsafe { x() } }\n' }, unsafeRust) },
})

// Documents and config that a healthy project carries: README, security policy, contributing guide, code owners, ignore rules,
// editor config, changelog, licence, CI and dependency updates. Plain file reads, no tool to install.
// Run through the repo pack, or by hand:
//   node thorough/repo-docs.mjs <check> [--root <dir>]      node thorough/repo-docs.mjs <check> --fixtures   (must exit 1)
// Limits are set in .meerkat-budgets.json under "repo". A check that is skipped says why in its pass note.
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { finish, isFixture, main, readBudgets, readText, trackedFiles, withFixture } from './kit.mjs'

const cfg = (root) => readBudgets(root)?.repo ?? {}
const exists = (root, p) => existsSync(join(root, p))
const SOURCE = /\.(m?[jt]sx?|cjs|py|rs|go|rb|php|java|cs|kt|swift|dart|c|cc|cpp|h|hpp|svelte|vue)$/i
const sourceFiles = (files) => files.filter((f) => SOURCE.test(f) && !isFixture(f) && !/(^|\/)(node_modules|dist|build|target|vendor)\//.test(f))
const rootFiles = (files) => files.filter((f) => !f.includes('/'))
const readmeOf = (files) => rootFiles(files).find((f) => /^readme(\.(md|markdown|rst|txt|adoc))?$/i.test(f))
const fx = (files, run) => ({ fixture: () => withFixture(files, run) })

// ---- readme-sections: a title, a how-to-run heading, and a licence mention
const readmeSections = (root) => {
  const name = readmeOf(trackedFiles(root))
  if (!name) return finish('readme-sections', ['there is no README at the top of the repo'])
  const text = readText(root, name)
  const heads = [...text.matchAll(/^#{1,6}\s+(.+)$/gm)].map((m) => m[1].trim())
  const f = []
  if (!heads.length) f.push(`${name} has no headings, so it has no title`)
  if (!heads.some((h) => /install|usage|getting started|quick start|run/i.test(h))) f.push(`${name} has no heading for installing, usage or running the project (for example "Install" or "Usage")`)
  if (!/licen[cs]e/i.test(text)) f.push(`${name} does not mention the licence`)
  return finish('readme-sections', f, `${name} has a title, a how-to-run heading and a licence mention`)
}

// ---- security-policy: SECURITY.md exists, is not empty, and says how to report a problem
const securityPolicy = (root) => {
  const name = trackedFiles(root).find((f) => /^(\.github\/)?security\.md$/i.test(f))
  if (!name) return finish('security-policy', ['there is no SECURITY.md (root or .github/) telling people how to report a security problem'])
  const text = readText(root, name).trim()
  if (!text) return finish('security-policy', [`${name} is empty`])
  if (!/report|contact|email|advisory/i.test(text)) return finish('security-policy', [`${name} does not say how to report a security problem (name an email, a contact or the advisory page)`])
  return finish('security-policy', [], `${name} says how to report a security problem`)
}

// ---- contributing-file: CONTRIBUTING.md once a project has a README and more than a few source files
const contributingFile = (root) => {
  const files = trackedFiles(root)
  const min = cfg(root).contributingMinSources ?? 3
  const sources = sourceFiles(files).length
  if (!readmeOf(files) || sources <= min) return finish('contributing-file', [], 'skipped: the repo has no README, or only a few source files')
  if (files.some((f) => /^(CONTRIBUTING\.md|docs\/CONTRIBUTING\.md|\.github\/CONTRIBUTING\.md)$/i.test(f))) return finish('contributing-file', [], 'a CONTRIBUTING.md is present')
  return finish('contributing-file', ['there is no CONTRIBUTING.md (root, docs/ or .github/) telling people how to propose a change'])
}

// ---- codeowners-valid: every pattern has real owners, and no pattern is listed twice
const codeownersValid = (root) => {
  const name = trackedFiles(root).find((f) => /^(CODEOWNERS|docs\/CODEOWNERS|\.github\/CODEOWNERS)$/.test(f))
  if (!name) return finish('codeowners-valid', [], 'skipped: there is no CODEOWNERS file')
  const f = []
  const seen = new Set()
  readText(root, name).split('\n').forEach((raw, i) => {
    const line = raw.replace(/\s+#.*$/, '').trim()
    if (!line || line.startsWith('#')) return
    const [pattern, ...owners] = line.split(/\s+/)
    const where = `${name}:${i + 1}`
    if (!owners.length) f.push(`${where} the pattern ${pattern} has no owner`)
    for (const o of owners) {
      if (!/^@[\w.-]+(\/[\w.-]+)?$/.test(o) && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(o)) f.push(`${where} "${o}" is not a user, team or email`)
    }
    if (seen.has(pattern)) f.push(`${where} the pattern ${pattern} is listed twice`)
    seen.add(pattern)
  })
  return finish('codeowners-valid', f, `${name} gives every pattern a valid owner`)
}

// ---- gitignore-essentials: the ignore file covers what the project obviously makes, and nothing it ignores was committed
const gitignoreEssentials = (root) => {
  const files = trackedFiles(root)
  if (!exists(root, '.gitignore')) return finish('gitignore-essentials', ['there is no .gitignore at the top of the repo'])
  const lines = readText(root, '.gitignore').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))
  const has = (re) => lines.some((l) => re.test(l))
  const f = []
  if (exists(root, 'package.json') && !has(/^\/?(\*\*\/)?node_modules\/?$/)) f.push('.gitignore does not ignore node_modules/ (the project has a package.json)')
  if (exists(root, 'Cargo.toml') && !has(/^\/?(\*\*\/)?target\/?$/)) f.push('.gitignore does not ignore target/ (the project has a Cargo.toml)')
  if (sourceFiles(files).some((x) => /\.py$/i.test(x)) && !has(/__pycache__|\*\.pyc/)) f.push('.gitignore does not ignore __pycache__/ or *.pyc (the project has Python files)')
  if (!has(/^\/?\.env(\*|\.\*)?$|^\*\.env$/)) f.push('.gitignore does not ignore .env (secrets)')
  if (!has(/\.DS_Store|Thumbs\.db/)) f.push('.gitignore does not ignore OS junk (.DS_Store or Thumbs.db)')
  // A folder the ignore file names, but that git already tracks: the rule came too late, so the files need removing from git.
  for (const dir of ['node_modules', 'target', '__pycache__']) {
    if (!has(new RegExp(`^/?(\\*\\*/)?${dir}/$`))) continue
    const hit = files.find((x) => x.split('/').includes(dir))
    if (hit) f.push(`${hit} is tracked, but .gitignore ignores ${dir}/ (remove it from git with git rm --cached, the disk copy can stay)`)
  }
  for (const x of files) if (/(^|\/)(\.DS_Store|Thumbs\.db)$/.test(x)) f.push(`${x} is tracked OS junk`)
  return finish('gitignore-essentials', f, '.gitignore covers dependencies, secrets and OS junk, and nothing it ignores is committed')
}

// ---- editorconfig-present: one shared set of editor settings, once there are several source files
const editorconfigPresent = (root) => {
  const min = cfg(root).editorconfigMinSources ?? 5
  const n = sourceFiles(trackedFiles(root)).length
  if (n < min) return finish('editorconfig-present', [], `skipped: the repo has fewer than ${min} source files`)
  if (!exists(root, '.editorconfig')) return finish('editorconfig-present', ['there is no .editorconfig, so editors can disagree on indentation and line endings'])
  return finish('editorconfig-present', [], '.editorconfig is present')
}

// ---- changelog-format: an Unreleased or version heading, and versions newest first
const cmpVersion = (a, b) => {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] - b[i]
  return 0
}
const changelogFormat = (root) => {
  const name = rootFiles(trackedFiles(root)).find((f) => /^CHANGELOG\.md$/i.test(f))
  if (!name) return finish('changelog-format', [], 'skipped: there is no CHANGELOG.md')
  const heads = [...readText(root, name).matchAll(/^#{2,3}\s+(.+)$/gm)].map((m) => m[1].trim().replace(/[[\]]/g, '').split(/\s+/)[0])
  const f = []
  if (!heads.some((h) => /^unreleased$/i.test(h) || /^v?\d+\.\d+/.test(h))) f.push(`${name} has no version heading and no Unreleased heading`)
  const versions = []
  for (const h of heads) {
    const m = /^v?(\d+)\.(\d+)\.(\d+)/.exec(h)
    if (m) versions.push({ label: h, nums: m.slice(1).map(Number) })
  }
  for (let i = 1; i < versions.length; i++) {
    if (cmpVersion(versions[i].nums, versions[i - 1].nums) > 0) f.push(`${name}: version ${versions[i].label} is listed below ${versions[i - 1].label}, but newer versions go first`)
  }
  return finish('changelog-format', f, `${name} has version headings, newest first`)
}

// ---- license-matches: the LICENSE file's licence agrees with the licence the manifest declares
const LICENCE_TEXT = [
  ['AGPL', /GNU AFFERO/i],
  ['LGPL', /GNU LESSER|GNU LIBRARY GENERAL|\bLGPL\b/i],
  ['GPL', /GNU GENERAL PUBLIC|\bGPL\b/i],
  ['MPL', /MOZILLA PUBLIC LICENSE/i],
  ['Apache', /APACHE LICENSE/i],
  ['MIT', /MIT LICENSE|PERMISSION IS HEREBY GRANTED/i],
  ['ISC', /ISC LICENSE/i],
  ['BSD', /\bBSD\b/i],
  ['Unlicense', /THIS IS FREE AND UNENCUMBERED|UNLICENSE/i],
]
const detectLicence = (text) => {
  const head = text.split('\n').slice(0, 40).join('\n')
  return LICENCE_TEXT.find(([, re]) => re.test(head))?.[0] ?? null
}
const familyOf = (token) => {
  const t = token.toUpperCase()
  if (t === 'UNLICENSED') return null
  if (t === 'MIT') return 'MIT'
  if (t.startsWith('APACHE')) return 'Apache'
  if (t === 'ISC') return 'ISC'
  if (t.startsWith('BSD')) return 'BSD'
  if (t.startsWith('AGPL')) return 'AGPL'
  if (t.startsWith('LGPL')) return 'LGPL'
  if (t.startsWith('GPL')) return 'GPL'
  if (t.startsWith('MPL')) return 'MPL'
  if (t.startsWith('UNLICEN')) return 'Unlicense'
  return null
}
// The licence families a declared value names, or null for a custom name ("SEE LICENSE IN LICENSE") that is not compared.
const declaredFamilies = (value) => {
  if (/SEE LICEN/i.test(value)) return null
  const fams = value.split(/[^A-Za-z0-9.-]+/).map(familyOf).filter(Boolean)
  return fams.length ? fams : null
}
const licenseMatches = (root) => {
  const lic = rootFiles(trackedFiles(root)).find((f) => /^(LICEN[CS]E|COPYING)(\.(md|txt))?$/i.test(f))
  if (!lic) return finish('license-matches', [], 'skipped: there is no LICENSE file')
  const declared = []
  try {
    const j = JSON.parse(readText(root, 'package.json'))
    const value = typeof j.license === 'string' ? j.license : j.license?.type
    if (value) declared.push(['package.json', value])
  } catch {
    // no package.json, or it is not JSON: nothing declared there
  }
  const cargo = /^\s*license\s*=\s*"([^"]+)"/m.exec(readText(root, 'Cargo.toml'))
  if (cargo) declared.push(['Cargo.toml', cargo[1]])
  if (!declared.length) return finish('license-matches', [], `skipped: ${lic} exists, and no licence is declared in package.json or Cargo.toml`)
  const detected = detectLicence(readText(root, lic))
  if (!detected) return finish('license-matches', [], `skipped: ${lic} is not a licence this check recognises, so it cannot be compared`)
  const f = []
  for (const [from, value] of declared) {
    const fams = declaredFamilies(value)
    if (fams && !fams.includes(detected)) f.push(`${from} declares ${value} but ${lic} is a ${detected} licence`)
  }
  return finish('license-matches', f, `${lic} agrees with the declared licence (${detected})`)
}

// ---- ci-present: some automated check config runs the checks on each change
const CI_FILE = /^(\.github\/workflows\/[^/]+\.ya?ml|\.gitlab-ci\.yml|azure-pipelines\.yml|\.circleci\/config\.yml|Jenkinsfile|\.travis\.yml|bitbucket-pipelines\.yml)$/
const ciPresent = (root) => {
  const files = trackedFiles(root)
  if (files.some((f) => CI_FILE.test(f))) return finish('ci-present', [], 'an automated check config is present')
  const min = cfg(root).ciMinSources ?? 3
  if (sourceFiles(files).length < min) return finish('ci-present', [], `skipped: the repo has fewer than ${min} source files`)
  return finish('ci-present', ['there is no automated check config (GitHub Actions, GitLab CI, CircleCI, Jenkins or similar), so nothing runs the checks on each change'])
}

// ---- dependency-updates-configured: a bot opens update pull requests when a manifest exists
const UPDATE_BOT = /^(\.github\/dependabot\.ya?ml|renovate\.json5?|\.renovaterc(\.json5?)?|\.github\/renovate\.json5?)$/
const MANIFESTS = ['package.json', 'Cargo.toml', 'requirements.txt', 'go.mod', 'pom.xml']
const dependencyUpdatesConfigured = (root) => {
  const files = trackedFiles(root)
  if (!MANIFESTS.some((m) => files.includes(m))) return finish('dependency-updates-configured', [], 'skipped: there is no package manifest at the top of the repo')
  if (files.some((f) => UPDATE_BOT.test(f)) || /"renovate"\s*:/.test(readText(root, 'package.json'))) return finish('dependency-updates-configured', [], 'a dependency update bot is configured')
  return finish('dependency-updates-configured', ['no dependency update bot is configured (.github/dependabot.yml or a Renovate config), so dependency fixes arrive only when someone remembers'])
}

main({
  'readme-sections': { run: readmeSections, ...fx({ 'README.md': '# Demo\n\nA small tool.\n' }, readmeSections) },
  'security-policy': { run: securityPolicy, ...fx({ 'README.md': '# Demo\n' }, securityPolicy) },
  'contributing-file': { run: contributingFile, ...fx({ 'README.md': '# Demo\n', 'a.js': '1\n', 'b.js': '1\n', 'c.js': '1\n', 'd.js': '1\n' }, contributingFile) },
  'codeowners-valid': { run: codeownersValid, ...fx({ 'CODEOWNERS': '/src/\n* @team-a\n' }, codeownersValid) },
  'gitignore-essentials': { run: gitignoreEssentials, ...fx({ 'package.json': '{}\n', '.gitignore': '.env\n.DS_Store\n' }, gitignoreEssentials) },
  'editorconfig-present': { run: editorconfigPresent, ...fx({ 'a.js': '1\n', 'b.js': '1\n', 'c.js': '1\n', 'd.js': '1\n', 'e.js': '1\n' }, editorconfigPresent) },
  'changelog-format': { run: changelogFormat, ...fx({ 'CHANGELOG.md': '# Changelog\n\n## 1.0.0\n\n## 2.0.0\n' }, changelogFormat) },
  'license-matches': { run: licenseMatches, ...fx({ 'LICENSE': 'MIT License\n\nPermission is hereby granted, free of charge.\n', 'package.json': '{"license":"Apache-2.0"}\n' }, licenseMatches) },
  'ci-present': { run: ciPresent, ...fx({ 'a.js': '1\n', 'b.js': '1\n', 'c.js': '1\n', 'd.js': '1\n' }, ciPresent) },
  'dependency-updates-configured': { run: dependencyUpdatesConfigured, ...fx({ 'package.json': '{}\n' }, dependencyUpdatesConfigured) },
})

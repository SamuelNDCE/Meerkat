// "Is this folder a project?" Meerkat checks projects, not any folder: a run in the home folder, a downloads folder or an empty
// directory would scan unrelated files and report meaningless results. A folder counts as a project when it
//   - is inside a git repository (a .git folder or file in it or in a parent), or
//   - holds a recognised project marker (package.json, Cargo.toml, pyproject.toml, requirements.txt, go.mod, pom.xml, build.gradle,
//     a .csproj or .sln, composer.json, Gemfile, pubspec.yaml, Package.swift, Dockerfile, a .tf file, ...), or
//   - holds an index.html together with other web files (.css, .js, .mjs), or
//   - holds enough source files (SOURCE_FILE_MIN, looked for in the folder and one level down).
// `meerkat verify <folder> --force` runs anyway. Pure of terminals: the filesystem is passed in, so tests use a fake tree.
import * as nodeFs from 'node:fs'
import { dirname, join, resolve } from 'node:path'

export const SOURCE_FILE_MIN = 5
export const MARKER_FILES = [
  'package.json', 'Cargo.toml', 'pyproject.toml', 'requirements.txt', 'setup.py', 'go.mod', 'pom.xml', 'build.gradle', 'build.gradle.kts',
  'composer.json', 'Gemfile', 'pubspec.yaml', 'Package.swift', 'Dockerfile', 'CMakeLists.txt', 'Makefile', 'deno.json', 'mix.exs', 'meerkat.config.json',
]
const MARKER_PATTERNS = [/\.(csproj|sln|fsproj|vbproj)$/i, /\.tf$/i]
const SOURCE_EXT = /\.(c|cc|cpp|cs|css|dart|go|h|hpp|java|js|jsx|kt|mjs|cjs|php|py|rb|rs|scala|svelte|swift|ts|tsx|vue|html)$/i
const SKIP = new Set(['node_modules', '.git', 'target', 'dist', 'build', '__pycache__'])

// What the message lists, in the words a person knows them by.
export const MARKER_NAMES = 'package.json, Cargo.toml, pyproject.toml, requirements.txt, go.mod, pom.xml, build.gradle, *.csproj/*.sln, composer.json, Gemfile, pubspec.yaml, Package.swift, Dockerfile, *.tf, index.html with other web files'

const names = (dir, fs) => {
  try {
    return fs.readdirSync(dir)
  } catch {
    return null
  }
}

function gitRootAbove(dir, fs) {
  let d = resolve(dir)
  for (let i = 0; i < 64; i++) {
    try {
      if (fs.existsSync(join(d, '.git'))) return d
    } catch {
      /* unreadable: keep going up */
    }
    const up = dirname(d)
    if (up === d) return null
    d = up
  }
  return null
}

// { ok, why } where `why` names the reason it counts ('a git repository', 'package.json', ...) or null. `quick` skips the source-file
// count (the folder browser asks about many folders, and a marker check is enough there).
export function projectCheck(dir, { fs = nodeFs, quick = false } = {}) {
  const list = names(dir, fs)
  if (list === null) return { ok: false, why: null, unreadable: true }
  const git = gitRootAbove(dir, fs)
  if (git) return { ok: true, why: 'a git repository' }
  const marker = list.find((n) => MARKER_FILES.includes(n)) ?? list.find((n) => MARKER_PATTERNS.some((re) => re.test(n)))
  if (marker) return { ok: true, why: marker }
  const web = list.filter((n) => /\.(css|js|mjs|ts)$/i.test(n))
  if (list.includes('index.html') && web.length) return { ok: true, why: 'index.html with other web files' }
  if (quick) return { ok: false, why: null }
  let sources = list.filter((n) => SOURCE_EXT.test(n)).length
  if (sources < SOURCE_FILE_MIN) {
    for (const n of list) {
      if (sources >= SOURCE_FILE_MIN) break
      if (n.startsWith('.') || SKIP.has(n) || n.includes('.')) continue
      const sub = names(join(dir, n), fs)
      if (sub) sources += sub.filter((s) => SOURCE_EXT.test(s)).length
    }
  }
  return sources >= SOURCE_FILE_MIN ? { ok: true, why: `${sources} source files` } : { ok: false, why: null, sources }
}

export const isProject = (dir, opts) => projectCheck(dir, opts).ok

// The plain message, the same for a person at the terminal and for a script or an AI agent reading --json-stdout.
export function notProjectMessage(dir) {
  return `${dir} is not a project: no git repository, no ${MARKER_NAMES} found, and fewer than ${SOURCE_FILE_MIN} source files; pass --force to run anyway`
}

// The JSON a script gets on stdout (--json-stdout) instead of a summary.
export function notProjectJson(dir) {
  return { ok: false, error: 'not-a-project', folder: dir, message: notProjectMessage(dir), exitCode: 2, fix: 'pass --force to run anyway, or choose a project folder' }
}

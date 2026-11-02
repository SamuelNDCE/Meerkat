// Detection gaps in code and config files (docs/accuracy.md, Known gaps): each fix is tested on both sides, the planted shape reports
// and a clean look-alike does not.
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, test } from 'vitest'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const made: string[] = []
afterAll(() => {
  for (const d of made) rmSync(d, { recursive: true, force: true })
})

// Runs one check on a tiny git project made of the given files; returns the exit code and the printed output.
function run(script: string, check: string, files: Record<string, string>): { code: number; out: string } {
  const dir = mkdtempSync(join(tmpdir(), 'meerkat-gaps-code-'))
  made.push(dir)
  for (const [name, body] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, name)), { recursive: true })
    writeFileSync(join(dir, name), body)
  }
  execFileSync('git', ['init', '-q'], { cwd: dir, stdio: 'ignore' })
  execFileSync('git', ['-C', dir, 'add', '-A'], { stdio: 'ignore' })
  try {
    const out = execFileSync(process.execPath, [script, check, '--root', dir], { cwd: ROOT, stdio: 'pipe', encoding: 'utf8' })
    return { code: 0, out }
  } catch (e: any) {
    return { code: e.status ?? -1, out: String(e.stdout ?? '') }
  }
}
const flags = (script: string, check: string, files: Record<string, string>) => run(script, check, files).code === 1

describe('cp-js: require of a computed or concatenated name', () => {
  const f = (body: string) => ({ 'src/a.js': `${body}\n` })
  test('reports a template literal with an interpolation', () => {
    expect(flags('thorough/code-patterns.mjs', 'cp-js', f('const plugin = require(`./plugins/${req.query.name}`)'))).toBe(true)
  })
  test('reports a string joined to a variable', () => {
    expect(flags('thorough/code-patterns.mjs', 'cp-js', f("const handler = require('./handlers/' + type)"))).toBe(true)
  })
  test('leaves fixed names alone', () => {
    for (const body of ["const a = require('./local')", 'const a = require(`./local`)', "const a = require(path.join(__dirname, 'x'))", "const a = require('./a' + '.js')", "const a = require('./native-' + process.platform)", "const a = require('./x' + SUFFIX)"]) {
      expect(flags('thorough/code-patterns.mjs', 'cp-js', f(body))).toBe(false)
    }
  })
})

describe('cp-dotnet-php-ruby: System.Random for a token held in a camelCase name', () => {
  const cs = (line: string) => ({ 'src/V.cs': `class V {\n  string H() { ${line} }\n}\n` })
  test('reports resetToken made with System.Random', () => {
    expect(flags('thorough/code-patterns.mjs', 'cp-dotnet-php-ruby', cs('var resetToken = new System.Random().Next().ToString(); return resetToken;'))).toBe(true)
  })
  test('leaves a cryptographic generator and a non-secret Random alone', () => {
    expect(flags('thorough/code-patterns.mjs', 'cp-dotnet-php-ruby', cs('var resetToken = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32)); return resetToken;'))).toBe(false)
    expect(flags('thorough/code-patterns.mjs', 'cp-dotnet-php-ruby', cs('var jitter = new System.Random().Next(5); return jitter.ToString();'))).toBe(false)
  })
})

describe('toml-valid: a multi-line array never closed', () => {
  test('reports an array that runs to the end of the file', () => {
    expect(flags('thorough/config.mjs', 'toml-valid', { 'cfg/a.toml': '[server]\nports = [\n  80,\n  443,\n\n[db]\nhost = "x"\n' })).toBe(true)
  })
  test('leaves a closed multi-line array alone', () => {
    expect(flags('thorough/config.mjs', 'toml-valid', { 'cfg/a.toml': '[server]\nports = [\n  80,\n  443,\n]\n\n[db]\nhost = "x"\nnested = [\n  [1, 2],\n  [3, 4],\n]\n' })).toBe(false)
  })
})

describe('csv-consistent: a semicolon-separated file', () => {
  test('reports a long row', () => {
    expect(flags('thorough/content.mjs', 'csv-consistent', { 'data/s.csv': 'id;name;score\n1;a;4\n2;b;5;9;9\n' })).toBe(true)
  })
  test('leaves consistent semicolon rows, quoted semicolons and comma files alone', () => {
    expect(flags('thorough/content.mjs', 'csv-consistent', { 'data/s.csv': 'id;name;score\n1;a;4\n2;"b;c";5\n' })).toBe(false)
    expect(flags('thorough/content.mjs', 'csv-consistent', { 'data/c.csv': 'id,note,score\n1,"a;b;c;d",4\n' })).toBe(false)
  })
})

describe('spell-common-typos: a plain .txt file', () => {
  test('reports a misspelling in prose', () => {
    expect(flags('thorough/content.mjs', 'spell-common-typos', { 'docs/typo.txt': 'Make sure teh config is adress-able.\n' })).toBe(true)
  })
  test('leaves correct prose and dependency lists alone', () => {
    expect(flags('thorough/content.mjs', 'spell-common-typos', { 'docs/ok.txt': 'Make sure the config is addressable.\n' })).toBe(false)
    expect(flags('thorough/content.mjs', 'spell-common-typos', { 'requirements.txt': 'teh==1.0\n' })).toBe(false)
  })
})

describe('notebook-secrets and notebook-absolute-paths', () => {
  const nb = (source: string[], text: string[]) =>
    JSON.stringify({ cells: [{ cell_type: 'code', execution_count: 1, metadata: {}, source, outputs: text.length ? [{ output_type: 'stream', name: 'stdout', text }] : [] }], metadata: {}, nbformat: 4, nbformat_minor: 5 })
  const npm = ['npm_', 'a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8'].join('')
  test('reports an npm token printed in an output', () => {
    expect(flags('thorough/data-science.mjs', 'notebook-secrets', { 'n/a.ipynb': nb(['import os'], [`token=${npm}\n`]) })).toBe(true)
  })
  test('leaves an ordinary output alone', () => {
    expect(flags('thorough/data-science.mjs', 'notebook-secrets', { 'n/a.ipynb': nb(['import os'], ['npm_config_cache is set\n']) })).toBe(false)
  })
  test('reports a Windows path written with doubled backslashes', () => {
    expect(flags('thorough/data-science.mjs', 'notebook-absolute-paths', { 'n/a.ipynb': nb(['df = read("C:\\\\Users\\\\dana\\\\data.csv")'], []) })).toBe(true)
  })
  test('leaves a relative path alone', () => {
    expect(flags('thorough/data-science.mjs', 'notebook-absolute-paths', { 'n/a.ipynb': nb(['df = read("data\\\\x.csv")'], []) })).toBe(false)
  })
})

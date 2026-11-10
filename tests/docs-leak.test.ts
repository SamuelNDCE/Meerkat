// Fails when a tracked public doc contains a private local path, a private product's internals,
// an internal issue number, an email address, a token-looking string or internal planning text.
// Fine public mentions go in docs/leak-allow.txt (one per line: <path prefix> <TAB> <pattern id>).
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const SCOPE = ['docs', 'README.md', 'CHANGELOG.md', 'CONTRIBUTING.md', 'SECURITY.md', 'MAP.md', 'skills', 'llms.txt', 'profiles', 'examples']
const BINARY = /\.(svg|png|gif|jpe?g|webp|ico|woff2?)$/i

const PATTERNS: Record<string, RegExp> = {
  'home-path': /[A-Za-z]:[\x5c\x2f]+Users[\x5c\x2f]|\x2fhome\x2f[a-z][A-Za-z0-9_.-]*\x2f|\x2fUsers\x2f[a-z][A-Za-z0-9_.-]*\x2f/,
  'workspace-path': /AiWorkspace|sample-vault/,
  'cloud-sync': /nextcloud/i,
  'chat-service': /discord/i,
  email: /[\w.+-]+@[\w-]+\.[A-Za-z]{2,}/,
  person: /Samuel(?!NDCE)|\bOwen\b/,
  'issue-number': /(^|[^&\w/])#\d{3,5}\b/,
  'private-repo': /private repo/i,
  'private-internals': /desktop-electron|nv-sidecar|nv-shared|nv_agents/,
  secret: /\b(ghp_|github_pat_|sk-|xox[bp]-|AKIA)[A-Za-z0-9_-]{10,}|(token|secret|password|api[_-]?key)["']?\s*[:=]\s*["'][A-Za-z0-9_\-+/]{20,}["']/i,
}

function allowList(): Array<{ prefix: string; id: string }> {
  const text = readFileSync(new URL('../docs/leak-allow.txt', import.meta.url), 'utf8')
  return text.split(/\r?\n/).filter((l) => l.trim() && !l.startsWith('#')).map((l) => {
    const [prefix, id] = l.split('\t')
    return { prefix: prefix.trim(), id: (id ?? '').trim() }
  })
}

describe('public docs carry no private values', () => {
  test('no hit outside docs/leak-allow.txt', () => {
    const files = execFileSync('git', ['ls-files', '--', ...SCOPE], { cwd: ROOT, encoding: 'utf8' })
      .split(/\r?\n/).filter((f) => f && !BINARY.test(f) && f !== 'docs/leak-allow.txt')
    const allow = allowList()
    const hits: string[] = []
    for (const f of files) {
      const lines = readFileSync(ROOT + f, 'utf8').split(/\r?\n/)
      lines.forEach((line, i) => {
        for (const [id, re] of Object.entries(PATTERNS)) {
          if (!re.test(line)) continue
          if (allow.some((a) => a.id === id && f.startsWith(a.prefix))) continue
          hits.push(`${f}:${i + 1} [${id}]`)
        }
      })
    }
    expect(hits).toEqual([])
  })

  test('the allow-list only names known patterns and existing prefixes', () => {
    const tracked = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' }).split(/\r?\n/)
    for (const a of allowList()) {
      expect(Object.keys(PATTERNS)).toContain(a.id)
      expect(tracked.some((f) => f.startsWith(a.prefix))).toBe(true)
    }
  })

  test('each pattern catches its own sample', () => {
    const samples: Record<string, string> = {
      'home-path': ['C:', 'Users', 'someone'].join(String.fromCharCode(92)) + String.fromCharCode(92), 'workspace-path': 'AiWorkspace', 'cloud-sync': 'Nextcloud', 'chat-service': 'Discord',
      email: 'a.b@example.com', person: 'Samuel said', 'issue-number': 'see #1234', 'private-repo': 'private repo',
      'private-internals': 'apps/desktop-electron', secret: 'ghp_abcdefghijklmnop',
    }
    for (const [id, s] of Object.entries(samples)) expect(PATTERNS[id].test(s), id).toBe(true)
  })
})

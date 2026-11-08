import { execFileSync, spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, dirname, join } from 'node:path'
import { describe, expect, test } from 'vitest'
// @ts-expect-error plain .mjs module
import { prePushBlock } from './ci-output.mjs'
// @ts-expect-error plain .mjs module
import { runExtra } from './extras-cli.mjs'

const tmp = mkdtempSync(join(tmpdir(), 'meerkat-hooksafe-'))
const emptyGlobal = join(tmp, 'global.gitconfig')
writeFileSync(emptyGlobal, '')
const baseEnv = { ...process.env, GIT_CONFIG_GLOBAL: emptyGlobal, GIT_CONFIG_NOSYSTEM: '1' }

const repo = (name: string) => {
  const dir = join(tmp, name)
  mkdirSync(dir, { recursive: true })
  execFileSync('git', ['init', '-q', dir], { env: baseEnv })
  return dir
}
const hookFile = (dir: string) => join(dir, '.git', 'hooks', 'pre-push')
const hook = (action: string, dir: string, env: NodeJS.ProcessEnv = baseEnv) => {
  const out: string[] = []
  const err: string[] = []
  const code = runExtra(['hook', action, dir], { env, cwd: dir, out: (t: string) => out.push(t), err: (t: string) => err.push(t) })
  return { code, text: [...out, ...err].join('\n') }
}

const shPath = (() => {
  for (const d of (process.env.PATH ?? '').split(delimiter)) {
    for (const n of ['sh.exe', 'sh']) {
      const p = join(d, n)
      if (d && existsSync(p)) return p
    }
  }
  return null
})()
const sh = shPath ? test : test.skip

describe('hook install safety', () => {
  test('a clean repo gets the block, and status says so', () => {
    const dir = repo('clean')
    expect(hook('status', dir).text).toContain('installed: no')
    const r = hook('install', dir)
    expect(r.code).toBe(0)
    const text = readFileSync(hookFile(dir), 'utf8')
    expect(text).toContain('# >>> meerkat pre-push >>>')
    expect(text).toContain('meerkat_fault "meerkat not found"')
    const s = hook('status', dir)
    expect(s.code).toBe(0)
    expect(s.text).toContain('installed: yes')
    expect(s.text).toContain('Install would be allowed')
  })

  test('a non-sh shebang is refused with exit 2 and the file is untouched', () => {
    const dir = repo('python')
    const orig = '#!/usr/bin/env python3\nprint("hi")\n'
    writeFileSync(hookFile(dir), orig)
    const r = hook('install', dir)
    expect(r.code).toBe(2)
    expect(r.text).toContain('non-sh shebang')
    expect(readFileSync(hookFile(dir), 'utf8')).toBe(orig)
    expect(hook('status', dir).text).toContain('Install would be refused')
  })

  test('a trailing exit is refused with exit 2', () => {
    const dir = repo('trailing-exit')
    writeFileSync(hookFile(dir), '#!/bin/sh\necho mine\nexit 0\n')
    const r = hook('install', dir)
    expect(r.code).toBe(2)
    expect(r.text).toContain('would stop the Meerkat block')
  })

  test('a global core.hooksPath is refused with exit 2', () => {
    const dir = repo('global-hooks')
    const g = join(tmp, 'with-hookspath.gitconfig')
    writeFileSync(g, '[core]\n\thooksPath = /somewhere/shared-hooks\n')
    const r = hook('install', dir, { ...baseEnv, GIT_CONFIG_GLOBAL: g })
    expect(r.code).toBe(2)
    expect(r.text).toContain('global core.hooksPath')
  })

  test('a core.hooksPath pointing into the repo (husky) is refused with exit 2', () => {
    const dir = repo('husky')
    execFileSync('git', ['-C', dir, 'config', '--local', 'core.hooksPath', '.husky'], { env: baseEnv })
    const r = hook('install', dir)
    expect(r.code).toBe(2)
    expect(r.text).toContain('points into the repository')
  })

  test('a tracked hooks directory is refused with exit 2', () => {
    const dir = repo('tracked-hooks')
    mkdirSync(join(dir, 'githooks'))
    writeFileSync(join(dir, 'githooks', 'pre-push'), '#!/bin/sh\necho mine\n')
    execFileSync('git', ['-C', dir, 'add', 'githooks/pre-push'], { env: baseEnv })
    // The hooks directory is the tracked one; reproduce it through a hooksPath-free check on the helper.
    return import('./hook-safety.mjs').then(({ hookRefusals }: { hookRefusals: (t: string, h: string, e: NodeJS.ProcessEnv) => string[] }) => {
      const why = hookRefusals(dir, join(dir, 'githooks', 'pre-push'), baseEnv)
      expect(why.join(';')).toContain('is tracked by git')
    })
  })

  test('install then remove restores the original hook exactly', () => {
    const dir = repo('restore')
    const orig = '#!/bin/sh\necho mine\n'
    writeFileSync(hookFile(dir), orig)
    expect(hook('install', dir).code).toBe(0)
    expect(readFileSync(hookFile(dir), 'utf8')).not.toBe(orig)
    expect(hook('remove', dir).code).toBe(0)
    expect(readFileSync(hookFile(dir), 'utf8')).toBe(orig)
  })
})

describe('the generated block', () => {
  const runBlock = (block: string, runFile: string, env: NodeJS.ProcessEnv) => {
    const script = join(tmp, `block-${Math.random().toString(36).slice(2)}.sh`)
    writeFileSync(script, `#!/bin/sh\n${block}\necho reached-end\n`)
    chmodSync(script, 0o755)
    return spawnSync(shPath as string, [script], { encoding: 'utf8', env })
  }

  // 0.5.3: the hook fails CLOSED. A hook error blocks the push and says how to bypass it on purpose.
  sh('with node missing from PATH it prints TOOL FAULT, blocks the push (non-zero) and names the bypass', () => {
    const runFile = join(tmp, 'fake-run.mjs')
    writeFileSync(runFile, 'process.exit(1)\n')
    const r = runBlock(prePushBlock(runFile, '--x'), runFile, { PATH: '' })
    expect(r.stderr).toContain('TOOL FAULT: meerkat not found')
    expect(r.stderr).toContain('MEERKAT_ALLOW_HOOK_FAIL=1 git push')
    expect(r.status).toBe(1)
    expect(r.stdout).not.toContain('reached-end')
  })

  sh('with run.mjs missing it prints TOOL FAULT and blocks (exit 1)', () => {
    const r = runBlock(prePushBlock(join(tmp, 'does-not-exist.mjs'), '--x'), '', { ...process.env, MEERKAT_ALLOW_HOOK_FAIL: '' })
    expect(r.stderr).toContain('TOOL FAULT')
    expect(r.status).toBe(1)
  })

  sh('MEERKAT_ALLOW_HOOK_FAIL=1 lets the push through (exit 0) and logs the bypass in hook.log', () => {
    const logs = join(tmp, 'bypass-logs')
    const r = runBlock(prePushBlock(join(tmp, 'does-not-exist.mjs'), '--x'), '', { ...process.env, MEERKAT_ALLOW_HOOK_FAIL: '1', MEERKAT_LOG_DIR: logs })
    expect(r.status).toBe(0)
    expect(r.stderr).toContain('MEERKAT_ALLOW_HOOK_FAIL=1 is set')
    const line = readFileSync(join(logs, 'hook.log'), 'utf8')
    expect(line).toContain('pre-push fault bypassed with MEERKAT_ALLOW_HOOK_FAIL=1: meerkat not found')
  })

  sh('a real meerkat failure still blocks with exit 1', () => {
    const runFile = join(tmp, 'failing-run.mjs')
    writeFileSync(runFile, 'process.exit(1)\n')
    const r = runBlock(prePushBlock(runFile, ''), runFile, { ...process.env, PATH: `${dirname(process.execPath)}${process.platform === 'win32' ? ';' : ':'}${process.env.PATH}` })
    expect(r.status).toBe(1)
    expect(r.stderr).not.toContain('TOOL FAULT')
  })

  sh('a passing run falls through to the rest of the hook', () => {
    const runFile = join(tmp, 'ok-run.mjs')
    writeFileSync(runFile, 'process.exit(0)\n')
    const r = runBlock(prePushBlock(runFile, ''), runFile, { ...process.env })
    expect(r.status).toBe(0)
    expect(r.stdout).toContain('reached-end')
  })
})

describe('hook install stays inside the repository', () => {
  test('a local core.hooksPath that points outside the repository is refused and nothing is written there', () => {
    const dir = repo('outside-hookspath')
    const outside = join(tmp, 'outside-hooks-dir')
    mkdirSync(outside, { recursive: true })
    execFileSync('git', ['-C', dir, 'config', '--local', 'core.hooksPath', outside], { env: baseEnv })
    const r = hook('install', dir)
    expect(r.code).not.toBe(0)
    expect(r.text).toContain('outside')
    expect(existsSync(join(outside, 'pre-push'))).toBe(false)
  })
})

test('cleanup', () => {
  rmSync(tmp, { recursive: true, force: true })
})

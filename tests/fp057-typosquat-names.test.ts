// typosquat-names: scoped packages from publishers that own the scope are not lookalikes.
import { describe, expect, test } from 'vitest'
import { runCheck } from './fp057-run'

const typo = (deps: Record<string, string>) => runCheck('thorough/sec-supply.mjs', 'typosquat-names', { 'package.json': JSON.stringify({ dependencies: deps }) }, true)

describe('typosquat-names and known svelte scopes', () => {
  test('@lucide/svelte, @xyflow/svelte and @tsconfig/svelte are quiet', () => {
    expect(typo({ '@lucide/svelte': '1.0.0', '@xyflow/svelte': '1.0.0', '@tsconfig/svelte': '5.0.0' }).code).toBe(0)
  })
  test('the same name under an unknown scope still fails', () => {
    const r = typo({ '@lucid-evil/svelte': '1.0.0' })
    expect(r.code).toBe(1)
    expect(r.out).toContain('@lucid-evil/svelte')
  })
  test('a one-letter misspelling still fails', () => {
    expect(typo({ reqeust: '2.88.2' }).code).toBe(1)
  })
})

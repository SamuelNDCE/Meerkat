// The secrets-plus pack: provider-specific secret detection (cloud, source hosts, payments, comms, AI, infrastructure, observability,
// data, commerce and more) plus generic keyword and entropy rules. One check, one sub-check per rule (thorough/rules-secrets-plus.mjs).
// Turn it on with { "packs": ["secrets-plus"] } in meerkat.config.json.
import { MEERKAT_DIR as MK } from '../../lib/paths.mjs'
import { RULES } from '../../thorough/rules-secrets-plus.mjs'

const SP = `${MK}/thorough/secrets-plus.mjs`

export default [
  {
    id: 'secrets-plus',
    group: 'security',
    tier: 'fast',
    lane: 'free',
    weight: 'tiny',
    suite: 'secrets',
    subs: RULES.length,
    title: 'No provider key, token, private key or high-entropy secret is written into the files (never printed in full)',
    estSeconds: 3,
    needs: ['node'],
    run: { cmd: 'node', args: [SP, 'secrets-plus'], cwd: 'repo' },
    selfTest: { cmd: 'node', args: [SP, 'secrets-plus', '--fixtures'], cwd: 'repo', expectFail: true, expectMatch: 'found' },
  },
]

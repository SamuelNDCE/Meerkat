// Exit codes from these scripts: 0 pass, 1 fail, 75 = "NOT RUN: <why>" printed on the last line.
import { MEERKAT_DIR as MK } from '../lib/paths.mjs';
const T = `${MK}/thorough`;
const ex = (file, extra = []) => ({ cmd: 'node', args: [`${T}/${file}`, ...extra], cwd: 'app' });

export default [
  {
    id: 'parser-fuzz', group: 'functionality', tier: 'thorough', lane: 'cargo', estSeconds: 75,
    title: 'Fuzz the vault markdown and frontmatter parser (NV_FUZZ_SECONDS, default 60)',
    needs: ['node', 'cargo'],
    paths: ['packages/vault/src/**'],
    run: ex('parser-fuzz.mjs'),
    selfTest: { ...ex('parser-fuzz.mjs', ['--fixtures']), expectFail: true },
  },
  {
    id: 'guard-mutants', group: 'security', tier: 'thorough', lane: 'cargo', estSeconds: 860, timeoutSeconds: 3300,
    title: 'Mutation test the command classifier, poisoning guard and path rules',
    needs: ['node', 'cargo-mutants'],
    paths: ['packages/agents/src/shell_tool.rs', 'packages/agents/src/guard/poison.rs', 'packages/agents/src/sandbox.rs', '.cargo/mutants.toml'],
    run: ex('guard-mutants.mjs'),
    selfTest: { ...ex('guard-mutants.mjs', ['--fixtures']), expectFail: true },
  },
  {
    id: 'sync-load', group: 'performance', tier: 'thorough', lane: 'free', optIn: 'staging', estSeconds: 60,
    title: 'Load test the sync server (k6, synthetic notes). NV_SYNC_URL, NV_SYNC_TOKEN; add --local to the script for a local server',
    needs: ['node', 'k6'],
    paths: ['apps/sync-server/**', 'packages/sync/**', 'tools/loadtest/**'],
    run: ex('sync-load.mjs'),
    selfTest: { ...ex('sync-load.mjs', ['--fixtures']), expectFail: true },
  },
  {
    id: 'staging-scan', group: 'security', tier: 'thorough', lane: 'free', optIn: 'staging', estSeconds: 600,
    title: 'ZAP baseline and Nuclei against the staging sync server (never the live one)',
    needs: ['node', 'nuclei'],
    run: ex('staging-scan.mjs'),
    selfTest: { ...ex('staging-scan.mjs', ['--fixtures']), expectFail: true },
  },
  {
    id: 'agent-scan', group: 'security', tier: 'thorough', lane: 'free', optIn: 'snyk', estSeconds: 120,
    title: 'Snyk agent-scan of the MCP and skill setup (prints what it sends first)',
    needs: ['node', 'uvx'],
    run: ex('agent-scan.mjs'),
    selfTest: { ...ex('agent-scan.mjs', ['--fixtures']), expectFail: true },
  },
];

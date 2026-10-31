// CLI verified 2026-10-27 from https://github.com/snyk/agent-scan (README, "Run with uvx"):
//   SNYK_TOKEN=<token> uvx snyk-agent-scan@latest [path-to-config-or-skills-folder]
// Snyk's README also lists a standalone binary; this wrapper uses uvx. We never pass
// --dangerously-run-mcp-servers, so stdio MCP servers are NOT started and the scan stays passive.
//
// OFF unless the orchestrator is run with --include snyk (optIn 'snyk'). Per the plan decision
// "confirm data handling first": it prints what will be sent and where BEFORE anything runs, scans a
// COPY of the target in a temp folder, and requires NV_AGENT_SCAN_APPROVED=yes (Samuel approves the first run).
// What Snyk's README says is sent: tool, prompt, resource and skill descriptions go to Snyk's analysis API
// (api version 2026-07-10 for v0.6+), authenticated by SNYK_TOKEN. Read Snyk's data-handling docs before approving.
// --fixtures  self-test: no approval given. The wrapper must refuse (exit 1).
import { cpSync, mkdtempSync, existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { run, say, fail, pass, notRun, hasFlag, findBin, repoRoot } from '../../../thorough/lib.mjs';

const spec = process.env.NV_AGENT_SCAN_SPEC || 'snyk-agent-scan@latest'; // pin e.g. snyk-agent-scan@0.6.x for reproducible runs
const targetArg = process.env.NV_AGENT_SCAN_PATH || path.join(repoRoot, '.claude', 'skills');

say('agent-scan will SEND to Snyk (api.snyk.io analysis API, via the snyk-agent-scan CLI):');
say('  - the names and descriptions of the MCP tools, prompts, resources and agent skills found in the scan target');
say(`  - scan target (a temp COPY is scanned, the original is not touched): ${targetArg}`);
say('  - your Snyk API token (SNYK_TOKEN) as authentication');
say('It will NOT start local MCP servers (no --dangerously-run-mcp-servers).');

if (hasFlag('--fixtures')) { delete process.env.NV_AGENT_SCAN_APPROVED; }
if (process.env.NV_AGENT_SCAN_APPROVED !== 'yes') fail('not approved: read the lines above, then set NV_AGENT_SCAN_APPROVED=yes to run');
if (!process.env.SNYK_TOKEN) notRun('SNYK_TOKEN is not set (https://app.snyk.io/account, API Token)');
const uvx = findBin('uvx');
if (!uvx) notRun('uvx not found: install uv (https://docs.astral.sh/uv/getting-started/installation/)');
if (!existsSync(targetArg)) notRun(`scan target does not exist: ${targetArg}`);

const tmp = mkdtempSync(path.join(tmpdir(), 'nv-agent-scan-'));
const copy = path.join(tmp, path.basename(targetArg));
cpSync(targetArg, copy, { recursive: statSync(targetArg).isDirectory(), dereference: false });
const r = await run({ cmd: uvx, args: [spec, copy], timeoutMs: 600000, label: 'snyk-agent-scan' });
if (r.timedOut) fail('snyk-agent-scan hit the hard time limit');
if (r.code !== 0) fail(`snyk-agent-scan exit ${r.code}: read its output above (its output format is experimental, so only the exit code is used)`);
pass('snyk-agent-scan reported no failing result');

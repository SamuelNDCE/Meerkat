// Wraps the installed k6 binary (AGPL-3.0: we do not copy or vendor any k6 code).
// Refuses any target that is not staging or loopback: the script WRITES notes into the
// throwaway vault (NV_SYNC_VAULT, default "test").
// --local     start a locally built sync server on a temp vault and test it (needs NV_SYNC_BIN or a built binary).
//             The server needs no Supabase or secrets: only NV_SYNC_TOKEN, which we generate for the run.
// --fixtures  self-test: a deliberately slow, failing stub server. k6 must report threshold failures.
import { spawn } from 'node:child_process';
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { run, say, fail, pass, notRun, hasFlag, repoRoot, findBin, looksLikeStaging } from '../../../thorough/lib.mjs';
import { dirname, resolve as resolvePath } from 'node:path';
import { fileURLToPath as fileUrlToPath } from 'node:url';
const fixturesDir = resolvePath(dirname(fileUrlToPath(import.meta.url)), '../fixtures');

const k6 = findBin('k6', ['C:/Program Files/k6/k6.exe']);
if (!k6) notRun('k6 not installed: winget install GrafanaLabs.k6');
const script = path.join(repoRoot, 'tools/loadtest/sync-load.js');
const children = [];
const stopAll = () => children.forEach((c) => { try { c.kill(); } catch { /* already gone */ } });
process.on('exit', stopAll);

function startProc(cmd, args, env, readyRe, label) {
  return new Promise((resolve, reject) => {
    const c = spawn(cmd, args, { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    children.push(c);
    let buf = '';
    const t = setTimeout(() => reject(new Error(`${label} did not become ready in 30s`)), 30000);
    const on = (d) => { buf += d; const m = buf.match(readyRe); if (m) { clearTimeout(t); resolve(m); } };
    c.stdout.on('data', on); c.stderr.on('data', on);
    c.on('exit', (code) => { clearTimeout(t); reject(new Error(`${label} exited early (${code}): ${buf.slice(-300)}`)); });
  });
}

let url = process.env.NV_SYNC_URL;
let token = process.env.NV_SYNC_TOKEN;
let duration = process.env.NV_LOAD_DURATION || '30s';

if (hasFlag('--fixtures')) {
  const m = await startProc(process.execPath, [path.join('sync-load/bad-server.mjs')], {}, /PORT (\d+)/, 'stub');
  url = `http://127.0.0.1:${m[1]}`; token = 'fixture-token'; duration = '8s';
} else if (hasFlag('--local')) {
  const target = process.env.CARGO_TARGET_DIR || path.join(repoRoot, '..', 'nv-shared-target');
  const exe = process.env.NV_SYNC_BIN || ['release', 'debug'].map((p) => path.join(target, p, 'neuralvault-sync-server.exe')).find(existsSync);
  if (!exe || !existsSync(exe)) notRun('no built sync server: build it with `cargo build -p neuralvault-sync-server` through the cargo lock, or set NV_SYNC_BIN');
  const dir = mkdtempSync(path.join(tmpdir(), 'nv-sync-load-'));
  token = crypto.randomBytes(16).toString('hex'); // test token for this run only
  const port = 20000 + Math.floor(Math.random() * 20000);
  say(`local sync server: ${exe}, temp vaults dir ${dir}, port ${port}`);
  await startProc(exe, [], { NV_SYNC_PORT: String(port), NV_SYNC_BIND: '127.0.0.1', NV_SYNC_TOKEN: token, NV_SYNC_VAULTS_DIR: dir, NV_SYNC_VAULTS: 'test', USERPROFILE: dir, HOME: dir }, /listen|7420|bound|serving|ready/i, 'sync-server').catch((e) => fail(String(e)));
  url = `http://127.0.0.1:${port}`;
}

if (!url || !token) notRun('NV_SYNC_URL and NV_SYNC_TOKEN are not set (or run with --local to test a local server)');
if (!looksLikeStaging(url)) fail(`refusing ${url}: the load test writes notes, so it only runs against a staging host or loopback`);
if ((process.env.NV_SYNC_VAULT || 'test') === 'main') fail('refusing vault "main"');

const r = await run({ cmd: k6, args: ['run', '--quiet', '--no-usage-report', '-e', `NV_SYNC_URL=${url}`, '-e', `NV_SYNC_TOKEN=${token}`, '-e', `NV_LOAD_DURATION=${duration}`, script], timeoutMs: 300000, label: 'k6' });
stopAll();
if (r.timedOut) fail('k6 hit the hard time limit');
if (r.code === 0) pass('k6 thresholds held (p95 latency and error rate)');
fail(`k6 exit ${r.code}: ${r.code === 99 ? 'a threshold was crossed (see the lines above)' : 'the test could not run'}`);

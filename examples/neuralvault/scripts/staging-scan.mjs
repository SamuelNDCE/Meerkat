// Opt-in (--include staging). Tuned for our server, not stock:
//   Nuclei runs only our own small template set (thorough/nuclei-templates/*.yaml), not the public library.
//   ZAP runs the baseline with thorough/zap-baseline.conf (rules that cannot apply to a JSON API are ignored).
// Both tools are wrapped as installed binaries, nothing is copied or modified.
// Needs: nuclei on PATH, and ZAP via docker (zaproxy/zap-stable) or zap-baseline.py on PATH.
// --fixtures  self-test: aims at a live-looking host. The wrapper must REFUSE (exit 1).
import path from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { run, say, fail, pass, notRun, hasFlag, findBin, looksLikeStaging } from '../../../thorough/lib.mjs';

const thisDir = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const target = hasFlag('--fixtures') ? 'https://sync.neuralvault.app' : process.env.NV_STAGING_URL;

if (!target) notRun('NV_STAGING_URL is not set');
if (!looksLikeStaging(target)) fail(`refusing ${target}: host must contain "staging" or be localhost. This check never touches the live server.`);

const nuclei = findBin('nuclei');
if (!nuclei) notRun('nuclei not installed (https://docs.projectdiscovery.io/opensource/nuclei/install, MIT licence)');
const docker = findBin('docker');
const zapScript = findBin('zap-baseline.py');
if (!docker && !zapScript) notRun('ZAP not available: install Docker (then zaproxy/zap-stable is pulled) or put zap-baseline.py on PATH (needs Python + Java)');

const token = process.env.NV_STAGING_TOKEN; // test token for the staging copy only; optional
const findings = [];

say(`staging-scan target: ${target}`);
const n = await run({
  cmd: nuclei,
  args: ['-u', target, '-t', path.join(thisDir, 'nuclei-templates'), '-duc', '-rate-limit', '20', '-timeout', '10', '-silent', ...(token ? ['-H', `Authorization: Bearer ${token}`] : [])],
  timeoutMs: 300000, label: 'nuclei',
});
if (n.timedOut) fail('nuclei hit the hard time limit');
if (n.code !== 0) fail(`nuclei error, exit ${n.code}`);
if (n.out.trim()) findings.push(`nuclei: ${n.out.trim().split(/\r?\n/).length} finding(s)`);

const conf = path.join(thisDir, 'zap-baseline.conf');
const wrk = mkdtempSync(path.join(tmpdir(), 'nv-zap-'));
const zapArgs = docker
  ? { cmd: docker, args: ['run', '--rm', '-v', `${wrk}:/zap/wrk:rw`, '-v', `${conf}:/zap/wrk/rules.conf:ro`, 'zaproxy/zap-stable', 'zap-baseline.py', '-t', target, '-c', 'rules.conf', '-m', '2', '-T', '8'] }
  : { cmd: zapScript, args: ['-t', target, '-c', conf, '-m', '2', '-T', '8'] };
const z = await run({ ...zapArgs, timeoutMs: 600000, label: 'zap-baseline' });
if (z.timedOut) fail('ZAP hit the hard time limit');
if (z.code !== 0) findings.push(`ZAP baseline exit ${z.code} (1 = fail rule, 2 = warnings)`);

if (findings.length) fail(findings.join('; '));
pass('nuclei and ZAP baseline found nothing');

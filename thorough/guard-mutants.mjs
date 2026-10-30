// Copyright (c) 2026 perpetualtechnologies. All rights reserved.
// Proprietary and confidential. Unauthorised copying, modification,
// or distribution is strictly prohibited.
// guard-mutants: cargo-mutants on the three guard areas (scope lives in .cargo/mutants.toml).
// Fails when a mutant survives (the guard tests still pass with the rule broken) unless the
// survivor is in guard-mutants-allowlist.json with a reason. Wraps the installed cargo-mutants (MIT).
// Env: NV_MUTANTS_SHARD=k/n runs one slice (871 mutants at first count, each needs a nv-agents rebuild: the full run takes hours).
// Env: NV_MUTANTS_IN_DIFF=1 limits to mutants inside the diff against origin/dev (fast pre-release check).
import { readFileSync, existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { run, say, fail, pass, notRun, hasFlag, repoRoot, fixturesDir, findBin, cargoCmd } from './lib.mjs';

const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const allow = JSON.parse(readFileSync(path.join(here, 'guard-mutants-allowlist.json'), 'utf8')).allow || [];
for (const a of allow) if (!a.match || !a.reason || a.reason.length < 20) fail('allowlist entry without a match or a reasoned explanation');

function judge(outDir) {
  const read = (f) => (existsSync(path.join(outDir, f)) ? readFileSync(path.join(outDir, f), 'utf8').split(/\r?\n/).filter(Boolean) : []);
  const missed = read('missed.txt');
  const timeouts = read('timeout.txt');
  const unlisted = missed.filter((l) => !allow.some((a) => l.includes(a.match)));
  say(`survivors: ${missed.length} (${missed.length - unlisted.length} allowlisted), timeouts: ${timeouts.length}`);
  for (const l of unlisted.slice(0, 15)) say(`  SURVIVED: ${l}`);
  if (unlisted.length) fail(`${unlisted.length} guard mutant(s) survived: the tests do not notice the rule breaking. Add a test, or allowlist with a reason.`);
  if (timeouts.length) fail(`${timeouts.length} mutant(s) timed out: read mutants.out/timeout.txt (a timeout is not a catch)`);
  pass(`all mutants caught (${missed.length} allowlisted survivors)`);
}

if (hasFlag('--fixtures')) judge(path.join(fixturesDir, 'guard-mutants')); // fixture has an unlisted survivor
if (!findBin('cargo-mutants')) notRun('cargo-mutants not installed: cargo install cargo-mutants --locked');

const outBase = mkdtempSync(path.join(tmpdir(), 'nv-mutants-'));
// NV_MUTANTS_JOBS raises how many mutants are built and tested at once (default 1, the measured-safe value). Same mutants,
// same slice, so no coverage is lost; it only trades RAM and CPU for time and is meant to be measured on the PC first.
const jobs = /^[1-9]\d?$/.test(process.env.NV_MUTANTS_JOBS ?? '') ? process.env.NV_MUTANTS_JOBS : '1';
const args = ['mutants', '--no-shuffle', '--jobs', jobs, '--output', outBase, '--colors', 'never'];
if (process.env.NV_MUTANTS_IN_DIFF === '1') {
  const d = await run({ cmd: 'git', args: ['diff', 'origin/dev...HEAD', '--', 'packages/agents/src'], timeoutMs: 30000, label: 'diff', quiet: true });
  const f = path.join(outBase, 'in.diff'); (await import('node:fs')).writeFileSync(f, d.out);
  args.push('--in-diff', f);
}
// One slice per run bounds the time (the whole set takes hours). Unless told otherwise the slice rotates by day, so
// repeated runs walk the whole set: 80 slices (about a dozen mutants, 10 to 15 minutes), today's is (day of the year mod 80) + 1. NV_MUTANTS_SHARD=1/1 runs all.
const dayOfYear = Math.floor((Date.now() - Date.UTC(new Date().getUTCFullYear(), 0, 0)) / 86_400_000);
const shard = process.env.NV_MUTANTS_SHARD || (process.env.NV_MUTANTS_IN_DIFF === '1' ? '' : `${(dayOfYear % 80) + 1}/80`);
if (shard) {
  say(`mutation slice ${shard} (NV_MUTANTS_SHARD=1/1 for all of them)`);
  args.push('--shard', shard);
}
if (hasFlag('--list')) args.push('--list');
const { cmd, args: a } = cargoCmd(args);
// Its own target folder, with nv-agents' build records cleared before each run. cargo-mutants builds in a fresh
// temp copy of the tree every time, but cargo calls the compile "Fresh" and reuses the test programs from the last
// copy, which have that (deleted) folder's path baked in by env!("CARGO_MANIFEST_DIR"): guard_corpus then dies with
// "corpus dir: NotFound" on the unmutated code (seen 2026-10-27, second run). Clearing only nv-agents here keeps the
// dependencies cached and never touches the shared build folder other work uses.
const targetDir = process.env.NV_MUTANTS_TARGET || path.join(repoRoot, '..', 'nv-shared-target-mutants');
const fingerprints = path.join(targetDir, 'debug', '.fingerprint');
if (existsSync(fingerprints)) {
  for (const name of readdirSync(fingerprints)) {
    if (/^nv-agents-/.test(name)) rmSync(path.join(fingerprints, name), { recursive: true, force: true });
  }
}
const runMutants = () => run({ cmd, args: a, timeoutMs: Number(process.env.NV_MUTANTS_SECONDS || 3000) * 1000, label: 'cargo-mutants', env: { CARGO_TARGET_DIR: targetDir } });
let r = await runMutants();
// Exit 4 means the tests already FAILED on the unmutated code, so no mutant was tried. On a busy machine a
// timing-based test can flake (seen 2026-10-27: a_timeout_kills_the_grandchild_too, which needs a spawned
// `cmd` to write a file within 5 s). Retry once; if it fails again, name the failing test so it is not a mystery.
if (r.code === 4) {
  say('the tests failed on the unmutated code (exit 4); trying once more in case a timing test flaked under load');
  r = await runMutants();
  if (r.code === 4) {
    const failed = [...new Set([...r.out.matchAll(/^test (\S+) \.\.\. FAILED/gm)].map((m) => m[1]))];
    let named = failed;
    if (!named.length) {
      try { named = [...new Set([...readFileSync(path.join(outBase, 'mutants.out', 'log', 'baseline.log'), 'utf8').matchAll(/^test (\S+) \.\.\. FAILED/gm)].map((m) => m[1]))]; } catch { /* no log */ }
    }
    fail(`the nv-agents tests fail on the unmutated code twice in a row, so no mutant was tried: ${named.slice(0, 5).join(', ') || 'see mutants.out/log/baseline.log'}`);
  }
}
if (r.code === 75) notRun('cargo lock wait limit hit (exit 75)');
if (r.timedOut) fail('cargo-mutants hit the hard time limit (NV_MUTANTS_SECONDS)');
if (hasFlag('--list')) pass('mutant list printed');
if (![0, 2, 3].includes(r.code)) fail(`cargo-mutants error, exit ${r.code} (0 = all caught, 2 = survivors, 3 = timeouts)`);
judge(path.join(outBase, 'mutants.out'));

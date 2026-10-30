// Copyright (c) 2026 perpetualtechnologies. All rights reserved.
// Proprietary and confidential. Unauthorised copying, modification,
// or distribution is strictly prohibited.
// Shared helpers for the thorough-tier checks: a hard timeout, a progress line, and tool lookup.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { appDirOf, repoRootOf } from '../lib/paths.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
export const repoRoot = repoRootOf(appDirOf());
export const fixturesDir = path.resolve(here, '../fixtures');
export const EXIT_NOT_RUN = 75; // printed as "NOT RUN: <why>". A check that cannot run is never a pass.

export function say(msg) { console.log(msg); }
export function fail(msg) { console.log(`FAIL: ${msg}`); process.exit(1); }
export function notRun(msg) { console.log(`NOT RUN: ${msg}`); process.exit(EXIT_NOT_RUN); }
export function pass(msg) { console.log(`PASS: ${msg}`); process.exit(0); }

/** Look a binary up on PATH, plus the usual Windows install spots. Returns a full path or null. */
export function findBin(name, extra = []) {
  const probe = process.platform === 'win32' ? 'where' : 'which';
  const r = spawnSync(probe, [name], { encoding: 'utf8' });
  if (r.status === 0 && r.stdout.trim()) return r.stdout.split(/\r?\n/)[0].trim();
  for (const p of extra) if (existsSync(p)) return p;
  return null;
}

/** Run a command with a hard timeout (kills the whole tree) and a progress line every 20s. */
export function run({ cmd, args = [], cwd = repoRoot, env = {}, timeoutMs, label, quiet = false }) {
  return new Promise((resolve) => {
    const started = Date.now();
    say(`[${label}] start (limit ${Math.round(timeoutMs / 1000)}s)`);
    const child = spawn(cmd, args, { cwd, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let out = '';
    const grab = (d) => { out += d; if (out.length > 4_000_000) out = out.slice(-2_000_000); if (!quiet) process.stdout.write(d); };
    child.stdout.on('data', grab); child.stderr.on('data', grab);
    const beat = setInterval(() => say(`[${label}] still running, ${Math.round((Date.now() - started) / 1000)}s`), 20000);
    let timedOut = false;
    const killer = setTimeout(() => {
      timedOut = true;
      if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F']);
      else child.kill('SIGKILL');
    }, timeoutMs);
    child.on('error', (e) => { clearInterval(beat); clearTimeout(killer); resolve({ code: -1, out: String(e), timedOut: false }); });
    child.on('close', (code) => { clearInterval(beat); clearTimeout(killer); resolve({ code, out, timedOut, seconds: (Date.now() - started) / 1000 }); });
  });
}

export const hasFlag = (f) => process.argv.includes(f);
export const argVal = (f) => { const i = process.argv.indexOf(f); return i > 0 ? process.argv[i + 1] : undefined; };

/** Staging guard: the host must contain "staging" or be loopback. Never the live server. */
export function looksLikeStaging(url) {
  let u; try { u = new URL(url); } catch { return false; }
  if (!/^https?:$/.test(u.protocol)) return false;
  const h = u.hostname.toLowerCase();
  return h === 'localhost' || h === '127.0.0.1' || h === '[::1]' || h === '::1' || h.includes('staging');
}

/** Wrap a cargo invocation in the machine build lock when one is configured (NV_CARGO_LOCK) or in the repo. */
export function cargoCmd(args) {
  const lock = process.env.NV_CARGO_LOCK || (existsSync(path.join(repoRoot, 'scripts/cargo-lock.sh')) ? path.join(repoRoot, 'scripts/cargo-lock.sh') : null);
  return lock ? { cmd: 'bash', args: [lock, 'cargo', ...args] } : { cmd: 'cargo', args };
}

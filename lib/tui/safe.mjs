// Copyright (c) 2026 perpetualtechnologies. All rights reserved.
// Proprietary and confidential. Unauthorised copying, modification,
// or distribution is strictly prohibited.

// The viewer (watch.mjs) reads a status file from the shared temp folder and prints text out of it and out of the
// saved-output files it names. That text is DATA, not instructions: this module is the one place that makes it safe to
// print and safe to open.
//   stripControl   drops every control character (escape, bell, carriage return, the C1 range, tabs become spaces), so
//                  nothing in a status file or a log can move the cursor, rewrite earlier lines or set the title.
//   safeLogPath    returns a file's real path only when it sits inside Meerkat's own log folder (NV_VERIFY_LOG_DIR, else
//                  <temp>/nv-verify-logs) after symlinks are resolved; a network (UNC) path, a device path, a path that
//                  climbs out with .. or a link that leads elsewhere is refused (null).
import { lstatSync, realpathSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative, resolve } from 'node:path'

export function stripControl(text) {
  return String(text ?? '')
    .replace(/\t/g, ' ')
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, '')
}

export function logDirFor(env = process.env, tmp = tmpdir()) {
  return resolve(env.NV_VERIFY_LOG_DIR || join(tmp, 'nv-verify-logs'))
}

// The log folder itself must be trustworthy, not just the file in it: a real directory (not a link planted in a shared
// temp folder), and on systems that have owners, ours and not writable by group or others.
function trustedDir(dir, lstat) {
  const st = lstat(dir)
  if (!st.isDirectory() || st.isSymbolicLink()) return false
  if (typeof process.getuid === 'function') return st.uid === process.getuid() && (st.mode & 0o022) === 0
  return true
}

export function safeLogPath(file, { env = process.env, tmp = tmpdir(), realpath = realpathSync, lstat = lstatSync, stat = statSync } = {}) {
  const text = String(file ?? '')
  // Empty, a path with control characters, a UNC path (two leading slashes) or a device path: refused outright.
  if (!text || stripControl(text) !== text || /^[\\/]{2}/.test(text)) return null
  try {
    const logDir = logDirFor(env, tmp)
    if (!trustedDir(logDir, lstat)) return null
    const real = realpath(resolve(text))
    const rel = relative(realpath(logDir), real)
    if (!rel || rel.startsWith('..') || isAbsolute(rel)) return null
    return stat(real).isFile() ? real : null
  } catch {
    return null
  }
}

// The statuses the runner can write. Anything else in a status file is shown as NOT RUN (loud, never green).
export const KNOWN_STATUS = ['PASS', 'FAIL', 'NOT RUN']
export const knownStatus = (s) => (KNOWN_STATUS.includes(s) ? s : 'NOT RUN')

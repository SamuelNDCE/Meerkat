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
import { realpathSync } from 'node:fs'
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

export function safeLogPath(file, { env = process.env, tmp = tmpdir(), realpath = realpathSync } = {}) {
  const text = String(file ?? '')
  if (!text || /^[\\/]{2}/.test(text)) return null // empty, a UNC path (\\host\share) or a device path (\\.\ or \\?\)
  try {
    const real = realpath(resolve(text))
    const dir = realpath(logDirFor(env, tmp))
    const rel = relative(dir, real)
    return rel && !rel.startsWith('..') && !isAbsolute(rel) ? real : null
  } catch {
    return null
  }
}

// The statuses the runner can write. Anything else in a status file is shown as NOT RUN (loud, never green).
export const KNOWN_STATUS = ['PASS', 'FAIL', 'NOT RUN']
export const knownStatus = (s) => (KNOWN_STATUS.includes(s) ? s : 'NOT RUN')

// Machine profiles for Meerkat, the validation tool: one switch for "this PC cannot run that many windows at once".
//   npm --prefix apps/desktop-electron run verify -- --profile low      (or MEERKAT_PROFILE=low)
// A profile only fills in settings the person has NOT set themselves; any NV_* variable in the environment wins.
// With no profile the window count sizes itself from this machine (half the cores, 1.5 GB of free memory per
// window, never more than the check's own ceiling), which is already right for most PCs.
export const PROFILES = {
  // A small or busy PC: two windows at a time, only the normal look in the full click-through.
  low: { NV_CLICKS_SHARDS: '2', NV_CLICKS_JOBS: '2', NV_CLICKS_CELLS: 'default' },
  // The default: nothing is forced, the tool sizes itself.
  normal: {},
  // A big machine with nothing else running.
  high: { NV_CLICKS_SHARDS: '8', NV_CLICKS_JOBS: '8' },
}

const isSafeKey = (k) => k !== '__proto__' && k !== 'constructor' && k !== 'prototype'

export function applyProfile(name, env = process.env) {
  if (!name) return []
  if (!Object.prototype.hasOwnProperty.call(PROFILES, name)) {
    throw new Error(`unknown profile "${name}" (use low, normal or high)`)
  }
  const set = []
  for (const [k, v] of Object.entries(PROFILES[name])) {
    if (!isSafeKey(k)) continue
    if (env[k] === undefined || env[k] === '') {
      env[k] = v
      set.push(`${k}=${v}`)
    }
  }
  return set
}

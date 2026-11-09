// `meerkat team [folder] [--app <folder>] [--check] [--json]`: the entries of .meerkat-team.json with owner, expiry and state.
// --check exits 1 when any entry is expired or has no owner (or no usable expiry), so CI can enforce it.
import { resolve } from 'node:path'
import { repoRootOf } from './paths.mjs'
import { readTeam, teamCheckFailures, teamCounts, TEAM_FILE } from './team.mjs'

const STATE_TEXT = { active: 'active', expiring: 'expiring', expired: 'expired', 'no-expiry': 'no expiry', invalid: 'invalid' }
const pad = (t, n) => String(t).padEnd(n)

export function teamText(team) {
  if (!team.exists) return `No ${TEAM_FILE} in this repo. Create one to share accepted findings with the team.`
  if (team.error) return `${team.error}`
  const c = teamCounts(team)
  const lines = [`${TEAM_FILE}: ${c.total} entr${c.total === 1 ? 'y' : 'ies'}: ${c.active} active, ${c.expiring} expiring within 14 days, ${c.expired} expired${c.noExpiry ? `, ${c.noExpiry} with no usable expiry` : ''}${c.invalid ? `, ${c.invalid} incomplete` : ''}`, '']
  if (!team.entries.length) return lines.join('\n').trimEnd()
  const rows = team.entries.map((e) => ({ n: String(e.index), state: e.state === 'expiring' ? `expiring (${e.days}d)` : STATE_TEXT[e.state], check: e.check || '-', file: e.file || '-', owner: e.owner || 'NO OWNER', exp: e.expires || '-', reason: e.reason || '-' }))
  const w = (k) => Math.max(k.length, ...rows.map((r) => r[k].length))
  const head = { n: '#', state: 'STATE', check: 'CHECK', file: 'FILE', owner: 'OWNER', exp: 'EXPIRES' }
  const cols = ['n', 'state', 'check', 'file', 'owner', 'exp']
  lines.push(`${cols.map((k) => pad(head[k], w(k))).join('  ')}  REASON`)
  for (const r of rows) lines.push(`${cols.map((k) => pad(r[k], w(k))).join('  ')}  ${r.reason}`)
  return lines.join('\n')
}

export function runTeam(args, { cwd = process.cwd(), out, err }) {
  const i = args.indexOf('--app')
  const app = i >= 0 ? args[i + 1] : args.find((a, j) => !a.startsWith('--') && args[j - 1] !== '--app')
  const unknown = args.find((a) => a.startsWith('--') && !['--check', '--json', '--app'].includes(a))
  if (unknown) return (err(`meerkat team: unknown option ${unknown}. Use: meerkat team [folder] [--check] [--json]`), 2)
  const root = repoRootOf(resolve(cwd, app ?? '.'))
  const team = readTeam(root)
  const bad = teamCheckFailures(team)
  if (args.includes('--json')) out(JSON.stringify({ file: team.file, exists: team.exists, error: team.error, counts: teamCounts(team), entries: team.entries, failures: bad }, null, 2))
  else out(teamText(team))
  if (!args.includes('--check')) return team.error ? 1 : 0
  if (bad.length) {
    err(`meerkat team --check: ${bad.length} problem(s): ${bad.join('; ')}`)
    return 1
  }
  if (!args.includes('--json')) out('team --check: ok')
  return 0
}

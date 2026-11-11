// `meerkat trust`: say whether a folder's project commands may run, and change that with one obvious command.
//   meerkat trust [folder]            approve this folder's commands block (shows exactly what, asks at a terminal; --yes skips the question)
//   meerkat trust --status [folder]   TRUSTED, NOT TRUSTED (with why) or NO COMMANDS; exit 0 / 1 / 2
//   meerkat trust --revoke [folder]   take the record back (idempotent)
//   meerkat trust --list              every trusted folder, from the trust record file only
// Trust is per folder and per hash of the commands block, and is never on by default. MEERKAT_TRUST_PROJECT=1 still works and --status says so.
import { createInterface } from 'node:readline/promises'
import { candidateTop, claimedCommon, foldPath, folderOf, registeredWorktrees, revokedKey, trustCommand, readCommands, sharedTrustKey, show_ as show, trustHash, trustKey, trustStatus } from './repocommands.mjs'
import { getTrustRecord, listTrustRecords, removeTrust, saveTrust } from './trust.mjs'
import { realpathSync } from 'node:fs'

const fwd0 = (p) => String(p).split(String.fromCharCode(92)).join('/')
const fwd = (p) => show(String(p).replace(/\\/g, '/'))
const USAGE = 'usage: meerkat trust [folder] [--yes] | --status [folder] | --revoke [folder] | --list'
const FLAGS = new Set(['--yes', '-y', '--status', '--revoke', '--list'])

function isTerminal(env) {
  return Boolean(process.stdin.isTTY) && Boolean(process.stderr.isTTY) && !env.CI
}

function beforeAfter(before, after) {
  const lines = []
  const names = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort()
  for (const n of names) {
    if (before[n] === after[n]) continue
    lines.push(`  ${show(n)}: before ${before[n] === undefined ? '(none)' : show(before[n])}`)
    lines.push(`  ${show(n)}: after  ${after[n] === undefined ? '(none)' : show(after[n])}`)
  }
  return lines
}

export async function runTrust(argv, { env = process.env, cwd = process.cwd(), out = (t) => process.stdout.write(`${t}\n`), err = (t) => process.stderr.write(`${t}\n`), isTTY = null } = {}) {
  const unknown = argv.find((a) => a.startsWith('-') && !FLAGS.has(a) && a !== '--app')
  if (unknown) {
    err(`meerkat trust: unknown option ${show(unknown)}. ${USAGE}`)
    return 2
  }
  const has = (f) => argv.includes(f)
  const modes = ['--status', '--revoke', '--list'].filter(has)
  if (modes.length > 1 || (has('--yes') && modes.length)) {
    err(`meerkat trust: ${modes.length > 1 ? modes.join(' and ') + ' cannot be used together' : '--yes only goes with approving'}. ${USAGE}`)
    return 2
  }

  if (has('--list')) {
    const all = listTrustRecords(env)
    const rows = all.filter((x) => x.key.startsWith('commands:'))
    const shared = all.filter((x) => x.key.startsWith('commands@git:'))
    if (!rows.length && !shared.length) out('no folder is trusted (the trust record file lists none)')
    for (const x of rows) out(`${fwd(x.key.slice('commands:'.length))}  ${String(x.hash).slice(0, 12)}  ${show(x.at ?? 'unknown date')}`)
    for (const x of shared) out(`any worktree of ${fwd(x.common ?? x.key.slice('commands@git:'.length).split('|')[0])} (commands approved ${show(x.at ?? 'unknown date')})  ${String(x.hash).slice(0, 12)}  approved in ${fwd(x.folder ?? 'an unknown folder')}`)
    return 0
  }

  const r = readCommands(folderOf(argv.filter((a) => !FLAGS.has(a)), env, cwd))
  if (r.unreadable) {
    for (const n of r.notes) err(`meerkat trust: ${show(n)}`)
    return 2
  }
  const folder = fwd(r.dir)
  const has_cmds = Object.keys(r.commands).length > 0
  const st = trustStatus(r, env)
  const rec = st.rec

  if (has('--revoke')) {
    const sk = r.file ? sharedTrustKey(r) : null
    const sh = sk ? getTrustRecord(env, sk) : null
    const top = r.file ? candidateTop(r.dir) : null
    const a = r.file ? removeTrust(env, trustKey(r)) : false
    // The approved main checkout (the folder the approval was made in, or the repository's main worktree) revokes the shared record for everyone.
    // Any other worktree only drops its own inheritance, by a marker that the inheritance check honours.
    let isMain = false
    if (sh && top) {
      let appr = null
      try { appr = sh.folder ? fwd0(realpathSync(sh.folder)) : null } catch { appr = fwd0(sh.folder ?? '') }
      const live = sh.common ? registeredWorktrees(sh.common, sh.folder) : null
      isMain = (appr && foldPath(appr) === foldPath(top)) || Boolean(live && live[0] && foldPath(live[0]) === foldPath(top))
    }
    let b = false
    let marked = false
    if (sh && isMain) b = removeTrust(env, sk)
    else if (sh && top && st.via === 'inherited') {
      saveTrust(env, revokedKey(top), sh.hash, { folder: r.dir })
      marked = true
    }
    if (!a && !b && !marked) {
      out(`already not trusted: ${folder}`)
      return 0
    }
    if (b) out(`trust revoked, SHARED approval (every worktree of ${fwd(sh.common ?? 'the repository')} loses it)${a ? ' and this folder own record' : ''}: ${folder}. To trust it again: ${trustCommand(folder)}`)
    else if (marked) out(`trust revoked, ONLY this worktree's inheritance (the main checkout and other worktrees keep theirs)${a ? ' and its own record' : ''}: ${folder}. To trust it again: ${trustCommand(folder)}`)
    else out(`trust revoked, this folder own record only (no shared approval applies to it): ${folder}. Its commands no longer run. To trust it again: ${trustCommand(folder)}`)
    return 0
  }

  if (has('--status')) {
    if (!has_cmds) {
      out(`NO COMMANDS: ${folder} defines no commands, so there is nothing to trust`)
      return 0
    }
    const envOn = env.MEERKAT_TRUST_PROJECT === '1'
    if (st.via === 'inherited') {
      out(`TRUSTED (inherited from ${fwd(st.from ?? 'the approved checkout')}, registered worktree ${fwd(st.worktree ?? folder)}): ${folder} (hash ${String(st.rec.hash).slice(0, 12)}, approved ${show(st.rec.at ?? 'at an unknown time')}, commands byte-identical)`)
      return 0
    }
    if (st.via === 'record') {
      out(`TRUSTED: ${folder} (hash ${String(rec.hash).slice(0, 12)}, approved ${show(rec.at ?? 'at an unknown time')})`)
      return 0
    }
    if (envOn || st.via === 'env') {
      out(`TRUSTED: ${folder}, trusted by environment variable MEERKAT_TRUST_PROJECT, not by a record`)
      return 0
    }
    if (rec) {
      out(`NOT TRUSTED: ${folder}. The commands changed since they were approved on ${show(rec.at ?? 'an unknown date')}:`)
      if (rec.commands && typeof rec.commands === 'object') for (const l of beforeAfter(rec.commands, r.commands)) out(l)
      else out('  (the old commands were not saved with that approval)')
    } else out(`NOT TRUSTED: ${folder}. No record: it has never been approved.`)
    if (st.why) out(`  not inherited: ${show(st.why)}`)
    out(`To trust it: ${trustCommand(folder)}`)
    return 1
  }

  // approve
  if (!has_cmds) {
    out(`nothing to trust: ${folder} defines no commands`)
    return 0
  }
  if (st.via === 'record' || st.via === 'inherited') {
    out(`already trusted${st.via === 'inherited' ? ` (inherited from ${fwd(st.from ?? 'the approved checkout')}, registered worktree ${fwd(st.worktree ?? folder)})` : ''}: ${folder}. To take the trust back: ${trustCommand(folder, { flag: '--revoke' })}`)
    return 0
  }
  const hash = trustHash(r)
  const nCmds = Object.keys(r.commands).length
  out(`meerkat trust will approve ${nCmds} command(s) for ${folder}, which run through a shell:`)
  out(`  folder: ${folder}`)
  out(`  config: ${fwd(r.file)}`)
  for (const [n, c] of Object.entries(r.commands)) out(`  ${show(n)}: ${show(c)}`)
  out(`  hash:   ${hash}`)
  if (!has('--yes') && !has('-y')) {
    if (!(isTTY ?? isTerminal(env))) {
      err('meerkat trust: no terminal to ask in, so nothing was approved (status 400).')
      err(`run: ${trustCommand(folder, { yes: true })}`)
      return 2
    }
    const rl = createInterface({ input: process.stdin, output: process.stderr })
    let answer = ''
    try {
      answer = await rl.question('Trust these commands? [y/N] ')
    } finally {
      rl.close()
    }
    if (!/^y(es)?$/i.test(answer.trim())) {
      out('not trusted')
      return 1
    }
  }
  saveTrust(env, trustKey(r), hash, { commands: r.commands, folder: r.dir })
  // The shared record is written only when this folder is itself a registered worktree of its repository (as that repository lists it), and it
  // stores the approved common directory and the worktree list at this moment. A folder that merely claims the repository writes none.
  const sk = sharedTrustKey(r)
  const top = candidateTop(r.dir)
  if (top) removeTrust(env, revokedKey(top))
  if (sk && top) {
    const real = claimedCommon(r.dir)
    const live = real ? registeredWorktrees(real, r.dir) : null
    if (live && live.some((w) => foldPath(w) === foldPath(top))) saveTrust(env, sk, hash, { commands: r.commands, folder: r.dir, common: real, worktrees: live })
  }
  out(`trusted: ${folder}. Its commands run when you use meerkat test, frontend or gate. To take the trust back: ${trustCommand(folder, { flag: '--revoke' })}.`)
  out(`approved ${nCmds} command(s) for ${folder}`)
  return 0
}

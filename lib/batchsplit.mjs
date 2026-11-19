// `meerkat batch --split`: gate the union of the branches once; when it fails, bisect over the branches (halves) until every branch has its own
// verdict. A half that passes is never searched further, a half that fails is split again, and a result is reused when the merged file contents
// (the git tree of the checkout) are the same as in an earlier gate run. Nothing here touches the user's checkouts: every merge is in a temp worktree.
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join, relative, resolve } from 'node:path'
import { conflictReason, notJudgedLine, stoppedInfo } from './batchreasons.mjs'
import { dataDir } from './datadir.mjs'
import { VERSION } from './version.mjs'
import { EXIT_BLOCKED, EXIT_INCOMPLETE, EXIT_NO_RESULT, EXIT_USAGE, DEFAULT_MAX_RUNS, baselineFor, branchDiff, applyPreTriage, buildBatch, nameList, planBatch, resolveRefs, sideOf, writeResultAtomic } from './batch.mjs'

const NL = String.fromCharCode(10)
const SPLIT_SCHEMA = 1
const git = (dir, args) => spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
const firstLine = (t) => String(t ?? '').split(NL)[0].trim().slice(0, 160)

const failRows = (res) => (res?.checks ?? []).filter((r) => r.status === 'fail' || r.status === 'crash')
// The blocking count of one gate result: the verdict's own number when it gave one, else the places of the failing rows (a row without places counts 1).
export const blockingOf = (res) => (Number.isInteger(res?.blocking) ? res.blocking : failRows(res).reduce((s, r) => s + (r.places?.length || r.findings?.length || 1), 0))
export const failIdsOf = (res) => [...new Set(failRows(res).map((r) => r.check))]
const passed = (res) => !!res && res.code === 0 && res.verdict === 'PASS'
const failed = (res) => !!res && res.code === 1 && failRows(res).length > 0

// One printed row: branch, head sha, verdict, blocking, failing check ids, side; a reason after a bar when the branch has no plain PASS or FAIL.
function rowText(r) {
  const base = `${r.branch} ${String(r.headSha ?? '').slice(0, 12)} ${r.verdict} ${r.blocking} ${r.failingChecks.length ? r.failingChecks.map((f) => f.id).join(',') : '-'} ${r.side ?? '-'}`
  return r.reason && ((r.verdict !== 'PASS' && r.verdict !== 'FAIL') || r.interaction) ? `${base} | ${r.reason}` : base
}

// A digest of Meerkat's own code (lib, packs, bin, thorough). It goes into the split cache key, so a result from an older Meerkat or
// rule set is a miss, never reused as if it were the new gate's answer (29an). Computed once per process.
let fingerprintCache = null
export function meerkatFingerprint() {
  if (fingerprintCache) return fingerprintCache
  const here = fileURLToPath(new URL('..', import.meta.url))
  const h = createHash('sha1').update(VERSION)
  const walk = (dir) => {
    for (const name of readdirSync(dir).sort()) {
      const p = join(dir, name)
      if (statSync(p).isDirectory()) walk(p)
      else if (/\.(mjs|cjs|js|json)$/.test(name)) h.update(relative(here, p)).update(readFileSync(p))
    }
  }
  for (const d of ['lib', 'packs', 'bin', 'thorough']) if (existsSync(join(here, d))) walk(join(here, d))
  fingerprintCache = h.digest('hex')
  return fingerprintCache
}


export async function runBatchSplit(opts, { env = process.env, cwd = process.cwd(), out, err = () => {}, gate, devBaseline } = {}) {
  const startDir = resolve(cwd, opts.app ?? '.')
  const top = git(startDir, ['rev-parse', '--show-toplevel'])
  if (top.status !== 0) {
    out('NO-RESULT: not inside a git work tree. next: run it inside a git repository, or pass --app <repo>')
    return EXIT_USAGE
  }
  const root = top.stdout.trim()
  const sub = relative(root, startDir)
  const asked = opts.base ? [opts.base] : ['main', 'master', 'origin/main', 'origin/master']
  const resolved = resolveRefs(root, [...asked, ...opts.branches])
  const baseRef = opts.base || asked.find((r) => resolved.get(r))
  const baseSha = baseRef ? resolved.get(baseRef) : null
  if (!baseSha) {
    out(`NO-RESULT: git does not know the base ${baseRef ?? '(none found)'}. next: pass --base <ref> that exists`)
    return EXIT_USAGE
  }
  const logs = join(dataDir(env), 'batches', opts.batchId)
  const cacheDir = join(dataDir(env), 'batches', 'split-cache')
  mkdirSync(logs, { recursive: true })
  const maxRuns = Number(env.MEERKAT_BATCH_MAX_RUNS) > 0 ? Number(env.MEERKAT_BATCH_MAX_RUNS) : DEFAULT_MAX_RUNS
  let runs = 0
  let cacheHits = 0
  const cleanups = []
  const ctx = { root, sub, baseSha, env, gate, devBaseline, takeRun: () => (runs < maxRuns ? ((runs += 1), true) : false), cleanups, diffs: new Map() }

  const facts = opts.branches.map((branch) => {
    const sha = resolved.get(branch) ?? null
    if (sha && !ctx.diffs.has(sha)) ctx.diffs.set(sha, branchDiff(root, baseSha, sha))
    const m = sha ? ctx.diffs.get(sha) : null
    return { branch, sha, lines: m ? m.lines : null }
  })
  const plan = planBatch(facts, { maxLines: opts.maxLines, maxPrs: opts.maxPrs })
  const triageNote = applyPreTriage(root, baseSha, plan)
  if (triageNote) err(`[batch split] ${triageNote}`)
  const rows = new Map(facts.map((f) => [f.branch, { branch: f.branch, headSha: f.sha, verdict: 'NO-RESULT', blocking: 0, failingChecks: [], side: null, reason: 'not judged', interaction: false }]))
  const setRow = (b, patch) => Object.assign(rows.get(b), patch)
  for (const e of plan.excluded) setRow(e.branch, { reason: `excluded: ${e.reason}` })

  // One gate run on the union of `items`, or the cached result for the same file contents.
  const gateSet = async (items) => {
    const b = buildBatch(ctx, items)
    for (const c of b.conflicts) setRow(c.item.branch, { reason: `excluded: ${conflictReason(baseRef, c.detail)}` })
    if (!b.merged.length) return { merged: [], res: null }
    const tree = git(b.co.wt, ['rev-parse', 'HEAD^{tree}']).stdout.trim()
    const file = join(cacheDir, `${createHash('sha1').update(`${meerkatFingerprint()}:${baseSha}:${sub}:${tree}`).digest('hex')}.json`)
    if (tree && existsSync(file)) {
      try {
        const res = JSON.parse(readFileSync(file, 'utf8'))
        cacheHits += 1
        err(`[batch split] ${b.merged.map((i) => i.branch).join('+')}: reused a result for the same file contents, from Meerkat ${VERSION} (same code fingerprint)`)
        return { merged: b.merged, res, cached: true }
      } catch {
        /* an unreadable cache file is a miss */
      }
    }
    if (!ctx.takeRun()) return { merged: b.merged, res: null, limited: true }
    err(`[batch split] gating ${b.merged.map((i) => i.branch).join('+')} ...`)
    const res = await gate(b.co.dir, { base: baseSha, env, err: () => {} })
    if (tree && (passed(res) || failed(res))) {
      try {
        writeResultAtomic(file, { code: res.code, verdict: res.verdict, blocking: res.blocking, reason: res.reason, checks: res.checks })
      } catch {
        /* a result that could not be cached is still a result */
      }
    }
    return { merged: b.merged, res }
  }

  const noResult = (items, reason) => {
    for (const it of items) setRow(it.branch, { verdict: 'NO-RESULT', reason })
  }
  const limitReason = (what) => `gate run limit reached (${maxRuns}, MEERKAT_BATCH_MAX_RUNS) before ${what}`
  const leaf = (it, res) => setRow(it.branch, { verdict: 'FAIL', blocking: blockingOf(res), failingChecks: failIdsOf(res).map((id) => ({ id, reason: firstLine(failRows(res).find((r) => r.check === id)?.detail) })), reason: 'fails alone' })
  const unusable = (res) => `the gate did not finish or gave no usable result (${res?.reason || res?.verdict || 'no result'})`

  // `res` is the gate result of exactly `items` (known) or the failing result of the set they were split from (not known: a half whose sibling passed).
  const solve = async (items, res, known) => {
    if (known && passed(res)) {
      for (const it of items) setRow(it.branch, { verdict: 'PASS', reason: 'passes' })
      return
    }
    if (known && !failed(res)) return noResult(items, unusable(res))
    if (items.length === 1) {
      let own = res
      if (!known) {
        const g = await gateSet(items)
        if (g.limited) return noResult(items, limitReason('this branch was checked alone'))
        own = g.res
        if (!g.merged.length) return
        if (passed(own)) return setRow(items[0].branch, { verdict: 'PASS', reason: 'passes alone' })
        if (!failed(own)) return noResult(items, unusable(own))
      }
      return leaf(items[0], own)
    }
    const mid = Math.ceil(items.length / 2)
    const left = items.slice(0, mid)
    const right = items.slice(mid)
    const gl = await gateSet(left)
    if (gl.limited) return noResult(items, limitReason('these branches were checked'))
    await solve(gl.merged, gl.res, true)
    if (passed(gl.res)) await solve(right, res, false) // the left half is clean, so the failure is searched for in the right half only
    else if (failed(gl.res) && blockingOf(gl.res) === blockingOf(res) && failIdsOf(gl.res).length === failIdsOf(res).length) {
      // The left half already carries every finding of the whole: the right half adds none (findings are counted per changed file), so it needs no run.
      for (const it of right) setRow(it.branch, { verdict: 'PASS', reason: 'adds no finding to the union (inferred from the other half, no run of its own)' })
    } else {
      const gr = await gateSet(right)
      if (gr.limited) noResult(right, limitReason('these branches were checked'))
      else await solve(gr.merged, gr.res, true)
    }
    // The union fails but no part of it does: the failure needs branches from both halves together.
    if (known && items.every((it) => rows.get(it.branch).verdict === 'PASS')) {
      const ids = failIdsOf(res)
      for (const it of items) setRow(it.branch, { verdict: 'FAIL', blocking: 0, interaction: true, failingChecks: ids.map((id) => ({ id, reason: 'only fails when these branches are combined' })), reason: `interaction: ${ids.join(', ')} fails only when these branches are combined (${items.map((i) => i.branch).join(' + ')}); no part of the union fails alone` })
    }
  }

  let unionRes = null
  let note = null
  const sideById = new Map()
  try {
    err(`[batch split] gating ${plan.included.length} branch(es) together ...`)
    const first = plan.included.length ? await gateSet(plan.included) : null
    if (!first) note = 'no branch could be merged into the batch, nothing was gated'
    else if (first.limited) noResult(first.merged, limitReason('the union was gated'))
    else if (first.merged.length) {
      unionRes = first.res
      await solve(first.merged, first.res, true)
    }
    // Which side each failing check is on, asked of the base once for all failing check ids.
    const bad = [...rows.values()].filter((r) => r.verdict === 'FAIL')
    const ids = [...new Set(bad.flatMap((r) => r.failingChecks.map((f) => f.id)))]
    if (ids.length) {
      let fails = {}
      try {
        const files = [...new Set(bad.flatMap((r) => ctx.diffs.get(r.headSha)?.files ?? []))]
        fails = (await baselineFor(ctx, ids, files)).fails ?? {}
      } catch {
        fails = {}
      }
      for (const id of ids) sideById.set(id, sideOf(true, fails[id]))
      for (const r of bad) {
        const sides = [...new Set(r.failingChecks.map((f) => sideById.get(f.id)).filter(Boolean))]
        r.side = sides.length ? sides.join('/') : null
        for (const f of r.failingChecks) f.side = sideById.get(f.id) ?? null
      }
    }
    // Stale guard: a branch whose head moved since the start is not judged.
    const nowAll = resolveRefs(root, facts.filter((f) => f.sha).map((f) => f.branch))
    for (const f of facts) if (f.sha && (nowAll.get(f.branch) ?? '') !== f.sha) setRow(f.branch, { verdict: 'NO-RESULT', blocking: 0, failingChecks: [], side: null, reason: `STALE: the branch moved from ${f.sha.slice(0, 12)} while the batch ran; rerun the batch` })
  } finally {
    for (const c of cleanups.reverse()) {
      try {
        c()
      } catch {
        /* a leftover temp folder is not a result */
      }
    }
    if (cleanups.length) git(root, ['worktree', 'prune'])
  }

  const list = [...rows.values()]
  const blocking = list.reduce((s, r) => s + r.blocking, 0)
  const anyFail = list.some((r) => r.verdict === 'FAIL')
  const verdict = anyFail ? 'FAIL' : list.length && list.every((r) => r.verdict === 'PASS') ? 'PASS' : 'NO-RESULT'
  const judged = list.some((r) => r.verdict === 'PASS' || r.verdict === 'FAIL')
  const code = verdict === 'FAIL' ? EXIT_BLOCKED : verdict === 'PASS' ? 0 : judged ? EXIT_INCOMPLETE : EXIT_NO_RESULT
  const unchecked = list.filter((r) => r.verdict === 'NO-RESULT' && /run limit/.test(r.reason)).map((r) => r.branch)
  const stopped = stoppedInfo(list, maxRuns)
  const doc = {
    schema: SPLIT_SCHEMA,
    mode: 'split',
    batchId: opts.batchId,
    verdict,
    exitCode: code,
    base: { ref: baseRef, sha: baseSha },
    blocking,
    gateRuns: runs,
    cacheHits,
    maxRuns,
    note,
    unionVerdict: unionRes ? unionRes.verdict : null,
    branches: list.map((r) => ({ branch: r.branch, headSha: r.headSha, verdict: r.verdict, blocking: r.blocking, failingChecks: r.failingChecks.map((f) => ({ id: f.id, reason: f.reason, side: f.side ?? null })), side: r.side, interaction: r.interaction, reason: r.reason })),
    uncheckedBranches: unchecked,
    stopped,
    logs,
  }
  try {
    writeFileSync(join(logs, 'summary.json'), `${JSON.stringify(doc, null, 2)}${NL}`)
  } catch (e) {
    err(`note: summary.json was not written (${firstLine(e?.message ?? e)})`)
  }
  if (opts.json) {
    out(JSON.stringify(doc, null, 2))
    return code
  }
  out(`BATCH ${verdict} base ${baseSha.slice(0, 12)} | blocking ${blocking}${stopped ? ` | stopped: ${stopped.reason}, ${stopped.branches.length} branch(es) not judged` : ''} | logs ${logs}`)
  for (const r of list) out(rowText(r))
  if (unchecked.length) out(`INCOMPLETE: gate run limit reached (${maxRuns}, MEERKAT_BATCH_MAX_RUNS), ${unchecked.length} branch(es) not checked: ${nameList(unchecked)}. Raise MEERKAT_BATCH_MAX_RUNS or batch fewer branches`)
  if (note) out(`note: ${note}`)
  if (code === EXIT_NO_RESULT) out(notJudgedLine(list))
  out(`${doc.gateRuns} gate run(s), ${cacheHits} reused from cache`)
  return code
}

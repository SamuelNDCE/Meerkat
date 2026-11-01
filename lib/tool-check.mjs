import { MEERKAT_DIR } from './paths.mjs'

// A check that runs one well-known tool, written in a few lines. The tool must be installed: if it is not, the check is NOT RUN and says
// how to install it. Every one proves itself with a small broken file in fixtures/tools/ that the tool must reject.
//
//   tool({ id, bin, args, fixture, install, title, ... })
//     bin      the program (found on PATH or in node_modules/.bin of the project)
//     args     the arguments for a real run, from the repository root
//     fixture  the arguments for the self-test, run from Meerkat's own folder, aimed at a file under fixtures/tools/
//     install  the one line that installs it, shown when it is missing
//     expect   a regex the self-test's output must match, so the tool is proven to reject the file for the right reason
//     onFiles  optional regex: run it over the tracked files that match, instead of over the folder
// Other fields (group, tier, weight, estSeconds, paths, env) work as in any check. `appliesTo` (default: paths) names the files the tool is about:
// a folder with none of them passes with "not applicable" instead of running the tool (lib/applies.mjs).
// Tools that take file names (onFiles) and have no `paths` still say which files they are about, so a folder without any shows "not applicable" and not NOT RUN.
const FILE_KINDS = { shellcheck: ['**/*.sh', '**/*.bash'], hadolint: ['**/Dockerfile', '**/Dockerfile.*', '**/*.dockerfile'] }

export function tool({ id, bin, args = [], fixture, install, title, group = 'functionality', tier = 'fast', weight = 'light', estSeconds = 10, paths, appliesTo = paths ?? FILE_KINDS[id], env, timeoutSeconds, onFiles, expect, scale, fallback }) {
  // onFiles: a regex; the tool is run over the tracked files that match it (for tools that want file names, not a folder).
  const run = onFiles
    ? { cmd: 'node', args: [`${MEERKAT_DIR}/thorough/on-files.mjs`, '--match', onFiles, '--', bin, ...args], cwd: 'repo' }
    : { cmd: bin, args, cwd: 'repo' }
  // fallback: the name of a built-in check (lib/builtin.mjs). The real tool still runs when it is found; when it is not, the built-in one
  // runs and its result says "built-in fallback". The check is then never NOT RUN for the missing tool.
  const wrapper = `${MEERKAT_DIR}/thorough/tool-or-builtin.mjs`
  const wrapped = fallback ? { cmd: 'node', args: [wrapper, '--bin', bin, '--fallback', fallback, ...(onFiles ? ['--match', onFiles] : []), '--', ...args], cwd: 'repo' } : null
  return {
    id,
    group,
    tier,
    lane: 'free',
    weight,
    title,
    estSeconds,
    ...(timeoutSeconds ? { timeoutSeconds } : {}),
    ...(scale ? { scale } : {}),
    needs: fallback ? [] : [bin],
    ...(fallback ? { optionalNeeds: [bin], fallback } : {}),
    install,
    ...(paths ? { paths } : {}),
    ...(appliesTo ? { appliesTo } : {}),
    run: { ...(wrapped ?? run), ...(env ? { env } : {}) },
    selfTest: fallback
      ? { cmd: 'node', args: [wrapper, '--bin', bin, '--fallback', fallback, '--builtin-root', `fixtures/tools/builtin/${fallback}`, '--', ...fixture], cwd: 'meerkat', expectFail: true, expectMatch: expect ? `${expect}|built-in fallback` : 'built-in fallback', ...(env ? { env } : {}) }
      : { cmd: bin, args: fixture, cwd: 'meerkat', expectFail: true, ...(expect ? { expectMatch: expect } : {}), ...(env ? { env } : {}) },
  }
}

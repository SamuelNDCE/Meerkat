// The git pack: commit messages, merges, history size, branch and tag names, changelog and version against the tag, author identity, signing and submodules. Uses the git already installed, nothing else. Turn it on with { "packs": ["git"] } in meerkat.config.json.
import { MEERKAT_DIR as MK } from '../../lib/paths.mjs'

const GS = `${MK}/thorough/git.mjs`
const make = (id, title) => ({
  id,
  group: 'functionality',
  tier: 'fast',
  lane: 'free',
  weight: 'tiny',
  title,
  estSeconds: 3,
  needs: ['node', 'git'],
  run: { cmd: 'node', args: [GS, id], cwd: 'repo' },
  selfTest: { cmd: 'node', args: [GS, id, '--fixtures'], cwd: 'repo', expectFail: true },
})

export default [
  make('commit-message-format', 'Recent commit subjects are short, not empty, not ending in a period, and free of WIP or fixup!'),
  make('merge-commit-noise', 'Recent history does not fill up with "Merge branch" commits'),
  make('large-commits', 'No recent commit touches more files than the budget allows'),
  make('binary-in-history', 'No file over the size budget was added in the recent history'),
  make('long-lived-branches', 'Remote branches with no commit for months are listed (fails only when enforced)'),
  make('branch-names', 'Local branch names are lowercase kebab-case with / separators'),
  make('tags-semver', 'Version-like tags are vX.Y.Z'),
  make('changelog-updated', 'CHANGELOG.md changes when the source changes after the latest tag'),
  make('version-tag-match', 'The package.json version matches the latest tag'),
  make('author-identity', 'Recent commits have a real author name and email, not a placeholder'),
  make('signed-commits-info', 'Share of recent commits that are signed (fails only when enforced)'),
  make('gitmodules-pinned', 'Submodules use https, and branch-tracking submodules are pinned to a commit'),
]

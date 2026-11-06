// `meerkat ai hooks`: prints a JSON snippet for the user's .claude/settings.json. It never writes a settings file.
// Shape checked 2026-11-06 against https://code.claude.com/docs/en/hooks: top-level "hooks"; event name -> array of matcher groups
// { matcher, hooks: [handler] }; command handler { type, command, timeout (seconds), if (a permission rule, tool events only) };
// exit code 2 blocks a PreToolUse call; Stop has no matcher.

// Only a gate failure (exit 1) blocks. Exit 75 means "could not run": that must never stop a commit, so it is let through.
const BLOCK_ON_FAIL = (cmd) => `${cmd}; s=$?; if [ $s -eq 1 ]; then exit 2; fi; exit 0`

export function hooksSnippet({ gateTimeout = 300, stopTimeout = 120 } = {}) {
  const pre = (rule) => ({ matcher: 'Bash', hooks: [{ type: 'command', if: rule, command: BLOCK_ON_FAIL('meerkat gate --staged'), timeout: gateTimeout }] })
  return {
    hooks: {
      PreToolUse: [pre('Bash(git commit *)'), pre('Bash(git push *)')],
      // Stop cannot be filtered by a matcher. A plain `meerkat gate` (no flags) covers the uncommitted changes and never blocks stopping.
      Stop: [{ hooks: [{ type: 'command', command: 'meerkat gate; exit 0', timeout: stopTimeout }] }],
    },
  }
}

// The notes go to stderr so stdout is valid JSON that can be pasted or piped.
export function hooksNotes() {
  return [
    'Merge the JSON above into .claude/settings.json (project) or ~/.claude/settings.json (all projects). Meerkat does not write that file.',
    'PreToolUse: a git commit or git push runs `meerkat gate --staged`; a failed gate (exit 1) blocks the call. Timeouts are in seconds.',
    'Stop: after each turn, a quick `meerkat gate` on the changed files. It reports and never blocks.',
    'The commands use POSIX shell syntax (Git Bash on Windows).',
  ].join('\n')
}

export const hooksText = (opts) => JSON.stringify(hooksSnippet(opts), null, 2)

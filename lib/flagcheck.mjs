// One check for the options of the small commands: an option the command does not know stops it with the usage line (exit 2), the way every
// other command already does (lib/cli.mjs parseFlags). Without it these commands ignored a misspelt flag and carried on, so a typo such as
// `meerkat baseline --bogus` still wrote a baseline.
const GLOBAL = ['--json', '-q', '--quiet', '--no-color', '-y', '--yes', '--no-input', '--dry-run', '-h', '--help']

// Per command: the switches it accepts, the options that take a value, and its usage line.
export const SMALL_COMMANDS = {
  last: { switches: [], values: [], usage: 'meerkat last' },
  logs: { switches: [], values: [], usage: 'meerkat logs [run-id]' },
  commands: { switches: [], values: ['--app'], usage: 'meerkat commands [folder] [--json]' },
  trend: { switches: [], values: ['--app'], usage: 'meerkat trend [folder]' },
  suggest: { switches: [], values: ['--app'], usage: 'meerkat suggest [run-folder]' },
  'pr-comment': { switches: ['--post'], values: ['--run-url', '--repo', '--sha', '--pr', '--run', '--app'], usage: 'meerkat pr-comment [run-folder] [--run-url <url>] [--repo <owner/name>] [--sha <sha>] [--post]' },
  describe: { switches: [], values: [], usage: 'meerkat describe' },
  bug: { switches: [], values: [], usage: 'meerkat bug' },
  ps: { switches: ['--kill'], values: [], usage: 'meerkat ps [--kill] [--json]' },
  version: { switches: [], values: [], usage: 'meerkat version' },
  update: { switches: ['--check'], values: [], usage: 'meerkat update [--check] [--yes] | auto|notify|off|status' },
  dismissals: { switches: ['--stats', '--verify'], values: ['--show', '--app'], usage: 'meerkat dismissals [folder] [--stats] [--show <id>] [--verify]' },
  redtest: { switches: [], values: ['--kind'], usage: 'meerkat redtest [--kind mutation|faults|adversarial|regression|cleantwin|all]' },
  baseline: { switches: ['--clear'], values: ['--run', '--app'], usage: 'meerkat baseline [folder] [--clear] [--run <dir>]' },
}

// Returns null, or { message, code: 2 } for the first option the command does not know.
export function unknownOption(argv) {
  const [word, ...rest] = argv
  const spec = SMALL_COMMANDS[word]
  if (!spec || rest.includes('--help') || rest.includes('-h')) return null
  for (let i = 0; i < rest.length; i++) {
    const a = String(rest[i])
    if (spec.values.includes(a)) {
      i++
      continue
    }
    if (!a.startsWith('-') || a === '-' || GLOBAL.includes(a) || spec.switches.includes(a)) continue
    return { code: 2, message: `meerkat ${word}: unknown option ${a.replace(/[\p{Cc}\p{Cf}]/gu, '?')}\nusage: ${spec.usage}` }
  }
  return null
}

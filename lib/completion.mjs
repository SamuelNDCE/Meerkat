// `meerkat completion powershell|bash|zsh`: tab completion for commands, presets, nouns and verbs. Check ids are asked for
// lazily (meerkat check list --json) only when the word before the cursor is a command that takes a check.
import { allWords } from './help.mjs'
import { PRESETS } from './presets.mjs'

export const SHELLS = ['powershell', 'bash', 'zsh']
export const VERBS = {
  check: ['list', 'show'],
  preset: ['list', 'show', 'new', 'delete'],
  pack: ['list', 'enable', 'disable', 'add', 'remove'],
  run: ['list', 'show', 'log', 'open'],
  root: ['list', 'add', 'remove'],
  recent: ['list', 'clear'],
  mcp: ['install', 'serve', 'status'],
  ai: ['status', 'use', 'test'],
  update: ['check', 'apply', 'auto', 'notify', 'off', 'status'],
  completion: SHELLS,
}
const CHECK_WORDS = ['show', 'why', 'log']

export function completionScript(shell) {
  const words = [...new Set([...allWords(), ...Object.keys(PRESETS)])].sort()
  const verbs = Object.entries(VERBS)
  if (shell === 'powershell') {
    return [
      '# meerkat tab completion. Add this to your $PROFILE:  meerkat completion powershell | Out-String | Invoke-Expression',
      'Register-ArgumentCompleter -Native -CommandName meerkat -ScriptBlock {',
      '  param($wordToComplete, $commandAst, $cursorPosition)',
      '  $words = @($commandAst.CommandElements | ForEach-Object { $_.ToString() })',
      `  $commands = @(${words.map((w) => `'${w}'`).join(', ')})`,
      '  $verbs = @{',
      ...verbs.map(([k, v]) => `    '${k}' = @(${v.map((x) => `'${x}'`).join(', ')})`),
      '  }',
      '  $list = $commands',
      '  if ($words.Count -ge 2 -and $verbs.ContainsKey($words[1])) { $list = $verbs[$words[1]] }',
      `  if ($words.Count -ge 2 -and (($words[1] -eq 'check' -and $words.Count -ge 3 -and $words[2] -eq 'show') -or $words[1] -eq 'why' -or $words[1] -eq 'log')) {`,
      '    $env:MEERKAT_NO_PROJECT_CODE = "1"',
      '    try { $list = @(meerkat check list --json 2>$null | ConvertFrom-Json | ForEach-Object { $_.id } | Where-Object { $_ -match "^[a-z0-9][a-z0-9-]*$" }) } finally { Remove-Item Env:MEERKAT_NO_PROJECT_CODE -ErrorAction SilentlyContinue }',
      '  }',
      '  $list | Where-Object { $_ -like "$wordToComplete*" } | ForEach-Object { [System.Management.Automation.CompletionResult]::new($_, $_, "ParameterValue", $_) }',
      '}',
      '',
    ].join('\n')
  }
  if (shell === 'bash' || shell === 'zsh') {
    const cases = verbs.map(([k, v]) => `    ${k}) opts="${v.join(' ')}" ;;`).join('\n')
    const ids = `$(MEERKAT_NO_PROJECT_CODE=1 meerkat check list --json 2>/dev/null | grep -o '"id": *"[^"]*"' | sed 's/.*: *"\\(.*\\)"/\\1/' | grep -E '^[a-z0-9][a-z0-9-]*$')`
    const head = shell === 'bash' ? ['# meerkat tab completion. Add to ~/.bashrc:  source <(meerkat completion bash)', '_meerkat() {', '  local cur prev opts', '  cur="${COMP_WORDS[COMP_CWORD]}"', '  prev="${COMP_WORDS[1]}"'] : ['# meerkat tab completion. Add to ~/.zshrc:  source <(meerkat completion zsh)', 'autoload -Uz compinit && compinit', '_meerkat() {', '  local cur prev opts', '  cur="${words[CURRENT]}"', '  prev="${words[2]}"']
    const n = shell === 'bash' ? '${COMP_CWORD}' : '${CURRENT}'
    const tail = shell === 'bash' ? ['  local w; COMPREPLY=(); for w in $opts; do [[ $w == "$cur"* ]] && COMPREPLY+=("$w"); done', '}', 'complete -F _meerkat meerkat'] : ['  compadd -- ${=opts}', '}', 'compdef _meerkat meerkat']
    return [...head, `  opts="${words.join(' ')}"`, `  if [ "${n}" -ge ${shell === 'bash' ? 2 : 3} ]; then`, '    case "$prev" in', cases, `    why|log) opts="${ids}" ;;`, '    esac', '  fi', `  if [ "$prev" = "check" ] && [ "${n}" -ge ${shell === 'bash' ? 3 : 4} ]; then opts="${ids}"; fi`, ...tail, ''].join('\n')
  }
  return null
}

export { CHECK_WORDS }

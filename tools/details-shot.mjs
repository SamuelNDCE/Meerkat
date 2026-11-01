// Draws the preset details screen (the REAL renderDetails) with a sample project, to an .ansi file you can turn into a PNG.
//   node tools/details-shot.mjs > details.ansi ; python tools/screenshot.py details.ansi details.png
//   add "plain" for no colour and no art, "narrow" for 60 columns, "short" for a small window (shows the scroll note), "scroll" to scroll down 6 rows
import { renderDetails } from '../lib/presetdetails.mjs'
import { PRESETS } from '../lib/presets.mjs'

const args = process.argv.slice(2)
const color = !args.includes('plain')
const width = args.includes('narrow') ? 60 : 100
const rows = args.includes('short') ? 24 : 60
const kind = (id, k, seconds, title) => ({ id, kind: k, seconds, title })
const checks = [
  kind('secret-scan', 'security', 3, 'Secret scan: keys, tokens and private keys in tracked files'),
  kind('risky-code', 'security', 3, 'Risky calls: eval, shell strings, disabled TLS checks, weak hashes, plain http'),
  kind('dependency-pinning', 'security', 3, 'Dependencies name a fixed version, not latest or *'),
  kind('workflow-security', 'security', 3, 'GitHub Actions: pinned actions, limited permissions, no script injection'),
  kind('lockfile-integrity', 'security', 3, 'Locked packages are fetched securely and checksummed'),
  kind('sensitive-files', 'security', 2, 'No environment files, private keys or tokens are tracked'),
  kind('build', 'functionality', 45, 'The project builds'),
  kind('type-check', 'functionality', 20, 'TypeScript type check, no errors'),
  kind('unit-tests', 'functionality', 90, 'Unit tests pass'),
]
const data = {
  name: 'ci',
  source: 'bundled',
  tier: 'fast',
  kinds: ['security', 'functionality'],
  include: [],
  packs: [],
  about: PRESETS['ci'].about,
  purpose: PRESETS['ci'].purpose,
  checks,
  estimateSeconds: 63,
}
const view = renderDetails(data, { offset: args.includes('scroll') ? 6 : 0, project: 'C:/Users/SamuelNDCE/code/plume', version: '1.3.2', width, rows, color, level: color ? 'truecolor' : false, env: color ? {} : { NO_COLOR: '1' }, isTTY: true })
process.stdout.write(`${view.lines.map((l) => l.text).join('\n')}\n`)

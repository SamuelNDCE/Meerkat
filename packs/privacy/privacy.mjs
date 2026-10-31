// The privacy pack: tracker hosts, consent, personal data in logs and source, telemetry disclosure, permission prompts, notices and licences,
// with no tool to install. Turn it on with { "packs": ["privacy"] } in meerkat.config.json.
// Informational checks list what they find and pass, unless the budget key in .meerkat-budgets.json "privacy" is true.
import { MEERKAT_DIR as MK } from '../../lib/paths.mjs'

const PS = `${MK}/thorough/privacy.mjs`
const make = (id, group, suite, title) => ({
  id,
  group,
  suite,
  tier: 'fast',
  lane: 'free',
  weight: 'tiny',
  title,
  estSeconds: 1,
  needs: ['node'],
  run: { cmd: 'node', args: [PS, id], cwd: 'repo' },
  selfTest: { cmd: 'node', args: [PS, id, '--fixtures'], cwd: 'repo', expectFail: true },
})

export default [
  make('third-party-trackers', 'security', 'web-security', 'No known tracking or analytics host is loaded (listed unless privacy.noTrackers is true)'),
  make('analytics-consent', 'security', 'web-security', 'A tracker is loaded only where the front end mentions consent, a cookie banner or GDPR'),
  make('pii-in-logs', 'security', 'web-security', 'No personal or secret value (email, password, token, card) is written to a log in the clear'),
  make('pii-patterns-in-source', 'security', 'web-security', 'No real-looking email, phone number, public IP or national ID number is written into the source'),
  make('telemetry-calls', 'security', 'web-security', 'Telemetry and error-reporting calls are listed so the README can disclose them'),
  make('telemetry-disclosure', 'security', 'web-security', 'If the code has telemetry, the README or PRIVACY.md says so'),
  make('privacy-policy-file', 'security', 'web-security', 'A web app with sign-in or forms, or a published package, has a privacy policy (listed unless privacy.requirePolicy is true)'),
  make('external-fonts-cdn', 'security', 'web-security', 'No font or style is loaded from a third-party CDN (listed unless privacy.noThirdPartyFonts is true)'),
  make('geolocation-and-media-requests', 'security', 'web-security', 'Location, camera, microphone and clipboard prompts only run behind a user action'),
  make('local-storage-pii', 'security', 'web-security', 'No personal or secret value is kept in localStorage or sessionStorage'),
  make('notice-file', 'security', 'licensing', 'Committed third-party code has a NOTICE or THIRD_PARTY file'),
  make('lockfile-licenses', 'security', 'licensing', 'Lock-file packages have no copyleft, missing or UNLICENSED licence (listed unless privacy.noCopyleft is true)'),
  make('license-header-consistency', 'security', 'licensing', 'The LICENSE text and the package manifests name the same licence'),
]

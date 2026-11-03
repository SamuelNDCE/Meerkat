// The client-frameworks pack: React, Android / React Native and Next.js checks. Three checks, one per rule table in
// thorough/rules-client-frameworks.mjs: React hooks and links (cf-react), Android manifests and React Native storage, links and
// WebViews (cf-mobile), and Next.js public variables and server actions (cf-next). Each check prints one sub-check per rule
// (docs/suites.md). Turn it on with { "packs": ["client-frameworks"] } in meerkat.config.json.
import { MEERKAT_DIR as MK } from '../../lib/paths.mjs'
import { CHECK_TABLES } from '../../thorough/rules-client-frameworks.mjs'

const CF = `${MK}/thorough/client-frameworks.mjs`
const TITLES = {
  'cf-react': 'React: hooks called in conditions and javascript: links',
  'cf-mobile': 'Android and React Native: exported components, secrets in AsyncStorage, unchecked links and open WebViews',
  'cf-next': 'Next.js: secret-named NEXT_PUBLIC_ variables and server actions without a session check or with unchecked file paths',
}
const SUITE = { 'cf-react': 'web-security', 'cf-mobile': 'desktop-apps', 'cf-next': 'web-security' }

// Subs: the number of rules in each table (computed, never written as a snapshot).
const check = (id) => ({
  id,
  group: 'security',
  tier: 'fast',
  lane: 'free',
  weight: 'tiny',
  title: TITLES[id],
  estSeconds: 1,
  suite: SUITE[id],
  subs: CHECK_TABLES[id].length,
  needs: ['node'],
  run: { cmd: 'node', args: [CF, id], cwd: 'repo' },
  selfTest: { cmd: 'node', args: [CF, id, '--fixtures'], cwd: 'repo', expectFail: true, expectMatch: 'found' },
})

export default Object.keys(CHECK_TABLES).map(check)

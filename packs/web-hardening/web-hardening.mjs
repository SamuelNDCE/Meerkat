// The web-hardening pack: security headers and TLS settings in server config, structural audits on page templates, files that must not be published, and vendored libraries, lockfile and manifest hygiene. No tool to install. Turn it on with { "packs": ["web-hardening"] } in meerkat.config.json.
import { MEERKAT_DIR as MK } from '../../lib/paths.mjs'
import { HEADERS, HTML, PUBLISH, SUPPLY } from '../../thorough/rules-web-hardening.mjs'

const WH = `${MK}/thorough/web-hardening.mjs`
const make = (id, group, title, suite, subs, paths) => ({
  id,
  group,
  tier: 'fast',
  lane: 'free',
  weight: 'tiny',
  title,
  estSeconds: 1,
  needs: ['node'],
  suite,
  subs,
  ...(paths ? { paths } : {}),
  run: { cmd: 'node', args: [WH, id], cwd: 'repo' },
  selfTest: { cmd: 'node', args: [WH, id, '--fixtures'], cwd: 'repo', expectFail: true, expectMatch: 'found' },
})

export default [
  make('wh-headers', 'security', 'Server config sends HSTS, frame, content-type, referrer and CSP headers, and TLS is current', 'web-security', HEADERS.length,
    ['**/*.conf', '**/.htaccess', '**/httpd*', '**/Caddyfile*', '**/web.config', '**/_headers', '**/netlify.toml', '**/vercel.json', '**/staticwebapp.config.json', '**/firebase.json', '**/wrangler.toml', '**/next.config.*', '**/app.*', '**/server.*']),
  make('wh-html', 'ui', 'Page markup avoids session ids in URLs, exposed private IPs, unsafe forms, risky iframes and leftover secrets', 'html-and-css', HTML.length,
    ['**/*.html', '**/*.htm', '**/*.jsx', '**/*.tsx', '**/*.vue', '**/*.svelte', '**/*.php', '**/*.liquid', '**/*.hbs', '**/*.erb', '**/*.ejs']),
  make('wh-publish-root', 'security', 'No git history, env file, dump, key, backup or debug page sits in a published folder, and no host publishes the repo root', 'web-security', PUBLISH.length),
  make('wh-supply', 'security', 'Vendored libraries are not known-vulnerable versions, and lockfile and manifest entries are complete and pinned', 'supply-chain', SUPPLY.length,
    ['**/package.json', '**/package-lock.json', '**/yarn.lock', '**/.npmrc', '**/*.js', '.github/workflows/*.yml']),
]

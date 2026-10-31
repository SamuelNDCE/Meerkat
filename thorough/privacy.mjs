// Privacy, telemetry and licence checks: tracker hosts, consent, personal data in logs and source, telemetry disclosure, permission
// prompts at load time, notices and licence consistency. Zero dependencies; reads only the files git tracks. Run through the privacy pack, or by hand:
//   node thorough/privacy.mjs <check> [--root <dir>]      node thorough/privacy.mjs <check> --fixtures   (must exit 1)
// Limits are set in .meerkat-budgets.json under "privacy". Accepted findings go in .meerkat-privacy-allow, one "check-id path" per line
// (the path may end in * to cover a folder). Informational checks list what they find and still pass, unless their budget key is true:
//   noTrackers, noTelemetry, requirePolicy, noThirdPartyFonts, noCopyleft.
import { finish, isFixture, main, readBudgets, readText, trackedFiles, withFixture } from './kit.mjs'

const cfg = (root) => readBudgets(root)?.privacy ?? {}
const SKIP = /(^|\/)(node_modules|dist|build|vendor|target|fixtures?)\//i
const MINIFIED = /\.min\.(m?js|css)$/i
const TEST_FILE = /(^|\/)(tests?|__tests__)\/|\.(test|spec)\.[a-z]+$|(^|\/)test_[^/]*\.py$|_test\.go$/i
// Meerkat's own check scripts and packs name tracker hosts and sample data as strings: they are data, not findings.
const OWN = /^(thorough|packs)\//
const CODE = /\.(m?[jt]sx?|cjs|py|rs|go|rb|php|java|cs|kt|swift|dart|svelte|vue|astro|html?)$/i
const FRONT = /\.(html?|m?[jt]sx?|vue|svelte|astro|css|scss)$/i
const LOCK = /(^|\/)(package-lock\.json|Cargo\.lock|poetry\.lock)$/

const cache = new Map()
const tracked = (root) => {
  if (!cache.has(root)) cache.set(root, trackedFiles(root))
  return cache.get(root)
}
const files = (root, re) => tracked(root).filter((x) => re.test(x) && !SKIP.test(x) && !MINIFIED.test(x) && !TEST_FILE.test(x) && !OWN.test(x) && !isFixture(x))
const lines = (root, x) => readText(root, x).split('\n').map((l) => l.replace(/\r$/, ''))

const allowRules = new Map()
const allowed = (root, id, x) => {
  if (!allowRules.has(root)) {
    allowRules.set(root, readText(root, '.meerkat-privacy-allow').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#')).map((l) => l.split(/\s+/)))
  }
  return allowRules.get(root).some(([check, path]) => check === id && path && (path.endsWith('*') ? x.startsWith(path.slice(0, -1)) : x === path))
}

const LIST_MAX = 25
// Informational: list what was found and pass, unless the budget key turns it into a failure.
const informational = (root, name, key, f, ok) => {
  if (cfg(root)[key] === true) return finish(name, f, ok)
  if (!f.length) {
    console.log(`${name}: ${ok}`)
    return 0
  }
  console.log(`${name}: ${f.length} listed, informational (set privacy.${key} to true to fail on them)`)
  for (const line of f.slice(0, LIST_MAX)) console.log(`  ${line}`)
  if (f.length > LIST_MAX) console.log(`  ... and ${f.length - LIST_MAX} more`)
  return 0
}

// ---- third-party-trackers: a script, image or frame that loads a known tracking or analytics host
const TRACKERS = [
  ['google analytics', /google-analytics\.com/],
  ['google tag manager', /googletagmanager\.com/],
  ['facebook pixel', /connect\.facebook\.net|facebook\.com\/tr\b/],
  ['hotjar', /hotjar\.com/],
  ['mixpanel', /mixpanel\.com|cdn\.mxpnl\.com/],
  ['segment', /cdn\.segment\.com|api\.segment\.io/],
  ['amplitude', /cdn\.amplitude\.com|api\.amplitude\.com/],
  ['microsoft clarity', /clarity\.ms/],
  ['tiktok pixel', /analytics\.tiktok\.com/],
  ['linkedin insight', /snap\.licdn\.com|px\.ads\.linkedin\.com/],
]
const FRONT_TRACKER_FILES = (root) => files(root, FRONT)
const trackerLines = (root) => {
  const out = []
  for (const x of FRONT_TRACKER_FILES(root)) {
    lines(root, x).forEach((line, i) => {
      const hit = TRACKERS.find(([, re]) => re.test(line))
      if (hit && !allowed(root, 'third-party-trackers', x)) out.push({ x, n: i + 1, name: hit[0], host: hit[1].exec(line)[0] })
    })
  }
  return out
}
const thirdPartyTrackers = (root) => {
  const f = trackerLines(root).map((t) => `${t.x}:${t.n} loads the ${t.name} tracker (${t.host})`)
  return informational(root, 'third-party-trackers', 'noTrackers', f, 'no known tracking or analytics host is loaded by the front end')
}

// ---- analytics-consent: a tracker is loaded but the front end never mentions consent, a cookie banner, GDPR or opt-in
const CONSENT = /\bconsent\b|cookie[-_ ]?(banner|notice|policy)|\bgdpr\b|opt[-_ ]?in\b/i
const analyticsConsent = (root) => {
  const trackers = trackerLines(root)
  if (!trackers.length) {
    console.log('analytics-consent: no tracker is loaded, so no consent is needed')
    return 0
  }
  const front = FRONT_TRACKER_FILES(root)
  if (front.some((x) => CONSENT.test(readText(root, x)))) {
    console.log('analytics-consent: a tracker is loaded and the front end has a consent, cookie or GDPR mention')
    return 0
  }
  const f = trackers.map((t) => `${t.x}:${t.n} loads the ${t.name} tracker, but the front end never mentions consent, a cookie banner, GDPR or opt-in`)
  return finish('analytics-consent', f)
}

// ---- pii-in-logs: a log, print or console call that writes a variable named like personal or secret data, with no redaction nearby
const LOG_CALL = /\bconsole\.(log|info|warn|error|debug)\s*\(|\blogger\.\w+\s*\(|\blog\.(info|debug|warn|error|trace|log)\s*\(|\bLog\.[dviwe]\s*\(|\bprintln\s*\(|System\.out\.print(ln)?\s*\(|\bNSLog\s*\(|\bfmt\.Print\w*\s*\(|(^|[^\w.])print\s*\(/
const SENSITIVE_NAME = /\w*(email|password|passwd|token|ssn|phone|address|card|secret)\w*/i
const STRING_LITERAL = /'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"/g
const REDACTION = /redact|mask|scrub|hash|omit|\*{3}|anonymi/i
const piiInLogs = (root) => {
  const f = []
  for (const x of files(root, CODE)) {
    const ls = lines(root, x)
    ls.forEach((line, i) => {
      const m = LOG_CALL.exec(line)
      if (!m) return
      const args = line.slice(m.index + m[0].length).replace(STRING_LITERAL, '')
      const id = SENSITIVE_NAME.exec(args)
      if (!id) return
      const near = [ls[i - 2] ?? '', ls[i - 1] ?? '', line].join('\n')
      if (REDACTION.test(near) || allowed(root, 'pii-in-logs', x)) return
      f.push(`${x}:${i + 1} logs "${id[0]}", which looks like personal or secret data, with no redaction nearby`)
    })
  }
  return finish('pii-in-logs', f, 'no personal or secret value is written to a log in the clear')
}

// ---- pii-patterns-in-source: a real-looking person's email, a UK or US phone number, a public IPv4 address, a National Insurance or SSN shape
const EMAIL = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g
const GENERIC_LOCAL = /^(noreply|no-reply|donotreply|do-not-reply|info|support|admin|hello|contact|sales|webmaster|postmaster|privacy|security|abuse|team|git|user|test|example|you|name|email|foo|bar|john\.doe|jane\.doe)$/i
const FAKE_DOMAIN = /(^|\.)(example\.(com|org|net)|test|localhost|invalid|local|example)$/i
const UK_MOBILE = /(?:\+44\s?7|\b07)\d{3}\s?\d{6}\b/
const US_PHONE = /(?:\+1[\s.-]?)?\(?\b[2-9]\d{2}\)?[\s.-]\d{3}[\s.-]\d{4}\b/
const IPV4 = /(?<![\w.])(\d{1,3}(?:\.\d{1,3}){3})(?![\w]|\.\d)/g
const NINO = /\b(?!BG|GB|NK|KN|TN|NT|ZZ)[A-CEGHJ-PR-TW-Z][A-CEGHJ-NPR-TW-Z]\d{6}[A-D]\b/
const SSN = /\b(?!000|666|9\d{2})\d{3}-\d{2}-\d{4}\b/
const publicIpv4 = (ip) => {
  const o = ip.split('.').map(Number)
  if (o.some((n) => n > 255)) return false
  const [a, b] = o
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false
  if (a === 169 && b === 254) return false
  if (a === 172 && b >= 16 && b <= 31) return false
  if (a === 100 && b >= 64 && b <= 127) return false
  if (a === 192 && (b === 168 || (b === 0 && o[2] === 2))) return false
  if (a === 198 && (b === 51 || b === 18 || b === 19)) return false
  if (a === 203 && b === 0 && o[2] === 113) return false
  return true
}
const piiPatternsInSource = (root) => {
  const f = []
  for (const x of files(root, CODE)) {
    if (allowed(root, 'pii-patterns-in-source', x)) continue
    lines(root, x).forEach((line, i) => {
      const at = `${x}:${i + 1}`
      for (const m of line.matchAll(EMAIL)) {
        const [local, domain] = [m[0].split('@')[0], m[0].split('@')[1]]
        if (GENERIC_LOCAL.test(local) || FAKE_DOMAIN.test(domain) || /noreply\.github\.com$/i.test(domain)) continue
        f.push(`${at} has the email address ${m[0]}`)
        break
      }
      if (UK_MOBILE.test(line) && !/0000|1234567/.test(line)) f.push(`${at} has a UK mobile number`)
      else {
        const us = US_PHONE.exec(line)
        if (us && !/555[\s.-]?01\d\d/.test(us[0])) f.push(`${at} has a US phone number`)
      }
      for (const m of line.matchAll(IPV4)) {
        if (publicIpv4(m[1])) {
          f.push(`${at} has the public IP address ${m[1]}`)
          break
        }
      }
      if (NINO.test(line)) f.push(`${at} has a UK National Insurance number shape`)
      if (SSN.test(line)) f.push(`${at} has a US Social Security number shape`)
    })
  }
  return finish('pii-patterns-in-source', f, 'no real-looking personal data is written into the source')
}

// ---- telemetry-calls: code that posts to a telemetry, analytics, metrics, usage, track or collect host, or starts an error or performance SDK
const TELEMETRY_HOST = /https?:\/\/([a-z0-9.-]*(?:telemetry|analytics|metrics|usage|track|collect)[a-z0-9.-]*)/i
const TELEMETRY_SDK = /@sentry\/|from ['"]sentry|require\(['"]@?sentry|Sentry\.init\(|@bugsnag\/|Bugsnag\.start\(|datadogRum|@datadog\/|datadog-browser|@newrelic\/|newrelic\.|NewRelic/
const telemetryHits = (root) => {
  const out = []
  for (const x of files(root, CODE)) {
    if (allowed(root, 'telemetry-calls', x)) continue
    lines(root, x).forEach((line, i) => {
      const host = TELEMETRY_HOST.exec(line)
      const sdk = host ? null : TELEMETRY_SDK.exec(line)
      const what = host ? `posts to the ${host[1]} host` : sdk ? `starts the ${sdk[0].trim()} SDK` : null
      if (what) out.push(`${x}:${i + 1} ${what}`)
    })
  }
  return out
}
const telemetryCalls = (root) => informational(root, 'telemetry-calls', 'noTelemetry', telemetryHits(root), 'no telemetry or error-reporting call found (nothing to disclose)')

// ---- telemetry-disclosure: telemetry is in the code, and neither README nor PRIVACY.md says so
const DISCLOSE = /telemetry|analytics|data collection|usage data|collects?\b[^.\n]{0,40}\bdata/i
const telemetryDisclosure = (root) => {
  const hits = telemetryHits(root)
  if (!hits.length) {
    console.log('telemetry-disclosure: no telemetry to disclose')
    return 0
  }
  const docs = tracked(root).filter((x) => /^(README|PRIVACY)[^/]*$/i.test(x))
  if (docs.some((x) => DISCLOSE.test(readText(root, x)))) {
    console.log('telemetry-disclosure: the README or PRIVACY.md says the app collects telemetry or analytics')
    return 0
  }
  const where = docs.length ? docs.join(', ') : 'neither file exists'
  return finish('telemetry-disclosure', [`the README and PRIVACY.md never mention telemetry, analytics or data collection (${where}), but the code has ${hits.length} call(s), for example ${hits[0]}`])
}

// ---- privacy-policy-file: a web app with a sign-in or form, or a published package, and no privacy policy
const USER_FACING = /<form\b|type=["']password["']|type=["']email["']|\b(sign[-_ ]?up|register|create[-_ ]?account|log[-_ ]?in)\b/i
const POLICY_FILE = /(^|\/)(privacy|privacy-policy|privacy-notice)(\.[a-z]+|\/[^/]+)?$/i
const privacyPolicyFile = (root) => {
  // Markup only: a bare "login" in a .js file (a function name, a route) is not a user-facing form.
  const front = files(root, /\.(html?|[jt]sx|vue|svelte|astro)$/i).find((x) => USER_FACING.test(readText(root, x)))
  let pkg = null
  try {
    pkg = JSON.parse(readText(root, 'package.json'))
  } catch {
    pkg = null
  }
  const published = Boolean(pkg && pkg.private !== true && (pkg.main || pkg.exports || pkg.bin))
  if (!front && !published) {
    console.log('privacy-policy-file: no sign-in, form or published package, so no privacy policy is needed')
    return 0
  }
  if (tracked(root).some((x) => POLICY_FILE.test(x))) {
    console.log('privacy-policy-file: a privacy policy or privacy page is in the repository')
    return 0
  }
  const why = front ? `${front} has a form or sign-in` : 'package.json describes a published package'
  return informational(root, 'privacy-policy-file', 'requirePolicy', [`${why}, but there is no PRIVACY.md or privacy page`], 'a privacy policy is present')
}

// ---- external-fonts-cdn: fonts or styles loaded from a third-party host (each visitor's IP address goes to it)
const CDN_HOST = /fonts\.googleapis\.com|fonts\.gstatic\.com|cdnjs\.cloudflare\.com|cdn\.jsdelivr\.net|unpkg\.com/i
const externalFontsCdn = (root) => {
  const f = []
  for (const x of files(root, FRONT)) {
    if (allowed(root, 'external-fonts-cdn', x)) continue
    lines(root, x).forEach((line, i) => {
      const m = CDN_HOST.exec(line)
      if (m) f.push(`${x}:${i + 1} loads from ${m[0]}`)
    })
  }
  return informational(root, 'external-fonts-cdn', 'noThirdPartyFonts', f, 'no font or style is loaded from a third-party CDN')
}

// ---- geolocation-and-media-requests: a permission prompt (location, camera, microphone, notifications, clipboard) called with no click or submit handler nearby
const PERMISSION_CALL = /navigator\.geolocation\b|\bgetUserMedia\s*\(|Notification\.requestPermission\s*\(|navigator\.clipboard\.(readText|read)\s*\(/
const GESTURE = /\bon(click|submit|change|input|keydown|keyup|pointerdown|pointerup|touchend)\b|@(click|submit|change)\b|on:(click|submit|change)\b|addEventListener\(\s*['"](click|submit|change|pointerdown|pointerup|touchend|keydown|keyup)['"]|\bbutton\b/i
const geolocationAndMediaRequests = (root) => {
  const f = []
  for (const x of files(root, FRONT)) {
    if (allowed(root, 'geolocation-and-media-requests', x)) continue
    const ls = lines(root, x)
    ls.forEach((line, i) => {
      const m = PERMISSION_CALL.exec(line)
      if (!m) return
      const before = ls.slice(Math.max(0, i - 8), i + 1).join('\n')
      if (!GESTURE.test(before)) f.push(`${x}:${i + 1} calls ${m[0].trim()} with no click or submit handler in the 8 lines above (it may run at load time)`)
    })
  }
  return finish('geolocation-and-media-requests', f, 'every permission prompt is behind a user action')
}

// ---- local-storage-pii: personal or secret values written to browser storage under a key named like them
const STORE_PII = /(localStorage|sessionStorage)\.setItem\(\s*(['"`])[^'"`]*(email|password|passwd|token|jwt|ssn)[^'"`]*\2/i
const localStoragePii = (root) => {
  const f = []
  for (const x of files(root, FRONT)) {
    if (allowed(root, 'local-storage-pii', x)) continue
    lines(root, x).forEach((line, i) => {
      if (STORE_PII.test(line)) f.push(`${x}:${i + 1} stores a personal or secret value in browser storage`)
    })
  }
  return finish('local-storage-pii', f, 'no personal or secret value is kept in browser storage')
}

// ---- notice-file: third-party code is committed (vendor, third_party or node_modules) and there is no NOTICE or THIRD_PARTY file
const notice = (root) => {
  const all = tracked(root)
  const bundled = all.filter((x) => /(^|\/)(vendor|third_party|node_modules)\//i.test(x) && !allowed(root, 'notice-file', x))
  if (!bundled.length) {
    console.log('notice-file: no third-party code is committed, so no notice file is needed')
    return 0
  }
  if (all.some((x) => /^(NOTICE|THIRD[-_ ]?PARTY)[^/]*$/i.test(x))) {
    console.log('notice-file: a NOTICE or THIRD_PARTY file is in the repository')
    return 0
  }
  return finish('notice-file', [`${bundled.length} committed file(s) under a vendor, third_party or node_modules folder (for example ${bundled[0]}) and no NOTICE or THIRD_PARTY file at the root`])
}

// ---- lockfile-licenses: lock files that store a licence per package: flag copyleft, UNLICENSED or missing ones (only for a permissive project)
const COPYLEFT = /\b(A?GPL|LGPL|SSPL|BUSL)/i
const PERMISSIVE = /^(MIT|Apache-2\.0|BSD-[23]-Clause|ISC|0BSD|Unlicense|CC0-1\.0)$/i
const licenceText = (v) => (typeof v === 'string' ? v : typeof v?.type === 'string' ? v.type : '').trim()
const permissiveLicence = (lic) => Boolean(lic) && lic.split(/\s+(?:OR|AND)\s+/i).every((a) => PERMISSIVE.test(a.trim()))
const copyleftLicence = (lic) => lic.split(/\s+OR\s+/i).every((a) => COPYLEFT.test(a))
const ownLicence = (root) => {
  try {
    const l = licenceText(JSON.parse(readText(root, 'package.json')).license)
    if (l) return l
  } catch {
    /* no readable package.json */
  }
  return /^license\s*=\s*"([^"]+)"/m.exec(readText(root, 'Cargo.toml'))?.[1] ?? ''
}
const lockEntries = (root) => {
  const out = []
  for (const x of tracked(root).filter((p) => LOCK.test(p) && !SKIP.test(p))) {
    const t = readText(root, x)
    if (x.endsWith('package-lock.json')) {
      let j
      try {
        j = JSON.parse(t)
      } catch {
        continue
      }
      const pk = j.packages
        ? Object.entries(j.packages).filter(([k]) => k !== '').map(([k, v]) => ({ name: k.replace(/^.*node_modules\//, ''), license: licenceText(v.license) }))
        : Object.entries(j.dependencies ?? {}).map(([k, v]) => ({ name: k, license: licenceText(v?.license) }))
      for (const e of pk) out.push({ file: x, ...e })
    } else {
      for (const block of t.split(/^\[\[package\]\]\s*$/m).slice(1)) {
        const name = /^name\s*=\s*"([^"]+)"/m.exec(block)?.[1]
        if (name) out.push({ file: x, name, license: /^license\s*=\s*"([^"]+)"/m.exec(block)?.[1] ?? '' })
      }
    }
  }
  return out.filter((e) => !allowed(root, 'lockfile-licenses', e.file))
}
const lockfileLicenses = (root) => {
  const entries = lockEntries(root)
  if (!entries.length) {
    console.log('lockfile-licenses: no package-lock.json, Cargo.lock or poetry.lock is tracked, so nothing was checked')
    return 0
  }
  const licensed = entries.filter((e) => e.license)
  if (!licensed.length) {
    console.log(`lockfile-licenses: the lock files store no licence field, so the licences of ${entries.length} entries were not checked`)
    return 0
  }
  const own = ownLicence(root)
  if (!permissiveLicence(own)) {
    console.log(`lockfile-licenses: the project's own licence (${own || 'none declared'}) is not permissive, so copyleft packages are not flagged`)
    return 0
  }
  const f = []
  for (const e of entries) {
    if (!e.license) f.push(`${e.file}: ${e.name} has no licence field`)
    else if (/^unlicensed$/i.test(e.license)) f.push(`${e.file}: ${e.name} is UNLICENSED`)
    else if (copyleftLicence(e.license)) f.push(`${e.file}: ${e.name} is ${e.license} (copyleft) in a project licensed ${own}`)
  }
  return informational(root, 'lockfile-licenses', 'noCopyleft', f, `no copyleft, missing or UNLICENSED package in ${entries.length} lock entries`)
}

// ---- license-header-consistency: the LICENSE text names one licence and the manifest declares another
const LICENCE_TEXT = [
  ['Apache-2.0', /Apache License[\s\S]*Version 2\.0/i],
  ['AGPL-3.0', /GNU AFFERO GENERAL PUBLIC LICENSE[\s\S]*Version 3/i],
  ['GPL-3.0', /GNU GENERAL PUBLIC LICENSE[\s\S]*Version 3/i],
  ['GPL-2.0', /GNU GENERAL PUBLIC LICENSE[\s\S]*Version 2/i],
  ['LGPL', /GNU LESSER GENERAL PUBLIC LICENSE/i],
  ['MPL-2.0', /Mozilla Public License,? Version 2\.0/i],
  ['MIT', /Permission is hereby granted, free of charge/i],
  ['ISC', /Permission to use, copy, modify, and\/or distribute this software for any/i],
  ['BSD-3-Clause', /Redistribution and use[\s\S]*Neither the name/i],
  ['BSD-2-Clause', /Redistribution and use in source and binary forms/i],
  ['Unlicense', /This is free and unencumbered software/i],
]
const canon = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '')
const licenseHeaderConsistency = (root) => {
  const licFile = tracked(root).find((x) => /^(LICEN[SC]E|COPYING)(\.[a-z]+)?$/i.test(x))
  if (!licFile) {
    console.log('license-header-consistency: no LICENSE file, so there is nothing to compare (the license check reports that)')
    return 0
  }
  const id = LICENCE_TEXT.find(([, re]) => re.test(readText(root, licFile)))?.[0]
  if (!id) {
    console.log(`license-header-consistency: ${licFile} is not a licence text this check knows, so it was not compared`)
    return 0
  }
  const declared = []
  try {
    const l = licenceText(JSON.parse(readText(root, 'package.json')).license)
    if (l) declared.push({ file: 'package.json', value: l })
  } catch {
    /* no readable package.json */
  }
  const cargo = /^license\s*=\s*"([^"]+)"/m.exec(readText(root, 'Cargo.toml'))?.[1]
  if (cargo) declared.push({ file: 'Cargo.toml', value: cargo })
  const py = readText(root, 'pyproject.toml')
  const pyLic = /^license\s*=\s*"([^"]+)"/m.exec(py)?.[1] ?? /^license\s*=\s*\{\s*text\s*=\s*"([^"]+)"/m.exec(py)?.[1]
  if (pyLic) declared.push({ file: 'pyproject.toml', value: pyLic })
  const f = []
  for (const d of declared) {
    if (allowed(root, 'license-header-consistency', d.file)) continue
    for (const alt of d.value.split(/\s+(?:OR|AND|\/)\s+/i)) {
      const a = alt.trim()
      // Only single SPDX-style identifiers are compared: free text such as "Apache License 2.0" or "SEE LICENSE IN" is skipped.
      if (!a || /\s/.test(a) || /^(unlicensed|see)/i.test(a)) continue
      if (!canon(a).startsWith(canon(id))) f.push(`${d.file} declares ${a}, but ${licFile} is the ${id} licence`)
    }
  }
  return finish('license-header-consistency', f, `${licFile}, package.json and the manifests agree on ${id}`)
}

const fx = (tree, run) => ({ run, fixture: () => withFixture(tree, run) })
const BUDGET = (key) => ({ '.meerkat-budgets.json': `{"privacy":{"${key}":true}}` })

main({
  'third-party-trackers': fx({ ...BUDGET('noTrackers'), 'index.html': '<script src="https://www.googletagmanager.com/gtag/js?id=G-1"></script>\n' }, thirdPartyTrackers),
  'analytics-consent': fx({ 'index.html': '<script src="https://static.hotjar.com/c/hotjar.js"></script>\n<p>Hello</p>\n' }, analyticsConsent),
  'pii-in-logs': fx({ 'src/app.js': "function show(userEmail) {\n  console.log('signed in', userEmail)\n}\n" }, piiInLogs),
  'pii-patterns-in-source': fx({ 'src/contact.js': 'export const owner = "jane.smith@gmail.com"\n' }, piiPatternsInSource),
  'telemetry-calls': fx({ ...BUDGET('noTelemetry'), 'src/report.js': "fetch('https://telemetry.acme.dev/collect', { method: 'POST' })\n" }, telemetryCalls),
  'telemetry-disclosure': fx({ 'src/main.js': "import * as Sentry from '@sentry/browser'\nSentry.init({ dsn: 'x' })\n", 'README.md': '# App\n\nA small tool.\n' }, telemetryDisclosure),
  'privacy-policy-file': fx({ ...BUDGET('requirePolicy'), 'index.html': '<form><input type="password" name="pw"></form>\n' }, privacyPolicyFile),
  'external-fonts-cdn': fx({ ...BUDGET('noThirdPartyFonts'), 'index.html': '<link href="https://fonts.googleapis.com/css2?family=Inter" rel="stylesheet">\n' }, externalFontsCdn),
  'geolocation-and-media-requests': fx({ 'src/app.js': 'navigator.geolocation.getCurrentPosition((p) => show(p))\n' }, geolocationAndMediaRequests),
  'local-storage-pii': fx({ 'src/session.js': "localStorage.setItem('authToken', token)\n" }, localStoragePii),
  'notice-file': fx({ 'vendor/lib/util.js': 'module.exports = 1\n' }, notice),
  'lockfile-licenses': fx(
    {
      ...BUDGET('noCopyleft'),
      'package.json': '{"name":"x","version":"1.0.0","license":"MIT"}\n',
      'package-lock.json': `${JSON.stringify({ lockfileVersion: 3, packages: { '': {}, 'node_modules/gplpkg': { version: '1.0.0', license: 'GPL-3.0' } } })}\n`,
    },
    lockfileLicenses,
  ),
  'license-header-consistency': fx(
    {
      'LICENSE': 'MIT License\n\nPermission is hereby granted, free of charge, to any person obtaining a copy of this software.\n',
      'package.json': '{"name":"x","version":"1.0.0","license":"Apache-2.0"}\n',
    },
    licenseHeaderConsistency,
  ),
})

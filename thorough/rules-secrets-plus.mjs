// The rule table for the secrets-plus check: provider-specific secret formats (Meerkat's own patterns, anchored on each vendor's
// documented prefix, length and character set) plus three generic rules (keyword assignment, high-entropy base64, high-entropy hex).
//
// Every rule is { id, title, re | test+find, bad, good, files?, ext?, sample? }, the shape thorough/rules.mjs selfProve() checks.
// Every `bad` sample is ASSEMBLED AT RUNTIME (a prefix plus generated filler), so this file never contains a real-looking secret.
//
// Regex safety: every pattern is linear or bounded. No nested quantifier runs over overlapping classes; a "context" rule looks for a
// vendor word, at most 30 name characters, an assignment mark and a fixed-shape value.

const HEX = '0123456789abcdef'
const HEXU = '0123456789ABCDEF'
const LOW = 'abcdefghijklmnopqrstuvwxyz0123456789'
const UP = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
const ALN = 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789aBcDeFgHiJkLmNoPqRsTuVwXyZ'
const B64U = `${ALN}_-`
const B64 = `${ALN}+/`
const DIG = '0123456789'

// A deterministic filler of n characters from a charset (not random: the same input always gives the same sample).
const f = (n, cs = ALN, k = 1) => {
  let s = ''
  for (let i = 0; i < n; i++) s += cs[(i * 7 + k * 13 + (i >> 2)) % cs.length]
  return s
}
const uuid = () => `${f(8, HEX)}-${f(4, HEX)}-${f(4, HEX)}-${f(4, HEX)}-${f(12, HEX)}`
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
// The end of a fixed-length value: the next character must not continue it.
const E = '(?![A-Za-z0-9])'

const realisticGood = (bad) => `// set ${bad.slice(0, Math.min(8, bad.length >> 1))}<redacted> in your env, never in code${String.fromCharCode(10)}const key = process.env.SERVICE_API_KEY`
const R = (id, title, re, bad, good) => ({ id, title, re, bad, good: good ?? realisticGood(bad) })

// name word(s), up to 30 name characters, an assignment mark, then a value of exactly the vendor's shape.
// The name must also say it holds a secret (key, token, secret, pass, ...): a vendor word alone ("snowflake": "Schneeflocke") is not enough.
const SECRETY = String.raw`(?=[\w.-]{0,45}(?:key|token|secret|pass|pwd|pat(?![a-z])|auth|cred|dsn|license|salt|role|sid|hec))`
const ctx = (names, value) => new RegExp(String.raw`${SECRETY}(?:${names})[\w.-]{0,30}["']?\s{0,5}(?::=|=>|[:=])\s{0,5}["']?${value}${E}`, 'i')
const C = (id, title, names, value, sampleName, sampleValue) => ({
  id,
  title,
  re: ctx(names, value),
  bad: `${sampleName} = "${sampleValue}"`,
  good: `${sampleName} = "<redacted>"${String.fromCharCode(10)}# ${sampleName} is read from the secret store`,
})

// A credentials-in-URL rule (scheme://user:password@host): a password that is a common placeholder (password, postgres, root, ...) is not a leak.
const COMMON_PW = /^(?:pass(?:word)?\d*|postgres|root|admin|user|test|secret|changeme|1234\d*|qwerty|app|dev|local|redis|mysql|guest|demo|pw|\*+|x+)$/i
const U = (id, title, re, bad, good) => {
  const g = new RegExp(re.source, 'g')
  const find = (line) => {
    g.lastIndex = 0
    for (let m = g.exec(line); m; m = g.exec(line)) {
      const pw = /^[a-z0-9+]+:\/\/[^:@/]*:([^@]*)@/i.exec(m[0])?.[1] ?? ''
      if (!isPlaceholder(pw) && !COMMON_PW.test(pw)) return m[0]
    }
    return null
  }
  return { ...R(id, title, re, bad, good), find, test: (line) => find(line) !== null }
}

const P = (n) => `[A-Za-z0-9]{${n}}`

// ---------------------------------------------------------------------------------------------------------------------------
// Generic rules (modelled on keyword and entropy strategies)
// ---------------------------------------------------------------------------------------------------------------------------
const KEYWORDS = String.raw`password|passwd|secret|api[_-]?key|apikey|token|auth(?=[_.\-]|token|key|secret|["':=\s])|credential|private[_-]?key`
const NOT_SECRET_NAME = /(?:sha\d*|md5|hash|checksum|digest|commit|etag|integrity|uuid|guid|csrf|nonce)/i
const keywordRe = () => new RegExp(String.raw`(?:${KEYWORDS})[\w.-]{0,24}["']?\s{0,5}(?::=|=>|[:=])\s{0,5}["']([^"'\s]{8,200})["']`, 'gi')
const entropyRe = () => new RegExp(String.raw`(?:${KEYWORDS}|access[_-]?key|signing[_-]?key)[\w.-]{0,24}["']?\s{0,5}(?::=|=>|[:=])\s{0,5}["']([A-Za-z0-9+/=_-]{20,200})["']`, 'gi')

const PLACEHOLDER =
  /^(?:change[_-]?me|example|sample|dummy|placeholder|redacted|secret|password|passwd|token|null|none|nil|undefined|true|false|test|todo|fixme|unset|empty|default|foobar|hunter2$)|example|your[_-]|my[_-]?(?:secret|password|token|key)|xxx|\*\*\*|\.\.\.|<[^>]*>|\$\{|\{\{|\{%|%\(|%s|^\$|^%|^@|^\{|process\.env|os\.getenv|getenv|environ|\benv\(|\bENV\[|secrets\.|config\.|settings\.|\(|\)/i

// True when a value is obviously not a real secret: a placeholder, an environment lookup, a template, an identifier or a path.
export function isPlaceholder(v) {
  if (!v) return true
  if (PLACEHOLDER.test(v)) return true
  if (/[^\x21-\x7e]/.test(v)) return true // non-ASCII text: a translated label, not a machine-made secret
  if (/^arn:[a-z-]+:/i.test(v)) return true // an AWS ARN names a resource, it is not a secret
  if (/^(.)\1+$/.test(v)) return true // aaaaaaaa
  if (/^(?:https?:\/\/|\.{0,2}\/|[a-z]:\\)/i.test(v)) return true // a URL or a path
  if (/^-{0,2}[A-Za-z][A-Za-z_.:-]*$/.test(v)) return true // letters and separators only: a message key, constant, css variable or identifier
  if (/^[a-z][a-z0-9_.-]*(?:\/[a-z0-9_.-]+)+$/.test(v)) return true // a lower-case relative path (apps/desktop)
  return false
}

// Shannon entropy in bits per character.
export function shannon(s) {
  if (!s) return 0
  const counts = new Map()
  for (const ch of s) counts.set(ch, (counts.get(ch) ?? 0) + 1)
  let h = 0
  for (const n of counts.values()) h -= (n / s.length) * Math.log2(n / s.length)
  return h
}

export const BASE64_LIMIT = 4.5
export const HEX_LIMIT = 3.0

// Each finder returns the matched text of the first hit on the line, or null.
// A name that ends like this holds a reference to a secret (its name, path, id, label), not the secret itself.
const REF_NAME = /(?:name|arn|label|path|file|url|uri|type|length|field|header|prompt|title|text|hint|message|policy|placeholder|endpoint|region|version|id|ids|count|ttl|expiry|expires|prefix|env|var|ref)$/i
export function findKeyword(line) {
  const re = keywordRe()
  for (let m = re.exec(line); m; m = re.exec(line)) {
    const nameOnly = m[0].slice(0, m[0].length - m[1].length).replace(/["']?\s{0,5}(?::=|=>|[:=])\s{0,5}["']$/, '')
    if (!isPlaceholder(m[1]) && !REF_NAME.test(nameOnly) && !/tokeni[sz]|tokens?.*(?:min|max)/i.test(nameOnly)) return m[0]
  }
  return null
}
function findEntropy(line, hex) {
  const re = entropyRe()
  for (let m = re.exec(line); m; m = re.exec(line)) {
    const v = m[1]
    if (isPlaceholder(v) || NOT_SECRET_NAME.test(m[0].slice(0, m[0].length - v.length))) continue
    const isHex = /^[0-9a-f]+$/i.test(v)
    if (hex ? isHex && shannon(v) > HEX_LIMIT : !isHex && /[A-Za-z]/.test(v) && /[0-9]/.test(v) && shannon(v) > BASE64_LIMIT) return m[0]
  }
  return null
}

const generic = (id, title, find, bad, good) => ({ id, title, find, test: (line) => find(line) !== null, bad, good, generic: true })

const GENERIC = [
  generic('generic-keyword-secret', 'A secret-like name (password, token, api_key, ...) is assigned a quoted value of 8 or more characters that is not a placeholder', findKeyword, `db_password = "${'hunter2' + 'Qx9'}"`, 'db_password = "changeme"'),
  generic('generic-entropy-base64', 'A quoted base64-style value of 20+ characters with entropy above 4.5 sits next to a secret-like name', (l) => findEntropy(l, false), `api_token = "${f(40, B64U)}"`, `api_token = "${'ab1'.repeat(14)}"`),
  generic('generic-entropy-hex', 'A quoted hex value of 20+ characters with entropy above 3.0 sits next to a secret-like name', (l) => findEntropy(l, true), `secret_key = "${f(32, HEX)}"`, `secret_key = "${'0'.repeat(32)}"`),
]

// ---------------------------------------------------------------------------------------------------------------------------
// Provider rules
// ---------------------------------------------------------------------------------------------------------------------------
const HDR = '-----BEGIN '
// A header written inside a comment, or closed straight away by a quote (a string constant in a scanner), is a mention, not a key.
const PEM_COMMENT = /^\s*(?:\/\/|\/\*|\*|#)/
const pem = (id, what, label) => {
  const re = new RegExp(`${HDR}${label}-----(?!["'\`])`)
  const find = (line) => (PEM_COMMENT.test(line) ? null : (re.exec(line)?.[0] ?? null))
  return {
    id,
    title: `A ${what} private key block is committed`,
    re,
    find,
    test: (line) => find(line) !== null,
    bad: `${HDR}${label}-----`,
    good: `${HDR.slice(0, 8)} ${label}`,
  }
}

const CLOUD = [
  // The key ids AWS prints in its own docs end in EXAMPLE: they are documentation, not a leak.
  R('aws-access-key-id', 'AWS access key ID (AKIA prefix, 20 characters)', /\bAKIA(?!\w{0,12}EXAMPLE)[A-Z2-7]{16}(?![A-Z0-9])/, 'AKIA' + 'QWERTYUIOPASDFGH', 'AKIA' + 'IOSFODNN7' + 'EXAMPLE'),
  R('aws-session-key-id', 'AWS temporary access key ID (ASIA prefix, 20 characters)', /\bASIA(?!\w{0,12}EXAMPLE)[A-Z2-7]{16}(?![A-Z0-9])/, 'ASIA' + 'QWERTYUIOPASDFGH', 'ASIA' + 'IOSFODNN7' + 'EXAMPLE'),
  C('aws-secret-access-key', 'AWS secret access key (40 characters) assigned to an aws-named variable', String.raw`aws[\w.-]{0,20}secret`, '[A-Za-z0-9/+=]{40}', 'aws_secret_access_key', f(40, B64)),
  C('aws-session-token', 'AWS session token (long base64 value) assigned to an aws-named variable', 'aws[_-]?session[_-]?token', '[A-Za-z0-9/+=]{100,}', 'AWS_SESSION_TOKEN', f(120, B64)),
  R('aws-mws-auth-token', 'Amazon MWS auth token (amzn.mws. plus a UUID)', new RegExp(String.raw`\bamzn\.mws\.${UUID}`), 'amzn.mws.' + uuid()),
  R('aws-appsync-api-key', 'AWS AppSync GraphQL API key (da2- prefix)', /\bda2-[a-z0-9]{26}(?![a-z0-9])/, 'da2-' + f(26, LOW)),
  R('gcp-api-key', 'Google Cloud / Firebase API key (AIza prefix)', /\bAIza[0-9A-Za-z_-]{35}(?![A-Za-z0-9_-])/, 'AIza' + f(35, B64U)),
  R('gcp-oauth-client-id', 'Google OAuth client ID (digits-hash.apps.googleusercontent.com)', /\b[0-9]{6,15}-[0-9a-z]{32}\.apps\.googleusercontent\.com/, f(12, DIG) + '-' + f(32, LOW) + '.apps.googleusercontent.com'),
  R('gcp-oauth-client-secret', 'Google OAuth client secret (GOCSPX- prefix)', /\bGOCSPX-[A-Za-z0-9_-]{28}(?![A-Za-z0-9_-])/, 'GOCSPX-' + f(28, B64U)),
  R('gcp-oauth-access-token', 'Google OAuth access token (ya29. prefix)', /\bya29\.[0-9A-Za-z_-]{30,}/, 'ya29.' + f(60, B64U)),
  R('gcp-oauth-refresh-token', 'Google OAuth refresh token (1//0 prefix)', /\b1\/\/0[0-9A-Za-z_-]{40,}/, '1//0' + f(60, B64U)),
  R('gcp-service-account-key-json', 'Google service account JSON key (private_key_id field)', /"private_key_id"\s*:\s*"[0-9a-f]{40}"/, `"private_key_id": "${f(40, HEX)}"`),
  R('firebase-cloud-messaging-key', 'Firebase Cloud Messaging legacy server key (AAAA prefix)', /\bAAAA[A-Za-z0-9_-]{7}:[A-Za-z0-9_-]{140}/, 'AAAA' + f(7, B64U) + ':' + f(140, B64U)),
  R('azure-storage-account-key', 'Azure storage account key (AccountKey= plus 88 base64 characters)', /\bAccountKey=[A-Za-z0-9+/]{86}==/, 'AccountKey=' + f(86, B64) + '=='),
  R('azure-storage-connection-string', 'Azure storage connection string with an account key', /\bDefaultEndpointsProtocol=https?;[^\s"']{0,200}?AccountKey=[A-Za-z0-9+/]{40,}/, 'DefaultEndpointsProtocol=https;AccountName=acct;AccountKey=' + f(60, B64)),
  R('azure-sas-token', 'Azure shared access signature (sv= ... sig= in a URL)', /\bsv=\d{4}-\d{2}-\d{2}&[^\s"']{0,200}?sig=[A-Za-z0-9%+/]{43,}/, 'https://acct.blob.core.windows.net/c?sv=2021-06-08&ss=b&sp=r&sig=' + f(43, ALN) + '%3D'),
  R('azure-ad-client-secret', 'Azure AD (Entra) app client secret (xxxNQ~ shape)', /(?<![A-Za-z0-9_~.])[A-Za-z0-9_~.]{3}\dQ~[A-Za-z0-9_~.-]{31,34}(?![A-Za-z0-9_~.-])/, f(3, ALN) + '8Q~' + f(34, B64U)),
  R('azure-cosmos-db-key', 'Azure Cosmos DB connection string with an account key', /\bAccountEndpoint=https:\/\/[\w.-]+:?\d*\/?;AccountKey=[A-Za-z0-9+/]{80,}/, 'AccountEndpoint=https://acct.documents.azure.com:443/;AccountKey=' + f(86, B64) + '=='),
  R('azure-service-bus-key', 'Azure Service Bus / Event Hubs connection string with a shared access key', /\bEndpoint=sb:\/\/[\w.-]+\/?;SharedAccessKeyName=[\w.-]+;SharedAccessKey=[A-Za-z0-9+/]{30,}/, 'Endpoint=sb://ns.servicebus.windows.net/;SharedAccessKeyName=root;SharedAccessKey=' + f(44, B64)),
  R('azure-container-registry-password', 'Azure Container Registry password (42 characters, +ACR, 6 characters)', /(?<![A-Za-z0-9+/])[A-Za-z0-9+/]{42}\+ACR[A-Za-z0-9]{6}(?![A-Za-z0-9])/, f(42, B64) + '+ACR' + f(6, ALN)),
  C('azure-devops-pat', 'Azure DevOps personal access token (52 base32 characters)', 'azure|devops|ado[_-]?pat', '[a-z2-7]{52}', 'AZURE_DEVOPS_PAT', f(52, 'abcdefghijklmnopqrstuvwxyz234567')),
  R('alibaba-access-key-id', 'Alibaba Cloud access key ID (LTAI prefix)', /\bLTAI[A-Za-z0-9]{12,20}(?![A-Za-z0-9])/, 'LTAI' + f(16, ALN)),
  R('tencent-secret-id', 'Tencent Cloud SecretId (AKID prefix)', /\bAKID[A-Za-z0-9]{32}(?![A-Za-z0-9])/, 'AKID' + f(32, ALN)),
  C('ibm-cloud-api-key', 'IBM Cloud API key (44 characters)', 'ibm[\\w.-]{0,10}(?:cloud|api)', '[A-Za-z0-9_-]{44}', 'IBMCLOUD_API_KEY', f(44, B64U)),
  C('digitalocean-spaces-secret', 'DigitalOcean Spaces secret key (43 base64 characters)', 'spaces[_-]?secret|do[_-]?spaces[\\w.-]{0,10}secret', '[A-Za-z0-9+/]{43}', 'SPACES_SECRET_KEY', f(43, B64)),
]

const SOURCE = [
  R('github-pat-classic', 'GitHub classic personal access token (ghp_)', /\bghp_[A-Za-z0-9]{36}(?![A-Za-z0-9])/, 'ghp_' + f(36)),
  R('github-pat-fine-grained', 'GitHub fine-grained personal access token (github_pat_)', /\bgithub_pat_[A-Za-z0-9]{22}_[A-Za-z0-9]{59}(?![A-Za-z0-9])/, 'github_pat_' + f(22) + '_' + f(59)),
  R('github-oauth-token', 'GitHub OAuth access token (gho_)', /\bgho_[A-Za-z0-9]{36}(?![A-Za-z0-9])/, 'gho_' + f(36)),
  R('github-app-user-token', 'GitHub App user-to-server token (ghu_)', /\bghu_[A-Za-z0-9]{36}(?![A-Za-z0-9])/, 'ghu_' + f(36)),
  R('github-app-server-token', 'GitHub App server-to-server token (ghs_)', /\bghs_[A-Za-z0-9]{36}(?![A-Za-z0-9])/, 'ghs_' + f(36)),
  R('github-refresh-token', 'GitHub refresh token (ghr_)', /\bghr_[A-Za-z0-9]{36}(?![A-Za-z0-9])/, 'ghr_' + f(36)),
  R('gitlab-pat', 'GitLab personal access token (glpat-)', /\bglpat-[A-Za-z0-9_-]{20,}/, 'glpat-' + f(26, B64U)),
  R('gitlab-pipeline-trigger-token', 'GitLab pipeline trigger token (glptt-)', /\bglptt-[0-9a-f]{40}(?![0-9a-f])/, 'glptt-' + f(40, HEX)),
  R('gitlab-runner-token', 'GitLab runner authentication token (glrt-)', /\bglrt-[A-Za-z0-9_-]{20,}/, 'glrt-' + f(26, B64U)),
  R('gitlab-deploy-token', 'GitLab deploy token (gldt-)', /\bgldt-[A-Za-z0-9_-]{20,}/, 'gldt-' + f(26, B64U)),
  R('gitlab-feed-token', 'GitLab feed token (glft-)', /\bglft-[A-Za-z0-9_-]{20,}/, 'glft-' + f(26, B64U)),
  R('gitlab-oauth-app-secret', 'GitLab OAuth application secret (gloas-)', /\bgloas-[0-9a-f]{64}(?![0-9a-f])/, 'gloas-' + f(64, HEX)),
  R('gitlab-ci-build-token', 'GitLab CI job token (glcbt-)', /\bglcbt-[A-Za-z0-9_-]{20,}/, 'glcbt-' + f(26, B64U)),
  R('gitlab-incoming-mail-token', 'GitLab incoming mail token (glimt-)', /\bglimt-[A-Za-z0-9_-]{25}(?![A-Za-z0-9_-])/, 'glimt-' + f(25, B64U)),
  R('gitlab-agent-token', 'GitLab Kubernetes agent token (glagent-)', /\bglagent-[A-Za-z0-9_-]{50,}/, 'glagent-' + f(60, B64U)),
  R('gitlab-scim-token', 'GitLab SCIM token (glsoat-)', /\bglsoat-[A-Za-z0-9_-]{20,}/, 'glsoat-' + f(26, B64U)),
  R('bitbucket-app-password', 'Bitbucket / Atlassian repository access token (ATBB prefix)', /\bATBB[A-Za-z0-9_=.-]{32,}/, 'ATBB' + f(40, B64U)),
  R('atlassian-api-token', 'Atlassian API token (ATATT prefix)', /\bATATT3[A-Za-z0-9_=-]{50,}/, 'ATATT3' + f(60, B64U)),
  R('atlassian-repo-access-token', 'Bitbucket repository / workspace access token (ATCTT prefix)', /\bATCTT3[A-Za-z0-9_=-]{50,}/, 'ATCTT3' + f(60, B64U)),
  C('bitbucket-client-secret', 'Bitbucket OAuth consumer secret (32 characters)', 'bitbucket[\\w.-]{0,10}secret', '[A-Za-z0-9]{32}', 'BITBUCKET_CLIENT_SECRET', f(32)),
  R('npm-access-token', 'npm access token (npm_)', /\bnpm_[A-Za-z0-9]{36}(?![A-Za-z0-9])/, 'npm_' + f(36)),
  R('pypi-upload-token', 'PyPI upload token (pypi-AgEIcHlwaS5vcmc)', /\bpypi-AgEIcHlwaS5vcmc[A-Za-z0-9_-]{50,}/, 'pypi-' + 'AgEIcHlwaS5vcmc' + f(70, B64U)),
  R('rubygems-api-key', 'RubyGems API key (rubygems_)', /\brubygems_[0-9a-f]{48}(?![0-9a-f])/, 'rubygems_' + f(48, HEX)),
  R('nuget-api-key', 'NuGet API key (oy2 prefix)', /\boy2[a-z2-7]{43}(?![a-z0-9])/, 'oy2' + f(43, 'abcdefghijklmnopqrstuvwxyz234567')),
  R('crates-io-token', 'crates.io API token (cio prefix)', /\bcio[A-Za-z0-9]{32}(?![A-Za-z0-9])/, 'cio' + f(32)),
  R('dockerhub-pat', 'Docker Hub personal access token (dckr_pat_)', /\bdckr_pat_[A-Za-z0-9_-]{27,}/, 'dckr_pat_' + f(27, B64U)),
  R('sourcegraph-access-token', 'Sourcegraph access token (sgp_)', /\bsgp_(?:[0-9a-f]{16}_)?[0-9a-f]{40}(?![0-9a-f])/, 'sgp_' + f(16, HEX) + '_' + f(40, HEX)),
  R('circleci-pat', 'CircleCI personal API token (CCIPAT_)', /\bCCIPAT_[A-Za-z0-9]{22}_[0-9a-f]{40}(?![0-9a-f])/, 'CCIPAT_' + f(22) + '_' + f(40, HEX)),
  R('buildkite-agent-token', 'Buildkite user access token (bkua_)', /\bbkua_[0-9a-f]{40}(?![0-9a-f])/, 'bkua_' + f(40, HEX)),
  R('artifactory-api-key', 'JFrog Artifactory API key (AKCp prefix)', /\bAKCp[A-Za-z0-9]{60,80}(?![A-Za-z0-9])/, 'AKCp' + f(69)),
  R('sonarqube-token', 'SonarQube / SonarCloud token (sqp_, squ_, sqa_)', /\bsq[pua]_[0-9a-f]{40}(?![0-9a-f])/, 'sqp_' + f(40, HEX)),
  R('octopus-deploy-api-key', 'Octopus Deploy API key (API- plus 26 characters)', /\bAPI-[A-Z0-9]{26}(?![A-Z0-9])/, 'API-' + f(26, UP)),
  R('harness-api-key', 'Harness personal access token (pat.<id>.<id>.<id>)', /\bpat\.[A-Za-z0-9_-]{22}\.[0-9a-f]{24}\.[A-Za-z0-9]{20}(?![A-Za-z0-9])/, 'pat.' + f(22, B64U) + '.' + f(24, HEX) + '.' + f(20)),
  R('postman-api-key', 'Postman API key (PMAK-)', /\bPMAK-[0-9a-f]{24}-[0-9a-f]{34}(?![0-9a-f])/, 'PMAK-' + f(24, HEX) + '-' + f(34, HEX)),
  R('jenkins-api-token', 'Jenkins user API token (11 plus 32 hex) assigned to a jenkins name', ctx('jenkins', '11[0-9a-f]{32}'), 'JENKINS_API_TOKEN = "11' + f(32, HEX) + '"'),
  R('infracost-api-key', 'Infracost API key (ico- prefix)', /\bico-[A-Za-z0-9]{32}(?![A-Za-z0-9])/, 'ico-' + f(32)),
  R('databricks-token', 'Databricks personal access token (dapi prefix)', /\bdapi[0-9a-f]{32}(?![0-9a-f])/, 'dapi' + f(32, HEX)),
  R('openshift-user-token', 'OpenShift user token (sha256~ prefix)', /\bsha256~[A-Za-z0-9_-]{43}(?![A-Za-z0-9_-])/, 'sha256~' + f(43, B64U)),
]

const PAYMENT = [
  R('stripe-live-secret-key', 'Stripe live secret key (sk_live_)', /\bsk_live_[A-Za-z0-9]{24,}/, 'sk_live_' + f(28)),
  R('stripe-restricted-key', 'Stripe live restricted key (rk_live_)', /\brk_live_[A-Za-z0-9]{24,}/, 'rk_live_' + f(28)),
  R('stripe-webhook-secret', 'Stripe webhook signing secret (whsec_)', /\bwhsec_[A-Za-z0-9]{32,}/, 'whsec_' + f(36)),
  R('square-access-token', 'Square access token (sq0atp-)', /\bsq0atp-[0-9A-Za-z_-]{22}(?![A-Za-z0-9_-])/, 'sq0atp-' + f(22, B64U)),
  R('square-oauth-secret', 'Square OAuth secret (sq0csp-)', /\bsq0csp-[0-9A-Za-z_-]{43}(?![A-Za-z0-9_-])/, 'sq0csp-' + f(43, B64U)),
  R('square-production-token', 'Square production access token (EAAA prefix)', /\bEAAA[A-Za-z0-9_-]{56,64}(?![A-Za-z0-9_-])/, 'EAAA' + f(60, B64U)),
  R('braintree-access-token', 'Braintree / PayPal production access token', /\baccess_token\$production\$[0-9a-z]{16}\$[0-9a-f]{32}/, 'access_token$production$' + f(16, LOW) + '$' + f(32, HEX)),
  C('paypal-client-secret', 'PayPal REST client secret (80 characters starting with E)', 'paypal[\\w.-]{0,10}secret', 'E[A-Za-z0-9_-]{79}', 'PAYPAL_CLIENT_SECRET', 'E' + f(79, B64U)),
  R('razorpay-key-id', 'Razorpay key ID (rzp_live_)', /\brzp_live_[A-Za-z0-9]{14}(?![A-Za-z0-9])/, 'rzp_live_' + f(14)),
  C('razorpay-key-secret', 'Razorpay key secret (24 characters)', 'razorpay[\\w.-]{0,10}secret', '[A-Za-z0-9]{24}', 'RAZORPAY_KEY_SECRET', f(24)),
  C('coinbase-api-secret', 'Coinbase API secret (32 or 64 characters)', 'coinbase[\\w.-]{0,10}(?:secret|private)', '[A-Za-z0-9+/]{32}', 'COINBASE_API_SECRET', f(32, B64)),
  R('coinbase-cdp-key-name', 'Coinbase CDP API key name (organizations/<uuid>/apiKeys/<uuid>)', new RegExp(String.raw`\borganizations/${UUID}/apiKeys/${UUID}`), 'organizations/' + uuid() + '/apiKeys/' + uuid()),
  R('flutterwave-secret-key', 'Flutterwave secret key (FLWSECK-)', /\bFLWSECK(?:_TEST)?-[0-9a-f]{32}-X/, 'FLWSECK-' + f(32, HEX) + '-X'),
  R('shippo-api-token', 'Shippo live API token (shippo_live_)', /\bshippo_live_[0-9a-f]{40}(?![0-9a-f])/, 'shippo_live_' + f(40, HEX)),
  R('easypost-api-key', 'EasyPost production API key (EZAK prefix)', /\bEZAK[A-Za-z0-9]{54}(?![A-Za-z0-9])/, 'EZAK' + f(54)),
  R('plaid-access-token', 'Plaid access token (access-<env>-<uuid>)', new RegExp(String.raw`\baccess-(?:sandbox|development|production)-${UUID}`), 'access-production-' + uuid()),
  C('plaid-secret', 'Plaid secret (30 hex characters)', 'plaid[\\w.-]{0,10}secret', '[0-9a-f]{30}', 'PLAID_SECRET', f(30, HEX)),
  R('mollie-api-key', 'Mollie live API key (live_ plus 30 characters)', /\blive_[A-Za-z0-9]{30}(?![A-Za-z0-9])/, 'live_' + f(30)),
  R('gocardless-live-token', 'GoCardless live access token (live_ plus 40 characters)', ctx('gocardless', 'live_[A-Za-z0-9_=-]{40}'), 'GOCARDLESS_ACCESS_TOKEN = "live_' + f(40, B64U) + '"'),
  R('paddle-api-key', 'Paddle API key (pdl_live_apikey_)', /\bpdl_(?:live|sdbx)_apikey_[0-9a-z]{26}_[A-Za-z0-9]{22}_[A-Za-z0-9]{3}(?![A-Za-z0-9])/, 'pdl_live_apikey_' + f(26, LOW) + '_' + f(22) + '_' + f(3)),
  C('chargebee-api-key', 'Chargebee live API key', 'chargebee', 'live_[A-Za-z0-9]{32}', 'CHARGEBEE_API_KEY', 'live_' + f(32)),
  R('lob-live-api-key', 'Lob live API key (live_ plus 35 hex)', ctx('lob', 'live_[0-9a-f]{35}'), 'LOB_API_KEY = "live_' + f(35, HEX) + '"'),
  R('duffel-access-token', 'Duffel access token (duffel_live_)', /\bduffel_live_[A-Za-z0-9_-]{43}(?![A-Za-z0-9_-])/, 'duffel_live_' + f(43, B64U)),
]

const COMMS = [
  R('slack-bot-token', 'Slack bot token (xoxb-)', /\bxoxb-[0-9]{9,13}-[0-9]{9,13}-[A-Za-z0-9]{24}(?![A-Za-z0-9])/, 'xoxb-' + f(11, DIG) + '-' + f(12, DIG) + '-' + f(24)),
  R('slack-user-token', 'Slack user token (xoxp-)', /\bxoxp-[0-9]{9,13}-[0-9]{9,13}-(?:[0-9]{9,13}-)?[A-Za-z0-9]{24,}/, 'xoxp-' + f(11, DIG) + '-' + f(12, DIG) + '-' + f(12, DIG) + '-' + f(32, HEX)),
  R('slack-app-token', 'Slack app-level token (xapp-)', /\bxapp-\d-[A-Z0-9]{9,12}-\d{10,}-[a-z0-9]{40,}/, 'xapp-1-' + f(11, UP) + '-' + f(13, DIG) + '-' + f(64, LOW)),
  R('slack-config-token', 'Slack configuration access token (xoxe.xoxp- / xoxe.xoxb-)', /\bxoxe\.xox[bp]-\d-[A-Za-z0-9]{100,}/, 'xoxe.xoxp-1-' + f(120)),
  R('slack-refresh-token', 'Slack configuration refresh token (xoxe-)', /\bxoxe-\d-[A-Za-z0-9]{100,}/, 'xoxe-1-' + f(120)),
  R('slack-webhook-url', 'Slack incoming webhook URL', /https:\/\/hooks\.slack\.com\/(?:services|workflows|triggers)\/[A-Za-z0-9/_-]{20,}/, 'https://hooks.slack.com/services/' + 'T' + f(10, UP) + '/B' + f(10, UP) + '/' + f(24)),
  R('discord-bot-token', 'Discord bot token (three dot-separated parts)', /(?<![A-Za-z0-9_-])[MNO][A-Za-z0-9_-]{23,25}\.[A-Za-z0-9_-]{6}\.[A-Za-z0-9_-]{27,38}(?![A-Za-z0-9_-])/, 'M' + f(24, B64U) + '.' + f(6, B64U) + '.' + f(30, B64U)),
  R('discord-webhook-url', 'Discord webhook URL', /https:\/\/(?:ptb\.|canary\.)?discord(?:app)?\.com\/api\/webhooks\/\d{17,20}\/[A-Za-z0-9_-]{60,}/, 'https://discord.com/api/webhooks/' + f(18, DIG) + '/' + f(68, B64U)),
  C('discord-client-secret', 'Discord application client secret (32 characters)', 'discord[\\w.-]{0,10}secret', '[A-Za-z0-9_-]{32}', 'DISCORD_CLIENT_SECRET', f(32, B64U)),
  R('telegram-bot-token', 'Telegram bot token (digits:AA...)', /(?<![0-9])\d{8,10}:AA[A-Za-z0-9_-]{33}(?![A-Za-z0-9_-])/, f(9, DIG) + ':' + 'AA' + f(33, B64U)),
  R('twilio-api-key-sid', 'Twilio API key SID (SK plus 32 hex)', /\bSK[0-9a-f]{32}(?![0-9a-f])/, 'SK' + f(32, HEX)),
  C('twilio-auth-token', 'Twilio auth token (32 hex)', 'twilio[\\w.-]{0,10}(?:auth|token|secret)', '[0-9a-f]{32}', 'TWILIO_AUTH_TOKEN', f(32, HEX)),
  R('sendgrid-api-key', 'SendGrid API key (SG. plus two parts)', /\bSG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}(?![A-Za-z0-9_-])/, 'SG.' + f(22, B64U) + '.' + f(43, B64U)),
  R('mailgun-private-key', 'Mailgun private API key (key- plus 32 hex)', /\bkey-[0-9a-f]{32}(?![0-9a-f])/, 'key-' + f(32, HEX)),
  R('mailgun-public-key', 'Mailgun public validation key (pubkey-)', /\bpubkey-[0-9a-f]{32}(?![0-9a-f])/, 'pubkey-' + f(32, HEX)),
  C('mailgun-signing-key', 'Mailgun webhook signing key (32 hex)', 'mailgun[\\w.-]{0,10}(?:sign|webhook)', '[0-9a-f]{32}', 'MAILGUN_SIGNING_KEY', f(32, HEX)),
  R('mailchimp-api-key', 'Mailchimp API key (32 hex plus -usNN)', /\b[0-9a-f]{32}-us\d{1,2}(?![A-Za-z0-9])/, f(32, HEX) + '-us14'),
  C('postmark-server-token', 'Postmark server token (UUID)', 'postmark', UUID, 'POSTMARK_SERVER_TOKEN', uuid()),
  R('brevo-api-key', 'Brevo / Sendinblue API key (xkeysib-)', /\bxkeysib-[0-9a-f]{64}-[A-Za-z0-9]{16}(?![A-Za-z0-9])/, 'xkeysib-' + f(64, HEX) + '-' + f(16)),
  C('mandrill-api-key', 'Mandrill API key (22 characters)', 'mandrill', '[A-Za-z0-9_-]{22}', 'MANDRILL_API_KEY', f(22, B64U)),
  R('resend-api-key', 'Resend API key (re_, 8 characters, underscore, 24 characters)', /\bre_[A-Za-z0-9]{8}_[A-Za-z0-9]{24}(?![A-Za-z0-9])/, 're_' + f(8) + '_' + f(24)),
  C('sparkpost-api-key', 'SparkPost API key (40 hex)', 'sparkpost', '[0-9a-f]{40}', 'SPARKPOST_API_KEY', f(40, HEX)),
  C('mailjet-secret-key', 'Mailjet secret key (32 hex)', 'mailjet[\\w.-]{0,10}(?:secret|private)', '[0-9a-f]{32}', 'MAILJET_API_SECRET', f(32, HEX)),
  C('messagebird-access-key', 'MessageBird access key (25 characters)', 'messagebird', '[A-Za-z0-9]{25}', 'MESSAGEBIRD_ACCESS_KEY', f(25)),
  R('twitter-bearer-token', 'X / Twitter bearer token (AAAAAAAAAAAAAAAAAAAAA prefix)', /(?<![A-Za-z0-9+/=%_-])AAAAAAAAAAAAAAAAAAAAA[A-Za-z0-9%]{30,}/, 'A'.repeat(21) + f(40, ALN)),
  C('twitter-api-secret', 'X / Twitter consumer secret (50 characters)', '(?:twitter|x)[_-]?(?:api|consumer)[\\w.-]{0,10}secret', '[A-Za-z0-9]{50}', 'TWITTER_API_SECRET', f(50)),
  R('facebook-access-token', 'Facebook / Meta access token (EAA prefix)', /\bEAA[A-Za-z0-9]{90,}/, 'EAA' + f(110)),
  R('instagram-access-token', 'Instagram access token (IGQ prefix)', /\bIGQ[A-Za-z0-9_-]{80,}/, 'IGQ' + f(100, B64U)),
  R('ms-teams-webhook-url', 'Microsoft Teams incoming webhook URL', /https:\/\/[\w.-]+\.webhook\.office\.com\/webhookb2\/[\w@-]+\/IncomingWebhook\/[a-f0-9]+\/[\w-]+/, 'https://contoso.webhook.office.com/webhookb2/' + uuid() + '@' + uuid() + '/IncomingWebhook/' + f(32, HEX) + '/' + uuid()),
  C('zoom-client-secret', 'Zoom OAuth client secret (32 characters)', 'zoom[\\w.-]{0,10}secret', '[A-Za-z0-9]{32}', 'ZOOM_CLIENT_SECRET', f(32)),
  C('vonage-api-secret', 'Vonage / Nexmo API secret (16 characters)', '(?:vonage|nexmo)[\\w.-]{0,10}secret', '[A-Za-z0-9]{16}', 'VONAGE_API_SECRET', f(16)),
  C('pusher-app-secret', 'Pusher app secret (20 hex)', 'pusher[\\w.-]{0,10}secret', '[0-9a-f]{20}', 'PUSHER_APP_SECRET', f(20, HEX)),
  C('sendbird-api-token', 'Sendbird API token (40 hex)', 'sendbird', '[0-9a-f]{40}', 'SENDBIRD_API_TOKEN', f(40, HEX)),
]

const AI = [
  R('openai-project-key', 'OpenAI project API key (sk-proj-)', /\bsk-proj-[A-Za-z0-9_-]{40,}/, 'sk-proj-' + f(60, B64U)),
  R('openai-service-account-key', 'OpenAI service account key (sk-svcacct-)', /\bsk-svcacct-[A-Za-z0-9_-]{40,}/, 'sk-svcacct-' + f(60, B64U)),
  R('openai-admin-key', 'OpenAI admin key (sk-admin-)', /\bsk-admin-[A-Za-z0-9_-]{40,}/, 'sk-admin-' + f(60, B64U)),
  R('openai-legacy-key', 'OpenAI API key with the T3BlbkFJ marker', /\bsk-[A-Za-z0-9]{20}T3BlbkFJ[A-Za-z0-9]{20}(?![A-Za-z0-9])/, 'sk-' + f(20) + 'T3Blbk' + 'FJ' + f(20)),
  R('openai-classic-key', 'OpenAI classic API key (sk- plus 48 characters)', /\bsk-[A-Za-z0-9]{48}(?![A-Za-z0-9])/, 'sk-' + f(48)),
  R('anthropic-api-key', 'Anthropic API key (sk-ant-api03-)', /\bsk-ant-api0\d-[A-Za-z0-9_-]{80,}/, 'sk-ant-api03-' + f(93, B64U)),
  R('anthropic-admin-key', 'Anthropic admin API key (sk-ant-admin01-)', /\bsk-ant-admin0\d-[A-Za-z0-9_-]{80,}/, 'sk-ant-admin01-' + f(93, B64U)),
  R('anthropic-oauth-token', 'Anthropic OAuth access token (sk-ant-oat01-)', /\bsk-ant-o[a-z]{2}0\d-[A-Za-z0-9_-]{60,}/, 'sk-ant-oat01-' + f(80, B64U)),
  R('huggingface-user-token', 'Hugging Face user access token (hf_)', /\bhf_[A-Za-z0-9]{34}(?![A-Za-z0-9])/, 'hf_' + f(34)),
  R('huggingface-org-token', 'Hugging Face organization API token (api_org_)', /\bapi_org_[A-Za-z0-9]{34}(?![A-Za-z0-9])/, 'api_org_' + f(34)),
  C('cohere-api-key', 'Cohere API key (40 characters)', 'cohere|co[_-]api[_-]key', '[A-Za-z0-9]{40}', 'COHERE_API_KEY', f(40)),
  R('replicate-api-token', 'Replicate API token (r8_)', /\br8_[A-Za-z0-9]{37}(?![A-Za-z0-9])/, 'r8_' + f(37)),
  C('mistral-api-key', 'Mistral API key (32 characters)', 'mistral', '[A-Za-z0-9]{32}', 'MISTRAL_API_KEY', f(32)),
  R('groq-api-key', 'Groq API key (gsk_)', /\bgsk_[A-Za-z0-9]{52}(?![A-Za-z0-9])/, 'gsk_' + f(52)),
  R('perplexity-api-key', 'Perplexity API key (pplx-)', /\bpplx-[A-Za-z0-9]{48}(?![A-Za-z0-9])/, 'pplx-' + f(48)),
  C('together-api-key', 'Together AI API key (64 hex)', 'together', '[0-9a-f]{64}', 'TOGETHER_API_KEY', f(64, HEX)),
  R('xai-api-key', 'xAI API key (xai-)', /\bxai-[A-Za-z0-9]{80}(?![A-Za-z0-9])/, 'xai-' + f(80)),
  R('openrouter-api-key', 'OpenRouter API key (sk-or-v1-)', /\bsk-or-v1-[0-9a-f]{64}(?![0-9a-f])/, 'sk-or-v1-' + f(64, HEX)),
  R('fireworks-api-key', 'Fireworks AI API key (fw_)', /\bfw_[A-Za-z0-9]{24}(?![A-Za-z0-9])/, 'fw_' + f(24)),
  R('elevenlabs-api-key', 'ElevenLabs API key (sk_ plus 48 hex)', /\bsk_[0-9a-f]{48}(?![0-9a-f])/, 'sk_' + f(48, HEX)),
  R('langsmith-api-key', 'LangSmith API key (lsv2_pt_ / lsv2_sk_)', /\blsv2_(?:pt|sk)_[0-9a-f]{32}_[0-9a-f]{10}(?![0-9a-f])/, 'lsv2_pt_' + f(32, HEX) + '_' + f(10, HEX)),
  R('pinecone-api-key', 'Pinecone API key (pcsk_)', /\bpcsk_[A-Za-z0-9]{6}_[A-Za-z0-9]{40,}/, 'pcsk_' + f(6) + '_' + f(50)),
  C('wandb-api-key', 'Weights & Biases API key (40 hex)', 'wandb|weights[_-]?and[_-]?biases', '[0-9a-f]{40}', 'WANDB_API_KEY', f(40, HEX)),
  C('assemblyai-api-key', 'AssemblyAI API key (32 hex)', 'assembly[_-]?ai', '[0-9a-f]{32}', 'ASSEMBLYAI_API_KEY', f(32, HEX)),
  C('deepgram-api-key', 'Deepgram API key (40 hex)', 'deepgram', '[0-9a-f]{40}', 'DEEPGRAM_API_KEY', f(40, HEX)),
  R('deepseek-api-key', 'DeepSeek API key (sk- plus 32 hex) assigned to a deepseek name', ctx('deepseek', 'sk-[0-9a-f]{32}'), 'DEEPSEEK_API_KEY = "sk-' + f(32, HEX) + '"'),
]

const INFRA = [
  R('heroku-platform-key', 'Heroku platform API key (HRKU- prefix)', /\bHRKU-[A-Za-z0-9_-]{60}(?![A-Za-z0-9_-])/, 'HRKU-' + f(60, B64U)),
  C('heroku-api-key', 'Heroku legacy API key (UUID)', 'heroku', UUID, 'HEROKU_API_KEY', uuid()),
  R('digitalocean-pat', 'DigitalOcean personal access token (dop_v1_)', /\bdop_v1_[0-9a-f]{64}(?![0-9a-f])/, 'dop_v1_' + f(64, HEX)),
  R('digitalocean-oauth-token', 'DigitalOcean OAuth token (doo_v1_)', /\bdoo_v1_[0-9a-f]{64}(?![0-9a-f])/, 'doo_v1_' + f(64, HEX)),
  R('digitalocean-refresh-token', 'DigitalOcean refresh token (dor_v1_)', /\bdor_v1_[0-9a-f]{64}(?![0-9a-f])/, 'dor_v1_' + f(64, HEX)),
  C('linode-api-token', 'Linode / Akamai personal access token (64 hex)', 'linode', '[0-9a-f]{64}', 'LINODE_TOKEN', f(64, HEX)),
  C('vercel-token', 'Vercel access token (24 characters)', 'vercel', '[A-Za-z0-9]{24}', 'VERCEL_TOKEN', f(24)),
  R('netlify-pat', 'Netlify personal access token (nfp_)', /\bnfp_[A-Za-z0-9]{36}(?![A-Za-z0-9])/, 'nfp_' + f(36)),
  C('netlify-legacy-token', 'Netlify access token (43 characters) assigned to a netlify name', 'netlify', '[A-Za-z0-9_-]{43}', 'NETLIFY_AUTH_TOKEN', f(43, B64U)),
  C('cloudflare-api-token', 'Cloudflare API token (40 characters)', 'cloudflare|cf[_-]api', '[A-Za-z0-9_-]{40}', 'CLOUDFLARE_API_TOKEN', f(40, B64U)),
  C('cloudflare-global-api-key', 'Cloudflare global API key (37 hex)', 'cloudflare[\\w.-]{0,10}(?:global|key)|cf[_-]api[_-]key', '[0-9a-f]{37}', 'CLOUDFLARE_API_KEY', f(37, HEX)),
  R('cloudflare-origin-ca-key', 'Cloudflare Origin CA key (v1.0-<24 hex>-<146 hex>)', /\bv1\.0-[0-9a-f]{24}-[0-9a-f]{146}(?![0-9a-f])/, 'v1.0-' + f(24, HEX) + '-' + f(146, HEX)),
  C('fastly-api-token', 'Fastly API token (32 characters)', 'fastly', '[A-Za-z0-9_-]{32}', 'FASTLY_API_TOKEN', f(32, B64U)),
  R('terraform-cloud-token', 'Terraform Cloud / Enterprise API token (<14>.atlasv1.<64>)', /\b[A-Za-z0-9]{14}\.atlasv1\.[A-Za-z0-9_-]{60,70}/, f(14) + '.atlasv1.' + f(66, B64U)),
  R('pulumi-access-token', 'Pulumi access token (pul-)', /\bpul-[0-9a-f]{40}(?![0-9a-f])/, 'pul-' + f(40, HEX)),
  R('doppler-token', 'Doppler token (dp.pt. / dp.st. / dp.sa. / dp.ct.)', /\bdp\.(?:pt|st|sa|ct|scim|audit)\.[A-Za-z0-9]{40,44}(?![A-Za-z0-9])/, 'dp.st.' + f(43)),
  R('vault-service-token', 'HashiCorp Vault token (hvs. / hvb. / hvr.)', /\bhv[sbr]\.[A-Za-z0-9_-]{24,}/, 'hvs.' + f(30, B64U)),
  C('consul-acl-token', 'HashiCorp Consul ACL token (UUID)', 'consul', UUID, 'CONSUL_HTTP_TOKEN', uuid()),
  R('flyio-access-token', 'Fly.io personal access token (fo1_)', /\bfo1_[A-Za-z0-9_-]{43}(?![A-Za-z0-9_-])/, 'fo1_' + f(43, B64U)),
  C('railway-token', 'Railway project token (UUID)', 'railway', UUID, 'RAILWAY_TOKEN', uuid()),
  R('render-api-key', 'Render API key (rnd_)', /\brnd_[A-Za-z0-9]{32}(?![A-Za-z0-9])/, 'rnd_' + f(32)),
  R('scalingo-api-token', 'Scalingo API token (tk-us-)', /\btk-us-[A-Za-z0-9_-]{48}(?![A-Za-z0-9_-])/, 'tk-us-' + f(48, B64U)),
  R('yandex-api-key', 'Yandex Cloud API key (AQVN prefix)', /\bAQVN[A-Za-z0-9_-]{35,38}(?![A-Za-z0-9_-])/, 'AQVN' + f(36, B64U)),
  R('yandex-iam-token', 'Yandex Cloud IAM token (t1., a header, a dot, 86 characters)', /\bt1\.[A-Za-z0-9_-]{20,}={0,2}\.[A-Za-z0-9_-]{86}(?![A-Za-z0-9_-])/, 't1.' + f(40, B64U) + '.' + f(86, B64U)),
  R('prefect-api-key', 'Prefect API key (pnu_)', /\bpnu_[A-Za-z0-9]{36}(?![A-Za-z0-9])/, 'pnu_' + f(36)),
  R('onepassword-service-token', '1Password service account token (ops_eyJ)', /\bops_eyJ[A-Za-z0-9+/=]{100,}/, 'ops_' + 'eyJ' + f(120, B64)),
  R('onepassword-secret-key', '1Password secret key (A3-XXXXXX-...)', /\bA3-[A-Z0-9]{6}-(?:[A-Z0-9]{11}|[A-Z0-9]{6}-[A-Z0-9]{5})-[A-Z0-9]{5}-[A-Z0-9]{5}-[A-Z0-9]{5}(?![A-Z0-9])/, 'A3-' + f(6, UP) + '-' + f(11, UP) + '-' + f(5, UP) + '-' + f(5, UP) + '-' + f(5, UP)),
]

const OBSERVABILITY = [
  C('datadog-api-key', 'Datadog API key (32 hex)', 'datadog|dd[_-]api', '[0-9a-f]{32}', 'DATADOG_API_KEY', f(32, HEX)),
  C('datadog-app-key', 'Datadog application key (40 hex)', 'datadog[\\w.-]{0,10}app|dd[_-]app', '[0-9a-f]{40}', 'DATADOG_APP_KEY', f(40, HEX)),
  R('newrelic-user-api-key', 'New Relic user API key (NRAK-)', /\bNRAK-[A-Z0-9]{27}(?![A-Z0-9])/, 'NRAK-' + f(27, UP)),
  R('newrelic-license-key', 'New Relic license key (40 hex ending NRAL)', /\b[0-9a-f]{36}NRAL(?![A-Za-z0-9])/, f(36, HEX) + 'NRAL'),
  R('newrelic-browser-key', 'New Relic browser API key (NRJS-)', /\bNRJS-[0-9a-f]{19}(?![0-9a-f])/, 'NRJS-' + f(19, HEX)),
  R('newrelic-insights-key', 'New Relic Insights key (NRII- / NRIQ-)', /\bNRI[IQ]-[A-Za-z0-9_-]{32}(?![A-Za-z0-9_-])/, 'NRII-' + f(32, B64U)),
  R('sentry-org-auth-token', 'Sentry organization auth token (sntrys_)', /\bsntrys_eyJ[A-Za-z0-9+/=_-]{60,}/, 'sntrys_' + 'eyJ' + f(90, B64U)),
  R('sentry-user-auth-token', 'Sentry user auth token (sntryu_)', /\bsntryu_[0-9a-f]{64}(?![0-9a-f])/, 'sntryu_' + f(64, HEX)),
  R('sentry-dsn-with-secret', 'Sentry DSN (public key and project in a URL)', /https:\/\/[0-9a-f]{32}(?::[0-9a-f]{32})?@[\w.-]{1,80}\/\d+/, 'https://' + f(32, HEX) + '@o123456.ingest.sentry.io/456789'),
  R('grafana-cloud-token', 'Grafana Cloud API token (glc_)', /\bglc_[A-Za-z0-9+/]{32,}={0,2}/, 'glc_' + f(60, B64)),
  R('grafana-service-account-token', 'Grafana service account token (glsa_)', /\bglsa_[A-Za-z0-9]{32}_[0-9a-f]{8}(?![0-9a-f])/, 'glsa_' + f(32) + '_' + f(8, HEX)),
  C('honeycomb-api-key', 'Honeycomb API key (22 to 32 characters)', 'honeycomb', '[A-Za-z0-9]{22,32}', 'HONEYCOMB_API_KEY', f(32)),
  C('rollbar-access-token', 'Rollbar access token (32 hex)', 'rollbar', '[0-9a-f]{32}', 'ROLLBAR_ACCESS_TOKEN', f(32, HEX)),
  C('bugsnag-api-key', 'Bugsnag API key (32 hex)', 'bugsnag', '[0-9a-f]{32}', 'BUGSNAG_API_KEY', f(32, HEX)),
  C('pagerduty-api-key', 'PagerDuty API key (20 characters)', 'pagerduty', '[A-Za-z0-9_+-]{20}', 'PAGERDUTY_API_KEY', f(20)),
  C('opsgenie-api-key', 'Opsgenie API key (UUID)', 'opsgenie', UUID, 'OPSGENIE_API_KEY', uuid()),
  R('dynatrace-api-token', 'Dynatrace API token (dt0c01.)', /\bdt0c01\.[A-Z0-9]{24}\.[A-Z0-9]{64}(?![A-Z0-9])/, 'dt0c01.' + f(24, UP) + '.' + f(64, UP)),
  R('posthog-personal-api-key', 'PostHog personal API key (phx_)', /\bphx_[A-Za-z0-9]{43}(?![A-Za-z0-9])/, 'phx_' + f(43)),
  R('launchdarkly-sdk-key', 'LaunchDarkly server SDK or API key (sdk- / api- plus UUID)', new RegExp(String.raw`\b(?:sdk|api)-${UUID}`), 'sdk-' + uuid()),
  C('amplitude-secret-key', 'Amplitude secret key (32 hex)', 'amplitude[\\w.-]{0,10}secret', '[0-9a-f]{32}', 'AMPLITUDE_SECRET_KEY', f(32, HEX)),
  C('mixpanel-secret', 'Mixpanel project secret (32 hex)', 'mixpanel[\\w.-]{0,10}secret', '[0-9a-f]{32}', 'MIXPANEL_API_SECRET', f(32, HEX)),
  C('segment-write-key', 'Segment write key (32 characters)', 'segment[\\w.-]{0,10}(?:write|secret)', '[A-Za-z0-9]{32}', 'SEGMENT_WRITE_KEY', f(32)),
  C('splunk-hec-token', 'Splunk HTTP Event Collector token (UUID)', 'splunk', UUID, 'SPLUNK_HEC_TOKEN', uuid()),
  C('logdna-ingestion-key', 'Mezmo / LogDNA ingestion key (32 hex)', 'logdna|mezmo', '[0-9a-f]{32}', 'LOGDNA_INGESTION_KEY', f(32, HEX)),
]

const DATA = [
  R('supabase-service-role-key', 'Supabase service_role key (a JWT assigned to a service-role name)', ctx('service[_-]?role|supabase[_-]?service', String.raw`eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}`), 'SUPABASE_SERVICE_ROLE_KEY = "' + 'eyJ' + f(30, B64U) + '.' + f(60, B64U) + '.' + f(40, B64U) + '"'),
  R('supabase-secret-key', 'Supabase secret API key (sb_secret_)', /\bsb_secret_[A-Za-z0-9_-]{20,}/, 'sb_secret_' + f(30, B64U)),
  R('supabase-access-token', 'Supabase personal access token (sbp_)', /\bsbp_[0-9a-f]{40}(?![0-9a-f])/, 'sbp_' + f(40, HEX)),
  R('planetscale-password', 'PlanetScale database password (pscale_pw_)', /\bpscale_pw_[A-Za-z0-9_.-]{32,64}/, 'pscale_pw_' + f(43, B64U)),
  R('planetscale-api-token', 'PlanetScale service token (pscale_tkn_)', /\bpscale_tkn_[A-Za-z0-9_.-]{32,64}/, 'pscale_tkn_' + f(43, B64U)),
  R('planetscale-oauth-token', 'PlanetScale OAuth token (pscale_oauth_)', /\bpscale_oauth_[A-Za-z0-9_.-]{32,64}/, 'pscale_oauth_' + f(43, B64U)),
  U('mongodb-connection-string', 'MongoDB connection string with a user name and password', /\bmongodb(?:\+srv)?:\/\/[^\s:@/"'<>$]{1,64}:[^\s@/"'<>$]{3,64}@/, 'mongodb+srv://app:' + 'pw' + f(10) + '@cluster0.example.mongodb.net/db', 'mongodb+srv://cluster0.example.mongodb.net/db'),
  C('mongodb-atlas-api-key', 'MongoDB Atlas API private key (UUID)', 'atlas[\\w.-]{0,10}(?:private|secret|key)', UUID, 'ATLAS_PRIVATE_KEY', uuid()),
  U('redis-url-password', 'Redis URL with a password', /\brediss?:\/\/[^\s:@/"'<>$]{0,64}:[^\s@/"'<>$]{3,64}@/, 'rediss://default:' + 'pw' + f(12) + '@cache.example.com:6379'),
  U('postgres-url-password', 'PostgreSQL URL with a user name and password', /\bpostgres(?:ql)?:\/\/[^\s:@/"'<>$]{1,64}:[^\s@/"'<>$]{3,64}@/, 'postgresql://app:' + 'pw' + f(12) + '@db.example.com:5432/app'),
  U('mysql-url-password', 'MySQL URL with a user name and password', /\bmysqls?:\/\/[^\s:@/"'<>$]{1,64}:[^\s@/"'<>$]{3,64}@/, 'mysql://app:' + 'pw' + f(12) + '@db.example.com:3306/app'),
  U('amqp-url-password', 'AMQP (RabbitMQ) URL with a user name and password', /\bamqps?:\/\/[^\s:@/"'<>$]{1,64}:[^\s@/"'<>$]{3,64}@/, 'amqps://app:' + 'pw' + f(12) + '@mq.example.com:5671'),
  R('sqlserver-connection-password', 'SQL Server connection string with a password', /\b(?:Server|Data Source)=[^;"'\s]{1,100};[^"'\n]{0,150}?Password=[^;"'\s$<{]{4,64}/i, 'Server=db.example.com;Database=app;User Id=app;Password=' + 'pw' + f(10)),
  C('snowflake-password', 'Snowflake password in a connection setting', 'snowflake', '[^\\s"\'$<{]{8,64}', 'SNOWFLAKE_PASSWORD', 'pw' + f(12)),
  R('cloudinary-url', 'Cloudinary URL with an API secret', /\bcloudinary:\/\/\d{15}:[A-Za-z0-9_-]{27}@/, 'cloudinary://' + f(15, DIG) + ':' + f(27, B64U) + '@demo'),
  C('algolia-admin-key', 'Algolia admin API key (32 hex)', 'algolia[\\w.-]{0,10}(?:admin|secret|write)', '[0-9a-f]{32}', 'ALGOLIA_ADMIN_KEY', f(32, HEX)),
  C('upstash-redis-token', 'Upstash REST token (base64)', 'upstash[\\w.-]{0,20}token', '[A-Za-z0-9=_-]{40,}', 'UPSTASH_REDIS_REST_TOKEN', f(60, B64U)),
  C('confluent-api-secret', 'Confluent Cloud API secret (64 characters)', 'confluent[\\w.-]{0,10}secret', '[A-Za-z0-9+/]{64}', 'CONFLUENT_API_SECRET', f(64, B64)),
  C('elastic-api-key', 'Elastic Cloud API key (base64, 40+ characters)', 'elastic[\\w.-]{0,10}(?:api|key)', '[A-Za-z0-9=_-]{40,}', 'ELASTIC_API_KEY', f(60, B64U)),
  C('clickhouse-key-secret', 'ClickHouse Cloud key secret (43 characters)', 'clickhouse[\\w.-]{0,10}secret', '[A-Za-z0-9]{43}', 'CLICKHOUSE_KEY_SECRET', f(43)),
  U('neo4j-bolt-url-password', 'Neo4j Bolt URL with a password', /\b(?:bolt|neo4j)(?:\+s|\+ssc)?:\/\/[^\s:@/"'<>$]{1,64}:[^\s@/"'<>$]{3,64}@/, 'neo4j+s://neo4j:' + 'pw' + f(12) + '@db.example.com'),
]

const COMMERCE = [
  R('shopify-access-token', 'Shopify admin API access token (shpat_)', /\bshpat_[0-9a-f]{32}(?![0-9a-f])/, 'shpat_' + f(32, HEX)),
  R('shopify-custom-app-token', 'Shopify custom app access token (shpca_)', /\bshpca_[0-9a-f]{32}(?![0-9a-f])/, 'shpca_' + f(32, HEX)),
  R('shopify-private-app-token', 'Shopify private app access token (shppa_)', /\bshppa_[0-9a-f]{32}(?![0-9a-f])/, 'shppa_' + f(32, HEX)),
  R('shopify-shared-secret', 'Shopify app shared secret (shpss_)', /\bshpss_[0-9a-f]{32}(?![0-9a-f])/, 'shpss_' + f(32, HEX)),
  R('woocommerce-consumer-key', 'WooCommerce consumer key (ck_ plus 40 hex)', /\bck_[0-9a-f]{40}(?![0-9a-f])/, 'ck_' + f(40, HEX)),
  R('woocommerce-consumer-secret', 'WooCommerce consumer secret (cs_ plus 40 hex)', /\bcs_[0-9a-f]{40}(?![0-9a-f])/, 'cs_' + f(40, HEX)),
  C('bigcommerce-access-token', 'BigCommerce API access token (30 or 32 characters)', 'bigcommerce', '[A-Za-z0-9]{30,32}', 'BIGCOMMERCE_ACCESS_TOKEN', f(31)),
  C('magento-access-token', 'Magento integration access token (32 characters)', 'magento', '[A-Za-z0-9]{32}', 'MAGENTO_ACCESS_TOKEN', f(32)),
  R('amazon-sp-api-token', 'Amazon Selling Partner access token (Atza| prefix)', /\bAtza\|[A-Za-z0-9_-]{100,}/, 'Atza|' + f(120, B64U)),
  C('etsy-api-secret', 'Etsy API shared secret (10 characters)', 'etsy[\\w.-]{0,10}secret', '[a-z0-9]{10}', 'ETSY_SHARED_SECRET', f(10, LOW)),
  C('printful-api-key', 'Printful API key (40 characters)', 'printful', '[A-Za-z0-9]{40}', 'PRINTFUL_API_KEY', f(40)),
  C('lemonsqueezy-api-key', 'Lemon Squeezy API key (a long JWT) assigned to a lemonsqueezy name', 'lemon[_-]?squeezy', String.raw`eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{50,}\.[A-Za-z0-9_-]{50,}`, 'LEMONSQUEEZY_API_KEY', 'eyJ' + f(40, B64U) + '.' + f(100, B64U) + '.' + f(100, B64U)),
  C('gumroad-access-token', 'Gumroad access token (43 characters)', 'gumroad', '[A-Za-z0-9_-]{43}', 'GUMROAD_ACCESS_TOKEN', f(43, B64U)),
  C('recurly-api-key', 'Recurly private API key (32 hex)', 'recurly', '[0-9a-f]{32}', 'RECURLY_API_KEY', f(32, HEX)),
]

const OTHER = [
  R('jwt-literal', 'A JSON Web Token (header.payload.signature, base64url)', /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/, 'eyJ' + f(20, B64U) + '.eyJ' + f(30, B64U) + '.' + f(43, B64U)),
  pem('pem-rsa-private-key', 'RSA', 'RSA PRIVATE KEY'),
  pem('pem-ec-private-key', 'EC', 'EC PRIVATE KEY'),
  pem('pem-openssh-private-key', 'OpenSSH', 'OPENSSH PRIVATE KEY'),
  pem('pem-pgp-private-key', 'PGP', 'PGP PRIVATE KEY BLOCK'),
  pem('pem-pkcs8-private-key', 'PKCS8', 'PRIVATE KEY'),
  pem('pem-dsa-private-key', 'DSA', 'DSA PRIVATE KEY'),
  pem('pem-encrypted-private-key', 'encrypted PKCS8', 'ENCRYPTED PRIVATE KEY'),
  R('putty-private-key', 'A PuTTY private key file header', /\bPuTTY-User-Key-File-\d:/, 'PuTTY-User-Key-File-3: ssh-ed25519'),
  R('ssh-private-key-base64', 'A base64-encoded OpenSSH private key (openssh-key-v1)', /\bb3BlbnNzaC1rZXktdjE[A-Za-z0-9+/=]{40,}/, 'b3BlbnNzaC1rZXktdjE' + f(80, B64)),
  U('basic-auth-url', 'A web or FTP address with a user name and password in it', /\b(?:https?|ftps?|sftp):\/\/[^\s:@/"'<>$]{1,64}:[^\s@/"'<>$]{3,64}@[A-Za-z0-9][\w.-]*/, 'https://deploy:' + 'pw' + f(10) + '@git.example.com/repo.git'),
  R('age-secret-key', 'An age encryption secret key (AGE-SECRET-KEY-1)', /\bAGE-SECRET-KEY-1[QPZRY9X8GF2TVDW0S3JN54KHCE6MUA7L]{58}/, 'AGE-SECRET-KEY-1' + f(58, 'QPZRY9X8GF2TVDW0S3JN54KHCE6MUA7L')),
  R('kubernetes-service-account-token', 'A Kubernetes service account token (a JWT issued by kubernetes/serviceaccount)', /\beyJ[A-Za-z0-9_-]{10,}\.eyJpc3MiOiJrdWJlcm5ldGVzL3NlcnZpY2VhY2Nv[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{20,}/, 'eyJ' + f(30, B64U) + '.' + 'eyJpc3MiOiJrdWJlcm5ldGVzL3NlcnZpY2VhY2Nv' + f(80, B64U) + '.' + f(43, B64U)),
  R('kubeconfig-client-key-data', 'A kubeconfig client-key-data or token value', /\b(?:client-key-data|token):\s*[A-Za-z0-9+/=_-]{100,}\s*$/, 'client-key-data: ' + f(120, B64), 'client-key-data: ' + 'short'),
  {
    id: 'npmrc-auth-token',
    title: 'An .npmrc file holds a literal registry auth token',
    re: /(?::|^)_authToken\s*=\s*(?!\$\{)[^\s$"']{8,}/,
    files: /(^|\/)\.npmrc$/,
    sample: '.npmrc',
    bad: '//registry.npmjs.org/:_authToken=' + f(36),
    good: '//registry.npmjs.org/:_authToken=${NPM_TOKEN}',
  },
  {
    id: 'pypirc-password',
    title: 'A .pypirc file holds a literal upload password or token',
    re: /^\s*password\s*[:=]\s*(?!\$)\S{6,}/i,
    files: /(^|\/)\.pypirc$/,
    sample: '.pypirc',
    bad: 'password = pypi-' + f(40),
    good: '[pypi]\nusername = __token__\npassword = $PYPI_TOKEN',
  },
  {
    id: 'netrc-password',
    title: 'A .netrc file holds a literal password',
    re: /\bpassword\s+(?!\$)\S{4,}/,
    files: /(^|\/)_?\.?netrc$/,
    sample: '.netrc',
    bad: 'machine example.com login deploy password ' + 'pw' + f(10),
    good: 'machine example.com login deploy\nmachine example.org login ci password $NETRC_PW',
  },
  {
    id: 'dockercfg-auth',
    title: 'A Docker config file holds a base64 registry login',
    re: /"auth"\s*:\s*"[A-Za-z0-9+/=]{20,}"/,
    files: /(^|\/)(\.dockercfg|\.docker\/config\.json|config\.json)$/,
    sample: '.dockercfg',
    bad: '{"auths": {"r.example.com": {"auth": "' + f(40, B64) + '"}}}',
    good: '{"auths": {"r.example.com": {}}}',
  },
  C('okta-api-token', 'Okta API token (00 plus 40 characters)', 'okta', '00[A-Za-z0-9_-]{40}', 'OKTA_API_TOKEN', '00' + f(40, B64U)),
  C('auth0-client-secret', 'Auth0 client secret (64 characters)', 'auth0[\\w.-]{0,10}secret', '[A-Za-z0-9_-]{64}', 'AUTH0_CLIENT_SECRET', f(64, B64U)),
  R('mapbox-secret-token', 'Mapbox secret access token (sk.eyJ)', /\bsk\.eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/, 'sk.' + 'eyJ' + f(40, B64U) + '.' + f(22, B64U)),
  R('linear-api-key', 'Linear API key (lin_api_)', /\blin_api_[A-Za-z0-9]{40}(?![A-Za-z0-9])/, 'lin_api_' + f(40)),
  R('notion-integration-token', 'Notion integration token (secret_ / ntn_)', /\b(?:secret_[A-Za-z0-9]{43}|ntn_[A-Za-z0-9]{40,50})(?![A-Za-z0-9])/, 'ntn_' + f(46)),
  R('airtable-pat', 'Airtable personal access token (pat<14>.<64 hex>)', /\bpat[A-Za-z0-9]{14}\.[0-9a-f]{64}(?![0-9a-f])/, 'pat' + f(14) + '.' + f(64, HEX)),
  R('asana-pat', 'Asana personal access token (0/ or 1/ plus 16 digits : 32 hex)', ctx('asana', String.raw`[01]/\d{16}:[0-9a-f]{32}`), 'ASANA_TOKEN = "1/' + f(16, DIG) + ':' + f(32, HEX) + '"'),
  R('figma-pat', 'Figma personal access token (figd_)', /\bfigd_[A-Za-z0-9_-]{40}(?![A-Za-z0-9_-])/, 'figd_' + f(40, B64U)),
  R('dropbox-access-token', 'Dropbox short-lived or long-lived access token (sl. prefix)', /\bsl\.[A-Za-z0-9_-]{130,}/, 'sl.' + f(140, B64U)),
  C('dropbox-app-secret', 'Dropbox app secret (15 characters)', 'dropbox[\\w.-]{0,10}secret', '[a-z0-9]{15}', 'DROPBOX_APP_SECRET', f(15, LOW)),
  C('zendesk-api-token', 'Zendesk API token (40 characters)', 'zendesk', '[A-Za-z0-9]{40}', 'ZENDESK_API_TOKEN', f(40)),
  R('intercom-access-token', 'Intercom access token (base64 starting dG9rO)', /\bdG9rO[A-Za-z0-9+/=]{40,}/, 'dG9rO' + f(60, B64)),
  R('hubspot-pat', 'HubSpot private app token (pat-na1- / pat-eu1-)', new RegExp(String.raw`\bpat-(?:na|eu)\d-${UUID}`), 'pat-na1-' + uuid()),
  C('hubspot-api-key', 'HubSpot legacy API key (UUID)', 'hubspot', UUID, 'HUBSPOT_API_KEY', uuid()),
  R('contentful-pat', 'Contentful personal access token (CFPAT-)', /\bCFPAT-[A-Za-z0-9_-]{43}(?![A-Za-z0-9_-])/, 'CFPAT-' + f(43, B64U)),
  R('typeform-pat', 'Typeform personal access token (tfp_)', /\btfp_[A-Za-z0-9_-]{40,}/, 'tfp_' + f(50, B64U)),
  R('clickup-api-token', 'ClickUp personal API token (pk_<digits>_<32>)', /\bpk_\d{6,10}_[A-Z0-9]{32}(?![A-Z0-9])/, 'pk_' + f(8, DIG) + '_' + f(32, UP)),
  R('readme-api-key', 'ReadMe API key (rdme_)', /\brdme_[a-z0-9]{70}(?![a-z0-9])/, 'rdme_' + f(70, LOW)),
  R('frameio-token', 'Frame.io developer token (fio-u-)', /\bfio-u-[A-Za-z0-9_=-]{64}(?![A-Za-z0-9_=-])/, 'fio-u-' + f(64, B64U)),
  R('stackhawk-api-key', 'StackHawk API key (hawk.<20>.<20>)', /\bhawk\.[A-Za-z0-9]{20}\.[A-Za-z0-9]{20}(?![A-Za-z0-9])/, 'hawk.' + f(20) + '.' + f(20)),
  C('beamer-api-token', 'Beamer API token (b_ plus 44 characters) assigned to a beamer-named variable', 'beamer', 'b_[A-Za-z0-9=_-]{44}', 'BEAMER_API_TOKEN', 'b_' + f(44, B64U)),
  R('endorlabs-api-key', 'Endor Labs API key (endr+)', /\bendr\+[A-Za-z0-9-]{16}(?![A-Za-z0-9-])/, 'endr+' + f(16)),
  C('contentstack-delivery-token', 'Contentstack delivery token (cs plus 24 hex)', 'contentstack', 'cs[0-9a-f]{24}', 'CONTENTSTACK_TOKEN', 'cs' + f(24, HEX)),
  C('mapquest-consumer-secret', 'MapQuest consumer secret (16 characters)', 'mapquest[\\w.-]{0,10}secret', '[A-Za-z0-9]{16}', 'MAPQUEST_SECRET', f(16)),
  C('twitch-client-secret', 'Twitch client secret (30 characters)', 'twitch[\\w.-]{0,10}secret', '[a-z0-9]{30}', 'TWITCH_CLIENT_SECRET', f(30, LOW)),
  C('vimeo-access-token', 'Vimeo access token (32 hex)', 'vimeo', '[0-9a-f]{32}', 'VIMEO_ACCESS_TOKEN', f(32, HEX)),
  C('spotify-client-secret', 'Spotify client secret (32 hex)', 'spotify[\\w.-]{0,10}secret', '[0-9a-f]{32}', 'SPOTIFY_CLIENT_SECRET', f(32, HEX)),
  C('rapidapi-key', 'RapidAPI key (50 characters)', 'rapid[_-]?api', '[A-Za-z0-9]{50}', 'RAPIDAPI_KEY', f(50)),
  C('sumologic-access-key', 'Sumo Logic access key (64 characters)', 'sumo', '[A-Za-z0-9]{64}', 'SUMO_ACCESS_KEY', f(64)),
  C('freshbooks-client-secret', 'FreshBooks client secret (64 hex)', 'freshbooks[\\w.-]{0,10}secret', '[0-9a-f]{64}', 'FRESHBOOKS_CLIENT_SECRET', f(64, HEX)),
]

export const RULES = [...CLOUD, ...SOURCE, ...PAYMENT, ...COMMS, ...AI, ...INFRA, ...OBSERVABILITY, ...DATA, ...COMMERCE, ...OTHER, ...GENERIC]

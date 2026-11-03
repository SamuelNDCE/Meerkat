// Critical planted defects, family: secrets. A live credential written into source or config, with no precondition for an attacker
// who can read the repository. Every defect lives in its own file; the "-clean" twin project has the same files written safely
// (the value read from the environment or a secret store) and must not be reported. Keys and projects are prefixed `crit-`.
// Secret values come from the corpus context (random parts joined at run time), never written down here.

const mk = (fam, ctx, cases) => {
  const { d, tidy } = ctx
  const expect = {}
  const bad = { ...tidy(`crit-${fam}`) }
  const good = { ...tidy(`crit-${fam}-clean`) }
  for (const [k, file, exp, desc, pre, badText, goodText] of cases) {
    expect[`crit-${k}`] = exp
    bad[file] = [pre, d(`crit-${k}`, desc, badText), '', '', '', '', '']
    good[file] = [pre, goodText, '']
  }
  return { projects: { [`crit-${fam}`]: { files: bad }, [`crit-${fam}-clean`]: { files: good } }, expect }
}

export function projects(ctx) {
  const { S, pem } = ctx
  const cases = [
    ['sec-aws-id', 'config/aws.js', 'secrets-plus/aws-access-key-id', 'an AWS access key id in source', "'use strict'", `const AWS_ACCESS_KEY_ID = '${S.awsId}'`, 'const AWS_ACCESS_KEY_ID = process.env.AWS_ACCESS_KEY_ID'],
    ['sec-aws-secret', 'config/aws-secret.js', 'secrets-plus/aws-secret-access-key', 'an AWS secret access key in source', "'use strict'", `const AWS_SECRET_ACCESS_KEY = '${S.awsSecret}'`, 'const AWS_SECRET_ACCESS_KEY = process.env.AWS_SECRET_ACCESS_KEY'],
    ['sec-github-pat', 'tools/release.py', 'secrets-plus/github-pat-classic', 'a GitHub personal access token in a script', 'import os', `TOKEN = "${S.ghPat}"`, 'TOKEN = os.environ["GITHUB_TOKEN"]'],
    ['sec-stripe', 'billing/charge.go', 'secrets-plus/stripe-live-secret-key', 'a live Stripe secret key in Go source', 'package billing\n\nimport "os"', `var stripeKey = "${S.stripe}"`, 'var stripeKey = os.Getenv("STRIPE_SECRET_KEY")'],
    ['sec-slack', 'config/notify.yaml', 'secrets-plus/slack-bot-token', 'a Slack bot token in YAML', 'notify:\n  channel: "#ops"', `  slack_token: ${S.slack}`, '  slack_token: ${SLACK_BOT_TOKEN}'],
    ['sec-google', 'src/maps.ts', 'secrets-plus/gcp-api-key', 'a Google API key in TypeScript', 'export const zoom = 12', `export const MAPS_KEY = '${S.google}'`, 'export const MAPS_KEY = process.env.MAPS_KEY'],
    ['sec-sendgrid', 'src/mail.js', 'secrets-plus/sendgrid-api-key', 'a SendGrid API key in source', "'use strict'", `const SENDGRID_API_KEY = '${S.sendgrid}'`, 'const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY'],
    ['sec-npm', '.npmrc', 'secrets-plus/npm-access-token', 'an npm auth token in .npmrc', 'registry=https://registry.npmjs.org/', `//registry.npmjs.org/:_authToken=${S.npm}`, '//registry.npmjs.org/:_authToken=${NPM_TOKEN}'],
    ['sec-shopify', 'src/shop.rb', 'secrets-plus/shopify-access-token', 'a Shopify admin token in Ruby', "require 'net/http'", `ADMIN_TOKEN = '${S.shopify}'`, "ADMIN_TOKEN = ENV.fetch('SHOPIFY_ADMIN_TOKEN')"],
    ['sec-discord', 'src/alerts.js', 'secrets-plus/discord-webhook-url', 'a Discord webhook URL in source', "'use strict'", `const ALERT_HOOK = '${S.discord}'`, 'const ALERT_HOOK = process.env.ALERT_WEBHOOK_URL'],
    ['sec-jwt', 'src/service-auth.js', 'secrets-plus/jwt-literal', 'a signed service JWT written into source', "'use strict'", `const SERVICE_JWT = '${S.jwt}'`, 'const SERVICE_JWT = process.env.SERVICE_JWT'],
    ['sec-pg-url', 'src/db.js', 'secrets-plus/postgres-url-password', 'a database URL with the password in it', "'use strict'", `const DATABASE_URL = 'postgres://app:${S.dbPass}@db.internal:5432/app'`, 'const DATABASE_URL = process.env.DATABASE_URL'],
    ['sec-private-key', 'certs/server.key', 'secrets-plus', 'a private key file committed to the repository', '', pem(), '# the key is mounted at runtime from the secret store'],
    ['sec-telegram', 'src/bot.js', 'secrets-plus', 'a Telegram bot token in source', "'use strict'", `const BOT_TOKEN = '${S.telegram}'`, 'const BOT_TOKEN = process.env.BOT_TOKEN'],
  ]
  return mk('secrets', ctx, cases)
}

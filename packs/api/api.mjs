// The api pack: static checks on OpenAPI and GraphQL schemas, SQL migrations, Prisma schemas, HTTP timeouts, rate limiting, error leaks and
// pagination bounds, with no tool to install. Turn it on with { "packs": ["api"] } in meerkat.config.json.
import { MEERKAT_DIR as MK } from '../../lib/paths.mjs'

const AS = `${MK}/thorough/api.mjs`
const make = (id, title, group = 'functionality') => ({
  id,
  group,
  tier: 'fast',
  lane: 'free',
  weight: 'tiny',
  title,
  estSeconds: 2,
  needs: ['node'],
  run: { cmd: 'node', args: [AS, id], cwd: 'repo' },
  selfTest: { cmd: 'node', args: [AS, id, '--fixtures'], cwd: 'repo', expectFail: true },
})

export default [
  make('openapi-valid', 'OpenAPI and Swagger files have a version, info title and version, paths, and responses on every operation'),
  make('openapi-operation-ids', 'No two OpenAPI operations share the same operationId'),
  make('openapi-security-defined', 'Every security scheme an API uses is defined, and public HTTPS APIs declare security'),
  make('graphql-schema-basics', 'GraphQL schemas have balanced braces and unique type names'),
  make('sql-migrations-order', 'SQL migration numbers are unique and have no gaps'),
  make('sql-destructive-migrations', 'SQL migrations do not drop, truncate or mass-delete without a meerkat-allow note'),
  make('sql-missing-index-note', 'Foreign-key style *_id columns have an index or constraint in the same file (listed unless required)'),
  make('prisma-schema-basics', 'Prisma models have an id and no datasource URL holds a password as a literal', 'security'),
  make('http-timeouts', 'HTTP calls set a timeout or signal, up to the untimed-call budget'),
  make('rate-limit-present', 'A project that starts an HTTP server mentions a rate-limit library or middleware'),
  make('error-leak', 'Handlers do not send error stacks, messages or tracebacks to the client'),
  make('pagination-bounds', 'Request-supplied page sizes have an upper bound (listed unless required)'),
]

// Quality, performance and hygiene rules that audits of real scans judged mostly false or low-value. They are hidden from the default view
// (counted in doc.hidden, never dropped) and shown again with MEERKAT_FINDINGS=all. Security rules never belong here.
export const QUARANTINED = new Map([
  ['js-await-in-loop', 'audits judged most hits intentional (ordered or rate-limited work)'],
  ['json-parse-in-loop', 'audits judged most hits harmless (small inputs)'],
  ['rust-unwrap-overuse', 'audits judged most hits safe (tests, invariants)'],
  ['robots-sitemap', 'audits judged most hits not applicable to the project'],
  ['regex-in-loop', 'audits judged most hits harmless (small inputs)'],
  ['dom-query-in-loop', 'audits judged most hits harmless (small pages)'],
  ['table-headers', 'audits judged most hits false (layout tables, generated markup)'],
  ['css-important-overuse', 'audits judged most hits a deliberate override'],
  ['debug-leftovers', 'audits judged most hits intentional logging'],
  ['ui-static', 'audits judged most hits false'],
  ['render-blocking', 'audits judged most hits false (local or bundled assets)'],
  ['duplicate-test-names', 'audits judged most hits false (same name in different describe blocks)'],
  ['empty-catch', 'audits judged most hits a deliberate ignore'],
  ['line-length', 'a measurement, audits judged it low value'],
  ['long-functions', 'a measurement, audits judged it low value'],
  ['cyclomatic-complexity', 'a measurement, audits judged it low value'],
  ['deep-nesting', 'a measurement, audits judged it low value'],
  ['many-parameters', 'a measurement, audits judged it low value'],
])

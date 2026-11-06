import { expect, test } from 'vitest'
// @ts-ignore plain .mjs module has no type declarations
import { CHECKS, NOT_CHECKABLE, contrastRatio, declaredScale, parseColor, parseCss, report, runUiclean, selfTest } from './uiclean.mjs'

const css = (text: string, path = 'a.css') => [{ path, text }]

test('contrast ratio matches the WCAG reference values', () => {
  expect(contrastRatio([0, 0, 0], [255, 255, 255])).toBeCloseTo(21, 5)
  expect(contrastRatio([255, 255, 255], [255, 255, 255])).toBeCloseTo(1, 5)
  expect(contrastRatio([119, 119, 119], [255, 255, 255])).toBeCloseTo(4.48, 2) // #777 on white: the well-known just-failing grey
})

test('colour parsing: short hex, rgb, and refusal of translucent or unknown values', () => {
  expect(parseColor('#fff')).toEqual([255, 255, 255])
  expect(parseColor('rgb(0, 128, 255)')).toEqual([0, 128, 255])
  expect(parseColor('#ffffff80')).toBeNull()
  expect(parseColor('hsl(0 0% 50%)')).toBeNull()
})

for (const c of CHECKS) {
  test(`${c.id} selfTest reports its broken fixture for the right reason`, () => {
    const r = selfTest(c)
    expect(r.ok, r.text).toBe(true)
  })
}

test('contrast: failing pair is reported with file, line, both colours and ratio', () => {
  const r = runUiclean(css('/* c */\n.a {\n  color: #777;\n  background-color: #fff;\n}'))
  expect(r.findings).toHaveLength(1)
  expect(r.findings[0]).toMatchObject({ rule: 'ui-contrast-aa', file: 'a.css', line: 3 })
  expect(r.findings[0].evidence).toMatch(/#777777.*#ffffff.*4\.48:1/)
})

test('contrast: passing pair and large text rules', () => {
  expect(runUiclean(css('.a{color:#595959;background:#fff}')).findings).toHaveLength(0) // 7:1
  const grey = '.a{color:#808080;background:#fff;font-size:24px}' // 3.95:1 passes only as large text
  expect(runUiclean(css(grey)).findings).toHaveLength(0)
  expect(runUiclean(css('.a{color:#808080;background:#fff;font-size:16px}')).findings).toHaveLength(1)
  expect(runUiclean(css('.a{color:#808080;background:#fff;font-size:19px;font-weight:700}')).findings).toHaveLength(0)
})

test('contrast: var() resolves when unambiguous, is skipped (not guessed) when ambiguous', () => {
  const ok = ':root{--fg:#999;--bg:#fff}.a{color:var(--fg);background:var(--bg)}'
  expect(runUiclean(css(ok)).findings).toHaveLength(1)
  const amb = ':root{--fg:#999}@media (prefers-color-scheme: dark){:root{--fg:#fff}}.a{color:var(--fg);background:#fff}'
  const r = runUiclean(css(amb))
  expect(r.findings).toHaveLength(0)
  expect(r.notes[0].note).toMatch(/1 not resolvable/)
})

test('contrast: gradients, translucent colours and one-sided rules are never judged', () => {
  expect(runUiclean(css('.a{color:#999;background:linear-gradient(#fff,#eee)}')).findings).toHaveLength(0)
  expect(runUiclean(css('.a{color:#999;background:#ffffff80}')).findings).toHaveLength(0)
  expect(runUiclean(css('.a{color:#999}')).findings).toHaveLength(0)
})

test('contrast: rules inside @media are read, and comments are ignored', () => {
  const t = '/* .x{color:#999;background:#fff} */\n@media (min-width: 1px) {\n  .b {\n    color: #aaa;\n    background: #fff;\n  }\n}'
  const r = runUiclean(css(t))
  expect(r.findings).toHaveLength(1)
  expect(r.findings[0].line).toBe(4)
})

test('spacing: not applicable when the project declares no scale', () => {
  const r = runUiclean(css('.a{padding:13px}'))
  expect(r.findings).toHaveLength(0)
  expect(r.notes[1]).toMatchObject({ id: 'ui-spacing-scale', applicable: false })
})

test('spacing: scale from custom properties, rem converted, off-scale value reported with nearest steps', () => {
  const t = ':root{--space-1:4px;--space-2:0.5rem;--space-3:16px}\n.a{margin:0 8px;padding:6px 1rem;gap:calc(1px + 2px)}'
  const r = runUiclean(css(t))
  expect(declaredScale(css(t))?.values).toEqual([4, 8, 16])
  expect(r.findings).toHaveLength(1)
  expect(r.findings[0].evidence).toMatch(/padding: 6px.*nearest 4 or 8px/)
  expect(r.findings[0].line).toBe(2)
})

test('spacing: scale from config wins, zero and auto are fine', () => {
  const r = runUiclean(css('.a{margin:0 auto;padding:10px}'), { spacingScale: [4, 8, 12] })
  expect(r.findings).toHaveLength(1)
  expect(r.findings[0].evidence).toMatch(/\.meerkat-uiclean\.json/)
})

test('report always states what is not checkable, on a pass and on a fail', () => {
  const pass = report(runUiclean(css('.a{color:#000;background:#fff}')))
  expect(pass).toContain('NOT CHECKABLE')
  expect(pass).toMatch(/not a statement that the UI looks clean/)
  expect(report(runUiclean(css('.a{color:#999;background:#fff}')))).toContain(NOT_CHECKABLE)
})

test('findings carry a suggested fix as text and nothing is applied', () => {
  const f = runUiclean(css('.a{color:#999;background:#fff}')).findings[0]
  expect(typeof f.fix).toBe('string')
  expect(f.fix.length).toBeGreaterThan(10)
})

test('parseCss reads declarations past a ; inside parentheses', () => {
  const rules = parseCss('.a{background:url(data:image/png;base64,AAAA);color:#000}')
  expect(rules[0].decls.map((d: { prop: string }) => d.prop)).toEqual(['background', 'color'])
})

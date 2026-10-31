// The lang pack: source hygiene for JavaScript and TypeScript, Python, Go and Rust, with no tool to install. Turn it on with { "packs": ["lang"] }. Limits: "lang" in .meerkat-budgets.json (see thorough/lang.mjs).
import { MEERKAT_DIR as MK } from '../../lib/paths.mjs'

const LS = `${MK}/thorough/lang.mjs`
const make = (id, title) => ({
  id,
  group: 'functionality',
  tier: 'fast',
  lane: 'free',
  weight: 'tiny',
  title,
  estSeconds: 2,
  needs: ['node'],
  run: { cmd: 'node', args: [LS, id], cwd: 'repo' },
  selfTest: { cmd: 'node', args: [LS, id, '--fixtures'], cwd: 'repo', expectFail: true },
})

export default [
  make('js-eqeqeq', 'JavaScript and TypeScript compare with === and !== (null checks aside)'),
  make('js-var-usage', 'No modern JavaScript or TypeScript declares a variable with var'),
  make('js-await-in-loop', 'No for or while loop awaits each step in turn'),
  make('js-unhandled-promise', 'No promise chain starts with .then and leaves its rejection unhandled'),
  make('js-prototype-pollution', 'No assignment can reach Object.prototype through __proto__ or a request key'),
  make('ts-any-overuse', 'TypeScript uses of any stay within the budget (lang.maxAny)'),
  make('ts-ignore-comments', 'Every @ts-ignore and @ts-nocheck says why'),
  make('py-bare-except', 'Python except clauses name the exception they catch'),
  make('py-mutable-default', 'No Python default argument is a shared mutable object'),
  make('py-assert-in-prod', 'Python does not check input with assert outside tests'),
  make('go-ignored-errors', 'Go does not throw an error away with _'),
  make('go-defer-in-loop', 'Go does not defer inside a loop'),
  make('rust-unwrap-overuse', 'Rust unwrap() and expect() outside tests stay within the budget (lang.maxUnwrap)'),
  make('rust-todo-macros', 'Rust has no todo! or unimplemented! outside tests'),
]

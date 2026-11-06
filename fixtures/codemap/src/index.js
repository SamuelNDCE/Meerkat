// Entry: wires the pieces together.
import { greet } from './util/greet.js'
import helper, { sum as add } from './util/math.js'
import './side-effect.js'
import pad from 'left-pad'
import { gone } from './missing.js'
import { fs } from 'node:fs'

// import { commented } from './not-real.js'
export const VERSION = '1'
export function main() {
  return greet(add(1, 2)) + pad('x') + helper + gone + fs
}
export default main

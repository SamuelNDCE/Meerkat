import { add, double } from './math.js'

export function main(argv = []) {
  const n = Number(argv[0] ?? 2)
  return { sum: add(n, 1), twice: double(n) }
}

if (process.argv[1] && process.argv[1].endsWith('index.js')) {
  console.log(JSON.stringify(main(process.argv.slice(2))))
}

// A check written as code, found without any setting because it sits in .meerkat/checks/. Same shape as an extraChecks file.
// It runs only when you run Meerkat on this project. Return { ok, detail }; a thrown error is a failure, never a crash.
import { existsSync } from 'node:fs'
import { join } from 'node:path'

export default [
  {
    id: 'checkout-smoke',
    group: 'functionality',
    tier: 'fast',
    lane: 'free',
    title: 'Checkout page file exists',
    suite: 'my-app',
    estSeconds: 1,
    run: ({ appDir }) => {
      const file = join(appDir, 'src', 'checkout.html')
      return existsSync(file) ? { ok: true, detail: 'src/checkout.html is there' } : { ok: false, detail: 'src/checkout.html is missing' }
    },
  },
]

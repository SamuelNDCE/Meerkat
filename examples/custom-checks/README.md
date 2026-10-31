# Your own checks: a small example

- `meerkat.config.json`: a check written as data (no JavaScript) and a suite of your own for it.
- `.meerkat/checks/checkout-smoke.mjs`: a check written as code, found without any setting.

Copy either into a project, then:

    meerkat check mine
    meerkat check try e2e

See docs/customizing.md, "Your own checks".

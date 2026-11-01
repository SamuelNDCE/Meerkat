// Shared helpers for the fake apps: write a file tree, make it a committed git repo. No network, deterministic.
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

export function writeTree(dir, files) {
  for (const [rel, text] of Object.entries(files)) {
    const p = join(dir, rel)
    mkdirSync(dirname(p), { recursive: true })
    writeFileSync(p, text)
  }
}

export function commit(dir) {
  const env = { ...process.env, GIT_AUTHOR_DATE: '2026-01-01T00:00:00Z', GIT_COMMITTER_DATE: '2026-01-01T00:00:00Z' }
  const git = (...a) => execFileSync('git', ['-c', 'user.name=fake', '-c', 'user.email=fake@example.invalid', '-c', 'commit.gpgsign=false', '-C', dir, ...a], { stdio: 'ignore', env })
  git('init', '-q', '-b', 'main')
  git('add', '-A')
  git('commit', '-q', '-m', 'fake app')
}

export const json = (o) => JSON.stringify(o, null, 2) + '\n'
export const LICENSE = 'MIT License\n\nCopyright (c) 2026 Fake Apps\n\nPermission is hereby granted, free of charge, to any person obtaining a copy of this software.\n'

// The housekeeping files any well-kept repository has, so a CLEAN fake app is not flagged for missing docs or CI.
// `test` is the command CI runs; `ecosystem` is the dependabot ecosystem.
export function baseline({ test, ecosystem = 'npm', ignore = '' }) {
  return {
    LICENSE,
    '.editorconfig': 'root = true\n\n[*]\ncharset = utf-8\nend_of_line = lf\nindent_style = space\nindent_size = 2\ninsert_final_newline = true\ntrim_trailing_whitespace = true\n',
    '.gitignore': `${ignore}.env\n.DS_Store\nThumbs.db\n*.log\n`,
    'SECURITY.md': '# Security policy\n\nReport a vulnerability privately by email to security@example.invalid. We reply within 3 working days.\n',
    'CONTRIBUTING.md': `# Contributing\n\nOpen an issue first, then a pull request. Run \`${test}\` before you push.\n`,
    'CHANGELOG.md': '# Changelog\n\n## 1.0.0 - 2026-01-01\n\n- First release.\n',
    '.github/dependabot.yml': `version: 2\nupdates:\n  - package-ecosystem: ${ecosystem}\n    directory: /\n    schedule:\n      interval: weekly\n  - package-ecosystem: github-actions\n    directory: /\n    schedule:\n      interval: weekly\n`,
    '.github/workflows/ci.yml': `name: CI\n\non:\n  push:\n    branches: [main]\n  pull_request:\n\npermissions:\n  contents: read\n\nconcurrency:\n  group: ci-\${{ github.workflow }}-\${{ github.ref }}\n  cancel-in-progress: true\n\njobs:\n  test:\n    runs-on: ubuntu-latest\n    timeout-minutes: 15\n    steps:\n      - uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4\n        with:\n          persist-credentials: false\n      - run: ${test}\n`,
  }
}

export const readme = (name, blurb, install, usage, test) => `# ${name}\n\n${blurb}\n\n## Install\n\n    ${install}\n\n## Usage\n\n    ${usage}\n\n## Test\n\n    ${test}\n\n## Licence\n\nMIT, see LICENSE.\n\n## Security\n\nSee SECURITY.md. Contributions: see CONTRIBUTING.md.\n`

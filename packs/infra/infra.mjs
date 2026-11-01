// The infra pack: scripts, containers, pipelines and config files. Turn it on with { "packs": ["infra"] }.
import { tool } from '../../lib/tool-check.mjs'

export default [
  tool({ id: 'shellcheck', expect: 'SC2086', bin: 'shellcheck', onFiles: '\\.(sh|bash)$', fixture: ['fixtures/tools/shellcheck/broken.sh'], install: 'your package manager (apt, brew, winget, scoop: shellcheck)', title: 'Shell scripts (shellcheck)', group: 'security', weight: 'tiny', estSeconds: 5 }),
  tool({ id: 'hadolint', expect: 'DL', bin: 'hadolint', onFiles: '(^|/)Dockerfile[^/]*$', fixture: ['fixtures/tools/hadolint/Dockerfile'], install: 'your package manager (brew, scoop: hadolint)', title: 'Dockerfiles (hadolint)', group: 'security', weight: 'tiny', estSeconds: 5 }),
  tool({ id: 'actionlint', expect: 'nothing', bin: 'actionlint', args: [], fixture: ['fixtures/tools/actionlint/broken.yml'], install: 'your package manager (brew, scoop: actionlint)', title: 'GitHub Actions workflows (actionlint)', group: 'security', weight: 'tiny', estSeconds: 5, paths: ['.github/workflows/**'] }),
  tool({ id: 'yamllint', expect: 'key-duplicates', bin: 'yamllint', onFiles: '\\.ya?ml$', fixture: ['fixtures/tools/yamllint/broken.yaml'], install: 'pip install yamllint', title: 'YAML files (yamllint)', weight: 'tiny', estSeconds: 3, paths: ['**/*.yml', '**/*.yaml'] }),
]

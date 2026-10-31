// The ci-systems pack: CI and deploy configuration for GitLab CI, CircleCI, Azure Pipelines, Jenkins, GitHub Actions reusable and
// artifact steps, Helm charts, Ansible and pre-commit. No tool to install. Each check says "not applicable" when the project does not
// use that system. Turn it on with { "packs": ["ci-systems"] } in meerkat.config.json.
import { MEERKAT_DIR as MK } from '../../lib/paths.mjs'

const CS = `${MK}/thorough/ci-systems.mjs`
const make = (id, group, title) => ({
  id,
  group,
  tier: 'fast',
  lane: 'free',
  weight: 'tiny',
  suite: 'ci-config',
  title,
  estSeconds: 2,
  needs: ['node'],
  run: { cmd: 'node', args: [CS, id], cwd: 'repo' },
  selfTest: { cmd: 'node', args: [CS, id, '--fixtures'], cwd: 'repo', expectFail: true },
})

export default [
  make('gitlab-ci-secrets', 'security', 'GitLab CI file writes no credential or token into the file'),
  make('gitlab-ci-images', 'functionality', 'GitLab CI images and services are pinned to a tag, not untagged or latest'),
  make('gitlab-ci-privileged', 'security', 'GitLab CI asks for no privileged container, and docker:dind keeps TLS on'),
  make('gitlab-ci-stages', 'functionality', 'Every GitLab CI job names a defined stage'),
  make('circleci-config', 'security', 'CircleCI config pins its orbs, avoids deprecated machine images and keeps secrets out'),
  make('azure-pipelines', 'security', 'Azure Pipelines uses named images, no piped installers and no inline secrets'),
  make('jenkinsfile-safety', 'security', 'Jenkinsfile keeps parameters out of shell strings, credentials out of the log and the Docker socket off any agent'),
  make('github-actions-reusable', 'functionality', 'Reusable workflows called from GitHub Actions exist and are not pinned to a branch'),
  make('github-actions-concurrency', 'functionality', 'Deploy and release GitHub Actions workflows set a concurrency group'),
  make('github-actions-artifacts', 'security', 'GitHub Actions artifact uploads set a retention limit and upload no secret paths'),
  make('helm-chart-basics', 'functionality', 'Helm charts have valid metadata, pinned images and no host networking or privilege'),
  make('helm-values-secrets', 'security', 'Helm chart values files hold no literal password, token or key'),
  make('ansible-hygiene', 'functionality', 'Ansible playbooks hide passwords, limit become and avoid plain http downloads'),
  make('pre-commit-config', 'functionality', 'pre-commit hook repositories are pinned to a release and fetched over https'),
]

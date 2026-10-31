// The infra-plus pack: Dockerfile, Kubernetes manifest, Terraform and Compose, and GitHub Actions workflow rules that read the files directly.
// No tool to install. Each check says "not applicable" when the folder has no file of its kind. Turn it on with { "packs": ["infra-plus"] } in meerkat.config.json.
import { MEERKAT_DIR as MK } from '../../lib/paths.mjs'
import { CHECK_SUBS } from '../../thorough/rules-infra-plus.mjs'

const IP = `${MK}/thorough/infra-plus.mjs`
const make = (id, suite, title) => ({
  id,
  group: 'security',
  tier: 'fast',
  lane: 'free',
  weight: 'tiny',
  suite,
  title,
  estSeconds: 3,
  subs: CHECK_SUBS[id],
  needs: ['node'],
  run: { cmd: 'node', args: [IP, id], cwd: 'repo' },
  selfTest: { cmd: 'node', args: [IP, id, '--fixtures'], cwd: 'repo', expectFail: true, expectMatch: 'found' },
})

export default [
  make('ip-docker', 'docker', 'Dockerfiles: health check, users, package installs, downloads, layers and secrets in the image'),
  make('ip-k8s', 'kubernetes', 'Kubernetes manifests: privileges, host access, probes, limits, roles, images and network policy'),
  make('ip-terraform-compose', 'terraform', 'Terraform and Compose: open ports, encryption, public access, IAM wildcards, capabilities and dependencies'),
  make('ip-gha', 'ci-workflows', 'GitHub Actions workflows: untrusted input in run steps, token permissions, pull_request_target and deprecated commands'),
]

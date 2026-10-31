// The kubernetes pack: Helm chart lint and kube-linter for Kubernetes manifests. Turn it on with { "packs": ["kubernetes"] }.
// helm lint runs from the repository root, so the chart must sit there. kube-linter reads every YAML file under the folder it is given.
// Not included: kubeconform (it fetches Kubernetes schemas over the network, so its self-test cannot run offline).
import { tool } from '../../lib/tool-check.mjs'

export default [
  tool({ id: 'helm-lint', expect: 'name is required', bin: 'helm', args: ['lint', '.'], fixture: ['lint', 'fixtures/tools/helm'], install: 'install Helm from https://helm.sh/docs/intro/install', title: 'Helm chart: lint', weight: 'tiny', estSeconds: 5, paths: ['**/Chart.yaml', '**/templates/**', '**/values.yaml'] }),
  tool({ id: 'kube-linter', expect: 'latest-tag', bin: 'kube-linter', args: ['lint', '.'], fixture: ['lint', 'fixtures/tools/kubernetes'], install: 'install kube-linter from https://github.com/stackrox/kube-linter/releases', title: 'Kubernetes manifests: security and best practice (kube-linter)', group: 'security', weight: 'light', estSeconds: 10, paths: ['**/*.yaml', '**/*.yml'] }),
]

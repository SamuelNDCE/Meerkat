// The terraform pack: Terraform's own formatting check. Turn it on with { "packs": ["terraform"] }.
// Not included: terraform validate (it needs terraform init, which downloads providers) and tflint and trivy (their command lines were not confirmed offline).
import { tool } from '../../lib/tool-check.mjs'

export default [
  tool({ id: 'terraform-fmt', expect: 'main\\.tf', bin: 'terraform', args: ['fmt', '-check', '-recursive'], fixture: ['fmt', '-check', 'fixtures/tools/terraform/main.tf'], install: 'install Terraform from https://developer.hashicorp.com/terraform/install', title: 'Terraform: formatting (terraform fmt)', weight: 'tiny', estSeconds: 5, paths: ['**/*.tf', '**/*.tfvars'] }),
]

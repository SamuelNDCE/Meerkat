// Does this project have its own configuration for a style tool? Used by thorough/config-guard.mjs and by the runner, so a check that runs eslint,
// prettier or stylelint is SKIPPED ("no configuration in this project") before anything asks whether the tool is installed.
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const exts = (base, list) => list.map((e) => `${base}${e}`)
export const TOOL_CONFIGS = {
  eslint: { files: [...exts('eslint.config', ['.js', '.mjs', '.cjs', '.ts', '.mts', '.cts']), ...exts('.eslintrc', ['', '.js', '.cjs', '.json', '.yaml', '.yml'])], pkg: 'eslintConfig' },
  prettier: { files: [...exts('.prettierrc', ['', '.json', '.yaml', '.yml', '.json5', '.js', '.cjs', '.mjs', '.toml']), ...exts('prettier.config', ['.js', '.cjs', '.mjs'])], pkg: 'prettier' },
  stylelint: { files: [...exts('.stylelintrc', ['', '.json', '.yaml', '.yml', '.js', '.cjs', '.mjs']), ...exts('stylelint.config', ['.js', '.cjs', '.mjs'])], pkg: 'stylelint' },
}

// True when the project chose rules for the tool: a config file, a key in package.json, or an option that names a configuration.
export function toolConfigured(bin, root, toolArgs = []) {
  const spec = TOOL_CONFIGS[bin]
  if (!spec) return true
  let configured = spec.files.some((f) => existsSync(join(root, f)))
  if (!configured) {
    try { configured = spec.pkg in JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) } catch { /* no package.json */ }
  }
  // An option that names a configuration (or switches the lookup off) means the caller chose the rules.
  if (toolArgs.some((a) => /^(--no-config-lookup|--config|-c|--rule)$/.test(a))) configured = true
  return configured
}

export const noConfigText = (bin) => `no ${bin} configuration in this project, so ${bin} has no rules of the project's to apply`

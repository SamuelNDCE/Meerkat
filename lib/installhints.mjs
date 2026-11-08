// Platform-specific install hints for the outside tools that have no npm/pip/cargo route (hadolint, actionlint, shellcheck).
// Sources (read 2026-11-08): hadolint README (scoop, brew, releases page; it gives NO winget id and NO apt package, so none is invented here);
// actionlint docs/install.md (choco, scoop, `winget install actionlint`, brew, pacman on Arch; no apt package).
// UNVERIFIED and therefore not printed: a winget id for hadolint, an apt package for hadolint or actionlint. Where a package manager is not
// documented for a platform, the official download page is printed instead.
const HINTS = {
  hadolint: {
    win32: { cmd: 'scoop install hadolint', page: 'https://github.com/hadolint/hadolint/releases/latest' },
    darwin: { cmd: 'brew install hadolint', page: 'https://github.com/hadolint/hadolint/releases/latest' },
    linux: { cmd: null, page: 'https://github.com/hadolint/hadolint/releases/latest' },
  },
  actionlint: {
    win32: { cmd: 'winget install actionlint   (or: scoop install actionlint)', page: 'https://github.com/rhysd/actionlint/blob/main/docs/install.md' },
    darwin: { cmd: 'brew install actionlint', page: 'https://github.com/rhysd/actionlint/blob/main/docs/install.md' },
    linux: { cmd: null, page: 'https://github.com/rhysd/actionlint/blob/main/docs/install.md', note: 'Arch: pacman -S actionlint' },
  },
}
const NAMES = { win32: 'Windows', darwin: 'macOS', linux: 'Linux' }

// A one-line hint for a missing tool on this platform, or null when the tool has no entry here.
export function installHint(bin, platform = process.platform) {
  const t = HINTS[bin]
  if (!t) return null
  const p = t[platform] ? platform : 'linux'
  const h = t[p]
  const how = h.cmd ? `${h.cmd}   (all options: ${h.page})` : `${h.note ? `${h.note}, or ` : ''}download from ${h.page}`
  return `${bin} on ${NAMES[p] ?? p}: ${how}`
}

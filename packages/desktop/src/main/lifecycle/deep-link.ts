// Buff (#596): the scheme the packages declare (electron-builder `protocols`). Claiming the upstream
// "opencode" one took over opencode:// from an installed OpenCode and ignored buff:// links.
export const DEEP_LINK_SCHEME = "buff"

export function deepLinkArgs(argv: readonly string[]) {
  return argv.filter((arg) => arg.startsWith(`${DEEP_LINK_SCHEME}://`))
}

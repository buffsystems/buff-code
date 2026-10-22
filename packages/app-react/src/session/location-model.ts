// Whether a session runs in a workspace (#584), as the Solid window decides it: a directory inside
// one of the project's worktrees other than its root. A loaded worktree inventory replaces the
// project's own sandbox list (the Solid window's withWorktreeInventory).

import { isWorkspaceDirectory, sameDirectory } from "@opencode/app/react-reuse/workspace-paths"
import type { WorktreeDirectory } from "@opencode/client/promise"

export function isWorkspaceSession(input: {
  canonical?: string
  sandboxes?: readonly string[]
  worktrees?: readonly WorktreeDirectory[]
  directory: string
}) {
  const canonical = input.canonical
  if (canonical === undefined) return false
  const sandboxes = input.worktrees
    ? input.worktrees.map((item) => item.directory).filter((directory) => !sameDirectory(canonical, directory))
    : input.sandboxes
  return isWorkspaceDirectory({ worktree: canonical, sandboxes }, input.directory)
}

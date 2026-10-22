// Where a draft's session will run (#584): the project itself ("main"), a new worktree
// ("create") or an existing worktree directory — ported from the Solid workspace controller.

export function resolveNewSessionWorktree(input: { enabled: boolean; selected?: string; fallback?: string }) {
  if (!input.enabled) return "main"
  if (input.selected) return input.selected
  return input.fallback ?? "main"
}

export function resolveNewSessionBranch(input: {
  worktree: string
  directory: string
  createBranch?: string
  worktreeBranch: (worktree: string) => string | undefined
}) {
  if (input.worktree === "create" && input.createBranch) return input.createBranch
  const directory = input.worktree === "main" || input.worktree === "create" ? input.directory : input.worktree
  return input.worktreeBranch(directory)
}

export function resolveNewSessionGit(input: { projectVcs?: string; branch?: string }) {
  return input.projectVcs === "git" || input.branch !== undefined
}

export function cycleNewSessionWorktree(input: { current: string; existing?: string }) {
  if (input.current === "main") return "create"
  if (input.current === "create") return input.existing ?? "main"
  return "main"
}

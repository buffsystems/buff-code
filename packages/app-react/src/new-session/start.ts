// Starting a session from a draft (#584): the order of the Solid composer adapter's start — a
// pending tab while a new worktree is created, the directory, the MCP switches, the session
// itself, then the draft becomes the session's tab. Any failure leaves the draft as it was.

import type { SessionMessageUser } from "@opencode/client/promise"
import type { DraftTab, Tabs } from "../shell/tabs/tabs"

export type DraftStartInput = {
  sessionID: string
  message?: SessionMessageUser
  create: (directory: string) => Promise<void>
}

export type DraftStarted = { sessionID: string; directory: string; complete?: () => Promise<void> }

export type DraftStartDeps = {
  tabs: Pick<Tabs, "prepareSession" | "updateDraft" | "promoteDraft">
  draft: DraftTab
  /** The project's canonical directory. */
  projectDirectory: string
  worktree: string
  branch?: string
  createWorktree: (projectDirectory: string, branch?: string) => Promise<string>
  mcp: {
    capture: () => Record<string, boolean>
    prepare: (directory: string, states: Record<string, boolean>) => Promise<boolean>
    remember: (directory: string, states: Record<string, boolean>) => void
  }
  /** The project list after a worktree appeared, so the restored draft can select it. */
  refreshProjects: () => Promise<void>
  remember: (worktree: string) => void
  onWorktreeFailed: (error: unknown) => void
  onCreateFailed: (error: unknown) => void
}

export async function startDraftSession(
  deps: DraftStartDeps,
  input: DraftStartInput,
): Promise<DraftStarted | undefined> {
  const states = deps.mcp.capture()
  const session = { server: deps.draft.server, sessionId: input.sessionID }
  const pending =
    deps.worktree === "create"
      ? deps.tabs.prepareSession(deps.draft.draftID, session, { message: input.message })
      : undefined
  const directory = await resolveDirectory(deps).catch((error: unknown) => {
    deps.onWorktreeFailed(error)
    return undefined
  })
  if (!directory) {
    await pending?.rollback()
    return
  }
  const rollback = async () => {
    if (!pending) return
    await deps.refreshProjects().catch(() => undefined)
    await pending.rollback(directory)
  }
  if (!(await deps.mcp.prepare(directory, states))) {
    await rollback()
    if (pending) deps.mcp.remember(directory, states)
    return
  }
  const created = await input.create(directory).then(
    () => true,
    (error: unknown) => {
      deps.onCreateFailed(error)
      return false
    },
  )
  if (!created) {
    await rollback()
    return
  }
  deps.remember(deps.worktree)
  if (!pending) {
    deps.tabs.updateDraft(deps.draft.draftID, { worktree: undefined, branch: undefined })
    deps.tabs.promoteDraft(deps.draft.draftID, session)
  }
  return { sessionID: input.sessionID, directory, complete: pending?.complete }
}

function resolveDirectory(deps: DraftStartDeps) {
  if (deps.worktree === "main") return Promise.resolve(deps.projectDirectory)
  if (deps.worktree !== "create") return Promise.resolve(deps.worktree)
  return deps.createWorktree(deps.projectDirectory, deps.branch)
}

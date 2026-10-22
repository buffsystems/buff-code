// What every draft slot reads (#584): the draft, its server, where the session will run, the MCP
// switches and `start`. See README.md.

import { sessionCreateFailure } from "@opencode/app/react-reuse/session-create"
import { createContext, use, useMemo, useRef, useState, type ReactNode } from "react"
import type { Server } from "../core/servers"
import { useI18n } from "../i18n/provider"
import { showToast } from "../shell/notifications/toast"
import type { DraftTab, Tabs } from "../shell/tabs/tabs"
import { applyMcp, toggleMcp } from "./mcp"
import { useMcpHost } from "./use-mcp"
import { startDraftSession, type DraftStartInput, type DraftStarted } from "./start"
import type { DraftWorkspace } from "./use-workspace"

export type DraftContextValue = {
  draft: DraftTab
  server: Server
  directory: string
  workspace: { value: string; branch?: string; git: boolean; target: string }
  mcp: {
    /** Where the switches apply now: the chosen worktree, or the project for a new one. */
    directory: string
    states: Record<string, boolean>
    preview: boolean
    pending: boolean
    change(name: string, enabled: boolean): void
  }
  start(input: DraftStartInput): Promise<DraftStarted | undefined>
  focus: { register(focus: () => void): () => void; restore(): void }
}

const DraftContext = createContext<DraftContextValue | undefined>(undefined)

export function DraftProvider(props: { value: DraftContextValue; children?: ReactNode }) {
  return <DraftContext value={props.value}>{props.children}</DraftContext>
}

/** The draft on screen: see the contract in README.md. */
export function useDraft() {
  const draft = use(DraftContext)
  if (!draft) throw new Error("useDraft must be used inside a draft slot")
  return draft
}

/** Builds the draft's context from its tab, server and workspace choice. */
export function useDraftValue(input: {
  draft: DraftTab
  server: Server
  tabs: Tabs
  workspace: DraftWorkspace
}): DraftContextValue {
  const i18n = useI18n()
  const draft = input.draft
  const server = input.server
  const workspace = input.workspace
  // A live switch per directory: the first prompt there waits for it.
  const [pending, setPending] = useState<Record<string, Promise<boolean> | undefined>>({})
  const [preparing, setPreparing] = useState(false)
  const focus = useRef<(() => void) | undefined>(undefined)
  const mcpKey = (worktree: string) => JSON.stringify([draft.server, draft.directory, worktree])
  const preview = workspace.value === "create"
  const target = workspace.value === "main" || workspace.value === "create" ? draft.directory : workspace.value
  const states = draft.mcp?.target === mcpKey(workspace.value) ? draft.mcp.states : empty
  const host = useMcpHost()

  const prepare = async (directory: string, next: Record<string, boolean>) => {
    const waiting = pending[directory]
    if (!waiting && Object.keys(next).length === 0) return true
    setPreparing(true)
    return applyMcp(server, directory, next, host, waiting)
      .catch((error: unknown) => {
        showToast({
          variant: "error",
          title: i18n.t("session.summary.mcp.prepareFailed"),
          description: error instanceof Error ? error.message : String(error),
        })
        return false
      })
      .finally(() => setPreparing(false))
  }

  const start = (start: DraftStartInput) =>
    startDraftSession(
      {
        tabs: input.tabs,
        draft,
        projectDirectory: workspace.root,
        worktree: workspace.value,
        branch: workspace.branch,
        createWorktree: async (directory, branch) => {
          const project = workspace.project ?? (await server.api().location.get({ location: { directory } })).project
          const created = await server.api().worktree.create({ projectID: project.id, from: project.canonical, branch })
          await server.data.location.syncInfo({ directory: created.directory })
          return created.directory
        },
        mcp: {
          capture: () => ({ ...states }),
          prepare,
          remember: (directory, next) =>
            input.tabs.updateDraft(draft.draftID, { mcp: { target: mcpKey(directory), states: { ...next } } }),
        },
        refreshProjects: async () => {
          server.data.project.invalidate()
          await server.data.project.sync()
        },
        remember: workspace.remember,
        onWorktreeFailed: (error) =>
          showToast({
            title: i18n.t("prompt.toast.worktreeCreateFailed.title"),
            description: error instanceof Error && error.message ? error.message : i18n.t("common.requestFailed"),
          }),
        onCreateFailed: (error) =>
          showToast({
            title: i18n.t("prompt.toast.sessionCreateFailed.title"),
            description: sessionCreateFailure(error, i18n.buff.t),
          }),
      },
      start,
    )

  const change = (name: string, enabled: boolean) => {
    if (preparing || (!preview && pending[target])) return
    input.tabs.updateDraft(draft.draftID, {
      mcp: { target: mcpKey(workspace.value), states: { ...states, [name]: enabled } },
    })
    if (preview) return
    const directory = target
    const request = toggleMcp(server, { name, enabled, directory }, host).then(
      () => true,
      (error: unknown) => {
        host.failed(error)
        return false
      },
    )
    setPending((all) => ({ ...all, [directory]: request }))
    void request.finally(() =>
      setPending((all) =>
        all[directory] === request ? Object.fromEntries(Object.entries(all).filter(([key]) => key !== directory)) : all,
      ),
    )
  }

  const register = useMemo(
    () => (next: () => void) => {
      focus.current = next
      return () => {
        if (focus.current === next) focus.current = undefined
      }
    },
    [],
  )
  return {
    draft,
    server,
    directory: draft.directory,
    workspace: { value: workspace.value, branch: workspace.branch, git: workspace.git, target },
    mcp: { directory: target, states, preview, pending: preparing || (!preview && !!pending[target]), change },
    start,
    focus: { register, restore: () => focus.current?.() },
  }
}

const empty: Record<string, boolean> = {}

// The draft's workspace choice in React (#584), ported from the Solid workspace controller: the
// project behind the draft's directory, its worktrees and branches, the selected destination and
// the branch a new worktree starts from. The choice itself lives on the draft tab.

import {
  isWorkspaceDirectory,
  isWorkspaceSelection,
  sameDirectory,
  workspaceDefaultSelection,
  workspaceSelectionDestination,
} from "@opencode/app/react-reuse/workspace-paths"
import { ScopedKey, type ServerScope } from "@opencode/app/react-reuse/server-scope"
import type { WorktreeDirectory } from "@opencode/client/promise"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useEffect, useMemo, useState } from "react"
import { locationKey } from "../core/data/state"
import type { Server } from "../core/servers"
import { useServerData } from "../react/core"
import { useSettings, useSettingsModel } from "../shell/settings-context"
import type { DraftTab, Tabs } from "../shell/tabs/tabs"
import {
  cycleNewSessionWorktree,
  resolveNewSessionBranch,
  resolveNewSessionGit,
  resolveNewSessionWorktree,
} from "./workspace"

export function useDraftWorkspace(input: { server: Server; draft: DraftTab; tabs: Tabs; scope: string }) {
  const server = input.server
  const directory = input.draft.directory
  const key = locationKey({ directory })
  const projectID = useServerData(server, (state) => state.location[key]?.info?.project.id)
  const project = useServerData(server, (state) => (projectID ? state.project.info[projectID] : undefined))
  const currentBranch = useServerData(server, (state) => state.location[key]?.vcs?.branch.current)
  const root = project?.canonical ?? directory
  const [search, setSearch] = useState("")
  const queries = useQueryClient()

  useEffect(() => {
    void Promise.all([
      server.data.location.syncInfo({ directory }),
      server.data.project.sync(),
      server.data.location.vcs.sync({ directory }),
    ]).catch(() => undefined)
  }, [server, directory])

  const worktrees = useQuery({
    queryKey: ["draft-worktrees", server.key, projectID],
    enabled: !!projectID,
    queryFn: () =>
      server
        .api()
        .worktree.list({ projectID: projectID ?? "" })
        .catch((): WorktreeDirectory[] => []),
  })
  useEffect(
    () =>
      server.event.on("worktree.updated", (event) => {
        if (event.data.projectID === projectID)
          void queries.invalidateQueries({ queryKey: ["draft-worktrees", server.key, projectID] })
      }),
    [server, projectID, queries],
  )
  const loaded = worktrees.isSuccess
  const items = worktrees.data ?? []
  const shape = project ? { worktree: project.canonical, sandboxes: project.sandboxes, worktrees: items } : undefined
  const workspaces = useMemo(() => {
    if (!project) return []
    return [...items.map((item) => item.directory), ...(project.sandboxes ?? [])]
      .filter((item) => !sameDirectory(project.canonical, item))
      .filter((item, index, all) => all.findIndex((other) => sameDirectory(other, item)) === index)
  }, [project, items])
  const managed = project
    ? items.filter((item) => item.strategy !== undefined && !sameDirectory(project.canonical, item.directory)).length
    : 0
  const git = resolveNewSessionGit({ projectVcs: project?.vcs, branch: currentBranch })
  const stored = input.draft.worktree
  const selected = (() => {
    if (!project || !stored) return undefined
    if (isWorkspaceSelection(shape, stored)) return stored
    // A saved worktree may be known only to the server's list; keep it until the list confirms.
    if (!loaded) return stored
    return workspaces.some((item) => sameDirectory(item, stored)) ? stored : undefined
  })()
  // Local or a new worktree by default: the settings' choice, or the project's last one (as Solid).
  const settings = useSettingsModel()
  const workspacesSetting = useSettings((value) => value.workspaces)
  const lastKey = project ? ScopedKey.from(input.scope as ServerScope, project.id) : undefined
  const last = lastKey ? workspacesSetting.lastUsed[lastKey] : undefined
  const fallback = project ? workspaceDefaultSelection(workspacesSetting.defaultDestination, last) : "main"
  const value = resolveNewSessionWorktree({ enabled: git, selected, fallback })

  // Only the selected worktree feeds the branch label; syncing all would boot each on the server.
  useEffect(() => {
    if (value === "main" || value === "create") return
    void server.data.location.vcs.sync({ directory: value }).catch(() => undefined)
  }, [server, value])
  const branch = useServerData(server, (state) =>
    resolveNewSessionBranch({
      worktree: value,
      directory,
      createBranch: input.draft.branch,
      worktreeBranch: (worktree) => state.location[locationKey({ directory: worktree })]?.vcs?.branch.current,
    }),
  )

  const branches = useQuery({
    queryKey: ["draft-branches", server.key, root, search],
    enabled: git,
    queryFn: () =>
      server
        .api()
        .vcs.branch.list({ location: { directory: root }, search, limit: 50 })
        .then((response) => response.data)
        .catch((): string[] => []),
  })
  const branchList = useMemo(
    () =>
      [
        ...new Set([
          ...(branches.data ?? []),
          ...(currentBranch && currentBranch.toLowerCase().includes(search.toLowerCase()) ? [currentBranch] : []),
        ]),
      ].slice(0, 50),
    [branches.data, currentBranch, search],
  )

  const remember = (worktree: string) => {
    if (!project) return
    const local = workspaceSelectionDestination(worktree, project.canonical) === "main"
    const key = ScopedKey.from(input.scope as ServerScope, project.id)
    const next = local ? "local" : "workspace"
    const current = settings.store.get().workspaces.lastUsed
    if (current[key] !== next) settings.workspaces({ lastUsed: { ...current, [key]: next } })
  }
  const set = (worktree: string) => {
    input.tabs.updateDraft(input.draft.draftID, { worktree, branch: undefined })
    remember(worktree)
  }
  const existing = workspaces.find((item) => item === stored)
  return {
    project,
    root,
    value,
    branch,
    git,
    managed,
    workspaces,
    branches: branchList,
    loaded,
    isWorkspace:
      value === "create" ||
      (value !== "main" &&
        !!project &&
        (isWorkspaceDirectory(shape, value) || !loaded || workspaces.some((item) => sameDirectory(item, value)))),
    searchBranches: setSearch,
    set,
    remember,
    create: (base: string) => {
      input.tabs.updateDraft(input.draft.draftID, { worktree: "create", branch: base })
      remember("create")
    },
    cycle: () => set(cycleNewSessionWorktree({ current: value, existing })),
  }
}

export type DraftWorkspace = ReturnType<typeof useDraftWorkspace>

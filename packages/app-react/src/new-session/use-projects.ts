// The projects a draft can start in (#584): the open projects of every server in the window,
// named as their server knows them; choosing one moves the draft, adding one asks for a folder.

import { workspaceSelectionDestination } from "@opencode/app/react-reuse/workspace-paths"
import type { Project } from "@opencode/client/promise"
import { serverKey, serverName } from "../core/servers"
import type { LocalProject } from "../core/server-state"
import { useCore, useServers } from "../react/core"
import { shallowEqual, useStore } from "../react/use-store"
import type { DraftTab, Tabs } from "../shell/tabs/tabs"
import { tabServer } from "../shell/tabs/tabs"
import type { ProjectControls, PromptProject } from "./project-selector"

export function useDraftProjects(input: {
  draft: DraftTab
  tabs: Tabs
  worktree: string
  pick: (server: string) => Promise<string | undefined>
}): ProjectControls {
  const core = useCore()
  const servers = useServers()
  const lists = useStore(
    core.serverState.store,
    (state) => servers.map((conn) => state.projects[core.scope(serverKey(conn))] ?? none),
    shallowEqual,
  )
  const known = servers.map((conn) => Object.values(core.registry.ensure(conn).data.state.get().project.info))
  const multiple = servers.length > 1
  const available = servers.flatMap((conn, index) =>
    (lists[index] ?? none).map((project) =>
      named(project, known[index] ?? [], multiple ? { key: serverKey(conn), name: serverName(conn) } : undefined),
    ),
  )
  const select = (worktree: string, server?: string) => {
    const conn = servers.find((item) => serverKey(item) === (server ?? input.draft.server))
    if (!conn) return
    const projects = core.serverState.projects(core.scope(serverKey(conn)))
    projects.open(worktree)
    projects.touch(worktree)
    input.tabs.updateDraft(input.draft.draftID, {
      server: tabServer(serverKey(conn)),
      directory: worktree,
      worktree: workspaceSelectionDestination(input.worktree, input.draft.directory),
      branch: undefined,
    })
  }
  return {
    available,
    directory: input.draft.directory,
    server: multiple ? input.draft.server : undefined,
    select,
    add: (server) =>
      void input.pick(server ?? input.draft.server).then((directory) => {
        if (directory) select(directory, server)
      }),
  }
}

function named(project: LocalProject, known: Project[], server?: PromptProject["server"]): PromptProject {
  const info = known.find((item) => item.canonical === project.worktree)
  return { worktree: project.worktree, id: info?.id, name: info?.name, sandboxes: info?.sandboxes, server }
}

const none: LocalProject[] = []

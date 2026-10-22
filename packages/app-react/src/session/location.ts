// The routed session's place (#584): its directory's reads and its project's worktree inventory
// (react/location.ts), which decides whether the session runs in a workspace.

import type { Server } from "../core/servers"
import { useServerData } from "../react/core"
import { useLocation } from "../react/location"
import { isWorkspaceSession } from "./location-model"

export function useSessionLocation(input: { server: Server; sessionID: string; enabled: boolean }) {
  const server = input.server
  const directory = useServerData(server, (state) => state.session.info[input.sessionID]?.location.directory)
  const location = useLocation(server, directory, input.enabled)
  // The project as the server lists it: its canonical root and sandboxes (as the Solid window's
  // project store, which the location's own reference does not replace).
  const project = useServerData(server, (state) =>
    location.projectID ? state.project.info[location.projectID] : undefined,
  )
  return {
    directory,
    workspace:
      !!directory &&
      isWorkspaceSession({
        canonical: project?.canonical,
        sandboxes: project?.sandboxes,
        worktrees: location.worktrees,
        directory,
      }),
  }
}

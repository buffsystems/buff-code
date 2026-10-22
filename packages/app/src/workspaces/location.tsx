import { createSimpleContext } from "@opencode/ui/context"
import type { LocationGetOutput, LocationRef } from "@opencode/client/promise"
import { type Accessor, createEffect, createMemo, onCleanup } from "solid-js"
import { type LocationContext, useServerSDK } from "@/runtime/server/client"
import { useData, useServer } from "@/runtime/server/current"
import { readWhileCurrent } from "./current-read"
export type { LocationContext } from "@/runtime/server/client"

export type WorkspaceLocation = LocationContext & {
  readonly ref: LocationRef
  readonly current: LocationGetOutput | undefined
}

const context = createSimpleContext({
  name: "Location",
  init: (props: { directory: string | Accessor<string>; workspaceID?: string | Accessor<string | undefined> }) => {
    const serverSDK = useServerSDK()
    const server = useServer()
    const data = useData()
    const ref = createMemo(
      () => ({
        directory: typeof props.directory === "function" ? props.directory() : props.directory,
        workspaceID: typeof props.workspaceID === "function" ? props.workspaceID() : props.workspaceID,
      }),
      undefined,
      {
        equals: (previous, next) => previous.directory === next.directory && previous.workspaceID === next.workspaceID,
      },
    )
    const current = createMemo(() => data.location.info(ref()))

    createEffect(() => {
      const location = ref()
      if (serverSDK.connection.status() !== "connected") return
      // A failed sync does not prove the directory is missing. Keep recovery local to reads.
      onCleanup(readWhileCurrent(() => data.location.sync(location)))
    })
    createEffect(() => {
      const id = current()?.project.id
      if (!id || serverSDK.connection.status() !== "connected") return
      // Showing a Location is the demand for its project's worktree inventory (workspace styling,
      // picker). Buff (#584): a failed listing is retried like the Location's own reads.
      onCleanup(readWhileCurrent(() => server.ctx.sync.worktrees.demand(id)))
    })

    const location = createMemo(() => serverSDK.ensureDirSdkContext(current()?.directory ?? ref().directory))
    return createMemo<WorkspaceLocation>(() => ({
      ...location(),
      ref: ref(),
      current: current(),
    }))
  },
})

export const useWorkspaceLocation: () => Accessor<WorkspaceLocation> = context.use
export const LocationProvider = context.provider

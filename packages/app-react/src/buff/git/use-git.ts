// The Git controller of a session's directory (#454), kept fresh: on connecting, after events
// that may change files or the branch (#470), and on the service's own «changed».

import { filesMayHaveChanged } from "@opencode/app/react-reuse/files-changed"
import { formatServerError } from "@opencode/app/react-reuse/server-errors"
import { BuffGit } from "@opencode/schema/buff-git"
import { useEffect, useMemo } from "react"
import type { Server } from "../../core/servers"
import { useI18n } from "../../i18n/provider"
import { useConnection } from "../../react/core"
import { createGitController } from "./controller"

export function useGit(server: Server, directory: string, sessionID?: string) {
  const t = useI18n().buff.t
  const connected = useConnection(server).status === "connected"
  // One controller per directory and session: the chip follows the composer's session.
  const git = useMemo(
    () =>
      createGitController({
        rpc: server.api().rpc(BuffGit.Rpc),
        directory,
        sessionID,
        refusal: (error) => formatServerError(error, undefined, t("Git refused.")),
      }),
    [server, directory, sessionID, t],
  )
  useEffect(() => {
    if (!connected) return
    void git.refresh()
    const timer: { current?: ReturnType<typeof setTimeout> } = {}
    const later = () => {
      clearTimeout(timer.current)
      timer.current = setTimeout(() => void git.refresh(), 400)
    }
    const unlisten = server.event.location(directory).listen((event) => {
      if (filesMayHaveChanged(event.type) || event.type === "vcs.branch.updated") later()
    })
    const stopRpc = server.api().rpc(BuffGit.Rpc).events.on("changed", later)
    return () => {
      stopRpc()
      clearTimeout(timer.current)
      unlisten()
    }
  }, [git, connected, server, directory])
  return git
}

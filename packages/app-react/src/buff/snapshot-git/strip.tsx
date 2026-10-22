// A strip above the prompt (#495): the session's snapshots need git 2.35 or newer — undo and the
// session's changes do not work. The words are shared with the console (BuffSnapshotGit). Ported
// from the Solid window's buff/snapshot-git.tsx; the session composer and the draft mount it.

import { Button } from "@buff/ui/react"
import { BuffSnapshotGit } from "@opencode/schema/buff-snapshot-git"
import { useQuery } from "@tanstack/react-query"
import { TriangleAlert } from "lucide-react"
import { createStore } from "../../core/store"
import type { Server } from "../../core/servers"
import { useI18n } from "../../i18n/provider"
import { useConnection } from "../../react/core"
import { useStore } from "../../react/use-store"
import "../bar.css"

// «Hide» lasts until the window restarts: git on the machine will not change meanwhile.
const hidden = createStore(false)

export function BuffSnapshotGitStrip(props: { server: Server; directory: string }) {
  const t = useI18n().buff.t
  const connected = useConnection(props.server).status === "connected"
  const dismissed = useStore(hidden, (value) => value)
  const status = useQuery({
    queryKey: ["buff-snapshot-git", props.server.key, props.directory],
    enabled: connected && !!props.directory,
    queryFn: () =>
      props.server
        .api()
        .rpc(BuffSnapshotGit.Rpc)
        .status(undefined, { location: { directory: props.directory } })
        .catch(() => null),
    staleTime: Infinity,
  })
  const warning = status.data && !dismissed ? BuffSnapshotGit.warning(status.data, t) : undefined
  if (!warning) return null
  return (
    <div className="buff-bar" data-component="buff-snapshot-git" data-tone="warning">
      <TriangleAlert aria-hidden className="buff-bar__icon" />
      <span className="buff-bar__text">{warning}</span>
      <Button size="sm" variant="ghost" data-action="buff-snapshot-git-hide" onClick={() => hidden.set(() => true)}>
        {t("Hide")}
      </Button>
    </div>
  )
}

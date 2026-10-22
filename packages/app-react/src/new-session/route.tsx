// The draft route (/new-session?draftId=…) (#584): the draft tab, its server, the slots. A draft
// that is gone (closed, promoted) sends the window home once the tabs have loaded.

import { useEffect, useState } from "react"
import { serverKey } from "../core/servers"
import { useCore, useServers } from "../react/core"
import { useStore } from "../react/use-store"
import { useLocation, useNavigate } from "../router/router"
import { useTabs } from "../shell/tabs/provider"
import type { DraftTab } from "../shell/tabs/tabs"
import { NewSessionScreen } from "./screen"
import { registeredDraftSlots } from "./slots"

const slots = registeredDraftSlots()

export function NewSessionRoute() {
  const tabs = useTabs()
  const core = useCore()
  const servers = useServers()
  const navigate = useNavigate()
  const location = useLocation()
  const draftID = new URLSearchParams(location.search).get("draftId") ?? undefined
  const draft = useStore(tabs.list, (list) =>
    list.find((tab): tab is DraftTab => tab.type === "draft" && tab.draftID === draftID),
  )
  const [ready, setReady] = useState(false)
  useEffect(() => {
    const current = { live: true }
    void tabs.ready.then(() => current.live && setReady(true))
    return () => {
      current.live = false
    }
  }, [tabs])
  useEffect(() => {
    if (ready && !draft) navigate("/", { replace: true })
  }, [ready, !!draft])
  const conn = draft ? servers.find((item) => serverKey(item) === draft.server) : undefined
  if (!draft || !conn) return null
  return (
    <NewSessionScreen
      key={`${draft.draftID}\n${draft.server}\n${draft.directory}`}
      draft={draft}
      server={core.registry.ensure(conn)}
      slots={slots}
    />
  )
}

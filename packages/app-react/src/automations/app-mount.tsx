// A run of an automation asked for permission (#447): a notice that opens its session. The window
// already tells about finished runs like about any session.

import { BuffAutomation } from "@opencode/schema/buff-automation"
import { useEffect } from "react"
import type { Server } from "../core/servers"
import { useI18n } from "../i18n/provider"
import { usePlatform } from "../platform/context"
import { useOpenSession, WithFirstServer } from "../buff/page"
import type { AppMount } from "../shell/mounts"

const automationOf = (metadata: Record<string, unknown> | undefined) => {
  const value = metadata?.[BuffAutomation.SESSION_KEY]
  return typeof value === "object" && value !== null && "title" in value && typeof value.title === "string"
    ? value.title
    : undefined
}

function Watch(props: { server: Server }) {
  const platform = usePlatform()
  const i18n = useI18n()
  const openSession = useOpenSession()
  const t = i18n.buff.t
  useEffect(
    () =>
      props.server.event.on("permission.asked", (event) => {
        const sessionID = event.data.sessionID
        void props.server
          .api()
          .session.get({ sessionID })
          .then(
            (session) => {
              const title = automationOf(session.metadata)
              if (!title) return
              void platform.notify(t("Automation is waiting for permission"), title, () =>
                openSession(props.server, sessionID),
              )
            },
            () => undefined,
          )
      }),
    [props.server, platform, t],
  )
  return null
}

function AutomationNotices() {
  return <WithFirstServer>{(server) => <Watch server={server} />}</WithFirstServer>
}

export default { id: "buff-automation-notices", component: AutomationNotices } satisfies AppMount

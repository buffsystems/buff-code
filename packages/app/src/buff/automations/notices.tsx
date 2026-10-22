import { onCleanup, onMount } from "solid-js"
import { BuffAutomation } from "@opencode/schema/buff-automation"
import { usePlatform } from "@/runtime/platform/platform"
import { useServerSDK } from "@/runtime/server/client"
import { useServer } from "@/runtime/server/current"
import { openNotificationSession } from "@/shell/notifications/notification"
import { useTabs } from "@/shell/tabs/tabs"
import { useBuffText } from "../i18n"
import { ServerScope } from "../server-scope"

/**
 * Запуск автоматизации спросил разрешение (#447) — человек узнаёт уведомлением и по нажатию
 * попадает в сессию ответить. Об окончании запусков окно уже сообщает само, как о любой сессии.
 */

const automationOf = (metadata: Record<string, unknown> | undefined) => {
  const value = metadata?.[BuffAutomation.SESSION_KEY]
  return typeof value === "object" && value !== null && "title" in value && typeof value.title === "string"
    ? value.title
    : undefined
}

function Watch() {
  const sdk = useServerSDK()
  const server = useServer()
  const platform = usePlatform()
  const tabs = useTabs()
  const { t } = useBuffText()
  onMount(() => {
    const unsubscribe = sdk.event.listen((event) => {
      if (event.type !== "permission.asked") return
      const sessionID = event.data.sessionID
      void sdk.api.session.get({ sessionID }).then(
        (session) => {
          const title = automationOf(session.metadata)
          if (!title) return
          void platform.notify(t("Automation is waiting for permission"), title, () =>
            openNotificationSession(tabs, server.key, sessionID),
          )
        },
        () => undefined,
      )
    })
    onCleanup(unsubscribe)
  })
  return null
}

export function BuffAutomationNotices() {
  return (
    <ServerScope>
      <Watch />
    </ServerScope>
  )
}

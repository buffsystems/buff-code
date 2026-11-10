// Окно контекста в композере (#836, эпик #783): потолок контекста сессии. У сессии он живёт на
// сервере (Session.Info.limit, POST /session/:id/context-limit) — выбор уходит сразу, событие
// возвращает его и строку в ленте. У черновика — локально до создания сессии; по умолчанию —
// ключ `context` конфига места.

import { BuffContextWindow } from "@opencode/schema/buff-context-window"
import { useRef, useState } from "react"
import { locationKey } from "../../core/data/state"
import type { Server } from "../../core/servers"
import { useI18n } from "../../i18n/provider"
import { useServerData } from "../../react/core"
import { showToast } from "../../shell/notifications/toast"

/** What the composer's control shows and does: the cap in force (0: the model's window) and a choice. */
export type ContextLimitChoice = { current: number; select(value: number): void }

/** A session's cap: read from the server's session, changed through its API. */
export function useSessionContextLimit(server: Server, sessionID: string): ContextLimitChoice {
  const i18n = useI18n()
  const current = useServerData(server, (state) => state.session.info[sessionID]?.limit?.context ?? 0)
  return {
    current,
    select(value) {
      if (value === current) return
      void server
        .api()
        .session.switchContextLimit({ sessionID, limit: value ? { context: value } : null })
        .catch((error: unknown) => {
          showToast({
            variant: "error",
            title: i18n.t("common.requestFailed"),
            description: error instanceof Error ? error.message : i18n.t("common.requestFailed"),
          })
        })
    },
  }
}

/** A draft's cap: the config's default until chosen; `limit()` is what the create call sends. */
export function useDraftContextLimit(server: Server, directory: string) {
  const configured = useServerData(server, (state) =>
    BuffContextWindow.configured(state.location[locationKey({ directory })]?.config),
  )
  const [chosen, setChosen] = useState<number | undefined>(undefined)
  const current = chosen ?? configured ?? 0
  const latest = useRef(current)
  latest.current = current
  return {
    choice: { current, select: setChosen } satisfies ContextLimitChoice,
    limit: () => (latest.current ? { context: latest.current } : undefined),
  }
}

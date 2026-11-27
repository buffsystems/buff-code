// Entering a side conversation on the session screen (#464): the palette command, `/side` (the
// service says «opened» and the tab shows) and «To a side conversation» on a selected answer.
// The side panes mount the tab; this hook gives them `open`, `fromSelection` and the event.

import { BuffSide } from "@opencode/schema/buff-side"
import { useEffect, useRef } from "react"
import { useCommandRegistration } from "../../commands/provider"
import type { Server } from "../../core/servers"
import { useI18n } from "../../i18n/provider"
import { showToast } from "../../shell/notifications/toast"
import { quoteForSide, setSideDraft } from "./drafts"

const EXPLAINED_KEY = "buff.side.explained"

/** #972 (IA-09): the first side conversation says what it is — a copy of the chat, the main one untouched. */
function explainOnce(t: (text: string) => string) {
  try {
    if (localStorage.getItem(EXPLAINED_KEY) === "true") return
    localStorage.setItem(EXPLAINED_KEY, "true")
  } catch {
    return
  }
  showToast({
    title: t("Side chat"),
    description: t("This is a copy of the chat: ask here apart — the main chat does not change."),
    duration: 10000,
  })
}

export function useSideConversations(input: {
  server: Server
  main: string | undefined
  directory: string
  show: (side: string) => void
}) {
  const t = useI18n().buff.t
  const latest = useRef(input)
  latest.current = input
  const open = async (text?: string) => {
    const current = latest.current
    if (!current.main) return
    await current.server
      .api()
      .rpc(BuffSide.Rpc)
      .open({ session: current.main }, { location: { directory: current.directory } })
      .then(
        (result) => {
          if (text) setSideDraft(result.side.id, quoteForSide(text))
          current.show(result.side.id)
          explainOnce(t)
        },
        (error: unknown) =>
          showToast({
            title: t("Side chat"),
            description: error instanceof Error ? error.message : t("Did not open."),
          }),
      )
  }
  useCommandRegistration("buff-side", () => [
    { id: "buff.side.new", title: t("Side chat"), category: "Buff", onSelect: () => void open() },
  ])
  useEffect(() => {
    const stop = new AbortController()
    void (async () => {
      for await (const event of input.server
        .api()
        .rpc(BuffSide.Rpc)
        .events.subscribe("opened", { signal: stop.signal }))
        if (event.data.session === latest.current.main) latest.current.show(event.data.side.id)
    })().catch(() => undefined)
    return () => stop.abort()
  }, [input.server])
  return { open, fromSelection: (text: string) => void open(text) }
}

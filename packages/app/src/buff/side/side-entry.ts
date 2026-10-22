import { onCleanup } from "solid-js"
import { BuffSide } from "@opencode/schema/buff-side"
import { useServerSDK } from "@/runtime/server/client"
import { useCommand } from "@/shell/commands/command"
import { showToast } from "@/shell/notifications/toast"
import { useWorkspaceLocation } from "@/workspaces/location"
import { useBuffText } from "../i18n"
import { quoteForSide, setSideDraft } from "./drafts"

/**
 * Вход в побочный диалог на экране сессии (#464): команда в палитре, `/side` (служба сообщает
 * «открыт» — вкладка показывается) и «В побочный диалог» у выделенного в ответе.
 */
export function useSideConversations(input: {
  readonly main: () => string | undefined
  readonly show: (side: string) => void
}) {
  const sdk = useServerSDK()
  const location = useWorkspaceLocation()
  const command = useCommand()
  const { t } = useBuffText()
  const rpc = sdk.api.rpc(BuffSide.Rpc)
  const at = () => ({ location: { directory: location().directory } })

  const open = async (text?: string) => {
    const main = input.main()
    if (!main) return
    await rpc.open({ session: main }, at()).then(
      ({ side }) => {
        if (text) setSideDraft(side.id, quoteForSide(text))
        input.show(side.id)
      },
      (error: unknown) =>
        showToast({
          title: t("Side conversation"),
          description: error instanceof Error ? error.message : t("Did not open."),
        }),
    )
  }

  command.register("buff-side", () => [
    { id: "buff.side.new", title: t("Side conversation"), category: "Buff", onSelect: () => void open() },
  ])
  const stop = new AbortController()
  onCleanup(() => stop.abort())
  void (async () => {
    for await (const event of rpc.events.subscribe("opened", { signal: stop.signal }))
      if (event.data.session === input.main()) input.show(event.data.side.id)
  })().catch(() => undefined)

  return { open, fromSelection: (text: string) => void open(text) }
}

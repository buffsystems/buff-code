import { createMemo, onMount } from "solid-js"
import { BuffQueryMap } from "@opencode/schema/buff-query-map"
import { useData } from "../../context/data"
import { DialogSelect, type DialogSelectOption } from "../../ui/dialog-select"
import { Locale } from "../../util/locale"
import { DialogMessage } from "./dialog-message"
import { useDialog } from "../../ui/dialog"
import type { PromptInfo } from "../../prompt/history"
import { t } from "../../feature-plugins/buff/locale"

export function DialogTimeline(props: {
  sessionID: string
  onMove: (messageID: string) => void
  setPrompt?: (prompt: PromptInfo) => void
}) {
  const data = useData()
  const dialog = useDialog()

  onMount(() => {
    dialog.setSize("large")
  })

  const options = createMemo((): DialogSelectOption<string>[] => {
    const messages = data.session.message.list(props.sessionID)
    // Buff (#465): под запросом — начало ответа, как в карте запросов окна.
    const answers = new Map(
      BuffQueryMap.queries(messages).map((query) => [query.id, BuffQueryMap.preview(query, t).answer]),
    )
    const result = [] as DialogSelectOption<string>[]
    for (const message of messages) {
      if (message.type !== "user") continue
      result.push({
        title: message.text.replace(/\n/g, " "),
        description: answers.get(message.id)?.replace(/\n/g, " "),
        value: message.id,
        footer: Locale.time(message.time.created),
        onSelect: (dialog) => {
          dialog.replace(() => (
            <DialogMessage messageID={message.id} sessionID={props.sessionID} setPrompt={props.setPrompt} />
          ))
        },
      })
    }
    result.reverse()
    return result
  })

  return <DialogSelect onMove={(option) => props.onMove(option.value)} title={t("Timeline")} options={options()} />
}

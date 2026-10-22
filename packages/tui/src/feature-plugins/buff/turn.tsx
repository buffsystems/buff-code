import { createMemo, createResource, Show } from "solid-js"
import type { LocationRef } from "@opencode/client"
import { BuffTurn } from "@opencode/schema/buff-turn"
import { BuffTurnFlow } from "@opencode/schema/buff-turn-flow"
import { useClient } from "../../context/client"
import { useTheme } from "../../context/theme"
import { createDialogApi } from "../../plugin/api"
import type { useDialog } from "../../ui/dialog"
import { n, t } from "./locale"

/**
 * Сводка изменений хода и откат с проверкой в консоли (#449). Под ответом — сколько файлов
 * ход изменил; /undo и «Revert» перед откатом показывают, какие файлы вернутся, и отмечают те,
 * что менялись уже после хода. Слова и шаги — общие с окном (`BuffTurn`, `BuffTurnFlow`).
 */

/** Спросить перед откатом; `undefined` — человек передумал. Без ответа службы откат не блокируется. */
export async function confirmRevert(input: {
  client: ReturnType<typeof useClient>
  dialog: ReturnType<typeof useDialog>
  sessionID: string
  messageID: string
  location?: LocationRef
}): Promise<{ files: boolean } | undefined> {
  const preview = await input.client.api
    .rpc(BuffTurn.Rpc)
    .preview(
      { sessionID: input.sessionID, messageID: input.messageID },
      input.location ? { location: input.location } : undefined,
    )
    .catch(() => undefined)
  if (!preview) return { files: true }
  return BuffTurnFlow.confirm(
    createDialogApi(input.dialog, (render) => render()),
    preview,
    t,
    n,
  )
}

/** Строка под ответом: что ход изменил. `userMessageID` — сообщение человека, с которого ход начался. */
export function TurnChanges(props: { sessionID: string; userMessageID: string | undefined }) {
  const client = useClient()
  const theme = useTheme()
  const [files] = createResource(
    () => (props.userMessageID ? { sessionID: props.sessionID, from: props.userMessageID } : undefined),
    (input) => client.api.session.diff({ ...input, context: 0 }).catch(() => []),
  )
  const line = createMemo(() => BuffTurnFlow.footer(files.latest ?? [], t, n))
  return (
    <Show when={line()}>
      {(text) => (
        <box paddingLeft={3}>
          <text fg={theme.text.muted}>{text()}</text>
        </box>
      )}
    </Show>
  )
}

/** Сообщение человека, с которого начался ход этого ответа. */
export function turnUserMessageID(
  messages: readonly { readonly id: string; readonly type: string }[],
  assistantMessageID: string,
): string | undefined {
  const at = messages.findIndex((message) => message.id === assistantMessageID)
  return at === -1 ? undefined : messages.slice(0, at).findLast((message) => message.type === "user")?.id
}

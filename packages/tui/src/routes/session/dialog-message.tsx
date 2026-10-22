import { createMemo } from "solid-js"
import { useData } from "../../context/data"
import { DialogSelect } from "../../ui/dialog-select"
import { useClipboard } from "../../context/clipboard"
import { useToast } from "../../ui/toast"
import { useClient } from "../../context/client"
import { errorMessage } from "../../util/error"
import { DialogFork } from "./dialog-fork"
import type { PromptInfo } from "../../prompt/history"
import { projectedPromptInput } from "../../prompt/codec"
import { confirmRevert } from "../../feature-plugins/buff/turn"
import { t } from "../../feature-plugins/buff/locale"

export function DialogMessage(props: {
  messageID: string
  sessionID: string
  setPrompt?: (prompt: PromptInfo) => void
}) {
  const data = useData()
  const clipboard = useClipboard()
  const toast = useToast()
  const client = useClient()
  const message = createMemo(() => data.session.message.get(props.sessionID, props.messageID))

  return (
    <DialogSelect
      title={t("Message Actions")}
      options={[
        {
          title: t("Jump to"),
          value: "message.jump",
          description: t("view message in session"),
          onSelect: (dialog) => dialog.clear(),
        },
        {
          title: t("Revert"),
          value: "session.revert",
          description: t("undo messages and file changes"),
          onSelect: (dialog) => {
            const value = message()
            // Buff (#449): откат сначала показывает, что вернётся, и спрашивает.
            void (async () => {
              const choice = await confirmRevert({
                client,
                dialog,
                sessionID: props.sessionID,
                messageID: props.messageID,
                location: data.session.get(props.sessionID)?.location,
              })
              if (!choice) return
              if (value?.type === "user") {
                props.setPrompt?.({
                  ...projectedPromptInput(value),
                  pasted: [],
                })
              }
              await client.api.session.revert.stage({
                sessionID: props.sessionID,
                messageID: props.messageID,
                files: choice.files,
              })
              dialog.clear()
            })().catch((error) => toast.show({ message: errorMessage(error), variant: "error", duration: 5000 }))
          },
        },
        {
          title: t("Copy"),
          value: "message.copy",
          description: t("message text to clipboard"),
          onSelect: async (dialog) => {
            const value = message()
            if (!value) return
            const text =
              value.type === "user"
                ? value.text
                : value.type === "assistant"
                  ? value.content
                      .filter((content) => content.type === "text")
                      .map((content) => content.text)
                      .join("\n")
                  : "text" in value
                    ? value.text
                    : ""
            try {
              await clipboard.write(text)
              dialog.clear()
            } catch (error) {
              toast.error(error)
            }
          },
        },
        {
          title: t("Fork"),
          value: "session.fork",
          description: t("create a new session"),
          onSelect: (dialog) => {
            const value = message()
            if (!value || value.type !== "user") return
            dialog.replace(() => <DialogFork sessionID={props.sessionID} messageID={props.messageID} />)
          },
        },
      ]}
    />
  )
}

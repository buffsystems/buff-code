import { Plugin } from "@opencode/plugin/tui"
import type { Context } from "@opencode/plugin/tui/context"
import { failureMessage } from "@opencode/schema/buff-failure"
import { fileFollowUp, type FileChoice } from "@opencode/schema/buff-turn-failure"
import { t } from "./locale"
import { filesFailure } from "./turn-failure"

/**
 * Ход упал на файлах (#757): /files-code просит модель разобрать их кодом, /files-skip —
 * продолжить без них. Оба отправляют готовое сообщение и больше не шлют модели этот формат;
 * слова — общие с окном (`fileFollowUp`).
 */
function Commands(props: { context: Context }) {
  const { context } = props
  const sessionID = () => {
    const route = context.ui.router.current()
    return route.type === "session" ? route.sessionID : undefined
  }
  const say = (message: string, variant: "info" | "error") => context.ui.toast.show({ message, variant })

  const send = async (choice: FileChoice) => {
    const id = sessionID()
    const files = id ? filesFailure(context.data.session.message.list(id)) : undefined
    if (!id || !files) return say(t("The last turn did not fail on files."), "info")
    const { text, metadata } = fileFollowUp(choice, files, t)
    await context.client.session.prompt({ sessionID: id, text, metadata: { ...metadata } })
  }
  const run = (choice: FileChoice) => () =>
    void send(choice).catch((cause: unknown) => say(failureMessage(cause, t("Could not send.")), "error"))

  context.keymap.layer(() => ({
    mode: "global",
    commands: [
      {
        id: "buff.files.code",
        title: t("Buff: analyse the files of the failed turn with code"),
        group: "Buff",
        palette: true as const,
        slash: { name: "files-code" },
        run: run("analyze"),
      },
      {
        id: "buff.files.skip",
        title: t("Buff: continue without the files of the failed turn"),
        group: "Buff",
        palette: true as const,
        slash: { name: "files-skip" },
        run: run("without-files"),
      },
    ],
  }))
  return null
}

export default Plugin.define({
  id: "buff.files",
  setup(context) {
    // Слой команд работает только в компоненте, отрисованном в слоте приложения.
    context.ui.slot({ append: "app", render: () => <Commands context={context} /> })
  },
})

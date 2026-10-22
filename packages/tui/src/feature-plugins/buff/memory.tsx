import { Plugin } from "@opencode/plugin/tui"
import type { Context } from "@opencode/plugin/tui/context"
import { failureMessage } from "@opencode/schema/buff-failure"
import type { BuffMcpFlow } from "@opencode/schema/buff-mcp-flow"
import { BuffMemory } from "@opencode/schema/buff-memory"
import { BuffMemoryFlow } from "@opencode/schema/buff-memory-flow"
import { t } from "./locale"

/**
 * Память из консоли (#446): /memory (и из палитры) — общий выключатель, выключатель файла и
 * заметка в файл. Шаги — общие (`BuffMemoryFlow`), хранит ядро (rpc `buff.memory`).
 */
function Commands(props: { context: Context }) {
  const { context } = props
  const rpc = context.client.rpc(BuffMemory.Rpc)
  const at = () => ({ location: context.location })
  const ui: BuffMcpFlow.Ui = {
    select: (dialog) => context.ui.dialog.select(dialog),
    prompt: (dialog) => context.ui.dialog.prompt(dialog),
    confirm: (dialog) => context.ui.dialog.confirm(dialog),
    t,
  }
  const say = (message: string, variant: "success" | "error") => context.ui.toast.show({ message, variant })
  const failed = (cause: unknown) => say(failureMessage(cause, t("Could not save.")), "error")

  const run = async () => {
    const action = await BuffMemoryFlow.run(ui, await rpc.list(undefined, at()), Date.now())
    context.ui.dialog.clear()
    if (!action) return
    if (action.type === "note") {
      const stored = await rpc.read({ path: action.path }, at())
      await rpc.write({ path: action.path, text: BuffMemoryFlow.withNote(stored.text, action.text) }, at())
      return say(t("Written to {file}", { file: action.path }), "success")
    }
    await rpc.enable({ ...(action.path ? { path: action.path } : {}), enabled: action.enabled }, at())
    say(
      t(action.enabled ? "{name}: turned on" : "{name}: turned off", { name: action.path ?? t("All memory") }),
      "success",
    )
  }

  context.keymap.layer(() => ({
    mode: "global",
    commands: [
      {
        id: "buff.memory",
        title: t("Memory: a note, turn on or off"),
        group: "Buff",
        palette: true as const,
        slash: { name: "memory" },
        run: () => void run().catch(failed),
      },
    ],
  }))
  return null
}

export default Plugin.define({
  id: "buff.memory",
  setup(context) {
    // Слой команд работает только в компоненте, отрисованном в слоте приложения.
    context.ui.slot({ append: "app", render: () => <Commands context={context} /> })
  },
})

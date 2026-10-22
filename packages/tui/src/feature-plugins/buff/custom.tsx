import { Plugin } from "@opencode/plugin/tui"
import type { Context } from "@opencode/plugin/tui/context"
import { BuffCustom } from "@opencode/schema/buff-custom"
import { BuffCustomFlow } from "@opencode/schema/buff-custom-flow"
import { failureMessage } from "@opencode/schema/buff-failure"
import type { BuffMcpFlow } from "@opencode/schema/buff-mcp-flow"
import { t } from "./locale"

/**
 * Команды и субагенты из консоли (#446): /command-add, /command-edit, /command-remove,
 * /command-toggle и то же для /agent-… (и из палитры) — те же действия, что в настройках окна.
 * Шаги — общие (`BuffCustomFlow`), хранит ядро (rpc `buff.custom`).
 */

function Commands(props: { context: Context }) {
  const { context } = props
  const rpc = context.client.rpc(BuffCustom.Rpc)
  const at = () => ({ location: context.location })
  const ui: BuffMcpFlow.Ui = {
    select: (dialog) => context.ui.dialog.select(dialog),
    prompt: (dialog) => context.ui.dialog.prompt(dialog),
    confirm: (dialog) => context.ui.dialog.confirm(dialog),
    t,
  }
  const say = (message: string, variant: "success" | "error") => context.ui.toast.show({ message, variant })
  const failed = (cause: unknown) => say(failureMessage(cause, t("Could not save.")), "error")

  /** Довести шаг до конца: закрыть вопросы, показать отказ или выполнить и сказать, что вышло. */
  const finish = async <Result extends object>(
    result: Result | BuffCustomFlow.Problem | undefined,
    apply: (result: Result) => Promise<unknown>,
    done: (result: Result) => string,
  ) => {
    context.ui.dialog.clear()
    if (!result) return
    if ("problem" in result) return say(result.problem, "error")
    await apply(result).then(() => say(done(result), "success"), failed)
  }

  const actions = (kind: BuffCustom.Kind) => {
    const name = kind.name
    const entries = () => rpc.list({ kind: name }, at())
    const call = (id: string) => BuffCustom.mention(kind, id)
    const save = (flow: () => Promise<BuffCustomFlow.Saved | BuffCustomFlow.Problem | undefined>) => async () =>
      finish(
        await flow(),
        (saved) => rpc.save({ kind: name, ...saved }, at()),
        (saved) => t("Saved: {name}", { name: call(saved.id) }),
      )
    return [
      { verb: "add", title: t("add"), run: save(() => BuffCustomFlow.add(ui, kind)) },
      {
        verb: "edit",
        title: t("edit"),
        run: save(async () =>
          BuffCustomFlow.edit(ui, kind, await entries(), (target) => rpc.read({ kind: name, ...target }, at())),
        ),
      },
      {
        verb: "remove",
        title: t("delete"),
        run: async () =>
          finish(
            await BuffCustomFlow.remove(ui, kind, await entries()),
            (target) => rpc.remove({ kind: name, ...target }, at()),
            (target) => t("Deleted: {name}", { name: call(target.id) }),
          ),
      },
      {
        verb: "toggle",
        title: t("turn on or off"),
        run: async () =>
          finish(
            await BuffCustomFlow.toggle(ui, kind, await entries()),
            (target) => rpc.enable({ kind: name, ...target }, at()),
            (target) => t(target.enabled ? "{name}: turned on" : "{name}: turned off", { name: call(target.id) }),
          ),
      },
    ].map((action) => ({
      id: `buff.${name}.${action.verb}`,
      title: `${t(kind.words.title)}: ${action.title}`,
      group: "Buff",
      palette: true as const,
      slash: { name: `${name}-${action.verb}` },
      run: () => void action.run().catch(failed),
    }))
  }

  context.keymap.layer(() => ({
    mode: "global",
    commands: [...actions(BuffCustom.kinds.command), ...actions(BuffCustom.kinds.agent)],
  }))
  return null
}

export default Plugin.define({
  id: "buff.custom",
  setup(context) {
    // Слой команд работает только в компоненте, отрисованном в слоте приложения.
    context.ui.slot({ append: "app", render: () => <Commands context={context} /> })
  },
})

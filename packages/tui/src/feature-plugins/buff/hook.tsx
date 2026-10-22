import { createEffect } from "solid-js"
import { Plugin } from "@opencode/plugin/tui"
import type { Context } from "@opencode/plugin/tui/context"
import { BuffCustom } from "@opencode/schema/buff-custom"
import { failureMessage } from "@opencode/schema/buff-failure"
import { BuffHook } from "@opencode/schema/buff-hook"
import { BuffHookFlow } from "@opencode/schema/buff-hook-flow"
import type { BuffMcpFlow } from "@opencode/schema/buff-mcp-flow"
import { BuffTrust } from "@opencode/schema/buff-trust"
import { n, t } from "./locale"

/**
 * Хуки и доверие из консоли (#446): /hook-add, /hook-remove, /hook-toggle и /trust (и из
 * палитры). Хуки и команды проекта не выполняются, пока их не подтвердили: при запуске консоль
 * говорит, что в проекте есть непроверенное, а /trust показывает каждую запись и даёт
 * подтвердить. Шаги — общие (`BuffHookFlow`), хранит и исполняет ядро (rpc `buff.hook`).
 */
function Commands(props: { context: Context }) {
  const { context } = props
  const hooks = context.client.rpc(BuffHook.Rpc)
  const custom = context.client.rpc(BuffCustom.Rpc)
  const at = () => ({ location: context.location })
  const ui: BuffMcpFlow.Ui = {
    select: (dialog) => context.ui.dialog.select(dialog),
    prompt: (dialog) => context.ui.dialog.prompt(dialog),
    confirm: (dialog) => context.ui.dialog.confirm(dialog),
    t,
  }
  const say = (message: string, variant: "success" | "error" | "warning") => context.ui.toast.show({ message, variant })
  const failed = (cause: unknown) => say(failureMessage(cause, t("Could not save.")), "error")

  /** Довести шаг до конца: закрыть вопросы, показать отказ или выполнить и сказать, что вышло. */
  const finish = async <Result extends object>(
    result: Result | BuffHookFlow.Problem | undefined,
    apply: (result: Result) => Promise<unknown>,
    done: (result: Result) => string,
  ) => {
    context.ui.dialog.clear()
    if (!result) return
    if ("problem" in result) return say(result.problem, "error")
    await apply(result).then(() => say(done(result), "success"), failed)
  }

  const pending = async () =>
    BuffTrust.pending(await custom.list({ kind: "command" }, at()), await hooks.list(undefined, at()), t)
  const review = (item: BuffTrust.Item) =>
    item.kind === "hook" ? hooks.review({ id: item.id }, at()) : custom.review({ kind: "command", id: item.id }, at())

  const actions = [
    {
      verb: "hook-add",
      title: "Hooks: add or replace",
      run: async () =>
        finish(
          await BuffHookFlow.add(ui),
          (hook) => hooks.save(hook, at()),
          (hook) => t("Hook «{id}» saved", { id: hook.id }),
        ),
    },
    {
      verb: "hook-remove",
      title: "Hooks: delete",
      run: async () =>
        finish(
          await BuffHookFlow.remove(ui, await hooks.list(undefined, at())),
          (target) => hooks.remove(target, at()),
          (target) => t("Hook «{id}» deleted", { id: target.id }),
        ),
    },
    {
      verb: "hook-toggle",
      title: "Hooks: turn on or off",
      run: async () =>
        finish(
          await BuffHookFlow.toggle(ui, await hooks.list(undefined, at())),
          (target) => hooks.enable(target, at()),
          (target) => t(target.enabled ? "Hook «{id}»: turned on" : "Hook «{id}»: turned off", { id: target.id }),
        ),
    },
    {
      verb: "trust",
      title: "Trust: check the project's hooks and commands",
      run: async () =>
        finish(
          await BuffHookFlow.trust(ui, await pending(), review),
          ({ item, token }) =>
            item.kind === "hook"
              ? hooks.trust({ id: item.id, token }, at())
              : custom.trust({ kind: "command", id: item.id, token }, at()),
          ({ item }) => t("{title}: confirmed", { title: item.title }),
        ),
    },
  ]

  // Каталог консоль узнаёт не сразу; о каждом каталоге напоминаем один раз.
  const reminded = new Set<string>()
  createEffect(() => {
    const directory = context.location?.directory
    if (!directory || reminded.has(directory)) return
    reminded.add(directory)
    void pending().then(
      (items) => {
        const line = BuffTrust.line(items, t, n)
        // Держим дольше обычного: это не сообщение о сделанном, а то, что человеку надо решить.
        if (line)
          context.ui.toast.show({
            message: t("{line} To check — /trust", { line }),
            variant: "warning",
            duration: 12000,
          })
      },
      () => undefined,
    )
  })

  context.keymap.layer(() => ({
    mode: "global",
    commands: actions.map((action) => ({
      id: `buff.${action.verb}`,
      title: t(action.title),
      group: "Buff",
      palette: true as const,
      slash: { name: action.verb },
      run: () => void action.run().catch(failed),
    })),
  }))
  return null
}

export default Plugin.define({
  id: "buff.hook",
  setup(context) {
    // Слой команд работает только в компоненте, отрисованном в слоте приложения.
    context.ui.slot({ append: "app", render: () => <Commands context={context} /> })
  },
})

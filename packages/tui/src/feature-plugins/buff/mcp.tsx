import { Plugin } from "@opencode/plugin/tui"
import type { Context } from "@opencode/plugin/tui/context"
import { BuffMcp } from "@opencode/schema/buff-mcp"
import { BuffMcpFlow } from "@opencode/schema/buff-mcp-flow"
import { failureMessage } from "@opencode/schema/buff-failure"
import { t } from "./locale"

/**
 * MCP-серверы из консоли (#444): /mcp-add, /mcp-edit, /mcp-remove (и из палитры) — те же
 * действия, что в настройках окна. Список со статусами — прежнее окно /mcps. Шаги — общие
 * (`BuffMcpFlow`), хранит ядро (rpc `buff.mcp`).
 */

/** Подсказка в окне списка серверов: чем их добавляют и правят. */
export const MCP_COMMANDS_HINT = "/mcp-add · /mcp-edit · /mcp-remove"

function Commands(props: { context: Context }) {
  const { context } = props
  const rpc = context.client.rpc(BuffMcp.Rpc)
  const at = () => ({ location: context.location })
  const ui: BuffMcpFlow.Ui = {
    select: (dialog) => context.ui.dialog.select(dialog),
    prompt: (dialog) => context.ui.dialog.prompt(dialog),
    confirm: (dialog) => context.ui.dialog.confirm(dialog),
    t,
  }
  const say = (message: string, variant: "success" | "error") => context.ui.toast.show({ message, variant })
  const failed = (cause: unknown) => say(failureMessage(cause, t("Could not save the server.")), "error")

  const save = async (flow: () => Promise<BuffMcpFlow.Saved | BuffMcpFlow.Problem | undefined>) => {
    const result = await flow()
    context.ui.dialog.clear()
    if (!result) return
    if ("problem" in result) return say(result.problem, "error")
    await Promise.all(
      result.servers.map((server, index) =>
        rpc.save(
          { scope: result.scope, ...server, ...(index === 0 && result.previous ? { previous: result.previous } : {}) },
          at(),
        ),
      ),
    ).then(
      () =>
        say(
          t("Saved: {names} · status — /mcps", { names: result.servers.map((server) => server.name).join(", ") }),
          "success",
        ),
      failed,
    )
  }
  const remove = async () => {
    const target = await BuffMcpFlow.remove(ui, await rpc.list(undefined, at()))
    context.ui.dialog.clear()
    if (!target) return
    if ("problem" in target) return say(target.problem, "error")
    await rpc
      .remove(target, at())
      .then(() => say(t("Server «{name}» deleted", { name: target.name }), "success"), failed)
  }

  const command = (name: string, title: string, run: () => Promise<unknown>) => ({
    id: `buff.mcp.${name}`,
    title,
    group: "Buff",
    palette: true as const,
    slash: { name: `mcp-${name}` },
    run: () => void run().catch(failed),
  })
  context.keymap.layer(() => ({
    mode: "global",
    commands: [
      command("add", t("MCP: add a server"), () => save(() => BuffMcpFlow.add(ui))),
      command("edit", t("MCP: edit a server"), () =>
        save(async () => BuffMcpFlow.edit(ui, await rpc.list(undefined, at()))),
      ),
      command("remove", t("MCP: delete a server"), remove),
    ],
  }))
  return null
}

export default Plugin.define({
  id: "buff.mcp",
  setup(context) {
    // Слой команд работает только в компоненте, отрисованном в слоте приложения.
    context.ui.slot({ append: "app", render: () => <Commands context={context} /> })
  },
})

import { Plugin } from "@opencode/plugin/tui"
import type { Context } from "@opencode/plugin/tui/context"
import { failureMessage } from "@opencode/schema/buff-failure"
import { BuffGit } from "@opencode/schema/buff-git"
import { BuffGitFlow } from "@opencode/schema/buff-git-flow"
import type { BuffMcpFlow } from "@opencode/schema/buff-mcp-flow"
import { BuffSnapshotGit } from "@opencode/schema/buff-snapshot-git"
import { followDirectory } from "./follow"
import { n, t } from "./locale"

/**
 * Коммит и отправка из консоли (#454): /commit и /push (и из палитры). Шаги — общие
 * (`BuffGitFlow`), git выполняет ядро (rpc `buff.git`). Ветки и граф коммитов — в окне.
 * При запуске — предупреждение, если снимкам сессии не хватает git (#495).
 */
function Commands(props: { context: Context }) {
  const { context } = props
  const rpc = context.client.rpc(BuffGit.Rpc)
  const at = () => ({ location: context.location })
  const ui: BuffMcpFlow.Ui = {
    select: (dialog) => context.ui.dialog.select(dialog),
    prompt: (dialog) => context.ui.dialog.prompt(dialog),
    confirm: (dialog) => context.ui.dialog.confirm(dialog),
  }
  /** Модель спрашиваем от имени открытой сессии — так запрос привязан к контексту Buff. */
  const sessionID = () => {
    const route = context.ui.router.current()
    return route.type === "session" ? { sessionID: route.sessionID } : {}
  }
  const say = (message: string, variant: "success" | "error") => context.ui.toast.show({ message, variant })
  const failed = (cause: unknown) => say(failureMessage(cause, t("Git refused.")), "error")

  // Снимкам нужен git от 2.35 (#495): без него откат и изменения сессии не работают — говорим,
  // как только TUI знает свой каталог (до подключения к серверу его нет).
  followDirectory(
    () => context.location?.directory,
    () =>
      void context.client
        .rpc(BuffSnapshotGit.Rpc)
        .status(undefined, at())
        .then((status) => {
          const warning = BuffSnapshotGit.warning(status, t)
          if (warning) context.ui.toast.show({ message: warning, variant: "warning", duration: 15_000 })
        })
        .catch(() => undefined),
  )

  const commit = async () => {
    const result = await BuffGitFlow.commit(
      ui,
      await rpc.state(undefined, at()),
      (files) => rpc.message({ files, ...sessionID() }, at()).then((answer) => answer.message),
      t,
      n,
    )
    context.ui.dialog.clear()
    if (!result) return
    if ("problem" in result) return say(result.problem, "error")
    await rpc.commit({ message: result.message, files: result.files }, at())
    if (!result.push) return say(t("Committed"), "success")
    const state = await rpc.push(undefined, at())
    say(t("Committed and pushed · {sync}", { sync: BuffGit.syncLabel(state, t) }), "success")
  }
  const push = async () => {
    const result = await BuffGitFlow.push(ui, await rpc.state(undefined, at()), t)
    context.ui.dialog.clear()
    if (!result) return
    if (result !== true) return say(result.problem, "error")
    const state = await rpc.push(undefined, at())
    say(t("Pushed · {sync}", { sync: BuffGit.syncLabel(state, t) }), "success")
  }

  context.keymap.layer(() => ({
    mode: "global",
    commands: [
      { verb: "commit", title: t("Git: commit the changes"), run: commit },
      { verb: "push", title: t("Git: push the branch"), run: push },
    ].map((action) => ({
      id: `buff.git.${action.verb}`,
      title: action.title,
      group: "Buff",
      palette: true as const,
      slash: { name: action.verb },
      run: () => void action.run().catch(failed),
    })),
  }))
  return null
}

export default Plugin.define({
  id: "buff.git",
  setup(context) {
    // Слой команд работает только в компоненте, отрисованном в слоте приложения.
    context.ui.slot({ append: "app", render: () => <Commands context={context} /> })
  },
})

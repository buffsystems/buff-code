import { Plugin } from "@opencode/plugin/tui"
import type { Context, DialogSelectOptions } from "@opencode/plugin/tui/context"
import { BuffAutomation } from "@opencode/schema/buff-automation"
import { BuffAutomationFlow } from "@opencode/schema/buff-automation-flow"
import { failureMessage } from "@opencode/schema/buff-failure"
import type { BuffMcpFlow } from "@opencode/schema/buff-mcp-flow"
import { n, t } from "./locale"

/**
 * Автоматизации в консоли (#447): /automations — список со следующим запуском и последним
 * итогом, у каждой — запустить, остановить, пауза, правка, история с переходом в сессию,
 * удаление; /automation-new — создать по шагам. Шаги и слова — общие с окном, хранит и
 * запускает служба Buff Code (rpc `buff.automation`).
 */

const NEW = "＋"
const words = { t, n }

function Commands(props: { context: Context }) {
  const { context } = props
  const rpc = context.client.rpc(BuffAutomation.Rpc)
  const at = () => ({ location: context.location })
  // Выбор — шире обычного: расписание, проект, следующий запуск и подсказки должны помещаться.
  const wide = <Value,>(dialog: DialogSelectOptions<Value>) => {
    const choice = context.ui.dialog.select(dialog)
    context.ui.dialog.set({ size: "xlarge" })
    return choice
  }
  const ui: BuffMcpFlow.Ui = {
    select: (dialog) => wide(dialog),
    prompt: (dialog) => context.ui.dialog.prompt(dialog),
    confirm: (dialog) => context.ui.dialog.confirm(dialog),
  }
  const say = (message: string, variant: "success" | "error" | "info") => context.ui.toast.show({ message, variant })
  const failed = (fallback: string) => (cause: unknown) => say(t(failureMessage(cause, fallback)), "error")
  const openSession = (sessionID: string) => context.ui.router.navigate({ type: "session", sessionID })

  const edit = async (automation?: BuffAutomation.Automation) => {
    const draft = await BuffAutomationFlow.draft(ui, automation, context.location?.directory ?? "", words)
    context.ui.dialog.clear()
    if (!draft) return
    if ("problem" in draft) return say(draft.problem, "error")
    await rpc.save({ ...(automation ? { id: automation.id } : {}), draft }, at()).then((saved) => {
      if (saved.problem || !saved.automation) return say(t(saved.problem ?? "Not saved."), "error")
      const row = BuffAutomationFlow.row(saved.automation, new Date(), words)
      say(t("Saved: {schedule}, next run — {next}", { schedule: row.description, next: row.footer }), "success")
    }, failed("The automation was not saved."))
  }

  const history = async (automation: BuffAutomation.Automation) => {
    const { runs } = await rpc.runs({ id: automation.id }, at())
    if (!runs.length) return say(t("No automation runs yet."), "info")
    const picked = await wide({
      title: t("History: {title} · Enter — open the run session", { title: automation.title }),
      options: runs.map((run) => BuffAutomationFlow.historyRow(run, new Date(), words)),
    })
    context.ui.dialog.clear()
    const session = runs.find((run) => run.id === picked)?.session
    if (session) openSession(session)
  }

  const act = async (automation: BuffAutomation.Automation) => {
    const action = await wide({
      title: BuffAutomationFlow.actionsTitle(automation, words),
      options: BuffAutomationFlow.actions(automation, t),
    })
    context.ui.dialog.clear()
    const id = { id: automation.id }
    const report = (result: { problem?: string }, done: string) =>
      result.problem ? say(t(result.problem), "error") : say(t(done), "success")
    switch (action) {
      case "run":
        return rpc.run(id, at()).then((result) => report(result, "The run started."), failed("The run did not start."))
      case "stop":
        return rpc
          .stop(id, at())
          .then(
            (result) => say(result.stopped ? t("The run was stopped.") : t("The run had already finished."), "info"),
            failed("The automation run did not stop."),
          )
      case "open":
        return automation.last?.session && openSession(automation.last.session)
      case "pause":
      case "resume":
        return rpc
          .pause({ ...id, paused: action === "pause" }, at())
          .then(
            (result) => report(result, action === "pause" ? "Paused." : "Back on schedule."),
            failed("It did not work."),
          )
      case "edit":
        return edit(automation)
      case "history":
        return history(automation).catch(failed("The history did not load."))
      case "remove": {
        const yes = await context.ui.dialog.confirm({
          title: t("Delete «{title}»?", { title: automation.title }),
          message: t("It will no longer run, its run history will be deleted. The run sessions will stay."),
        })
        context.ui.dialog.clear()
        if (!yes) return
        return rpc.remove(id, at()).then(() => say(t("Deleted."), "success"), failed("It was not deleted."))
      }
    }
  }

  const list = async () => {
    const { automations } = await rpc.list({}, at())
    const now = new Date()
    const picked = await wide({
      title: t("Automations — tasks for the agent on a schedule"),
      options: [
        { title: `${NEW} ${t("New automation")}`, value: NEW, description: t("or ask the agent in the chat") },
        ...automations.map((automation) => BuffAutomationFlow.row(automation, now, words)),
      ],
    })
    context.ui.dialog.clear()
    if (picked === NEW) return edit()
    const automation = automations.find((item) => item.id === picked)
    if (automation) return act(automation)
  }

  context.keymap.layer(() => ({
    mode: "global",
    commands: [
      {
        id: "buff.automations",
        title: t("Buff: automations"),
        group: "Buff",
        palette: true as const,
        slash: { name: "automations" },
        run: () => void list().catch(failed("The automation list did not load.")),
      },
      {
        id: "buff.automation.new",
        title: t("Buff: new automation"),
        group: "Buff",
        palette: true as const,
        slash: { name: "automation-new" },
        run: () => void edit(),
      },
    ],
  }))
  return null
}

export default Plugin.define({
  id: "buff.automation",
  setup(context) {
    context.ui.slot({ append: "app", render: () => <Commands context={context} /> })
  },
})

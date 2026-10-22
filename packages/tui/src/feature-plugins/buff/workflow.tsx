import { Plugin } from "@opencode/plugin/tui"
import type { Context, DialogSelectOptions } from "@opencode/plugin/tui/context"
import { BuffWorkflowFile } from "@opencode/schema/buff-workflow-file"
import { BuffWorkflowFlow } from "@opencode/schema/buff-workflow-flow"
import { BuffWorkflowRpc } from "@opencode/schema/buff-workflow-rpc"
import { failureMessage } from "@opencode/schema/buff-failure"
import { t } from "./locale"
import { WorkflowView } from "./workflow-view"

/**
 * Сценарии в консоли (#448): /workflows — сохранённые и прогоны; у сохранённого — запустить с
 * аргументами, подробнее, исправить в чате, удалить; у прогона — ход по фазам и шагам, вопросы
 * субагентов с ответом, артефакты, итог, журнал, остановить, продолжить. Слова — общие с окном.
 */

function Commands(props: { context: Context }) {
  const { context } = props
  const rpc = context.client.rpc(BuffWorkflowRpc.Rpc)
  const at = () => ({ location: context.location })
  const directory = () => context.location?.directory ?? ""
  // Выбор — шире обычного: строки прогона с метриками должны помещаться.
  const wide = <Value,>(dialog: DialogSelectOptions<Value>) => {
    const choice = context.ui.dialog.select(dialog)
    context.ui.dialog.set({ size: "xlarge" })
    return choice
  }
  const show = async (title: string, message: string) => {
    const shown = context.ui.dialog.alert({ title, message })
    context.ui.dialog.set({ size: "xlarge" })
    await shown
  }
  const say = (message: string, variant: "success" | "error" | "info") => context.ui.toast.show({ message, variant })
  const failed = (fallback: string) => (cause: unknown) => say(t(failureMessage(cause, fallback)), "error")
  const openSession = (sessionID: string) => context.ui.router.navigate({ type: "session", sessionID })
  /** Человек пишет, что исправить, — это уходит агенту в сессию, и консоль переходит туда. */
  const askAgent = async (lead: string, session: string | undefined, title: string) => {
    const text = await context.ui.dialog.prompt({ title: t("What to fix?"), description: lead })
    context.ui.dialog.clear()
    if (!text?.trim()) return
    const target = session ?? (await context.client.session.create({ title, location: { directory: directory() } })).id
    await context.client.session.prompt({ sessionID: target, text: lead + text.trim() })
    openSession(target)
  }

  const showRun = async (id: string): Promise<void> => {
    const detail = await rpc.run({ id }, at())
    const picked = await wide({
      title: `${detail.run.label} · ${BuffWorkflowFlow.runLine(detail.run, Date.now(), t)}`,
      options: WorkflowView.runOptions(detail, Date.now()),
    })
    context.ui.dialog.clear()
    if (!picked) return
    const [kind, key] = [picked.split(":")[0], picked.slice(picked.indexOf(":") + 1)]
    const again = () => showRun(id)
    if (kind === "refresh") return again()
    if (kind === "stop") return rpc.stop({ id }, at()).then(again, failed("The run did not stop."))
    if (kind === "resume")
      return rpc
        .resume({ id }, at())
        .then((done) => (done.problem ? say(t(done.problem), "error") : again()), failed("The run did not resume."))
    if (kind === "session") return detail.run.session ? openSession(detail.run.session) : undefined
    if (kind === "fix") return askAgent(BuffWorkflowFlow.fixRun(detail.run, t), detail.run.session, detail.run.label)
    if (kind === "question") {
      const question = detail.questions.find((item) => item.id === key)
      const text = await context.ui.dialog.prompt({
        title: t("{actor} asks", { actor: question?.actor ?? t("Subagent") }),
        description: question?.text,
      })
      context.ui.dialog.clear()
      if (text?.trim()) {
        const done = await rpc.answer({ question: key, text: text.trim() }, at())
        if (done.problem) say(t(done.problem), "error")
      }
      return again()
    }
    const step = detail.steps.find((item) => item.id === key)
    if (kind === "step" && step) await show(step.actor, WorkflowView.stepText(step, Date.now()))
    const artifact = detail.artifacts.find((item) => item.id === key)
    if (kind === "artifact" && artifact)
      await show(artifact.title ?? artifact.id, WorkflowView.artifactText(artifact, detail.items))
    if (kind === "result") await show(t("Run result"), JSON.stringify(detail.run.result, null, 2))
    if (kind === "log")
      await show(
        t("Log"),
        detail.log.map((line) => `${new Date(line.at).toLocaleTimeString("ru-RU")} ${t(line.text)}`).join("\n"),
      )
    context.ui.dialog.clear()
    return again()
  }

  const start = async (saved: BuffWorkflowRpc.Saved) => {
    const texts: Record<string, string> = BuffWorkflowFlow.formTexts(saved.meta.args)
    for (const [name, decl] of Object.entries(saved.meta.args)) {
      const value = await context.ui.dialog.prompt({
        title: `${saved.meta.name}: ${name} · ${t(BuffWorkflowFlow.TYPE_LABEL[decl.type])}${decl.required ? ` · ${t("required")}` : ""}`,
        ...(decl.description ? { description: decl.description } : {}),
        value: texts[name] ?? "",
      })
      context.ui.dialog.clear()
      if (value === undefined) return
      texts[name] = value
    }
    const checked = BuffWorkflowFlow.formValues(saved.meta.args, texts)
    if ("problems" in checked)
      return say(
        Object.entries(checked.problems)
          .map(([name, problem]) => `${name}: ${t(problem)}`)
          .join("; "),
        "error",
      )
    const started = await rpc.start(
      { name: saved.meta.name, args: { ...checked.values }, directory: directory() },
      at(),
    )
    if (started.problems)
      return say(
        Object.entries(started.problems)
          .map(([name, problem]) => `${name}: ${t(problem)}`)
          .join("; "),
        "error",
      )
    if (!started.run) return say(t(started.problem ?? "The workflow did not start."), "error")
    say(
      t("Workflow «{name}» started: the result will arrive in its session.", {
        name: BuffWorkflowFile.displayName(saved.meta),
      }),
      "success",
    )
    return showRun(started.run)
  }

  const savedActions = async (saved: BuffWorkflowRpc.Saved) => {
    const action = await wide({
      title: `${BuffWorkflowFile.displayName(saved.meta)} — ${saved.meta.description}`,
      options: [
        { title: t("Run"), value: "start", description: BuffWorkflowFlow.argsSummary(saved.meta.args, t) },
        { title: t("More details"), value: "detail", description: t("description, arguments and script") },
        {
          title: t("Fix in chat"),
          value: "fix",
          description: t("write what to change — the agent will fix and save it"),
        },
        ...(saved.last
          ? [
              {
                title: t("Last run"),
                value: "last",
                description: t(BuffWorkflowFlow.STATUS_LABEL[saved.last.status]),
              },
            ]
          : []),
        { title: t("Delete"), value: "remove" },
      ],
    })
    context.ui.dialog.clear()
    if (action === "start") return start(saved)
    if (action === "last" && saved.last) return showRun(saved.last.id)
    if (action === "fix")
      return askAgent(
        BuffWorkflowFlow.fixSaved(saved.meta.name, saved.path, t),
        undefined,
        t("Workflow «{name}»", { name: BuffWorkflowFile.displayName(saved.meta) }),
      )
    if (action === "detail") {
      const read = await rpc.read({ name: saved.meta.name }, at())
      await show(
        saved.meta.name,
        [
          read.meta.description,
          ...(read.meta.whenToUse ? [t("When: {text}", { text: read.meta.whenToUse })] : []),
          BuffWorkflowFlow.argsSummary(read.meta.args, t),
          t("File: {path}", { path: read.path }),
          `${t("Script (read-only — the agent edits it):")}\n${read.script}`,
        ].join("\n\n"),
      )
      context.ui.dialog.clear()
      return
    }
    if (action === "remove") {
      const yes = await context.ui.dialog.confirm({
        title: t("Delete workflow «{name}»?", { name: BuffWorkflowFile.displayName(saved.meta) }),
        message: t("The workflow file will be deleted. Past runs and their sessions stay."),
      })
      context.ui.dialog.clear()
      if (yes)
        await rpc
          .remove({ name: saved.meta.name }, at())
          .then(() => say(t("Deleted."), "success"), failed("The workflow was not deleted."))
    }
  }

  const list = async () => {
    const [saved, history] = await Promise.all([rpc.list({}, at()), rpc.runs({}, at())])
    const picked = await wide({
      title: t("Workflows — the agent writes and edits them in the chat"),
      options: WorkflowView.listOptions(saved, history.runs, Date.now()),
    })
    context.ui.dialog.clear()
    if (picked?.startsWith("run:")) return showRun(picked.slice(4))
    const workflow = saved.saved.find((item) => `saved:${item.meta.name}` === picked)
    if (workflow) return savedActions(workflow)
  }

  context.keymap.layer(() => ({
    mode: "global",
    commands: [
      {
        id: "buff.workflows",
        title: t("Buff: workflows"),
        group: "Buff",
        palette: true as const,
        slash: { name: "workflows" },
        run: () => void list().catch(failed("Workflows did not load.")),
      },
    ],
  }))
  return null
}

export default Plugin.define({
  id: "buff.workflow",
  setup(context) {
    context.ui.slot({ append: "app", render: () => <Commands context={context} /> })
  },
})

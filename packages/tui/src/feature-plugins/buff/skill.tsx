import { createMemo, createResource, createSignal, onCleanup, onMount } from "solid-js"
import type { LocationRef } from "@opencode/client"
import { Plugin } from "@opencode/plugin/tui"
import type { Context } from "@opencode/plugin/tui/context"
import { failureMessage } from "@opencode/schema/buff-failure"
import type { BuffMcpFlow } from "@opencode/schema/buff-mcp-flow"
import { BuffSkill } from "@opencode/schema/buff-skill"
import { BuffSkillFlow } from "@opencode/schema/buff-skill-flow"
import { useClient } from "../../context/client"
import { useTheme } from "../../context/theme"
import { useDialog } from "../../ui/dialog"
import { DialogSelect } from "../../ui/dialog-select"
import { useToast } from "../../ui/toast"
import { t } from "./locale"

/**
 * Навыки из консоли (#445). Список /skills показывает, откуда навык, и включает или выключает
 * его прямо из списка; /skill-attach и /skill-detach (и из палитры) подключают и отключают
 * каталог с навыками — те же действия, что в настройках окна. Слова и шаги — общие
 * (`BuffSkillFlow`), хранит ядро (rpc `buff.skill`).
 */

/** Подпись навыка в подсказках поля ввода — с пометкой, откуда он. */
export function useSkillNotes(location: () => LocationRef | undefined) {
  const rpc = useClient().api.rpc(BuffSkill.Rpc)
  const [entries, { refetch }] = createResource(
    () => location()?.directory ?? "",
    () =>
      rpc.list(undefined, location() ? { location: location() } : undefined).then(
        (result) => result.skills,
        () => [],
      ),
  )
  onMount(() => {
    const stop = new AbortController()
    onCleanup(() => stop.abort())
    void (async () => {
      for await (const _ of rpc.events.subscribe("changed", { signal: stop.signal })) void refetch()
    })().catch(() => undefined)
  })
  const origins = createMemo(() => new Map((entries.latest ?? []).map((skill) => [skill.id, skill.scope])))
  return (id: string, description: string | undefined) => BuffSkill.suggestionNote(origins().get(id), description, t)
}

/** Список навыков: выбор вставляет навык в поле ввода, действие — включает или выключает. */
export function DialogBuffSkill(props: { location?: LocationRef; onSelect: (skill: string) => void }) {
  const dialog = useDialog()
  const client = useClient()
  const toast = useToast()
  const theme = useTheme().surface("dialog")
  dialog.setSize("large")
  const rpc = client.api.rpc(BuffSkill.Rpc)
  const at = () => (props.location ? { location: props.location } : undefined)
  const [problem, setProblem] = createSignal<string>()
  const [entries, { refetch }] = createResource(() =>
    rpc.list(undefined, at()).then(
      (result) => result.skills,
      (cause: unknown) => {
        setProblem(failureMessage(cause, t("Could not get the list of skills.")))
        return []
      },
    ),
  )
  const [focused, setFocused] = createSignal<string>()
  const rows = createMemo(() => BuffSkillFlow.rows(entries.latest ?? [], t))
  const row = (id: string | undefined) => rows().find((item) => item.id === id)
  const width = createMemo(() => Math.max(0, ...rows().map((item) => item.title.length)))

  const toggle = (id: string) => {
    const target = row(id)
    if (!target) return
    void rpc
      .enable({ id, enabled: !target.enabled }, at())
      .then(() => refetch())
      .catch((cause: unknown) =>
        toast.show({ message: failureMessage(cause, t("Could not switch the skill.")), variant: "error" }),
      )
  }

  return (
    <DialogSelect
      title={t("Skills")}
      options={rows().map((item) => ({
        value: item.id,
        title: item.title.padEnd(width()),
        description: item.description,
        footer: item.status,
        footerColor: theme.text.muted,
      }))}
      preserveSelection
      locked={entries.loading && !entries.latest}
      onMove={(option) => setFocused(option.value as string)}
      onSelect={(option) => {
        const target = row(option.value as string)
        if (!target) return
        if (!target.enabled) return toast.show({ message: t("The skill is off — turn it on first."), variant: "error" })
        props.onSelect(target.id)
        dialog.clear()
      }}
      actions={[
        {
          title: BuffSkillFlow.toggleTitle(row(focused() ?? rows()[0]?.id)?.enabled, t),
          command: "dialog.skill.toggle",
          onTrigger: (option) => {
            setFocused(option.value as string)
            toggle(option.value as string)
          },
        },
      ]}
      emptyView={
        <box paddingLeft={4} paddingRight={4}>
          <text fg={theme.text.muted}>
            {problem() ??
              (entries.loading ? t("Loading skills…") : t("No skills. To attach a directory — /skill-attach."))}
          </text>
        </box>
      }
      noMatchView={
        <box paddingLeft={4} paddingRight={4}>
          <text fg={theme.text.muted}>{t("Nothing found")}</text>
        </box>
      }
      footer={<text fg={theme.text.muted}>{BuffSkillFlow.COMMANDS_HINT}</text>}
    />
  )
}

function Commands(props: { context: Context }) {
  const { context } = props
  const rpc = context.client.rpc(BuffSkill.Rpc)
  const at = () => ({ location: context.location })
  const ui: BuffMcpFlow.Ui = {
    select: (dialog) => context.ui.dialog.select(dialog),
    prompt: (dialog) => context.ui.dialog.prompt(dialog),
    confirm: (dialog) => context.ui.dialog.confirm(dialog),
    t,
  }
  const say = (message: string, variant: "success" | "error") => context.ui.toast.show({ message, variant })
  const failed = (cause: unknown) => say(failureMessage(cause, t("Could not save.")), "error")

  const change = async (
    attached: boolean,
    flow: () => Promise<BuffSkill.Source | BuffSkillFlow.Problem | undefined>,
  ) => {
    const result = await flow()
    context.ui.dialog.clear()
    if (!result) return
    if ("problem" in result) return say(result.problem, "error")
    await rpc.attach({ ...result, attached }, at()).then(
      () =>
        say(
          t(attached ? "Attached: {source} · skills — /skills" : "Detached: {source} · skills — /skills", {
            source: result.source,
          }),
          "success",
        ),
      failed,
    )
  }

  const command = (name: string, title: string, run: () => Promise<unknown>) => ({
    id: `buff.skill.${name}`,
    title,
    group: "Buff",
    palette: true as const,
    slash: { name: `skill-${name}` },
    run: () => void run().catch(failed),
  })
  context.keymap.layer(() => ({
    mode: "global",
    commands: [
      command("attach", t("Skills: attach a directory"), () => change(true, () => BuffSkillFlow.attach(ui))),
      command("detach", t("Skills: detach a directory"), () =>
        change(false, async () => BuffSkillFlow.detach(ui, (await rpc.list(undefined, at())).sources)),
      ),
    ],
  }))
  return null
}

export default Plugin.define({
  id: "buff.skill",
  setup(context) {
    // Слой команд работает только в компоненте, отрисованном в слоте приложения.
    context.ui.slot({ append: "app", render: () => <Commands context={context} /> })
  },
})

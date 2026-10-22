import { Show } from "solid-js"
import { Plugin } from "@opencode/plugin/tui"
import type { Context } from "@opencode/plugin/tui/context"
import { failureMessage } from "@opencode/schema/buff-failure"
import { BuffPermissionMode as Mode } from "@opencode/schema/buff-permission-mode"
import { t } from "./locale"

/**
 * Режим разрешений в консоли (#450): /mode (и из палитры) — сколько агенту доверяют в этой
 * сессии; текущий режим виден под полем ввода. Режим — правила сессии, слова — общие с окном.
 * План в консоли включается сменой агента (shift+tab), как и раньше.
 */

const PLAN = "plan"

function sessionOf(context: Context) {
  const route = context.ui.router.current()
  const id = route.type === "session" ? route.sessionID : undefined
  return id ? context.data.session.get(id) : undefined
}

function Commands(props: { context: Context }) {
  const { context } = props
  const choose = async () => {
    const session = sessionOf(context)
    if (!session)
      return context.ui.toast.show({
        message: t("The mode is set in a session: send a message first."),
        variant: "warning",
      })
    const plan = String(session.agent ?? "") === PLAN
    const current = Mode.modeOf(session.permissions, plan)
    const picked = await context.ui.dialog.select<Mode.Mode>({
      title: t("Permission mode"),
      options: Mode.MODES.map((mode) => ({
        title: mode.value === current ? `${t(mode.label)} ✓` : t(mode.label),
        value: mode.value,
        description: t(mode.hint),
      })),
    })
    context.ui.dialog.clear()
    if (!picked) return
    await context.client.session.update({ sessionID: session.id, permissions: Mode.rules(picked, plan) })
    context.ui.toast.show({
      message: t("Mode: {mode}", { mode: t(Mode.MODES.find((mode) => mode.value === picked)!.label) }),
      variant: "success",
    })
  }
  context.keymap.layer(() => ({
    mode: "global",
    commands: [
      {
        id: "buff.mode",
        title: t("Permission mode: ask, edit on its own, full access"),
        group: "Buff",
        palette: true as const,
        slash: { name: "mode" },
        run: () =>
          void choose().catch((cause: unknown) =>
            context.ui.toast.show({
              message: failureMessage(cause, t("Could not change the mode.")),
              variant: "error",
            }),
          ),
      },
    ],
  }))
  return null
}

function ModeLabel(props: { context: Context; sessionID: string }) {
  const label = () => {
    const session = props.context.data.session.get(props.sessionID)
    return session ? Mode.short(Mode.modeOf(session.permissions, String(session.agent ?? "") === PLAN), t) : undefined
  }
  return (
    <Show when={label()}>
      {(text) => (
        <text fg={props.context.theme.text.muted} wrapMode="none">
          {text()} · /mode
        </text>
      )}
    </Show>
  )
}

export default Plugin.define({
  id: "buff.permission-mode",
  setup(context) {
    context.ui.slot({ append: "app", render: () => <Commands context={context} /> })
    context.ui.slot({
      append: "prompt.footer.status",
      render: (input) => (
        <Show when={input.sessionID}>{(sessionID) => <ModeLabel context={context} sessionID={sessionID()} />}</Show>
      ),
    })
  },
})

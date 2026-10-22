import { createEffect, createSignal, on, onCleanup, Show } from "solid-js"
import { Plugin } from "@opencode/plugin/tui"
import type { Context } from "@opencode/plugin/tui/context"
import { BuffGoal } from "@opencode/schema/buff-goal"
import { failureMessage } from "@opencode/schema/buff-failure"
import { t } from "./locale"

/**
 * Цель сессии в консоли (#463): строка «Цель · итерация N · состояние: текст» с причиной над
 * полем ввода и команды «пауза», «продолжить», «сбросить». Ставится `/goal <текст>`.
 */

function Line(props: { context: Context; sessionID: string }) {
  const rpc = props.context.client.rpc(BuffGoal.Rpc)
  const at = () => ({ location: props.context.location })
  const [goal, setGoal] = createSignal<BuffGoal.Goal | undefined>()
  createEffect(
    on(
      () => props.sessionID,
      (session) =>
        void rpc.get({ session }, at()).then(
          (result) => setGoal(result.goal),
          () => undefined,
        ),
    ),
  )
  const stop = new AbortController()
  onCleanup(() => stop.abort())
  void (async () => {
    for await (const event of rpc.events.subscribe("changed", { signal: stop.signal }))
      if (event.data.session === props.sessionID) setGoal(event.data.goal)
  })().catch(() => undefined)
  const theme = () => props.context.theme.text
  return (
    <Show when={goal()}>
      {(value) => (
        <box paddingLeft={2} paddingRight={2} flexDirection="column">
          <text fg={value().status === "paused" ? theme().feedback.warning.base : theme().muted}>
            ◎ {BuffGoal.line(value(), t)} · {t("ctrl+p — pause, resume, reset")}
          </text>
          <Show when={value().reason}>
            <text fg={theme().muted}> {t(value().reason ?? "")}</text>
          </Show>
        </box>
      )}
    </Show>
  )
}

function Commands(props: { context: Context }) {
  const { context } = props
  const rpc = context.client.rpc(BuffGoal.Rpc)
  const at = () => ({ location: context.location })
  const session = () => {
    const route = context.ui.router.current()
    return route.type === "session" ? route.sessionID : undefined
  }
  const act = (name: "pause" | "resume" | "clear", done: string) => () => {
    const id = session()
    if (!id) return context.ui.toast.show({ message: t("Open a session with a goal."), variant: "info" })
    void rpc[name]({ session: id }, at()).then(
      () => context.ui.toast.show({ message: done, variant: "success" }),
      (cause: unknown) => context.ui.toast.show({ message: failureMessage(cause, t("Failed.")), variant: "error" }),
    )
  }
  context.keymap.layer(() => ({
    mode: "global",
    commands: [
      {
        id: "buff.goal.pause",
        title: t("Buff: goal — pause"),
        group: "Buff",
        palette: true as const,
        run: act("pause", t("The goal is paused.")),
      },
      {
        id: "buff.goal.resume",
        title: t("Buff: goal — resume"),
        group: "Buff",
        palette: true as const,
        run: act("resume", t("The goal is in progress again.")),
      },
      {
        id: "buff.goal.clear",
        title: t("Buff: goal — reset"),
        group: "Buff",
        palette: true as const,
        run: act("clear", t("The goal is reset.")),
      },
    ],
  }))
  return null
}

export default Plugin.define({
  id: "buff.goal",
  setup(context) {
    context.ui.slot({
      append: "session.composer.top",
      render: (input) => <Line context={context} sessionID={input.sessionID} />,
    })
    context.ui.slot({ append: "app", render: () => <Commands context={context} /> })
  },
})

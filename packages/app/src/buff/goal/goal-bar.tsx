import { createEffect, on, Show } from "solid-js"
import { BuffGoal } from "@opencode/schema/buff-goal"
import { Button } from "@opencode/ui/button"
import { Icon } from "@opencode/ui/icon"
import { useServerSDK } from "@/runtime/server/client"
import { showToast } from "@/shell/notifications/toast"
import { useWorkspaceLocation } from "@/workspaces/location"
import { useBuffText } from "../i18n"
import { createGoalController } from "./controller"
import "./goal-bar.css"

/**
 * Цель сессии над полем ввода (#463), как в ZCode: «Цель · итерация N · состояние: текст»,
 * причина последней проверки и кнопки «Пауза», «Продолжить», «Сбросить». Ставится `/goal`.
 */
export function BuffGoalBar(props: { session: string | undefined }) {
  const sdk = useServerSDK()
  const location = useWorkspaceLocation()
  const { t } = useBuffText()
  const rpc = sdk.api.rpc(BuffGoal.Rpc)
  const at = () => ({ location: { directory: location().directory } })
  const controller = createGoalController({
    rpc: {
      get: (input) => rpc.get(input, at()),
      pause: (input) => rpc.pause(input, at()),
      resume: (input) => rpc.resume(input, at()),
      clear: (input) => rpc.clear(input, at()),
    },
    session: () => props.session,
    subscribe: (handler) => {
      const stop = new AbortController()
      void (async () => {
        for await (const event of rpc.events.subscribe("changed", { signal: stop.signal })) handler(event.data)
      })().catch(() => undefined)
      return () => stop.abort()
    },
    notify: (text) => showToast({ title: t("Goal"), description: t(text) }),
  })
  createEffect(
    on(
      () => props.session,
      () => void controller.refresh(),
    ),
  )
  return (
    <Show when={controller.goal()}>
      {(goal) => (
        <div class="buff-goal-bar" data-component="buff-goal-bar" data-status={goal().status}>
          <div class="buff-goal-bar-line">
            <Icon name="flask" size="small" />
            <span class="buff-goal-bar-text">{BuffGoal.line(goal(), t)}</span>
            <Show when={goal().status === "active" || goal().status === "checking"}>
              <Button
                size="small"
                variant="ghost"
                data-action="buff-goal-pause"
                onClick={() => void controller.pause()}
              >
                {t("Pause")}
              </Button>
            </Show>
            <Show when={goal().status === "paused"}>
              <Button
                size="small"
                variant="ghost"
                data-action="buff-goal-resume"
                onClick={() => void controller.resume()}
              >
                {t("Resume")}
              </Button>
            </Show>
            <Button size="small" variant="ghost" data-action="buff-goal-clear" onClick={() => void controller.clear()}>
              {t("Reset")}
            </Button>
          </div>
          <Show when={goal().reason}>
            {(reason) => <span class="buff-goal-bar-reason">{t(reason())}</span>}
          </Show>
        </div>
      )}
    </Show>
  )
}

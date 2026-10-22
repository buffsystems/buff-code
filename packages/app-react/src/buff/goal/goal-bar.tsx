// A session's goal above the prompt (#463), like ZCode: «Goal · iteration N · state: text», the
// reason of the last check and Pause / Resume / Reset. It is set with `/goal`. Ported from the
// Solid window's buff/goal/goal-bar.tsx; the session composer mounts it for its session.

import { Button } from "@buff/ui/react"
import { BuffGoal } from "@opencode/schema/buff-goal"
import { FlaskConical } from "lucide-react"
import { useEffect, useMemo } from "react"
import type { Server } from "../../core/servers"
import { useI18n } from "../../i18n/provider"
import { useConnection } from "../../react/core"
import { useStore } from "../../react/use-store"
import { showToast } from "../../shell/notifications/toast"
import { createGoalController } from "./controller"
import "../bar.css"

export function BuffGoalBar(props: { server: Server; directory: string; sessionID: string }) {
  const t = useI18n().buff.t
  const connected = useConnection(props.server).status === "connected"
  const controller = useMemo(() => {
    const rpc = props.server.api().rpc(BuffGoal.Rpc)
    const at = { location: { directory: props.directory } }
    return createGoalController({
      rpc: {
        get: (input) => rpc.get(input, at),
        pause: (input) => rpc.pause(input, at),
        resume: (input) => rpc.resume(input, at),
        clear: (input) => rpc.clear(input, at),
      },
      session: props.sessionID,
      subscribe: (handler) => rpc.events.on("changed", (event) => handler(event.data)),
      notify: (text) => showToast({ title: t("Goal"), description: t(text) }),
    })
  }, [props.server, props.directory, props.sessionID, t])
  useEffect(() => {
    if (!connected) return
    void controller.refresh()
    return controller.start()
  }, [controller, connected])
  const goal = useStore(controller.store, (value) => value)
  if (!goal) return null
  const running = goal.status === "active" || goal.status === "checking"
  return (
    <div className="buff-bar buff-bar--stacked" data-component="buff-goal-bar" data-status={goal.status}>
      <div className="buff-bar__line">
        <FlaskConical aria-hidden className="buff-bar__icon" />
        <span className="buff-bar__text buff-goal__text">{BuffGoal.line(goal, t)}</span>
        {running && (
          <Button size="sm" variant="ghost" data-action="buff-goal-pause" onClick={() => void controller.pause()}>
            {t("Pause")}
          </Button>
        )}
        {goal.status === "paused" && (
          <Button size="sm" variant="ghost" data-action="buff-goal-resume" onClick={() => void controller.resume()}>
            {t("Resume")}
          </Button>
        )}
        <Button size="sm" variant="ghost" data-action="buff-goal-clear" onClick={() => void controller.clear()}>
          {t("Reset")}
        </Button>
      </div>
      {goal.reason && <span className="buff-bar__reason">{t(goal.reason)}</span>}
    </div>
  )
}

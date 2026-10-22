import { createResource, For, Show } from "solid-js"
import { BuffAutomation } from "@opencode/schema/buff-automation"
import { BuffBackground } from "@opencode/schema/buff-background"
import { Button } from "@opencode/ui/button"
import { useDialog } from "@opencode/ui/context/dialog"
import { Dialog, DialogBody, DialogHeader, DialogTitle } from "@opencode/ui/dialog"
import { useBuffText } from "../i18n"
import type { AutomationsController } from "./controller"

/**
 * История запусков автоматизации (#447): когда, по расписанию или вручную, чем кончился —
 * сбой с причиной, «остановлен», пропуски — сколько шёл, и переход в сессию запуска.
 */

const when = (ms: number, locale: string) =>
  new Date(ms).toLocaleString(locale === "ru" ? "ru-RU" : "en-GB", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  })

export function RunHistory(props: {
  automation: BuffAutomation.Automation
  controller: AutomationsController
  onOpenSession: (session: string) => void
}) {
  const dialog = useDialog()
  const { t, n, locale } = useBuffText()
  const [runs, { refetch }] = createResource(() => props.controller.runs(props.automation.id), { initialValue: [] })
  const remove = (run: string) => void props.controller.removeRun(props.automation.id, run).then(() => refetch())

  return (
    <Dialog size="large" containerClass="buff-dialog-fit">
      <DialogHeader>
        <DialogTitle>{t("History: {title}", { title: props.automation.title })}</DialogTitle>
      </DialogHeader>
      <DialogBody>
        <div class="buff-auto-history" data-component="buff-automation-history">
          <Show when={runs().length} fallback={<span class="buff-auto-empty">{t("No automation runs yet.")}</span>}>
            <For each={runs()}>
              {(run) => (
                <div class="buff-auto-run" data-status={run.status}>
                  <span class="buff-auto-run-when">{when(run.due, locale())}</span>
                  <span class="buff-auto-run-meta">
                    {[
                      run.source === "manual" ? t("manually") : t("on schedule"),
                      run.status === "skipped"
                        ? undefined
                        : BuffBackground.since(run.started, run.finished ?? Date.now(), t),
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                  <span class="buff-auto-run-status" data-slot="buff-auto-run-status">
                    {BuffAutomation.runLabel(run, t, n)}
                  </span>
                  <span class="buff-auto-run-actions">
                    <Show when={run.session}>
                      {(session) => (
                        <Button
                          size="small"
                          variant="ghost"
                          data-action="buff-auto-run-open"
                          onClick={() => {
                            dialog.close()
                            props.onOpenSession(session())
                          }}
                        >
                          {t("Open session")}
                        </Button>
                      )}
                    </Show>
                    <Button
                      size="small"
                      variant="ghost"
                      data-action="buff-auto-run-remove"
                      onClick={() => remove(run.id)}
                    >
                      {t("Delete record")}
                    </Button>
                  </span>
                </div>
              )}
            </For>
          </Show>
        </div>
      </DialogBody>
    </Dialog>
  )
}

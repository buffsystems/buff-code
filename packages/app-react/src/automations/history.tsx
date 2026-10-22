// An automation's run history (#447), ported from the Solid window's buff/automations/history.tsx:
// when, on schedule or by hand, how it ended — a failure with its reason, «stopped», skips — how
// long it went, and the run's session.

import { Button, Dialog, DialogBody, EmptyState } from "@buff/ui/react"
import { BuffAutomation } from "@opencode/schema/buff-automation"
import { BuffBackground } from "@opencode/schema/buff-background"
import { useQuery } from "@tanstack/react-query"
import { useI18n } from "../i18n/provider"
import type { AutomationsController } from "./controller"

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
  onClose: () => void
  onOpenSession: (session: string) => void
}) {
  const i18n = useI18n()
  const { t, n } = i18n.buff
  const runs = useQuery({
    queryKey: ["buff-automation-runs", props.automation.id],
    queryFn: () => props.controller.runs(props.automation.id),
    gcTime: 0,
  })
  const remove = (run: string) => void props.controller.removeRun(props.automation.id, run).then(() => runs.refetch())

  return (
    <Dialog
      open
      size="lg"
      onOpenChange={(open) => !open && props.onClose()}
      title={t("History: {title}", { title: props.automation.title })}
      closeLabel={t("Close")}
    >
      <DialogBody>
        <div data-component="buff-automation-history">
          {runs.data && !runs.data.length && <EmptyState inline>{t("No automation runs yet.")}</EmptyState>}
          {runs.data?.map((run) => (
            <div key={run.id} className="buff-auto-run" data-status={run.status}>
              <span className="buff-auto-run-when ui-num">{when(run.due, i18n.locale)}</span>
              <span className="buff-auto-run-meta ui-num">
                {[
                  run.source === "manual" ? t("manually") : t("on schedule"),
                  run.status === "skipped"
                    ? undefined
                    : BuffBackground.since(run.started, run.finished ?? Date.now(), t),
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
              <span className="buff-auto-run-status" data-slot="buff-auto-run-status">
                {BuffAutomation.runLabel(run, t, n)}
              </span>
              <span className="buff-auto-run-actions">
                {run.session && (
                  <Button
                    size="sm"
                    variant="ghost"
                    data-action="buff-auto-run-open"
                    onClick={() => {
                      props.onClose()
                      if (run.session) props.onOpenSession(run.session)
                    }}
                  >
                    {t("Open session")}
                  </Button>
                )}
                <Button size="sm" variant="ghost" data-action="buff-auto-run-remove" onClick={() => remove(run.id)}>
                  {t("Delete record")}
                </Button>
              </span>
            </div>
          ))}
        </div>
      </DialogBody>
    </Dialog>
  )
}

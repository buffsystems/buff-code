// The automation editor (#447), ported from the Solid window's buff/automations/editor.tsx: the
// name, a schedule without cron — kind, time, days — summed up in words with the next run, the
// task for the agent, the project, the permissions mode and the model. A mistake in the schedule
// shows at once and cannot be saved.

import {
  Button,
  Chip,
  ChipRow,
  Dialog,
  DialogBody,
  DialogFooter,
  Field,
  Input,
  Segmented,
  SelectMenu,
  Textarea,
} from "@buff/ui/react"
import { draftOf, formOf, scheduleOf, type Form } from "@opencode/app/react-reuse/automation-editor-state"
import { BuffAutomation } from "@opencode/schema/buff-automation"
import { BuffPermissionMode } from "@opencode/schema/buff-permission-mode"
import { BuffSchedule } from "@opencode/schema/buff-schedule"
import { useEffect, useState } from "react"
import { locationKey } from "../core/data/state"
import type { Server } from "../core/servers"
import { useI18n } from "../i18n/provider"
import { useServerData } from "../react/core"

const UNITS = ["minutes", "hours"] as const
// Not empty: the select reads an empty value as «nothing chosen».
const DEFAULT_MODEL = "default"

export function AutomationEditor(props: {
  server: Server
  automation?: BuffAutomation.Automation
  directories: readonly string[]
  onClose: () => void
  onSave: (draft: BuffAutomation.Draft) => Promise<string | undefined>
}) {
  const i18n = useI18n()
  const { t, n } = i18n.buff
  const [form, setForm] = useState<Form>(() => formOf(props.automation, props.directories[0] ?? ""))
  const [problem, setProblem] = useState<string>()
  const [saving, setSaving] = useState(false)
  const models = useModels(props.server, form.directory)
  const edit = (patch: Partial<Form>) => setForm((current) => ({ ...current, ...patch }))
  const schedule = scheduleOf(form)
  const trouble = BuffSchedule.problem(schedule, t)
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone
  const next = (() => {
    if (trouble) return undefined
    const now = new Date()
    // The schedule did not change: the service set the date; a new one counts from saving.
    const kept = props.automation && JSON.stringify(props.automation.schedule) === JSON.stringify(schedule)
    return BuffSchedule.nextLabel(
      kept && props.automation ? new Date(props.automation.next) : BuffSchedule.next(schedule, now, now),
      now,
      t,
    )
  })()
  const projects = [...new Set([...props.directories, form.directory].filter(Boolean))]
  const number = (value: string) => (value.trim() === "" ? Number.NaN : Number(value))
  const toggleDay = (day: number) =>
    edit({ days: form.days.includes(day) ? form.days.filter((item) => item !== day) : [...form.days, day] })
  const mode = BuffPermissionMode.MODES.find((item) => item.value === form.mode)

  const save = async () => {
    const draft = draftOf(form)
    const local = BuffAutomation.draftProblem(draft, t)
    if (local) return setProblem(local)
    setSaving(true)
    const refusal = await props.onSave(draft)
    setSaving(false)
    if (refusal) return setProblem(refusal)
    props.onClose()
  }

  return (
    <Dialog
      open
      size="lg"
      onOpenChange={(open) => !open && props.onClose()}
      title={props.automation ? t("Edit automation") : t("New automation")}
      closeLabel={t("Close")}
    >
      <DialogBody>
        <div className="flex flex-col gap-4" data-component="buff-automation-editor">
          <Field label={t("Name")}>
            <Input
              value={form.title}
              placeholder={t("Morning commit report")}
              onChange={(event) => edit({ title: event.currentTarget.value })}
            />
          </Field>
          <Field
            label={t("Schedule")}
            group
            hint={t(
              "Local time ({zone}). The Buff Code service on this machine runs it — even with the window closed.",
              { zone },
            )}
          >
            <Segmented
              size="sm"
              value={form.kind}
              options={BuffSchedule.KINDS.map((kind) => ({ id: kind.value, label: t(kind.label) }))}
              onChange={(kind) => edit({ kind })}
            />
            <div className="buff-auto-schedule" data-kind={form.kind}>
              {(form.kind === "interval" || form.kind === "weeks") && (
                <label className="buff-auto-inline">
                  {form.kind === "weeks" ? t("Once every") : t("Every")}
                  <Input
                    compact
                    className="buff-auto-number"
                    data-field="every"
                    type="number"
                    min={1}
                    max={BuffSchedule.MAX_EVERY}
                    value={Number.isNaN(form.every) ? "" : form.every}
                    onChange={(event) => edit({ every: number(event.currentTarget.value) })}
                  />
                  {form.kind === "weeks" ? (
                    n(form.every, "week|weeks")
                  ) : (
                    <Segmented
                      size="sm"
                      value={form.unit}
                      options={UNITS.map((unit) => ({ id: unit, label: t(unit) }))}
                      onChange={(unit) => edit({ unit })}
                    />
                  )}
                </label>
              )}
              {(form.kind === "weekly" || form.kind === "weeks") && (
                <ChipRow label={t("Days")}>
                  {BuffSchedule.DAYS.map((day) => (
                    <Chip
                      key={day.value}
                      size="sm"
                      pressed={form.days.includes(day.value)}
                      onClick={() => toggleDay(day.value)}
                    >
                      {t(day.label)}
                    </Chip>
                  ))}
                </ChipRow>
              )}
              {form.kind === "monthly" && (
                <label className="buff-auto-inline">
                  {t("Day of the month")}
                  <Input
                    compact
                    className="buff-auto-number"
                    data-field="day"
                    type="number"
                    min={1}
                    max={31}
                    value={Number.isNaN(form.day) ? "" : form.day}
                    onChange={(event) => edit({ day: number(event.currentTarget.value) })}
                  />
                </label>
              )}
              {form.kind !== "interval" && (
                <label className="buff-auto-inline">
                  {t("Time")}
                  {/* Text HH:MM: the system time input shows a 12-hour clock in some locales. */}
                  <Input
                    compact
                    className="buff-auto-time"
                    data-field="at"
                    type="text"
                    inputMode="numeric"
                    maxLength={5}
                    placeholder="09:00"
                    value={form.at}
                    onChange={(event) => edit({ at: event.currentTarget.value })}
                  />
                </label>
              )}
            </div>
            {trouble ? (
              <span className="ui-error" role="alert">
                {trouble}
              </span>
            ) : (
              <span className="ui-title ui-title--sm" data-slot="buff-auto-summary">
                {t("{schedule} · next run — {next}", {
                  schedule: BuffSchedule.summary(schedule, t, n),
                  next: next ?? "",
                })}
              </span>
            )}
          </Field>
          <Field
            label={t("What the agent should do")}
            hint={t("Each run is a new session: the agent does not see past conversations, write the whole task.")}
          >
            <Textarea
              rows={4}
              value={form.prompt}
              placeholder={t("Summarize yesterday's commits and write it to REPORT.md")}
              onChange={(event) => edit({ prompt: event.currentTarget.value })}
            />
          </Field>
          <Field label={t("Project")} group>
            <SelectMenu
              aria-label={t("Project")}
              value={form.directory || undefined}
              options={projects.map((directory) => ({ value: directory, label: directory }))}
              onValueChange={(directory) => edit({ directory })}
            />
          </Field>
          <Field
            label={t("Permissions in a run")}
            group
            hint={`${t(mode?.hint ?? "")} ${t("If a run asks anyway, it will wait for your answer in the session.")}`}
          >
            <Segmented
              size="sm"
              value={form.mode}
              options={BuffPermissionMode.MODES.map((item) => ({ id: item.value, label: t(item.label) }))}
              onChange={(value) => edit({ mode: value })}
            />
          </Field>
          <Field label={t("Model")} group>
            <SelectMenu
              aria-label={t("Model")}
              value={form.model || DEFAULT_MODEL}
              options={[{ value: DEFAULT_MODEL, label: t("Project default") }, ...models]}
              onValueChange={(value) => edit({ model: value === DEFAULT_MODEL ? "" : value })}
            />
          </Field>
          {problem && (
            <p className="ui-error" role="alert">
              {problem}
            </p>
          )}
        </div>
      </DialogBody>
      <DialogFooter>
        <Button onClick={props.onClose}>{t("Cancel")}</Button>
        <Button variant="primary" loading={saving} data-action="buff-automation-save" onClick={() => void save()}>
          {t("Save")}
        </Button>
      </DialogFooter>
    </Dialog>
  )
}

/** The enabled models of the project's catalog, «provider · model». */
function useModels(server: Server, directory: string) {
  const location = { directory }
  const key = locationKey(location)
  const models = useServerData(server, (state) => state.location[key]?.model)
  const providers = useServerData(server, (state) => state.location[key]?.provider)
  useEffect(() => {
    if (!directory) return
    void server.data.location.model.sync({ directory }).catch(() => undefined)
    void server.data.location.provider.sync({ directory }).catch(() => undefined)
  }, [server, directory])
  return (models ?? [])
    .filter((model) => model.enabled)
    .map((model) => ({
      value: `${model.providerID}/${model.id}`,
      label: `${providers?.find((provider) => provider.id === model.providerID)?.name ?? model.providerID} · ${model.name}`,
    }))
}

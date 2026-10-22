import { createMemo, createSignal, For, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { BuffAutomation } from "@opencode/schema/buff-automation"
import { BuffPermissionMode } from "@opencode/schema/buff-permission-mode"
import { BuffSchedule } from "@opencode/schema/buff-schedule"
import { Button } from "@opencode/ui/button"
import { useDialog } from "@opencode/ui/context/dialog"
import { Dialog, DialogBody, DialogFooter, DialogHeader, DialogTitle } from "@opencode/ui/dialog"
import { Select } from "@opencode/ui/select"
import { TextField } from "@opencode/ui/text-field"
import { useProviders } from "@/providers/catalog/providers"
import { useBuffText } from "../i18n"
import { Choice, FormBody, Hint, Problem } from "../settings-kit"
import { draftOf, formOf, scheduleOf, type Form } from "./editor-state"

/**
 * Редактор автоматизации (#447): название, расписание без cron — вид, время, дни — со сводкой
 * словами и следующим запуском, задача агенту, проект, режим разрешений и модель. Ошибку в
 * расписании видно сразу, сохранить с ней нельзя.
 */

const UNITS = [
  { value: "minutes", label: "minutes" },
  { value: "hours", label: "hours" },
] as const
// Не пустое значение: выбор считает пустое «ничего не выбрано» и не показывает подпись.
const DEFAULT_MODEL = { value: "default", label: "Project default" }

export function AutomationEditor(props: {
  automation?: BuffAutomation.Automation
  directories: readonly string[]
  onSave: (draft: BuffAutomation.Draft) => Promise<string | undefined>
}) {
  const dialog = useDialog()
  const { t, n } = useBuffText()
  const kinds = () => BuffSchedule.KINDS.map((kind) => ({ value: kind.value, label: t(kind.label) }))
  const units = () => UNITS.map((unit) => ({ value: unit.value, label: t(unit.label) }))
  const modes = () => BuffPermissionMode.MODES.map((mode) => ({ value: mode.value, label: t(mode.label) }))
  const [form, setForm] = createStore<Form>(formOf(props.automation, props.directories[0] ?? ""))
  const [problem, setProblem] = createSignal<string>()
  const providers = useProviders(() => form.directory || undefined)
  const schedule = () => scheduleOf(form)
  const trouble = () => BuffSchedule.problem(schedule(), t)
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone
  const next = createMemo(() => {
    if (trouble()) return undefined
    const now = new Date()
    // Расписание не меняли — срок уже назначен службой; новое считается от сохранения.
    const kept = props.automation && JSON.stringify(props.automation.schedule) === JSON.stringify(schedule())
    return BuffSchedule.nextLabel(
      kept ? new Date(props.automation!.next) : BuffSchedule.next(schedule(), now, now),
      now,
      t,
    )
  })
  const models = createMemo(() => [
    DEFAULT_MODEL,
    ...providers.connected().flatMap((provider) =>
      Object.values(provider.models).map((model) => ({
        value: `${provider.id}/${model.id}`,
        label: `${provider.name} · ${model.name}`,
      })),
    ),
  ])
  const projects = createMemo(() => [...new Set([...props.directories, form.directory].filter(Boolean))])
  const toggleDay = (day: number) =>
    setForm("days", (days) => (days.includes(day) ? days.filter((item) => item !== day) : [...days, day]))
  const number = (value: string) => (value.trim() === "" ? Number.NaN : Number(value))

  const save = async () => {
    const draft = draftOf(form)
    const local = BuffAutomation.draftProblem(draft, t)
    if (local) return setProblem(local)
    const refusal = await props.onSave(draft)
    if (refusal) return setProblem(refusal)
    dialog.close()
  }

  return (
    <Dialog size="large">
      <DialogHeader>
        <DialogTitle>{props.automation ? t("Edit automation") : t("New automation")}</DialogTitle>
      </DialogHeader>
      <DialogBody>
        <FormBody name="buff-automation-editor">
          <TextField
            label={t("Name")}
            placeholder={t("Morning commit report")}
            value={form.title}
            onChange={(value) => setForm("title", value)}
          />
          <div class="buff-auto-field">
            <span class="buff-auto-label">{t("Schedule")}</span>
            <Choice value={form.kind} options={kinds()} onPick={(kind) => setForm("kind", kind)} />
            <div class="buff-auto-schedule" data-kind={form.kind}>
              <Show when={form.kind === "interval" || form.kind === "weeks"}>
                <label class="buff-auto-inline">
                  {form.kind === "weeks" ? t("Once every") : t("Every")}
                  <input
                    class="buff-auto-input"
                    data-field="every"
                    type="number"
                    min="1"
                    max={BuffSchedule.MAX_EVERY}
                    value={Number.isNaN(form.every) ? "" : form.every}
                    onInput={(event) => setForm("every", number(event.currentTarget.value))}
                  />
                  <Show
                    when={form.kind === "weeks"}
                    fallback={<Choice value={form.unit} options={units()} onPick={(unit) => setForm("unit", unit)} />}
                  >
                    {n(form.every, "week|weeks")}
                  </Show>
                </label>
              </Show>
              <Show when={form.kind === "weekly" || form.kind === "weeks"}>
                <div class="buff-auto-days">
                  <For each={BuffSchedule.DAYS}>
                    {(day) => (
                      <button
                        type="button"
                        class="buff-kit-choice-item"
                        data-day={day.value}
                        data-active={form.days.includes(day.value)}
                        onClick={() => toggleDay(day.value)}
                      >
                        {t(day.label)}
                      </button>
                    )}
                  </For>
                </div>
              </Show>
              <Show when={form.kind === "monthly"}>
                <label class="buff-auto-inline">
                  {t("Day of the month")}
                  <input
                    class="buff-auto-input"
                    data-field="day"
                    type="number"
                    min="1"
                    max="31"
                    value={Number.isNaN(form.day) ? "" : form.day}
                    onInput={(event) => setForm("day", number(event.currentTarget.value))}
                  />
                </label>
              </Show>
              <Show when={form.kind !== "interval"}>
                <label class="buff-auto-inline">
                  {t("Time")}
                  {/* Текстом ЧЧ:ММ: системный ввод времени показывает 12-часовой формат по локали. */}
                  <input
                    class="buff-auto-input"
                    data-field="at"
                    type="text"
                    inputmode="numeric"
                    maxLength={5}
                    placeholder="09:00"
                    value={form.at}
                    onInput={(event) => setForm("at", event.currentTarget.value)}
                  />
                </label>
              </Show>
            </div>
            <Show when={!trouble()} fallback={<Problem text={trouble()} />}>
              <div class="buff-auto-summary" data-slot="buff-auto-summary">
                {t("{schedule} · next run — {next}", {
                  schedule: BuffSchedule.summary(schedule(), t, n),
                  next: next() ?? "",
                })}
              </div>
            </Show>
            <Hint>
              {t("Local time ({zone}). The Buff Code service on this machine runs it — even with the window closed.", {
                zone,
              })}
            </Hint>
          </div>
          <TextField
            label={t("What the agent should do")}
            placeholder={t("Summarize yesterday's commits and write it to REPORT.md")}
            multiline
            value={form.prompt}
            onChange={(value) => setForm("prompt", value)}
          />
          <Hint>
            {t("Each run is a new session: the agent does not see past conversations, write the whole task.")}
          </Hint>
          <div class="buff-auto-field">
            <span class="buff-auto-label">{t("Project")}</span>
            <Select
              data-action="buff-automation-project"
              options={projects()}
              current={form.directory}
              value={(item) => item}
              label={(item) => item}
              onSelect={(item) => item && setForm("directory", item)}
            />
          </div>
          <div class="buff-auto-field">
            <span class="buff-auto-label">{t("Permissions in a run")}</span>
            <Choice value={form.mode} options={modes()} onPick={(mode) => setForm("mode", mode)} />
            <Hint>
              {t(BuffPermissionMode.MODES.find((mode) => mode.value === form.mode)?.hint ?? "")}{" "}
              {t("If a run asks anyway, it will wait for your answer in the session.")}
            </Hint>
          </div>
          <div class="buff-auto-field">
            <span class="buff-auto-label">{t("Model")}</span>
            <Select
              data-action="buff-automation-model"
              options={models()}
              current={models().find((item) => item !== DEFAULT_MODEL && item.value === form.model) ?? DEFAULT_MODEL}
              value={(item) => item.value}
              label={(item) => (item === DEFAULT_MODEL ? t(item.label) : item.label)}
              onSelect={(item) => item && setForm("model", item === DEFAULT_MODEL ? "" : item.value)}
            />
          </div>
          <Problem text={problem()} />
        </FormBody>
      </DialogBody>
      <DialogFooter>
        <Button variant="neutral" onClick={() => dialog.close()}>
          {t("Cancel")}
        </Button>
        <Button variant="contrast" data-action="buff-automation-save" onClick={() => void save()}>
          {t("Save")}
        </Button>
      </DialogFooter>
    </Dialog>
  )
}

import { BuffAutomation } from "@opencode/schema/buff-automation"
import type { BuffSchedule } from "@opencode/schema/buff-schedule"

/**
 * Форма редактора автоматизации (#447). Поля всех пяти видов расписания живут в одной форме:
 * человек переключает вид — время, дни и интервал остаются, какими он их ввёл.
 */

export interface Form {
  title: string
  prompt: string
  directory: string
  mode: BuffAutomation.Draft["mode"]
  /** «провайдер/модель»; пусто — модель проекта по умолчанию. */
  model: string
  kind: BuffSchedule.Schedule["kind"]
  every: number
  unit: "minutes" | "hours"
  at: string
  days: number[]
  day: number
}

type ModelRef = NonNullable<BuffAutomation.Draft["model"]>

export const modelKey = (model: ModelRef) => `${model.providerID}/${model.id}`

const BLANK: Form = {
  title: "",
  prompt: "",
  directory: "",
  mode: BuffAutomation.DEFAULT_MODE,
  model: "",
  kind: "daily",
  every: 1,
  unit: "hours",
  at: "09:00",
  days: [1],
  day: 1,
}

export function formOf(draft: BuffAutomation.Draft | undefined, directory: string): Form {
  if (!draft) return { ...BLANK, directory }
  const schedule = draft.schedule
  return {
    ...BLANK,
    title: draft.title,
    prompt: draft.prompt,
    directory: draft.directory,
    mode: draft.mode,
    model: draft.model ? modelKey(draft.model) : "",
    kind: schedule.kind,
    ...("every" in schedule ? { every: schedule.every } : {}),
    ...("unit" in schedule ? { unit: schedule.unit } : {}),
    ...("at" in schedule ? { at: schedule.at } : {}),
    ...("days" in schedule ? { days: [...schedule.days] } : {}),
    ...("day" in schedule ? { day: schedule.day } : {}),
  }
}

export function scheduleOf(form: Form): BuffSchedule.Schedule {
  switch (form.kind) {
    case "interval":
      return { kind: "interval", every: form.every, unit: form.unit }
    case "daily":
      return { kind: "daily", at: form.at }
    case "weekly":
      return { kind: "weekly", days: form.days, at: form.at }
    case "weeks":
      return { kind: "weeks", every: form.every, days: form.days, at: form.at }
    case "monthly":
      return { kind: "monthly", day: form.day, at: form.at }
  }
}

function modelOf(key: string): ModelRef | undefined {
  const slash = key.indexOf("/")
  return slash > 0 ? { providerID: key.slice(0, slash), id: key.slice(slash + 1) } : undefined
}

export function draftOf(form: Form): BuffAutomation.Draft {
  const model = modelOf(form.model)
  return {
    title: form.title,
    prompt: form.prompt,
    schedule: scheduleOf(form),
    directory: form.directory,
    mode: form.mode,
    ...(model ? { model } : {}),
  }
}

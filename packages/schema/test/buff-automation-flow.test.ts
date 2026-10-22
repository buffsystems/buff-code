// Автоматизации в консоли (#447): создание и правка по шагам, список, действия, история.
import { describe, expect, test } from "bun:test"
import type { BuffAutomation } from "../src/buff-automation.js"
import { BuffAutomationFlow } from "../src/buff-automation-flow.js"
import { BuffI18n } from "../src/buff-i18n.js"

const ru: BuffI18n.T = (text, params) => BuffI18n.t("ru", text, params)
const ruN: BuffI18n.N = (count, forms, params) => BuffI18n.n("ru", count, forms, params)
const words = { t: ru, n: ruN }

/** Интерфейс-заглушка: отвечает по очереди, запоминает, о чём спросили. */
function scripted(answers: unknown[]) {
  const asked: string[] = []
  const take = (title: string) => {
    asked.push(title)
    return Promise.resolve(answers.shift() as never)
  }
  return {
    asked,
    ui: {
      select: (dialog: { title: string }) => take(dialog.title),
      prompt: (dialog: { title: string }) => take(dialog.title),
      confirm: (dialog: { title: string }) => take(dialog.title),
    },
  }
}

const automation: BuffAutomation.Automation = {
  id: "a1",
  title: "Отчёт",
  prompt: "Сводка",
  schedule: { kind: "weekly", days: [1, 4], at: "09:00" },
  directory: "/p",
  mode: "edit",
  paused: false,
  created: 0,
  anchor: 0,
  next: new Date("2026-10-08T09:00:00").getTime(),
  count: 3,
}

describe("days typed in the console", () => {
  test("short names, commas, the word «будни» or «выходные»", () => {
    expect(BuffAutomationFlow.parseDays("пн чт", ru)).toEqual([1, 4])
    expect(BuffAutomationFlow.parseDays("Пн, ср, пт", ru)).toEqual([1, 3, 5])
    expect(BuffAutomationFlow.parseDays("будни", ru)).toEqual([1, 2, 3, 4, 5])
    expect(BuffAutomationFlow.parseDays("выходные", ru)).toEqual([6, 0])
    expect(BuffAutomationFlow.parseDays("пн xx", ru)).toBeUndefined()
  })
  test("English names and words too — the console may be in English", () => {
    expect(BuffAutomationFlow.parseDays("Mon thu")).toEqual([1, 4])
    expect(BuffAutomationFlow.parseDays("weekends")).toEqual([6, 0])
    expect(BuffAutomationFlow.parseDays("weekdays", ru)).toEqual([1, 2, 3, 4, 5])
    expect(BuffAutomationFlow.daysText([1, 4])).toBe("Mon Thu")
  })
  test("and back", () => {
    expect(BuffAutomationFlow.daysText([1, 4], ru)).toBe("пн чт")
  })
})

describe("creating step by step", () => {
  test("daily — title, task, kind, time, permissions", async () => {
    const { ui, asked } = scripted(["Утро", "Проверь сборку", "daily", "07:30", "full"])
    expect(await BuffAutomationFlow.draft(ui, undefined, "/p", words)).toEqual({
      title: "Утро",
      prompt: "Проверь сборку",
      schedule: { kind: "daily", at: "07:30" },
      directory: "/p",
      mode: "full",
    })
    expect(asked).toEqual(["Название", "Что сделать агенту", "Расписание", "Время (ЧЧ:ММ)", "Разрешения в запуске"])
  })
  test("every N weeks — interval and days are asked too", async () => {
    const { ui } = scripted(["Раз в две", "Задача", "weeks", "2", "пн чт", "09:00", "edit"])
    expect((await BuffAutomationFlow.draft(ui, undefined, "/p", words)) as BuffAutomation.Draft).toMatchObject({
      schedule: { kind: "weeks", every: 2, days: [1, 4], at: "09:00" },
    })
  })
  test("every N hours", async () => {
    const { ui } = scripted(["Часто", "Задача", "interval", "3", "hours", "ask"])
    expect((await BuffAutomationFlow.draft(ui, undefined, "/p", words)) as BuffAutomation.Draft).toMatchObject({
      schedule: { kind: "interval", every: 3, unit: "hours" },
    })
  })
  test("a broken answer stops with the reason", async () => {
    const { ui } = scripted(["Утро", "Задача", "daily", "25:00", "edit"])
    expect(await BuffAutomationFlow.draft(ui, undefined, "/p", words)).toEqual({
      problem: "Время — в виде ЧЧ:ММ, например 09:00.",
    })
    const days = scripted(["Утро", "Задача", "weekly", "пн xx"])
    expect(await BuffAutomationFlow.draft(days.ui, undefined, "/p", words)).toEqual({
      problem: "Дни — сокращениями через пробел: пн вт ср чт пт сб вс, или «будни», «выходные».",
    })
  })
  test("cancelled — nothing", async () => {
    const { ui } = scripted(["Утро", undefined])
    expect(await BuffAutomationFlow.draft(ui, undefined, "/p", words)).toBeUndefined()
  })
  test("editing keeps the project and the model", async () => {
    const { ui } = scripted(["Отчёт", "Сводка", "weekly", "пн чт", "10:00", "edit"])
    const edited = await BuffAutomationFlow.draft(
      ui,
      { ...automation, model: { id: "m", providerID: "buff" } },
      "/other",
      words,
    )
    expect(edited).toMatchObject({ directory: "/p", model: { id: "m", providerID: "buff" } })
  })
})

describe("the list and its actions", () => {
  const now = new Date("2026-10-05T10:00:00")
  test("a row says what and where; when — on the right; the last outcome — in the actions title", () => {
    const failed = {
      ...automation,
      last: {
        id: "r",
        automation: "a1",
        due: 0,
        started: 0,
        status: "failed" as const,
        source: "schedule" as const,
        error: "нет денег",
      },
    }
    expect(BuffAutomationFlow.row(failed, now, words)).toEqual({
      title: "Отчёт",
      description: "По пн и чт в 09:00 · p",
      footer: "чт 08.10 в 09:00",
      value: "a1",
    })
    expect(BuffAutomationFlow.row({ ...automation, paused: true }, now, words).footer).toBe("на паузе")
    expect(BuffAutomationFlow.actionsTitle(failed, words)).toBe("Отчёт · запусков: 3 · последний: Сбой: нет денег")
    expect(BuffAutomationFlow.actionsTitle(automation, words)).toBe("Отчёт · запусков: 3")
  })
  test("actions follow the state", () => {
    const values = (item: BuffAutomation.Automation) => BuffAutomationFlow.actions(item).map((action) => action.value)
    expect(values(automation)).toEqual(["run", "pause", "edit", "history", "remove"])
    const going = {
      ...automation,
      paused: true,
      last: {
        id: "r",
        automation: "a1",
        due: 0,
        started: 0,
        status: "waiting" as const,
        source: "manual" as const,
        session: "ses_1",
      },
    }
    expect(values(going)).toEqual(["stop", "open", "resume", "edit", "history", "remove"])
  })
  test("history rows", () => {
    const run: BuffAutomation.Run = {
      id: "r",
      automation: "a1",
      due: new Date("2026-10-05T09:00:00").getTime(),
      started: new Date("2026-10-05T09:00:00").getTime(),
      finished: new Date("2026-10-05T09:03:05").getTime(),
      status: "stopped",
      source: "schedule",
      session: "ses_1",
    }
    expect(BuffAutomationFlow.historyRow(run, now, words)).toEqual({
      title: "05.10 09:00 · по расписанию",
      description: "Остановлен",
      footer: "3 мин 05 с",
      value: "r",
    })
    expect(BuffAutomationFlow.historyRow({ ...run, status: "skipped", skipped: 2 }, now, words).footer).toBeUndefined()
  })
})

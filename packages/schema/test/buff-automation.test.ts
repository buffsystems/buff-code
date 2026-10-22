// Автоматизации (#447): запуск в истории словами; сбой виден, остановленный — не успех.
import { describe, expect, test } from "bun:test"
import { BuffAutomation } from "../src/buff-automation.js"
import { BuffI18n } from "../src/buff-i18n.js"

const ru: BuffI18n.T = (text, params) => BuffI18n.t("ru", text, params)
const ruN: BuffI18n.N = (count, forms, params) => BuffI18n.n("ru", count, forms, params)

describe("a run's outcome in words", () => {
  test("a stopped run is not a success; a failure carries its reason", () => {
    expect(BuffAutomation.runLabel({ status: "stopped" }, ru, ruN)).toBe("Остановлен")
    expect(BuffAutomation.runLabel({ status: "failed", error: "Средства закончились" }, ru, ruN)).toBe(
      "Сбой: Средства закончились",
    )
    expect(BuffAutomation.runLabel({ status: "failed" }, ru, ruN)).toBe("Сбой: причина не пришла — откройте сессию")
    expect(BuffAutomation.runLabel({ status: "waiting" }, ru, ruN)).toBe("Ждёт разрешения")
    expect(BuffAutomation.runLabel({ status: "skipped", skipped: 3 }, ru, ruN)).toBe(
      "Пропущено: 3 запуска (машина была выключена)",
    )
    expect(BuffAutomation.runLabel({ status: "skipped", skipped: 1, reason: BuffAutomation.BUSY }, ru, ruN)).toBe(
      "Пропущено: 1 запуск (предыдущий запуск ещё шёл)",
    )
    expect(BuffAutomation.runLabel({ status: "succeeded", late: true }, ru, ruN)).toBe("Выполнен (с опозданием)")
  })
})

describe("an automation's state for the list", () => {
  const base = { paused: false, last: undefined }
  test("a run going wins even over a pause; then paused; otherwise the last run decides", () => {
    expect(BuffAutomation.stateOf({ ...base, paused: true, last: { status: "running" } })).toBe("running")
    expect(BuffAutomation.stateOf({ ...base, paused: true, last: { status: "waiting" } })).toBe("waiting")
    expect(BuffAutomation.stateOf({ ...base, paused: true, last: { status: "failed" } })).toBe("paused")
    expect(BuffAutomation.stateOf(base)).toBe("active")
    expect(BuffAutomation.stateOf({ ...base, last: { status: "succeeded" } })).toBe("active")
    expect(BuffAutomation.stateOf({ ...base, last: { status: "stopped" } })).toBe("active")
    expect(BuffAutomation.stateOf({ ...base, last: { status: "failed" } })).toBe("failed")
    expect(BuffAutomation.stateOf({ ...base, last: { status: "running" } })).toBe("running")
    expect(BuffAutomation.stateOf({ ...base, last: { status: "waiting" } })).toBe("waiting")
  })
  test("filters keep only what they name", () => {
    expect(BuffAutomation.FILTERS.map((filter) => ru(filter.label))).toEqual([
      "Все",
      "Выполняются",
      "Ждут разрешения",
      "Со сбоем",
      "На паузе",
    ])
    const failed = { ...base, last: { status: "failed" as const } }
    expect(BuffAutomation.matches("all", failed)).toBe(true)
    expect(BuffAutomation.matches("failed", failed)).toBe(true)
    expect(BuffAutomation.matches("paused", failed)).toBe(false)
  })
})

describe("a draft before saving", () => {
  const draft = {
    title: "Утренний отчёт",
    prompt: "Собери сводку по вчерашним коммитам",
    schedule: { kind: "daily", at: "09:00" },
    directory: "/home/dev/project",
    mode: "edit",
  } as const
  test("what is missing, in words", () => {
    expect(BuffAutomation.draftProblem(draft, ru)).toBeUndefined()
    expect(BuffAutomation.draftProblem({ ...draft, title: "  " }, ru)).toBe("Назовите автоматизацию.")
    expect(BuffAutomation.draftProblem({ ...draft, prompt: "" }, ru)).toBe("Напишите, что сделать агенту.")
    expect(BuffAutomation.draftProblem({ ...draft, directory: "" }, ru)).toBe("Выберите проект.")
    expect(BuffAutomation.draftProblem({ ...draft, schedule: { kind: "weekly", days: [], at: "09:00" } }, ru)).toBe(
      "Выберите хотя бы один день недели.",
    )
  })
  test("in English — the source strings", () => {
    expect(BuffAutomation.runLabel({ status: "skipped", skipped: 1, reason: BuffAutomation.BUSY })).toBe(
      "Skipped: 1 run (the previous run was still going)",
    )
    expect(BuffAutomation.draftProblem({ ...draft, title: "" })).toBe("Name the automation.")
    expect(BuffAutomation.confirmation({ ...draft, title: "Morning report", prompt: "Summarize" })).toBe(
      "«Morning report» — Daily at 09:00, in /home/dev/project, mode «Edit on its own».\nTask: Summarize",
    )
  })
  test("the summary a person confirms when the model creates one", () => {
    expect(BuffAutomation.confirmation(draft, ru, ruN)).toBe(
      "«Утренний отчёт» — Ежедневно в 09:00, в /home/dev/project, режим «Править сам».\nЗадача: Собери сводку по вчерашним коммитам",
    )
  })
})

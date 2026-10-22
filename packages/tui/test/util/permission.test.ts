import { expect, test } from "bun:test"
import { permissionPresentation } from "../../src/util/permission"

test("preserves permission roots and self-contained metadata", () => {
  expect(permissionPresentation({ action: "external_directory", resources: ["/*"] }).title).toBe(
    "Доступ к внешней папке /",
  )
  expect(permissionPresentation({ action: "external_directory", resources: ["C:/*"] }).title).toBe(
    "Доступ к внешней папке C:/",
  )
  expect(
    permissionPresentation({ action: "webfetch", resources: [], metadata: { url: "https://example.com" } }),
  ).toMatchObject({
    title: "WebFetch https://example.com",
    lines: ["URL: https://example.com"],
  })
  expect(permissionPresentation({ action: "websearch", resources: [], metadata: { query: "releases" } })).toMatchObject(
    {
      title: 'Web Search "releases"',
      lines: ["Запрос: releases"],
    },
  )
})

// Buff (#447): «создать автоматизацию» — пояснение и что именно человек подтверждает.
test("a proposed automation shows what, when and where", () => {
  expect(
    permissionPresentation({
      action: "buff_automation",
      resources: ["«Отчёт» — Ежедневно в 09:00, в /p, режим «Править сам».", "Задача: Сводка"],
    }),
  ).toMatchObject({
    title: "Создать автоматизацию",
    lines: [
      "Агент предлагает автоматизацию — задачу, которую Buff Code будет запускать сам по расписанию. Проверьте, что, когда и где, — подтверждение создаст её.",
      "«Отчёт» — Ежедневно в 09:00, в /p, режим «Править сам».",
      "Задача: Сводка",
    ],
  })
})

// Buff (#447): задача модели многострочная — каждая её строка отдельной строкой экрана.
test("a multi-line task is split into screen lines", () => {
  expect(
    permissionPresentation({
      action: "buff_automation",
      resources: ["«Отчёт» — Ежедневно в 09:00.", "Задача: шаг 1\nшаг 2"],
    }).lines,
  ).toEqual([
    "Агент предлагает автоматизацию — задачу, которую Buff Code будет запускать сам по расписанию. Проверьте, что, когда и где, — подтверждение создаст её.",
    "«Отчёт» — Ежедневно в 09:00.",
    "Задача: шаг 1",
    "шаг 2",
  ])
})

// Buff (#448): запуск сценария — пояснение, фазы, команды, аргументы.
test("a proposed workflow run shows its phases and commands", () => {
  expect(
    permissionPresentation({
      action: "buff_workflow",
      resources: ["Сценарий «Ревью» в /p", "Фазы: 1. Сбор → 2. Проверка", "Команды, которые он запустит: bun"],
      metadata: { kind: "run" },
    }),
  ).toMatchObject({
    title: "Запустить сценарий",
    lines: [
      "Агент предлагает запустить сценарий — субагенты будут работать в фоне по фазам ниже и запускать перечисленные команды. Проверьте — подтверждение запустит.",
      "Сценарий «Ревью» в /p",
      "Фазы: 1. Сбор → 2. Проверка",
      "Команды, которые он запустит: bun",
    ],
  })
})

test("saving a workflow says so", () => {
  expect(
    permissionPresentation({ action: "buff_workflow", resources: ["Сохранить новый сценарий «r»: x"], metadata: { kind: "save" } })
      .title,
  ).toBe("Сохранить сценарий")
})

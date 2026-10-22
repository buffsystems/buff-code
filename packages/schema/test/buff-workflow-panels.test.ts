// Сценарии (#448): панели прогона из report(item, "id") — таблица, плитки, график, доска; одинаково в окне и консоли.
import { describe, expect, test } from "bun:test"
import { BuffI18n } from "../src/buff-i18n.js"
import { BuffWorkflowPanels } from "../src/buff-workflow-panels.js"

// Слова схемы — английские; русские ожидания — через переводчик по каталогу (#472).
const ru: BuffI18n.T = (text, params) => BuffI18n.t("ru", text, params)

const items = (list: unknown[]) => list.map((value) => ({ value, artifact: "p" }))

describe("a field", () => {
  test("a dot path into the item; missing reads as nothing", () => {
    expect(BuffWorkflowPanels.field({ timing: { after: 5 } }, "timing.after")).toBe(5)
    expect(BuffWorkflowPanels.field({ a: 1 }, "b.c")).toBeUndefined()
  })
  test("shown as text with its unit", () => {
    expect(BuffWorkflowPanels.text(5, "мс")).toBe("5 мс")
    expect(BuffWorkflowPanels.text(undefined)).toBe("—")
    expect(BuffWorkflowPanels.text({ a: 1 })).toBe('{"a":1}')
    expect(BuffWorkflowPanels.text(true, undefined, ru)).toBe("да")
    expect(BuffWorkflowPanels.text(false)).toBe("no")
  })
})

describe("a table", () => {
  test("columns by label; a later item with the same key replaces its row", () => {
    const table = BuffWorkflowPanels.table(
      {
        columns: [
          { field: "file", label: "Файл" },
          { field: "n", label: "Строк", unit: "шт" },
        ],
        key: "file",
      },
      items([
        { file: "a", n: 1 },
        { file: "b", n: 2 },
        { file: "a", n: 3 },
      ]),
    )
    expect(table.columns).toEqual(["Файл", "Строк"])
    expect(table.rows).toEqual([
      ["a", "3 шт"],
      ["b", "2 шт"],
    ])
  })
  test("without a key every item is a row", () => {
    expect(BuffWorkflowPanels.table({ columns: [{ field: "n" }] }, items([{ n: 1 }, { n: 1 }])).rows.length).toBe(2)
  })
})

describe("metric tiles", () => {
  test("the newest value of each field", () => {
    expect(
      BuffWorkflowPanels.metrics(
        { metrics: [{ field: "done", label: "Готово" }, { field: "left" }] },
        items([{ done: 1, left: 9 }, { done: 4 }]),
      ),
    ).toEqual([
      { label: "Готово", value: "4" },
      { label: "left", value: "9" },
    ])
  })
})

describe("a chart", () => {
  test("one series per y field, points in report order", () => {
    const chart = BuffWorkflowPanels.chart(
      {
        type: "bar",
        x: { field: "round", label: "Раунд" },
        y: [{ field: "score", label: "Оценка" }, { field: "bugs" }],
      },
      items([
        { round: 1, score: 5, bugs: 3 },
        { round: 2, score: 8 },
      ]),
    )
    expect(chart.type).toBe("bar")
    expect(chart.x).toBe("Раунд")
    expect(chart.series).toEqual([
      {
        label: "Оценка",
        points: [
          { x: "1", y: 5 },
          { x: "2", y: 8 },
        ],
      },
      { label: "bugs", points: [{ x: "1", y: 3 }] },
    ])
  })
  test("a single y field and line by default", () => {
    const chart = BuffWorkflowPanels.chart({ x: { field: "t" }, y: { field: "v" } }, items([{ t: "a", v: "7" }]))
    expect(chart.type).toBe("line")
    expect(chart.series[0]!.points).toEqual([{ x: "a", y: 7 }])
  })
})

describe("a board", () => {
  test("cards by key in their status column; later items move them", () => {
    const board = BuffWorkflowPanels.board(
      {
        key: "id",
        status: "state",
        columns: ["Ждёт", "Идёт", "Готово"],
        cardTitle: "name",
        detail: [{ field: "who", label: "Кто" }],
      },
      items([
        { id: 1, state: "Ждёт", name: "Парсер", who: "a" },
        { id: 2, state: "Идёт", name: "Тесты" },
        { id: 1, state: "Готово", name: "Парсер", who: "b" },
      ]),
    )
    expect(board.map((column) => [column.name, column.cards.map((card) => card.title)])).toEqual([
      ["Ждёт", []],
      ["Идёт", ["Тесты"]],
      ["Готово", ["Парсер"]],
    ])
    expect(board[2]!.cards[0]!.detail).toEqual(["Кто: b"])
  })
  test("a status outside the declared columns gets its own column at the end", () => {
    const board = BuffWorkflowPanels.board({ key: "id", status: "s", columns: ["A"] }, items([{ id: 1, s: "Z" }]))
    expect(board.map((column) => column.name)).toEqual(["A", "Z"])
    expect(board[1]!.cards[0]!.title).toBe("1")
  })
})

describe("items of one panel", () => {
  test("only items routed to it", () => {
    expect(
      BuffWorkflowPanels.of("p", [{ value: 1, artifact: "p" }, { value: 2 }, { value: 3, artifact: "q" }]),
    ).toEqual([1])
  })
})

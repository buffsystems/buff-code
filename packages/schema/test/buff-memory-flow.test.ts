// Память в консоли (#446): выключатели и заметка в файл — вопросами по очереди.
import { describe, expect, test } from "bun:test"
import { BuffMemoryFlow } from "../src/buff-memory-flow.js"
import type { BuffMcpFlow } from "../src/buff-mcp-flow.js"
import type { BuffMemory } from "../src/buff-memory.js"
import { BuffI18n } from "../src/buff-i18n.js"

const ru: BuffI18n.T = (text, params) => BuffI18n.t("ru", text, params)

function ui(answers: unknown[]) {
  const asked: string[] = []
  const next = (title: string) => {
    asked.push(title)
    return Promise.resolve(answers.shift())
  }
  const dialogs: BuffMcpFlow.Ui = {
    t: ru,
    select: (dialog) => next(dialog.title) as never,
    prompt: (dialog) => next(dialog.title) as Promise<string | undefined>,
    confirm: (dialog) => next(dialog.title) as Promise<boolean | undefined>,
  }
  return { dialogs, asked }
}

const now = 1_000_000_000_000
const files: BuffMemory.File[] = [
  { path: "/u/AGENTS.md", scope: "user", exists: true, modified: now - 60_000, enabled: true },
  { path: "/p/AGENTS.md", scope: "project", exists: false, enabled: true },
]
const state = { enabled: true, files }

describe("the menu", () => {
  test("the switch for all memory comes first, then the files with what is known about each", () => {
    expect(BuffMemoryFlow.menu(state, now, ru)).toEqual([
      { title: "Вся память: выключить", value: "all", description: "сейчас включена" },
      { title: "/u/AGENTS.md", value: "/u/AGENTS.md", description: "моя · изменён 1 мин назад" },
      {
        title: "/p/AGENTS.md",
        value: "/p/AGENTS.md",
        description: "проект · Файла ещё нет — он появится, когда вы запишете в него первую заметку.",
      },
    ])
  })
})

describe("what one can do", () => {
  test("switch all memory off", async () => {
    expect(await BuffMemoryFlow.run(ui(["all"]).dialogs, state, now)).toEqual({ type: "enable", enabled: false })
    expect(await BuffMemoryFlow.run(ui(["all"]).dialogs, { ...state, enabled: false }, now)).toEqual({
      type: "enable",
      enabled: true,
    })
  })

  test("add a note to a file", async () => {
    const { dialogs, asked } = ui(["/p/AGENTS.md", "note", " Тесты запускать через make test "])
    expect(await BuffMemoryFlow.run(dialogs, state, now)).toEqual({
      type: "note",
      path: "/p/AGENTS.md",
      text: "Тесты запускать через make test",
    })
    expect(asked).toEqual(["Память", "/p/AGENTS.md", "Заметка в память"])
  })

  test("switch one file off", async () => {
    expect(await BuffMemoryFlow.run(ui(["/u/AGENTS.md", "toggle"]).dialogs, state, now)).toEqual({
      type: "enable",
      path: "/u/AGENTS.md",
      enabled: false,
    })
  })

  test("a file that is not there has nothing to switch", async () => {
    expect(BuffMemoryFlow.actions(files[1]).map((action) => action.value)).toEqual(["note"])
    expect(BuffMemoryFlow.actions(files[0]).map((action) => action.value)).toEqual(["note", "toggle"])
  })

  test("an empty note or leaving a question changes nothing", async () => {
    expect(await BuffMemoryFlow.run(ui(["/u/AGENTS.md", "note", "  "]).dialogs, state, now)).toBeUndefined()
    expect(await BuffMemoryFlow.run(ui([undefined]).dialogs, state, now)).toBeUndefined()
    expect(await BuffMemoryFlow.run(ui(["/u/AGENTS.md", undefined]).dialogs, state, now)).toBeUndefined()
  })
})

test("a note goes to the end of the file as a list item", () => {
  expect(BuffMemoryFlow.withNote("", "Первое")).toBe("- Первое\n")
  expect(BuffMemoryFlow.withNote("# Правила\n\n- Раз", "Два")).toBe("# Правила\n\n- Раз\n- Два\n")
  expect(BuffMemoryFlow.withNote("Текст\n\n", "Заметка")).toBe("Текст\n\n- Заметка\n")
})

// Хуки и доверие в консоли (#446): шаги вопросами по очереди; диалог приходит снаружи.
import { describe, expect, test } from "bun:test"
import { BuffHookFlow } from "../src/buff-hook-flow.js"
import type { BuffHook } from "../src/buff-hook.js"
import { BuffI18n } from "../src/buff-i18n.js"
import type { BuffMcpFlow } from "../src/buff-mcp-flow.js"

function ui(answers: unknown[]) {
  const asked: string[] = []
  const shown: string[] = []
  const next = (title: string) => {
    asked.push(title)
    return Promise.resolve(answers.shift())
  }
  const dialogs: BuffMcpFlow.Ui = {
    select: (dialog) => next(dialog.title) as never,
    prompt: (dialog) => next(dialog.title) as Promise<string | undefined>,
    confirm: (dialog) => {
      shown.push(dialog.message)
      return next(dialog.title) as Promise<boolean | undefined>
    },
    t: (text, params) => BuffI18n.t("ru", text, params),
  }
  return { dialogs, asked, shown }
}

const entry = (id: string, scope: BuffHook.Scope, more: Partial<BuffHook.Entry> = {}): BuffHook.Entry => ({
  id,
  event: "tool.after",
  command: "make fmt",
  scope,
  path: `/${scope}/hooks.json`,
  enabled: true,
  ...more,
})

describe("adding", () => {
  test("where, the name, the event, the tools, the command", async () => {
    const { dialogs, asked } = ui(["project", "fmt", "tool.after", "edit, write", "make fmt"])
    expect(await BuffHookFlow.add(dialogs)).toEqual({
      scope: "project",
      id: "fmt",
      event: "tool.after",
      tool: "edit, write",
      command: "make fmt",
    })
    expect(asked).toEqual(["Где хранить хук", "Имя хука", "Когда запускать", "Инструменты", "Команда"])
  })

  test("an event without a tool does not ask for tools", async () => {
    const { dialogs, asked } = ui(["user", "stamp", "prompt", "date"])
    expect(await BuffHookFlow.add(dialogs)).toEqual({
      scope: "user",
      id: "stamp",
      event: "prompt",
      tool: "",
      command: "date",
    })
    expect(asked).toEqual(["Где хранить хук", "Имя хука", "Когда запускать", "Команда"])
  })

  test("an answer that does not fit is a problem; leaving a question saves nothing", async () => {
    expect(await BuffHookFlow.add(ui(["user", "fmt", "tool.after", "", " "]).dialogs)).toEqual({
      problem: "Укажите команду, которую запускать.",
    })
    expect(await BuffHookFlow.add(ui(["user", undefined]).dialogs)).toBeUndefined()
  })
})

describe("the list", () => {
  test("each row says when the hook fires, what it runs and what holds it back", () => {
    expect(
      BuffHookFlow.rows(
        [
          entry("fmt", "user", { tool: "edit" }),
          entry("guard", "project", { trusted: false }),
          entry("old", "user", { enabled: false }),
        ],
        (text, params) => BuffI18n.t("ru", text, params),
      ),
    ).toEqual([
      { title: "fmt", value: 0, description: "мой · После инструмента · edit · make fmt" },
      { title: "guard", value: 1, description: "проект · не подтверждён · После инструмента · любой · make fmt" },
      { title: "old", value: 2, description: "мой · выключен · После инструмента · любой · make fmt" },
    ])
  })
})

describe("removing and switching", () => {
  const entries = [entry("fmt", "user"), entry("guard", "project", { enabled: false })]

  test("a hook is removed after a confirmation", async () => {
    expect(await BuffHookFlow.remove(ui([0, true]).dialogs, entries)).toEqual({ scope: "user", id: "fmt" })
    expect(await BuffHookFlow.remove(ui([0, false]).dialogs, entries)).toBeUndefined()
  })

  test("switching answers with the opposite of the state", async () => {
    expect(await BuffHookFlow.toggle(ui([1]).dialogs, entries)).toEqual({
      scope: "project",
      id: "guard",
      enabled: true,
    })
  })

  test("no hooks — says so", async () => {
    expect(await BuffHookFlow.remove(ui([]).dialogs, [])).toEqual({ problem: "Хуков пока нет. Добавить — /hook-add." })
  })
})

describe("trusting", () => {
  const items = [
    { kind: "hook" as const, id: "guard", title: "Хук «guard»", note: "Перед инструментом · любой" },
    { kind: "command" as const, id: "deploy", title: "Команда /deploy", note: "команда проекта" },
  ]
  const review = async () => ({ text: "Команда: rm -rf build", token: "t1" })

  test("pick what waits, read exactly what will run, confirm", async () => {
    const { dialogs, asked, shown } = ui([0, true])
    expect(await BuffHookFlow.trust(dialogs, items, review)).toEqual({ item: items[0], token: "t1" })
    expect(asked).toEqual(["Что проверить", "Доверять: Хук «guard»?"])
    expect(shown[0]).toContain("Команда: rm -rf build")
  })

  test("a refusal trusts nothing", async () => {
    expect(await BuffHookFlow.trust(ui([1, false]).dialogs, items, review)).toBeUndefined()
  })

  test("nothing waits — says so", async () => {
    expect(await BuffHookFlow.trust(ui([]).dialogs, [], review)).toEqual({
      problem: "Проверять нечего: всё, что пришло из проекта, подтверждено.",
    })
  })
})

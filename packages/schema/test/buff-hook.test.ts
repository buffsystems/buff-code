// Хуки из интерфейса (#446): команда оболочки на событие — правила, общие для ядра, окна и консоли.
import { describe, expect, test } from "bun:test"
import { BuffHook } from "../src/buff-hook.js"
import { BuffI18n } from "../src/buff-i18n.js"

const ru: BuffI18n.T = (text, params) => BuffI18n.t("ru", text, params)

const hook = (more: Partial<BuffHook.Hook> = {}): BuffHook.Hook => ({
  id: "fmt",
  event: "tool.after",
  command: "bun run fmt",
  ...more,
})

describe("what a hook needs", () => {
  test("a name, a command, and a tool filter only where there is a tool", () => {
    expect(BuffHook.problem(hook())).toBeUndefined()
    expect(BuffHook.problem(hook({ id: "Fmt 1" }), ru)).toBe(
      "Имя — строчные латинские буквы, цифры и дефис, например format.",
    )
    expect(BuffHook.problem(hook({ command: "  " }), ru)).toBe("Укажите команду, которую запускать.")
    expect(BuffHook.problem(hook({ event: "prompt", tool: "edit" }), ru)).toBe(
      "У события «Перед отправкой запроса» нет инструмента — оставьте это поле пустым.",
    )
  })
})

describe("when a hook fires", () => {
  test("on its event; without a filter — for any tool", () => {
    expect(BuffHook.matches(hook(), "tool.after", "edit")).toBe(true)
    expect(BuffHook.matches(hook(), "tool.before", "edit")).toBe(false)
    expect(BuffHook.matches(hook({ event: "prompt" }), "prompt")).toBe(true)
  })

  test("a filter names tools: a list, a star for any ending", () => {
    expect(BuffHook.matches(hook({ tool: "edit, write" }), "tool.after", "write")).toBe(true)
    expect(BuffHook.matches(hook({ tool: "edit, write" }), "tool.after", "read")).toBe(false)
    expect(BuffHook.matches(hook({ tool: "github_*" }), "tool.after", "github_create_issue")).toBe(true)
    expect(BuffHook.matches(hook({ tool: "github_*" }), "tool.after", "gitlab_x")).toBe(false)
  })
})

describe("the file", () => {
  test("hooks are read from the file; what is not a hook is skipped", () => {
    const text = JSON.stringify({
      hooks: [{ id: "fmt", event: "tool.after", tool: "edit", command: "bun run fmt" }, { id: "broken" }, "мусор"],
    })
    expect(BuffHook.fileHooks(text)).toEqual([{ id: "fmt", event: "tool.after", tool: "edit", command: "bun run fmt" }])
    expect(BuffHook.fileHooks("")).toEqual([])
    expect(BuffHook.fileHooks("{не json")).toEqual([])
  })

  test("a hook is added, replaced by its name, renamed and removed", () => {
    const one = BuffHook.fileWith("", hook())
    expect(JSON.parse(one)).toEqual({ hooks: [{ id: "fmt", event: "tool.after", command: "bun run fmt" }] })
    const two = BuffHook.fileWith(one, hook({ command: "make fmt" }))
    expect(BuffHook.fileHooks(two)).toEqual([hook({ command: "make fmt" })])
    const renamed = BuffHook.fileWith(two, hook({ id: "format" }), "fmt")
    expect(BuffHook.fileHooks(renamed).map((item) => item.id)).toEqual(["format"])
    expect(BuffHook.fileHooks(BuffHook.fileWithout(renamed, "format"))).toEqual([])
  })

  test("what else the file holds stays; a broken file is not overwritten", () => {
    const text = JSON.stringify({ note: "командный файл", hooks: [] })
    expect(JSON.parse(BuffHook.fileWith(text, hook())).note).toBe("командный файл")
    expect(() => BuffHook.fileWith("{не json", hook())).toThrow(BuffHook.BROKEN_FILE)
    expect(ru(BuffHook.BROKEN_FILE)).toBe(
      "Файл хуков повреждён (это не JSON) — исправьте его руками, чтобы ничего не потерять.",
    )
  })
})

describe("running", () => {
  test("the command gets the event as JSON", () => {
    expect(
      JSON.parse(
        BuffHook.payload({
          event: "tool.before",
          tool: "edit",
          input: { path: "a.ts" },
          directory: "/p",
          session: "ses_1",
        }),
      ),
    ).toEqual({ event: "tool.before", tool: "edit", input: { path: "a.ts" }, directory: "/p", session: "ses_1" })
  })

  test("before a tool: a non-zero exit forbids the call, and its output is the reason (in English — for the model)", () => {
    expect(BuffHook.verdict(hook({ id: "guard" }), 0, "ok")).toBeUndefined()
    expect(BuffHook.verdict(hook({ id: "guard" }), 2, " Нельзя править миграции \n")).toBe(
      "Hook «guard» forbade the call: Нельзя править миграции",
    )
    expect(BuffHook.verdict(hook({ id: "guard" }), 1, "")).toBe("Hook «guard» forbade the call (exit code 1).")
  })
})

describe("words", () => {
  test("what a hook does — in one line", () => {
    expect(BuffHook.summary(hook({ tool: "edit" }), ru)).toBe("После инструмента · edit")
    expect(BuffHook.summary(hook({ event: "tool.before" }), ru)).toBe("Перед инструментом · любой")
    expect(BuffHook.summary(hook({ event: "prompt" }), ru)).toBe("Перед отправкой запроса")
    expect(BuffHook.summary(hook({ event: "tool.before" }))).toBe("Before a tool · any")
  })

  test("what a person reviews before trusting; the fingerprint text does not depend on the language", () => {
    expect(BuffHook.reviewText(hook({ tool: "edit" }), ru)).toBe(
      "Когда: После инструмента · edit\nКоманда: bun run fmt",
    )
    expect(BuffHook.reviewText(hook({ tool: "edit" }))).toBe("When: After a tool · edit\nCommand: bun run fmt")
  })
})

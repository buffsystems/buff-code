// Шаги управления MCP-серверами в консоли (#444): вопросы по очереди, диалог приходит снаружи.
import { describe, expect, test } from "bun:test"
import { BuffI18n } from "../src/buff-i18n.js"
import { BuffMcpFlow } from "../src/buff-mcp-flow.js"
import type { BuffMcp } from "../src/buff-mcp.js"

/** Интерфейс, отвечающий заранее заданными ответами; запоминает, что спросили. */
function ui(answers: unknown[]) {
  const asked: string[] = []
  const next = (title: string) => {
    asked.push(title)
    return Promise.resolve(answers.shift())
  }
  const dialogs: BuffMcpFlow.Ui = {
    select: (dialog) => next(dialog.title) as never,
    prompt: (dialog) => next(dialog.title) as Promise<string | undefined>,
    confirm: (dialog) => next(dialog.title) as Promise<boolean | undefined>,
    // #472: шаги говорят по-русски через русский перевод (он же проверяет каталог).
    t: (text, params) => BuffI18n.t("ru", text, params),
  }
  return { dialogs, asked }
}

const entry = (name: string, scope: BuffMcp.Entry["scope"], config?: BuffMcp.Entry["config"]): BuffMcp.Entry => ({
  name,
  scope,
  config,
  status: { status: "connected" },
})

describe("adding", () => {
  test("a command: where to keep, what kind, the name, the command line", async () => {
    const { dialogs, asked } = ui(["user", "local", "files", "npx -y @acme/files"])
    expect(await BuffMcpFlow.add(dialogs)).toEqual({
      scope: "user",
      servers: [{ name: "files", config: { type: "local", command: ["npx", "-y", "@acme/files"] } }],
    })
    expect(asked).toEqual(["Где хранить сервер", "Что подключаем", "Имя сервера", "Команда запуска"])
  })

  test("an address", async () => {
    const { dialogs } = ui(["project", "remote", "web", "https://mcp.example.com"])
    expect(await BuffMcpFlow.add(dialogs)).toEqual({
      scope: "project",
      servers: [{ name: "web", config: { type: "remote", url: "https://mcp.example.com" } }],
    })
  })

  test("pasted JSON brings its own names — the name is not asked", async () => {
    const { dialogs, asked } = ui(["user", "json", '{ "mcpServers": { "a": { "command": "x" } } }'])
    expect(await BuffMcpFlow.add(dialogs)).toEqual({
      scope: "user",
      servers: [{ name: "a", config: { type: "local", command: ["x"] } }],
    })
    expect(asked).toEqual(["Где хранить сервер", "Что подключаем", "Описание сервера (JSON)"])
  })

  test("pasted JSON of one server asks for its name", async () => {
    const { dialogs } = ui(["user", "json", '{ "command": "x" }', "files"])
    expect(await BuffMcpFlow.add(dialogs)).toEqual({
      scope: "user",
      servers: [{ name: "files", config: { type: "local", command: ["x"] } }],
    })
  })

  test("a wrong answer is named, nothing is saved", async () => {
    expect(await BuffMcpFlow.add(ui(["user", "local", "my server", "srv"]).dialogs)).toEqual({
      problem: "Имя — латинские буквы, цифры, дефис и подчёркивание, без пробелов.",
    })
    expect(await BuffMcpFlow.add(ui(["user", "json", "{ nope"]).dialogs)).toEqual({
      problem: "Это не JSON: проверьте скобки и кавычки.",
    })
  })

  test("leaving any question leaves the whole thing", async () => {
    expect(await BuffMcpFlow.add(ui(["user", undefined]).dialogs)).toBeUndefined()
    expect(await BuffMcpFlow.add(ui([undefined]).dialogs)).toBeUndefined()
  })
})

describe("editing", () => {
  const stored = { type: "local" as const, command: ["srv"], environment: { A: "1" } }
  const entries = [entry("files", "user", stored), entry("buff", "builtin")]

  test("only one's own servers are offered; the record opens as JSON and is saved under the same name", async () => {
    const { dialogs, asked } = ui(["files", '{ "type": "local", "command": ["srv", "--x"] }'])
    expect(await BuffMcpFlow.edit(dialogs, entries)).toEqual({
      scope: "user",
      servers: [{ name: "files", config: { type: "local", command: ["srv", "--x"] } }],
      previous: { scope: "user", name: "files" },
    })
    expect(asked).toEqual(["Какой сервер изменить", "Сервер «files» (JSON)"])
  })

  test("with nothing of one's own there is nothing to edit", async () => {
    expect(await BuffMcpFlow.edit(ui([]).dialogs, [entry("buff", "builtin")])).toEqual({
      problem: "Своих серверов нет: серверы Buff Code не правятся.",
    })
  })
})

describe("removing", () => {
  const entries = [entry("files", "project"), entry("buff", "builtin")]

  test("the server is chosen and the removal confirmed", async () => {
    const { dialogs, asked } = ui(["files", true])
    expect(await BuffMcpFlow.remove(dialogs, entries)).toEqual({ scope: "project", name: "files" })
    expect(asked).toEqual(["Какой сервер удалить", "Удалить сервер «files»?"])
  })

  test("without the confirmation nothing is removed", async () => {
    expect(await BuffMcpFlow.remove(ui(["files", false]).dialogs, entries)).toBeUndefined()
  })
})

// #951: «только в этом проекте» ↔ «во всех проектах» — отдельным шагом, настройки сервера те же.
describe("changing who sees a server", () => {
  const files = { type: "local" as const, command: ["npx", "files"] }

  test("a server kept for this project only becomes available in all projects", async () => {
    const { dialogs, asked } = ui(["files", "user"])
    expect(await BuffMcpFlow.move(dialogs, [entry("files", "local", files), entry("buff", "builtin")])).toEqual({
      scope: "user",
      servers: [{ name: "files", config: files }],
      previous: { scope: "local", name: "files" },
    })
    expect(asked).toEqual(["Какому серверу сменить видимость", "Где сервер «files» будет доступен"])
  })

  test("the place it is in now is not offered", async () => {
    const offered: string[][] = []
    const answers = ["files", undefined]
    const dialogs: BuffMcpFlow.Ui = {
      select: (dialog) => {
        offered.push(dialog.options.map((option) => String(option.value)))
        return Promise.resolve(answers.shift() as never)
      },
      prompt: () => Promise.resolve(undefined),
      confirm: () => Promise.resolve(undefined),
    }
    await BuffMcpFlow.move(dialogs, [entry("files", "user", files)])
    expect(offered).toEqual([["files"], ["local", "project"]])
  })

  test("leaving a question changes nothing; no own servers — said so", async () => {
    expect(await BuffMcpFlow.move(ui(["files", undefined]).dialogs, [entry("files", "local", files)])).toBeUndefined()
    expect(await BuffMcpFlow.move(ui([]).dialogs, [entry("buff", "builtin")])).toEqual({
      problem: "Своих серверов нет: серверы Buff Code не правятся.",
    })
  })

  test("the list tells the three places apart", async () => {
    const descriptions: (string | undefined)[] = []
    const dialogs: BuffMcpFlow.Ui = {
      select: (dialog) => {
        descriptions.push(...dialog.options.map((option) => option.description))
        return Promise.resolve(undefined)
      },
      prompt: () => Promise.resolve(undefined),
      confirm: () => Promise.resolve(undefined),
      t: (text, params) => BuffI18n.t("ru", text, params),
    }
    await BuffMcpFlow.move(dialogs, [entry("a", "user", files), entry("b", "project", files), entry("c", "local", files)])
    expect(descriptions).toEqual(["у меня", "в проекте", "у меня, только этот проект"])
  })
})

describe("adding for this project only", () => {
  test("the third place to keep a server", async () => {
    const { dialogs } = ui(["local", "local", "files", "npx files"])
    expect(await BuffMcpFlow.add(dialogs)).toMatchObject({ scope: "local", servers: [{ name: "files" }] })
  })
})

// Команды и субагенты в консоли (#446): шаги вопросами по очереди; диалог приходит снаружи.
import { describe, expect, test } from "bun:test"
import { BuffCustomFlow } from "../src/buff-custom-flow.js"
import { BuffI18n } from "../src/buff-i18n.js"
import { BuffCustom } from "../src/buff-custom.js"
import type { BuffMcpFlow } from "../src/buff-mcp-flow.js"

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

const command = BuffCustom.kinds.command
const agent = BuffCustom.kinds.agent
const entry = (id: string, scope: BuffCustom.Origin, more: Partial<BuffCustom.Entry> = {}): BuffCustom.Entry => ({
  id,
  scope,
  enabled: true,
  values: {},
  ...more,
})

describe("adding", () => {
  test("a command: where, the name, each field of the form, the text", async () => {
    const { dialogs, asked } = ui(["user", "deploy", "Выкладка", "", "", "", "Выложи $ARGUMENTS"])
    expect(await BuffCustomFlow.add(dialogs, command)).toEqual({
      scope: "user",
      id: "deploy",
      values: { description: "Выкладка" },
      body: "Выложи $ARGUMENTS",
    })
    expect(asked).toEqual(["Где хранить", "Имя", "Описание", "Агент", "Модель", "Где выполнять", "Текст команды"])
  })

  test("a subagent: the mode is a choice", async () => {
    const { dialogs } = ui(["project", "reviewer", "Ревью перед слиянием", "subagent", "", "Ты — ревьюер."])
    expect(await BuffCustomFlow.add(dialogs, agent)).toEqual({
      scope: "project",
      id: "reviewer",
      values: { description: "Ревью перед слиянием", mode: "subagent" },
      body: "Ты — ревьюер.",
    })
  })

  test("an answer that does not fit is a problem, nothing is saved", async () => {
    const { dialogs } = ui(["user", "Deploy", "", "", "", "", "текст"])
    expect(await BuffCustomFlow.add(dialogs, command)).toEqual({ problem: BuffI18n.t("ru", command.idProblem) })
  })

  test("leaving a question saves nothing", async () => {
    expect(await BuffCustomFlow.add(ui([undefined]).dialogs, command)).toBeUndefined()
    expect(await BuffCustomFlow.add(ui(["user", "deploy", undefined]).dialogs, command)).toBeUndefined()
  })
})

describe("editing", () => {
  const read = async () => ({ values: { description: "Выкладка" }, body: "Выложи" })

  test("pick an own entry, change what is needed, save", async () => {
    const { dialogs, asked } = ui(["deploy", "description", "Выкладка на стенд", "body", "Выложи $1", "save"])
    expect(
      await BuffCustomFlow.edit(dialogs, command, [entry("deploy", "user"), entry("init", "builtin")], read),
    ).toEqual({
      scope: "user",
      id: "deploy",
      values: { description: "Выкладка на стенд" },
      body: "Выложи $1",
      previous: { scope: "user", id: "deploy" },
    })
    expect(asked).toEqual([
      "Какую команду изменить",
      "Команда /deploy",
      "Описание",
      "Команда /deploy",
      "Текст команды",
      "Команда /deploy",
    ])
  })

  test("nothing of one's own — says so", async () => {
    expect(await BuffCustomFlow.edit(ui([]).dialogs, command, [entry("init", "builtin")], read)).toEqual({
      problem: "Своих команд пока нет. Встроенные и записанные в файле настроек здесь не правятся.",
    })
  })

  test("leaving the menu saves nothing", async () => {
    expect(
      await BuffCustomFlow.edit(ui(["deploy", undefined]).dialogs, command, [entry("deploy", "user")], read),
    ).toBeUndefined()
  })
})

describe("removing", () => {
  test("an own entry, after a confirmation", async () => {
    const entries = [entry("deploy", "project", { path: "/p/.opencode/commands/deploy.md" })]
    expect(await BuffCustomFlow.remove(ui(["deploy", true]).dialogs, command, entries)).toEqual({
      scope: "project",
      id: "deploy",
    })
    expect(await BuffCustomFlow.remove(ui(["deploy", false]).dialogs, command, entries)).toBeUndefined()
  })
})

describe("switching on and off", () => {
  test("any entry can be picked; the answer is the opposite of its state", async () => {
    const entries = [entry("deploy", "user"), entry("init", "builtin", { enabled: false })]
    expect(await BuffCustomFlow.toggle(ui(["deploy"]).dialogs, command, entries)).toEqual({
      id: "deploy",
      enabled: false,
    })
    expect(await BuffCustomFlow.toggle(ui(["init"]).dialogs, command, entries)).toEqual({ id: "init", enabled: true })
  })

  test("each row says where the entry comes from and whether it is off", () => {
    expect(
      BuffCustomFlow.rows(
        command,
        [entry("deploy", "user", { description: "Выкладка" }), entry("init", "builtin", { enabled: false })],
        (text, params) => BuffI18n.t("ru", text, params),
      ),
    ).toEqual([
      { title: "/deploy", value: "deploy", description: "моя · Выкладка" },
      { title: "/init", value: "init", description: "встроенная · выключена" },
    ])
  })
})

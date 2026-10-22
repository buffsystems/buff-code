// Команды и субагенты из интерфейса (#446): правила, общие для окна и консоли.
import { describe, expect, test } from "bun:test"
import { BuffCustom } from "../src/buff-custom.js"
import { BuffI18n } from "../src/buff-i18n.js"

// #472: строки схемы — английские; русские ожидания — через русский перевод (он же проверяет каталог).
const ru: BuffI18n.T = (text, params) => BuffI18n.t("ru", text, params)

const command = BuffCustom.kinds.command
const agent = BuffCustom.kinds.agent

describe("identifier", () => {
  test("a command may sit in a folder, a subagent may not", () => {
    expect(BuffCustom.idProblem(command, "deploy", ru)).toBeUndefined()
    expect(BuffCustom.idProblem(command, "git/sync", ru)).toBeUndefined()
    expect(BuffCustom.idProblem(agent, "reviewer-2", ru)).toBeUndefined()
    expect(BuffCustom.idProblem(agent, "team/reviewer", ru)).toBe(
      "Имя — строчные латинские буквы, цифры и дефис, например reviewer.",
    )
  })

  test("anything else says what a name looks like", () => {
    for (const id of ["", "Deploy", "на стенд", "a b", "/x", "x/", "a.md"])
      expect(BuffCustom.idProblem(command, id, ru)).toBe(
        "Имя — строчные латинские буквы, цифры и дефис, например deploy; папка — через косую черту: git/sync.",
      )
  })
})

describe("what an entry needs", () => {
  test("a command is its text", () => {
    expect(BuffCustom.problem(command, { id: "deploy", values: {}, body: " " }, ru)).toBe(
      "Напишите текст команды: он уйдёт модели, когда команду вызовут.",
    )
    expect(BuffCustom.problem(command, { id: "deploy", values: {}, body: "Выложи $ARGUMENTS" }, ru)).toBeUndefined()
  })

  test("a subagent needs a description — by it the main agent decides whom to call", () => {
    expect(BuffCustom.problem(agent, { id: "reviewer", values: { mode: "subagent" }, body: "Проверяй" }, ru)).toBe(
      "Опишите, когда вызывать субагента: по описанию основной агент решает, кому отдать работу.",
    )
    expect(
      BuffCustom.problem(agent, { id: "reviewer", values: { description: "Ревью", mode: "subagent" }, body: "" }, ru),
    ).toBe("Напишите инструкцию субагента: кто он и как работает.")
  })

  test("a model is written as provider/model", () => {
    expect(BuffCustom.problem(command, { id: "x", values: { model: "glm" }, body: "т" }, ru)).toBe(
      "Модель записывается как провайдер/модель, например buff/buff. Пусто — модель сессии.",
    )
    expect(BuffCustom.problem(command, { id: "x", values: { model: "buff/buff" }, body: "т" }, ru)).toBeUndefined()
  })

  test("a choice takes only what it offers", () => {
    expect(BuffCustom.problem(agent, { id: "x", values: { description: "д", mode: "boss" }, body: "т" }, ru)).toBe(
      "«Режим»: выберите один из предложенных вариантов.",
    )
  })
})

describe("the file", () => {
  test("values go to the header in the order of the form, the text below", () => {
    const text = BuffCustom.fileEdited(command, "", {
      values: { description: "Выкладка", agent: "build", subagent: "true" },
      body: "Выложи $ARGUMENTS",
    })
    expect(text).toBe('---\ndescription: "Выкладка"\nagent: "build"\nsubagent: true\n---\n\nВыложи $ARGUMENTS\n')
    expect(BuffCustom.fileParts(command, text)).toEqual({
      values: { description: "Выкладка", agent: "build", subagent: "true" },
      body: "Выложи $ARGUMENTS\n",
    })
  })

  test("where the file of a new entry goes", () => {
    expect(BuffCustom.fileName(command, "git/sync")).toBe("commands/git/sync.md")
    expect(BuffCustom.fileName(agent, "reviewer")).toBe("agents/reviewer.md")
  })

  test("the name of an entry by its file", () => {
    expect(BuffCustom.idOf(command, "commands/git/sync.md")).toBe("git/sync")
    expect(BuffCustom.idOf(command, "command/deploy.md")).toBe("deploy")
    expect(BuffCustom.idOf(agent, "agent/reviewer.md")).toBe("reviewer")
    expect(BuffCustom.idOf(agent, "skills/x.md")).toBeUndefined()
  })
})

describe("what the form starts with", () => {
  test("a new entry takes the first choice — a new agent is a subagent", () => {
    expect(BuffCustom.formValues(agent, undefined)).toEqual({ mode: "subagent" })
    expect(BuffCustom.formValues(command, undefined)).toEqual({})
  })

  test("an existing file shows what it means: no mode in the file is «both»", () => {
    expect(BuffCustom.formValues(agent, { description: "д" })).toEqual({ description: "д", mode: "all" })
    expect(BuffCustom.formValues(agent, { mode: "primary" })).toEqual({ mode: "primary" })
  })
})

describe("trust", () => {
  test("only what a project brings and what runs on its own needs a confirmation", () => {
    expect(BuffCustom.needsTrust(command, "project")).toBe(true)
    expect(BuffCustom.needsTrust(command, "user")).toBe(false)
    expect(BuffCustom.needsTrust(agent, "project")).toBe(false)
  })

  test("what stands between a project command and its run", () => {
    expect(BuffCustom.untrusted("deploy", ru)).toBe(
      "Команда проекта /deploy не подтверждена и не выполнена. Проверьте её текст и подтвердите: настройки → Расширения → Команды, в консоли — /trust.",
    )
  })
})

describe("words", () => {
  test("how an entry is called in the input field", () => {
    expect(BuffCustom.mention(command, "git/sync")).toBe("/git/sync")
    expect(BuffCustom.mention(agent, "reviewer")).toBe("@reviewer")
  })

  test("where an entry comes from", () => {
    expect(ru(BuffCustom.originLabel(command, "project"))).toBe("проект")
    expect(ru(BuffCustom.originLabel(command, "user"))).toBe("моя")
    expect(ru(BuffCustom.originLabel(command, "config"))).toBe("из файла настроек")
    expect(ru(BuffCustom.originLabel(command, "builtin"))).toBe("встроенная")
    expect(ru(BuffCustom.originLabel(agent, "user"))).toBe("мой")
    expect(ru(BuffCustom.originLabel(agent, "builtin"))).toBe("встроенный")
  })
})

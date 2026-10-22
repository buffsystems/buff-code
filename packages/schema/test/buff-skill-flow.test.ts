// Навыки в консоли (#445): строки списка и шаги подключения каталога; диалог приходит снаружи.
import { describe, expect, test } from "bun:test"
import { BuffSkillFlow } from "../src/buff-skill-flow.js"
import type { BuffMcpFlow } from "../src/buff-mcp-flow.js"
import type { BuffSkill } from "../src/buff-skill.js"
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

const entry = (id: string, scope: BuffSkill.Origin, extra: Partial<BuffSkill.Entry> = {}): BuffSkill.Entry => ({
  id,
  name: id,
  scope,
  enabled: true,
  ...extra,
})

describe("the list of skills", () => {
  test("each row says where the skill comes from", () => {
    expect(
      BuffSkillFlow.rows([entry("notes", "project", { name: "Заметки", description: "Когда\n  просят" })], ru),
    ).toEqual([{ id: "notes", title: "Заметки", description: "Когда просят", status: "проект", enabled: true }])
  })

  test("a disabled skill stays in the list and says so", () => {
    expect(BuffSkillFlow.rows([entry("notes", "external", { enabled: false })], ru)[0]).toMatchObject({
      status: "подключён · выключен",
      enabled: false,
    })
  })

  test("the action on a row is the opposite of its state", () => {
    expect(BuffSkillFlow.toggleTitle(true, ru)).toBe("выключить")
    expect(BuffSkillFlow.toggleTitle(false, ru)).toBe("включить")
    expect(BuffSkillFlow.toggleTitle(undefined, ru)).toBe("включить")
  })
})

describe("attaching a directory", () => {
  test("where to keep the record, then the directory or address", async () => {
    const { dialogs, asked } = ui(["user", " ~/team-skills "])
    expect(await BuffSkillFlow.attach(dialogs)).toEqual({ scope: "user", source: "~/team-skills" })
    expect(asked).toEqual(["Для кого подключить навыки", "Каталог или адрес с навыками"])
  })

  test("an empty answer is a problem, nothing is attached", async () => {
    const { dialogs } = ui(["project", "  "])
    expect(await BuffSkillFlow.attach(dialogs)).toEqual({
      problem: "Укажите каталог с навыками или адрес, по которому они опубликованы.",
    })
  })

  test("leaving a question attaches nothing", async () => {
    expect(await BuffSkillFlow.attach(ui([undefined]).dialogs)).toBeUndefined()
    expect(await BuffSkillFlow.attach(ui(["user", undefined]).dialogs)).toBeUndefined()
  })
})

describe("detaching", () => {
  const sources: BuffSkill.Source[] = [
    { scope: "user", source: "~/team-skills" },
    { scope: "project", source: "https://skills.example.com" },
  ]

  test("the picked source goes away from the scope it was attached in", async () => {
    const { dialogs, asked } = ui([1])
    expect(await BuffSkillFlow.detach(dialogs, sources)).toEqual(sources[1])
    expect(asked).toEqual(["Что отключить"])
  })

  test("nothing attached — says so", async () => {
    expect(await BuffSkillFlow.detach(ui([]).dialogs, [])).toEqual({
      problem: "Подключённых каталогов нет. Подключить — /skill-attach.",
    })
  })

  test("leaving the question detaches nothing", async () => {
    expect(await BuffSkillFlow.detach(ui([undefined]).dialogs, sources)).toBeUndefined()
  })
})

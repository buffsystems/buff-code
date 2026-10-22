// Управление навыками из интерфейса (#445): правила, общие для окна и консоли.
import { describe, expect, test } from "bun:test"
import { BuffSkill } from "../src/buff-skill.js"
import { BuffI18n } from "../src/buff-i18n.js"

const ru: BuffI18n.T = (text, params) => BuffI18n.t("ru", text, params)

describe("identifier", () => {
  test("a usable identifier passes", () => {
    expect(BuffSkill.idProblem("release-notes", ru)).toBeUndefined()
    expect(BuffSkill.idProblem("db2", ru)).toBeUndefined()
  })

  test("anything else says what an identifier looks like", () => {
    for (const id of ["", "Release", "release notes", "релиз", "-x", "a/b", "a.md"])
      expect(BuffSkill.idProblem(id, ru)).toBe(
        "Идентификатор — строчные латинские буквы, цифры и дефис, например release-notes.",
      )
  })
})

describe("what a skill needs", () => {
  test("a description is what the model picks the skill by — without it the skill is never offered", () => {
    expect(BuffSkill.problem({ id: "notes", description: " ", body: "Делай так" }, ru)).toBe(
      "Опишите, когда применять навык: по описанию модель решает, нужен ли он.",
    )
  })

  test("instructions are the skill itself", () => {
    expect(BuffSkill.problem({ id: "notes", description: "Когда просят заметки к выпуску", body: "" }, ru)).toBe(
      "Напишите инструкцию: что делать, когда навык применён.",
    )
    expect(
      BuffSkill.problem({ id: "notes", description: "Когда просят заметки", body: "Делай так" }, ru),
    ).toBeUndefined()
  })
})

describe("skill file", () => {
  test("a new skill is a SKILL.md with its name, description and instructions", () => {
    const text = BuffSkill.fileText({
      name: "Заметки к выпуску",
      description: 'Когда просят "что нового"',
      body: "# Как писать\nКоротко.\n",
    })
    expect(text).toBe(
      '---\nname: "Заметки к выпуску"\ndescription: "Когда просят \\"что нового\\""\n---\n\n# Как писать\nКоротко.\n',
    )
    expect(BuffSkill.fileParts(text)).toEqual({
      name: "Заметки к выпуску",
      description: 'Когда просят "что нового"',
      body: "# Как писать\nКоротко.\n",
    })
  })

  test("a file written by hand is read: plain, quoted and folded values", () => {
    const text =
      "---\nname: release-notes\ndescription: >\n  Когда просят заметки\n  к выпуску\nmetadata:\n  opencode/autoinvoke: false\n---\nТекст\n"
    expect(BuffSkill.fileParts(text)).toEqual({
      name: "release-notes",
      description: "Когда просят заметки к выпуску",
      body: "Текст\n",
    })
    expect(BuffSkill.fileParts("---\nname: 'x'\n---\nТекст")).toEqual({
      name: "x",
      description: undefined,
      body: "Текст",
    })
  })

  test("a file without a header is all instructions", () => {
    expect(BuffSkill.fileParts("Просто текст\n")).toEqual({
      name: undefined,
      description: undefined,
      body: "Просто текст\n",
    })
  })

  test("editing rewrites the name, the description and the instructions — and keeps what else the header holds", () => {
    const text =
      "---\nname: old\ndescription: >\n  старое\n  описание\nmetadata:\n  opencode/autoinvoke: false\nlicense: MIT\n---\nстарый текст\n"
    const next = BuffSkill.fileEdited(text, { name: "Новое", description: "Новое описание", body: "новый текст\n" })
    expect(next).toBe(
      '---\nname: "Новое"\ndescription: "Новое описание"\nmetadata:\n  opencode/autoinvoke: false\nlicense: MIT\n---\n\nновый текст\n',
    )
  })

  test("editing a file that had no header gives it one", () => {
    expect(BuffSkill.fileEdited("старый текст", { name: "n", description: "d", body: "новый" })).toBe(
      '---\nname: "n"\ndescription: "d"\n---\n\nновый\n',
    )
  })
})

describe("where a skill comes from", () => {
  test("the words for each origin — the same in the list and in the input field", () => {
    expect(BuffSkill.scopeLabel("project", ru)).toBe("проект")
    expect(BuffSkill.scopeLabel("user", ru)).toBe("мой")
    expect(BuffSkill.scopeLabel("external", ru)).toBe("подключён")
    expect(BuffSkill.scopeLabel("builtin", ru)).toBe("встроенный")
  })

  test("a suggestion in the input field leads with the origin, then the description", () => {
    expect(BuffSkill.suggestionNote("project", "Когда просят заметки", ru)).toBe("проект · Когда просят заметки")
    expect(BuffSkill.suggestionNote("user", undefined, ru)).toBe("мой")
    expect(BuffSkill.suggestionNote("external", "  ", ru)).toBe("подключён")
  })

  test("an origin not known yet leaves the description as it is", () => {
    expect(BuffSkill.suggestionNote(undefined, "Когда просят заметки", ru)).toBe("Когда просят заметки")
    expect(BuffSkill.suggestionNote(undefined, undefined, ru)).toBeUndefined()
  })
})

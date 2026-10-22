// Горячие клавиши (#460): без модификатора не принимаем, повторы видны, поиск — по нажатому.
import { describe, expect, test } from "bun:test"
import { BuffI18n } from "@opencode/schema/buff-i18n"
import { BuffKeybinds } from "./keybind-rules"

const ru: BuffI18n.T = (s, p) => BuffI18n.t("ru", s, p)

describe("what can be bound", () => {
  test("a letter or a digit alone — no, with the reason", () => {
    expect(ru(BuffKeybinds.problem("k")!)).toBe(
      "Нужен модификатор: Ctrl, Alt или Shift вместе с клавишей — одна клавиша мешала бы набирать текст.",
    )
    expect(ru(BuffKeybinds.problem("shift+k")!)).toBe(
      "Shift с буквой — это просто заглавная буква. Добавьте Ctrl или Alt.",
    )
  })
  test("with a modifier — yes; function keys may stand alone", () => {
    expect(BuffKeybinds.problem("mod+k")).toBeUndefined()
    expect(BuffKeybinds.problem("alt+shift+1")).toBeUndefined()
    expect(BuffKeybinds.problem("f5")).toBeUndefined()
    expect(BuffKeybinds.problem("shift+f2")).toBeUndefined()
  })
})

describe("the same keys on several commands", () => {
  const used = new Map([
    [
      "ctrl+k",
      [
        { id: "a", title: "Палитра" },
        { id: "b", title: "Поиск" },
      ],
    ],
    ["ctrl+j", [{ id: "c", title: "Терминал" }]],
  ])
  test("each command sees who else has them", () => {
    expect(BuffKeybinds.alsoOn(used, ["ctrl+k"], "a")).toEqual(["Поиск"])
    expect(BuffKeybinds.alsoOn(used, ["ctrl+k"], "b")).toEqual(["Палитра"])
    expect(BuffKeybinds.alsoOn(used, ["ctrl+j"], "c")).toEqual([])
  })
})

describe("search by the keys pressed", () => {
  test("finds exactly the commands with that combination", () => {
    const signatures = (id: string) => ({ a: ["ctrl+k"], b: ["ctrl+k", "alt+x"], c: ["ctrl+j"] })[id] ?? []
    expect(BuffKeybinds.withCombo(["a", "b", "c"], signatures, ["ctrl+k"])).toEqual(["a", "b"])
    expect(BuffKeybinds.withCombo(["a", "b", "c"], signatures, ["alt+x"])).toEqual(["b"])
  })
})

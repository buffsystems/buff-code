// Подключённые каталоги навыков в файле конфигурации (#445): настройка `skills`.
import { expect, test } from "bun:test"
import { BuffSkillConfig } from "@opencode/core/buff/skill-config"

test("a source is added to the list, the rest of the file stays", () => {
  const next = BuffSkillConfig.withSource('{\n  // оболочка\n  "shell": "zsh"\n}\n', "~/team-skills", true)
  expect(next).toContain("// оболочка")
  expect(BuffSkillConfig.sources(next)).toEqual(["~/team-skills"])
})

test("a source already there is not added twice", () => {
  const once = BuffSkillConfig.withSource("", "~/team-skills", true)
  expect(BuffSkillConfig.withSource(once, "~/team-skills", true)).toBe(once)
})

test("a source is taken out, the others stay", () => {
  const both = BuffSkillConfig.withSource(BuffSkillConfig.withSource("", "a", true), "b", true)
  expect(BuffSkillConfig.sources(BuffSkillConfig.withSource(both, "a", false))).toEqual(["b"])
})

test("a broken file is refused", () => {
  expect(() => BuffSkillConfig.withSource("{ nope", "a", true)).toThrow("не читается")
})

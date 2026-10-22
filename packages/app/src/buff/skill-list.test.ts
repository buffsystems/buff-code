// Список навыков в настройках (#445): поиск и группы по происхождению.
import { expect, test } from "bun:test"
import type { BuffSkill } from "@opencode/schema/buff-skill"
import { skillGroups } from "./skill-list"

const skill = (id: string, scope: BuffSkill.Origin, more: Partial<BuffSkill.Entry> = {}): BuffSkill.Entry => ({
  id,
  name: id,
  scope,
  enabled: true,
  ...more,
})
const all = [
  skill("release-notes", "project", { name: "Заметки к выпуску", description: "Когда просят заметки" }),
  skill("review", "user", { description: "Как смотреть чужой код" }),
  skill("team", "external"),
  skill("report", "builtin"),
]
const ids = (groups: ReturnType<typeof skillGroups>) =>
  groups.map((group) => [group.scope, group.skills.map((item) => item.id)])

test("skills are grouped by where they come from, in the order one edits them", () => {
  expect(ids(skillGroups(all, "", ["project", "user"]))).toEqual([
    ["project", ["release-notes"]],
    ["user", ["review"]],
    ["external", ["team"]],
    ["builtin", ["report"]],
  ])
})

test("the groups one can add to are shown even when empty; the read-only ones only when they hold something", () => {
  expect(ids(skillGroups([], "", ["user"]))).toEqual([["user", []]])
})

test("server settings do not show project skills — there is no project there", () => {
  expect(ids(skillGroups(all, "", ["user"])).map(([scope]) => scope)).toEqual(["user", "external", "builtin"])
})

test("the search looks in the identifier, the name and the description", () => {
  expect(ids(skillGroups(all, "заметки", ["project", "user"]))).toEqual([["project", ["release-notes"]]])
  expect(ids(skillGroups(all, "ЧУЖОЙ", ["project", "user"]))).toEqual([["user", ["review"]]])
  expect(ids(skillGroups(all, "team", ["project", "user"]))).toEqual([["external", ["team"]]])
  expect(skillGroups(all, "нет такого", ["project", "user"])).toEqual([])
})

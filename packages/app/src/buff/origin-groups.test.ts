// Списки настроек Buff (#445, #446): поиск и группы по происхождению — одни для навыков, команд и субагентов.
import { expect, test } from "bun:test"
import { originGroups } from "./origin-groups"

type Row = { id: string; scope: "project" | "user" | "config" | "builtin"; description?: string }
const rows: Row[] = [
  { id: "deploy", scope: "project", description: "Выкладка на стенд" },
  { id: "sync", scope: "user" },
  { id: "lint", scope: "config" },
  { id: "init", scope: "builtin", description: "Создать AGENTS.md" },
]
const text = (row: Row) => [row.id, row.description ?? ""]
const shape = (groups: ReturnType<typeof originGroups<Row>>) =>
  groups.map((group) => [group.scope, group.items.map((item) => item.id)])

test("groups go in the given order; a group one can add to shows even when empty", () => {
  expect(
    shape(originGroups(rows.slice(1), "", ["project", "user", "config", "builtin"], ["project", "user"], text)),
  ).toEqual([
    ["project", []],
    ["user", ["sync"]],
    ["config", ["lint"]],
    ["builtin", ["init"]],
  ])
})

test("an origin not asked for is not shown", () => {
  expect(shape(originGroups(rows, "", ["user", "builtin"], ["user"], text))).toEqual([
    ["user", ["sync"]],
    ["builtin", ["init"]],
  ])
})

test("a search looks through the given text, case-blind, and drops empty groups", () => {
  expect(
    shape(originGroups(rows, " СТЕНД ", ["project", "user", "config", "builtin"], ["project", "user"], text)),
  ).toEqual([["project", ["deploy"]]])
  expect(originGroups(rows, "нет-такого", ["project", "user"], ["project", "user"], text)).toEqual([])
})

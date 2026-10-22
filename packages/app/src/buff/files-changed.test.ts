// После отката хода файлы на диске другие (#470): панель изменений и чип Git должны перечитаться.
import { expect, test } from "bun:test"
import { filesMayHaveChanged } from "./files-changed"

test("наблюдатель файлов и откат хода — повод перечитать изменения", () => {
  expect(filesMayHaveChanged("filesystem.changed")).toBe(true)
  expect(filesMayHaveChanged("session.revert.staged")).toBe(true)
  expect(filesMayHaveChanged("session.revert.cleared")).toBe(true)
  expect(filesMayHaveChanged("session.revert.committed")).toBe(true)
})

test("правки агента: инструмент, команда оболочки, конец хода (наблюдатель видит не все файлы)", () => {
  expect(filesMayHaveChanged("session.tool.success")).toBe(true)
  expect(filesMayHaveChanged("session.shell.ended")).toBe(true)
  expect(filesMayHaveChanged("session.idle")).toBe(true)
})

test("прочие события — нет", () => {
  expect(filesMayHaveChanged("session.updated")).toBe(false)
  expect(filesMayHaveChanged("session.text.delta")).toBe(false)
  expect(filesMayHaveChanged("vcs.branch.updated")).toBe(false)
})

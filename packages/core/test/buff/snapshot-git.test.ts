// Состояние git для снимков (#495) уходит окну и консоли ответом rpc — JSON-ом.
import { expect, test } from "bun:test"
import { BuffSnapshotGitPlugin } from "../../src/buff/snapshot-git"

// Регрессия: при исправном git ответ нёс `reason: undefined` и не проходил кодирование
// («Expected JSON value at ["output"]») — окно и консоль не получали ничего.
test("a ready git answers without empty fields", () => {
  const answer = BuffSnapshotGitPlugin.status({ repository: "/usr/bin/git", snapshot: "/usr/bin/git" }, true)
  expect(answer).toEqual({ ready: true, repository: true })
  expect(Object.values(answer)).not.toContain(undefined)
})

test("a missing git says why", () => {
  expect(
    BuffSnapshotGitPlugin.status(
      { repository: "/usr/bin/git", snapshot: undefined, missing: { reason: "old", version: "2.25.1" } },
      true,
    ),
  ).toEqual({ ready: false, repository: true, reason: "old", version: "2.25.1" })
  expect(
    BuffSnapshotGitPlugin.status({ repository: "git", snapshot: undefined, missing: { reason: "absent" } }, false),
  ).toEqual({ ready: false, repository: false, reason: "absent" })
})

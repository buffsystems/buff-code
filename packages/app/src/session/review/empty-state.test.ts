// Buff (#467): пустое ревью говорит, почему оно пустое. Без git изменения не загрузятся
// никогда — это сообщение, а не бесконечная загрузка.
import { expect, test } from "bun:test"
import { reviewEmptyState, reviewReady } from "./empty-state"

test("a project without git says so, whatever the mode", () => {
  for (const mode of ["git", "branch", "turn"] as const)
    expect(reviewEmptyState({ mode, ready: false, noGit: true })).toBe("no-git")
})

test("changes still being read show as loading", () => {
  expect(reviewEmptyState({ mode: "git", ready: false, noGit: false })).toBe("loading")
  expect(reviewEmptyState({ mode: "branch", ready: false, noGit: false })).toBe("loading")
})

test("a read that came back empty is an empty review", () => {
  expect(reviewEmptyState({ mode: "git", ready: true, noGit: false })).toBe("empty")
  expect(reviewEmptyState({ mode: "turn", ready: true, noGit: false })).toBe("empty")
})

test("without git there is nothing to wait for — the review is ready at once", () => {
  expect(reviewReady({ mode: "git", pending: true, noGit: true })).toBe(true)
  expect(reviewReady({ mode: "git", pending: true, noGit: false })).toBe(false)
  expect(reviewReady({ mode: "branch", pending: false, noGit: false })).toBe(true)
  expect(reviewReady({ mode: "turn", pending: true, noGit: false })).toBe(true)
})

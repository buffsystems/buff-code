import { expect, test } from "bun:test"
import { createComposerDraft } from "../composer/draft/draft"
import { memoryStorage } from "../../test/storage"
import { followUpDraft, moveFollowUp, restoreFollowUp } from "./follow-up"

const text = (content: string) => [{ type: "text" as const, content, start: 0, end: content.length }]
const draft = () => {
  const storage = memoryStorage()
  return createComposerDraft({ host: { storage: () => storage }, target: { key: "prompt" } })
}
const plain = (value: ReturnType<typeof draft>) =>
  value.current().map((part) => ("content" in part ? part.content : "")).join("")

test("the follow-up stays with its pending tab and moves into the created session's draft", () => {
  followUpDraft("tab-a").set(text("Then explain the setup."))
  expect(followUpDraft("tab-a").current()).toEqual(text("Then explain the setup."))
  const session = draft()
  moveFollowUp("tab-a", session)
  expect(plain(session)).toBe("Then explain the setup.")
  expect(followUpDraft("tab-a").current()).not.toEqual(text("Then explain the setup."))
})

test("a session never made puts the first prompt and the follow-up back in the draft tab", () => {
  followUpDraft("tab-b").set(text("Then explain the setup."))
  const original = draft()
  original.set(text("Create the workspace."))
  restoreFollowUp("tab-b", original)
  expect(plain(original)).toBe("Create the workspace.\n\nThen explain the setup.")
})

test("an empty follow-up leaves the drafts as they are", () => {
  const original = draft()
  original.set(text("Create the workspace."))
  restoreFollowUp("tab-c", original)
  expect(plain(original)).toBe("Create the workspace.")
})

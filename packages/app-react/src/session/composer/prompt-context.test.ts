import { expect, test } from "bun:test"
import { memoryStorage } from "../../test/storage"
import { promptContext } from "../../core/prompt-context"
import { createComposerDraft } from "./draft/draft"
import { draftPromptTarget } from "./draft/target"
import { historyComments, mirrorPromptContext, promptContextActions } from "./prompt-context"

const host = { storage: () => memoryStorage() }

test("review comments staged by the panes show in the draft, follow edits and leave with removal", async () => {
  const key = "scope\u0000session-a"
  const draft = createComposerDraft({ host, target: draftPromptTarget("mirror") })
  await draft.ready
  const stop = mirrorPromptContext(draft, key)
  const comment = promptContext.comments.add(key, { file: "a.ts", selection: { start: 3, end: 5 }, comment: "check" })
  promptContext.context.add(key, {
    type: "file",
    path: "a.ts",
    selection: { startLine: 3, endLine: 5, startChar: 0, endChar: 0 },
    comment: "check",
    commentID: comment.id,
    commentOrigin: "review",
  })
  expect(draft.contextItems().map((item) => item.comment)).toEqual(["check"])
  promptContext.context.updateComment(key, "a.ts", comment.id, { comment: "check twice" })
  expect(draft.contextItems().map((item) => item.comment)).toEqual(["check twice"])
  expect(historyComments(draft.contextItems())).toMatchObject([{ path: "a.ts", selection: { start: 3, end: 5 } }])
  const item = draft.contextItems()[0]
  if (item) promptContextActions(key).remove(item)
  expect(promptContext.read(key).comments).toHaveLength(0)
  expect(draft.contextItems()).toHaveLength(0)
  stop()
})

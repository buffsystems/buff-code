import { expect, test } from "bun:test"
import { contextKey, createPromptContext, selectionFromLines } from "./prompt-context"

const key = "local\u0000ZGly/ses_1"

test("a review comment is kept, focused and staged once in the prompt context", () => {
  const ids = ["c1", "c2"]
  const context = createPromptContext(() => ids.shift()!, () => 7)
  const comment = context.comments.add(key, { file: "a.ts", selection: { start: 2, end: 2 }, comment: "Use it" })
  expect(comment).toEqual({ id: "c1", file: "a.ts", selection: { start: 2, end: 2 }, comment: "Use it", time: 7 })
  expect(context.read(key).focus).toEqual({ file: "a.ts", id: "c1" })
  const item = {
    type: "file" as const,
    path: "a.ts",
    selection: selectionFromLines(comment.selection),
    comment: "Use it",
    commentID: "c1",
    commentOrigin: "review" as const,
  }
  context.context.add(key, item)
  context.context.add(key, item)
  expect(context.read(key).context).toHaveLength(1)
  context.context.updateComment(key, "a.ts", "c1", { comment: "Use that" })
  expect(context.read(key).context[0]?.comment).toBe("Use that")
  context.comments.remove(key, "a.ts", "c1")
  context.context.removeComment(key, "a.ts", "c1")
  expect(context.read(key)).toEqual({ comments: [], context: [], focus: null })
})

test("selectionFromLines orders the lines and the key names the range", () => {
  expect(selectionFromLines({ start: 9, end: 3 })).toEqual({ startLine: 3, endLine: 9, startChar: 0, endChar: 0 })
  expect(contextKey({ type: "file", path: "a.ts", selection: selectionFromLines({ start: 1, end: 2 }) })).toBe(
    "file:a.ts:1-2:",
  )
})

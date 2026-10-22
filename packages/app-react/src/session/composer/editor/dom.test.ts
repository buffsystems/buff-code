import { expect, test } from "bun:test"
import { parseEditor, renderEditor } from "./dom"

test("mentions render as non-editable spans and parse back with their part", () => {
  const editor = document.createElement("div")
  renderEditor(editor, [
    { type: "text", content: "see ", start: 0, end: 4 },
    { type: "file", path: "src/a.ts", content: "@src/a.ts", start: 4, end: 13 },
    { type: "agent", name: "review", content: "@review", start: 13, end: 20 },
  ])
  const mention = editor.querySelector<HTMLElement>('[data-mention="file"]')
  expect(mention?.contentEditable).toBe("false")
  expect(parseEditor(editor)).toEqual([
    { type: "text", content: "see ", start: 0, end: 4 },
    { type: "file", path: "src/a.ts", content: "@src/a.ts", start: 4, end: 13 },
    { type: "agent", name: "review", content: "@review", start: 13, end: 20 },
  ])
})

test("line breaks and blank content read as one empty text part", () => {
  const editor = document.createElement("div")
  editor.innerHTML = "one<br>two"
  expect(parseEditor(editor)).toEqual([{ type: "text", content: "one\ntwo", start: 0, end: 7 }])
  editor.innerHTML = "<br>"
  expect(parseEditor(editor)).toEqual([{ type: "text", content: "", start: 0, end: 0 }])
})

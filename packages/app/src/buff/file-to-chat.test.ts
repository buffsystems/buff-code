// «Добавить в чат» (#451): файл или его строки становятся упоминанием в поле ввода.
import { expect, test } from "bun:test"
import { withMention } from "./file-to-chat-prompt"

const text = (content: string, start = 0) => ({ type: "text" as const, content, start, end: start + content.length })

test("into an empty field: the mention and a space to keep typing", () => {
  expect(withMention([text("")], { path: "src/a.ts" })).toEqual({
    prompt: [{ type: "file", path: "src/a.ts", content: "@src/a.ts", start: 0, end: 9 }, text(" ", 9)],
    cursor: 10,
    mention: "@src/a.ts",
  })
})

test("after what is already typed — through a space", () => {
  const result = withMention([text("Посмотри")], { path: "a.ts" })
  expect(result.prompt.map((part) => ("content" in part ? part.content : "")).join("")).toBe("Посмотри @a.ts ")
  expect(result.prompt[2]).toMatchObject({ type: "file", path: "a.ts", start: 9, end: 14 })
  expect(result.cursor).toBe(15)
})

test("selected lines are named in the mention and travel with it", () => {
  const selection = { startLine: 3, startChar: 0, endLine: 7, endChar: 0 }
  const result = withMention([text("")], { path: "a.ts", selection })
  expect(result.prompt[0]).toEqual({ type: "file", path: "a.ts", content: "@a.ts:3-7", start: 0, end: 9, selection })
})

test("one line is named without a range", () => {
  const selection = { startLine: 5, startChar: 0, endLine: 5, endChar: 0 }
  expect(withMention([text("")], { path: "a.ts", selection }).prompt[0]).toMatchObject({ content: "@a.ts:5" })
})

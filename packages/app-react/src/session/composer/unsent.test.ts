import { expect, test } from "bun:test"
import type { Prompt } from "@opencode/app/react-reuse/composer-schema"
import { hasUnsent, joined } from "./unsent"

const text = (content: string): Prompt[number] => ({ type: "text", content, start: 0, end: content.length })

test("an empty box, or one with only spaces, holds nothing unsent", () => {
  expect(hasUnsent([])).toBe(false)
  expect(hasUnsent([text("")])).toBe(false)
  expect(hasUnsent([text("  \n ")])).toBe(false)
})

test("typed text or an attachment is the person's unsent work", () => {
  expect(hasUnsent([text("half a thought")])).toBe(true)
  expect(
    hasUnsent([text(""), { type: "file", path: "a.txt", content: "@a.txt", start: 0, end: 6 } as Prompt[number]]),
  ).toBe(true)
})

test("bringing text back after typing keeps both texts, mentions in their places, and the files of both", () => {
  const image = (id: string) =>
    ({ type: "image", id, filename: `${id}.png`, mime: "image/png", dataUrl: "data:" }) as unknown as Prompt[number]
  const mention = { type: "file", path: "a.ts", content: "@a.ts", start: 8, end: 13 } as Prompt[number]
  const now: Prompt = [
    text("look at "),
    mention,
    { type: "text", content: " and fix", start: 13, end: 21 },
    image("now"),
  ]
  const kept: Prompt = [text("set aside"), image("kept")]
  const result = joined(now, kept)
  const words = result.flatMap((part) => ("content" in part ? [part.content] : [])).join("")
  expect(words).toBe("look at @a.ts and fix\n\nset aside")
  // The mention is still a mention, where it stood.
  expect(result.find((part) => part.type === "file")).toMatchObject({ path: "a.ts", start: 8, end: 13 })
  expect(result.filter((part) => part.type === "image").map((part) => (part as { id: string }).id)).toEqual([
    "now",
    "kept",
  ])
})

test("an empty side adds no blank lines", () => {
  const words = (prompt: Prompt) => prompt.flatMap((part) => ("content" in part ? [part.content] : [])).join("")
  expect(words(joined([text("")], [text("only this")]))).toBe("only this")
  expect(words(joined([text("typed")], [text("  ")]))).toBe("typed")
})

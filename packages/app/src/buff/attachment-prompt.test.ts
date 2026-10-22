// Чип вставленного текста (#459): «Развернуть в текст» возвращает текст в поле ввода целиком.
import { expect, test } from "bun:test"
import type { Prompt } from "@/composer/state"
import { chipPart, expandChip } from "./attachment-prompt"

const text = (content: string, start = 0) => ({ type: "text" as const, content, start, end: start + content.length })

test("into an empty field the text goes as it is", () => {
  const chip = chipPart("paste", "один\nдва\nтри", "c1")
  const prompt = [text(""), chip] as Prompt
  expect(expandChip(prompt, "c1")).toEqual([text("один\nдва\nтри")])
})

test("after what was typed — on a new paragraph; other attachments stay", () => {
  const chip = chipPart("quote", "цитата", "c1")
  const image = { type: "path" as const, id: "f1", filename: "a.txt", mime: "text/plain", path: "/a.txt" }
  const prompt = [text("Посмотри"), image, chip] as Prompt
  const next = expandChip(prompt, "c1")
  expect(next.filter((part) => part.type === "text").map((part) => ("content" in part ? part.content : ""))).toEqual([
    "Посмотри",
    "\n\n",
    "> цитата",
  ])
  expect(next.some((part) => part.type === "path")).toBe(true)
  expect(next.some((part) => part.type === "buff-text")).toBe(false)
})

test("an unknown chip changes nothing", () => {
  const prompt = [text("x")] as Prompt
  expect(expandChip(prompt, "nope")).toEqual(prompt)
})

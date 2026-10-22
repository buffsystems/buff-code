// Побочный диалог (#464): выделенный фрагмент ложится в его поле ввода цитатой.
import { expect, test } from "bun:test"
import { quoteForSide, setSideDraft, sideDraft } from "./drafts"

test("a fragment becomes a markdown quote with room to ask", () => {
  expect(quoteForSide("раз\nдва")).toBe("> раз\n> два\n\n")
})

test("drafts are kept per side conversation", () => {
  setSideDraft("a", "x")
  expect(sideDraft("a")).toBe("x")
  expect(sideDraft("b")).toBe("")
})

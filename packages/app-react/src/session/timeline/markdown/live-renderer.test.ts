import { expect, test } from "bun:test"
import { createMarkdownRenderer } from "./live-renderer"

test("keeps the words already on screen and animates only the new ones", () => {
  const root = document.createElement("div")
  const renderer = createMarkdownRenderer(root, "<p>Hello wor</p>", true)
  const first = root.querySelector("[data-markdown-word]")
  expect(first?.hasAttribute("data-markdown-enter")).toBe(false)

  renderer.update("<p>Hello world again</p>", true)
  const words = [...root.querySelectorAll("[data-markdown-word]")]
  expect(words.map((word) => word.textContent)).toEqual(["Hello", "world", "again"])
  expect(words[0]).toBe(first!)
  expect(words[2]?.hasAttribute("data-markdown-enter")).toBe(true)
})

test("replaces an element whose tag changed and drops removed nodes", () => {
  const root = document.createElement("div")
  const renderer = createMarkdownRenderer(root, "<p>a</p><p>b</p>", false)
  renderer.update("<h1>a</h1>", false)
  expect(root.innerHTML).toBe("<h1>a</h1>")
})

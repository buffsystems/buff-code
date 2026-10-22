import { expect, test } from "bun:test"
import { previewImages } from "./image-preview"

test("images open the preview by click and by Enter", () => {
  const root = document.createElement("div")
  root.innerHTML = '<img src="https://example.test/a.png" alt="Diagram"><img src="https://example.test/b.png">'
  const opened: string[] = []
  previewImages(root, (src, alt) => opened.push(`${alt}:${src}`), "Image")
  const [first, second] = [...root.querySelectorAll("img")]
  expect(first?.getAttribute("role")).toBe("button")
  expect(second?.getAttribute("aria-label")).toBe("Image")
  first?.click()
  second?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }))
  expect(opened).toEqual(["Diagram:https://example.test/a.png", ":https://example.test/b.png"])
})

import { afterEach, expect, test } from "bun:test"
import { settle } from "../test/render"
import { renderSessionSlot } from "../session/test"
import { ArtifactCard } from "./panels"

const cleanup: (() => void)[] = []
afterEach(() => cleanup.splice(0).forEach((run) => run()))

test("a markdown artifact renders as markdown, as in the Solid window — not as its source", async () => {
  const artifact = { id: "report", kind: "markdown" as const, version: 1, title: "Review", content: "# Review\n\n- **src/cart.js:19** — high" }
  const view = renderSessionSlot(<ArtifactCard artifact={artifact} items={[]} />)
  cleanup.push(view.unmount)
  await settle()
  const body = view.element.querySelector('[data-component="markdown"]')
  expect(body).not.toBeNull()
  expect(body?.classList.contains("buff-wf-markdown")).toBe(true)
})

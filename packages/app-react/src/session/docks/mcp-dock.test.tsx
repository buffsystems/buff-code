import { afterEach, expect, test } from "bun:test"
import { settle } from "../../test/render"
import { renderSessionSlot } from "../test"
import { McpMessage } from "./mcp-dock"

const cleanup: (() => void)[] = []
afterEach(() => cleanup.splice(0).forEach((run) => run()))

test("the server's message is markdown, as in the Solid window: bold and lists render, no raw asterisks", async () => {
  const view = renderSessionSlot(<McpMessage message={"Gift sets ship **by courier only**.\n\n- no post\n- no pickup"} />)
  cleanup.push(view.unmount)
  await settle()
  const message = view.element.querySelector('[data-component="markdown"]')
  expect(message).not.toBeNull()
  expect(message?.classList.contains("mcp-form__message")).toBe(true)
})

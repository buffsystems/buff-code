import { afterEach, expect, test } from "bun:test"
import type { SessionMessageInfo } from "@opencode/client/promise"
import { act } from "react"
import { createMemoryHistory } from "../../router/history"
import { RouterProvider } from "../../router/router"
import { settle } from "../../test/render"
import { renderSessionSlot } from "../test"
import { QueryMap } from "./query-map"

const cleanup: (() => void)[] = []
afterEach(() => cleanup.splice(0).forEach((run) => run()))

const user = (id: string, text: string): SessionMessageInfo => ({ id, type: "user", text, time: { created: 1 } })

async function mount(messages: SessionMessageInfo[]) {
  const history = createMemoryHistory("/server/s/session/ses_test")
  const view = renderSessionSlot(
    <RouterProvider history={history}>
      <QueryMap />
    </RouterProvider>,
  )
  cleanup.push(view.unmount)
  act(() =>
    view.server.data.state.set((state) => ({
      ...state,
      session: { ...state.session, message: { ...state.session.message, ses_test: messages } },
    })),
  )
  await settle()
  return { ...view, history }
}

test("the request map shows a tick per request once a session has two (#465)", async () => {
  const one = await mount([user("msg_1", "Run the tests")])
  expect(one.element.querySelectorAll('[data-action="buff-query-jump"]').length).toBe(0)

  const two = await mount([user("msg_1", "Run the tests"), user("msg_2", "Start a command in the background")])
  const ticks = two.element.querySelectorAll<HTMLButtonElement>('[data-action="buff-query-jump"]')
  expect(ticks.length).toBe(2)
  expect(ticks[1]?.getAttribute("aria-label")).toBe("Go to request 2")
})

test("a tick jumps to its request: the address names the message", async () => {
  const view = await mount([user("msg_1", "Run the tests"), user("msg_2", "Start a command in the background")])
  act(() => view.element.querySelectorAll<HTMLButtonElement>('[data-action="buff-query-jump"]')[0]?.click())
  expect(view.history.location.get().hash).toBe("#message-msg_1")
})

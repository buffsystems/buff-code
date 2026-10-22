import { expect, test } from "bun:test"
import type { SessionMessageInfo } from "@opencode/client/promise"
import { model } from "../../core/data/fixtures"
import { enrichLeadingTurn, leadingTurnNeedsParent } from "./interaction"

const user = (id: string): SessionMessageInfo => ({ id, type: "user", text: id, time: { created: 1 } })
const assistant = (id: string): SessionMessageInfo => ({
  id,
  type: "assistant",
  agent: "build",
  model,
  content: [],
  time: { created: 1, completed: 2 },
})

test("a page that starts with an answer needs its prompt", () => {
  expect(leadingTurnNeedsParent([assistant("a"), user("b")])).toBe(true)
  expect(leadingTurnNeedsParent([user("a"), assistant("b")])).toBe(false)
  expect(leadingTurnNeedsParent([user("a")])).toBe(false)
})

test("loads older pages until the leading answer has its prompt, at most the page limit", async () => {
  const pages = [[assistant("c")], [assistant("b")], [user("a")]]
  const messages = [assistant("d")]
  const loaded: number[] = []
  await enrichLeadingTurn({
    current: () => true,
    messages: () => messages,
    more: () => pages.length > 0,
    loading: () => false,
    loadMore: async () => {
      messages.unshift(...pages.shift()!)
      loaded.push(messages.length)
    },
    pause: async () => undefined,
    maxPages: 2,
  })
  expect(loaded).toEqual([2, 3])
  expect(leadingTurnNeedsParent(messages)).toBe(true)
})

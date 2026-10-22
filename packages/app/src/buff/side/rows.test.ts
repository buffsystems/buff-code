// Побочный диалог в окне (#464): строки компактной ленты из сообщений сессии.
import { expect, test } from "bun:test"
import { sideRows } from "./rows"

test("only what was said since the side conversation opened; tools as short labels; service messages left out", () => {
  const rows = sideRows(
    [
      { id: "u0", type: "user", text: "до побочного", time: { created: 5 } },
      { id: "u1", type: "user", text: "Что значит X?", time: { created: 10 } },
      { id: "s1", type: "synthetic", text: "служебное", time: { created: 11 } },
      {
        id: "a1",
        type: "assistant",
        time: { created: 12 },
        content: [
          { type: "reasoning", text: "думаю" },
          { type: "tool", name: "read", state: { status: "completed", input: { path: "a.ts" } } },
          { type: "text", text: "X — это" },
          { type: "text", text: " переменная." },
        ],
      },
    ],
    10,
  )
  expect(rows).toEqual([
    { id: "u1", role: "user", text: "Что значит X?", tools: [] },
    { id: "a1", role: "assistant", text: "X — это переменная.", tools: ["read"] },
  ])
})

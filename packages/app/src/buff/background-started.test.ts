// Фоновая работа (#456): у каждой строки списка есть время начала — от него идёт время работы.
import { expect, test } from "bun:test"
import { createRoot } from "solid-js"
import { createSessionBackground } from "@/session/requests/background"

const tool = (name: string, input: Record<string, unknown>, metadata: Record<string, unknown>, ran: number) => ({
  type: "tool",
  id: `part_${name}`,
  name,
  state: { status: "completed", input, metadata: { status: "running", ...metadata } },
  time: { created: ran - 5, ran },
})

test("background work started by the model carries its start time; a live shell — its own", () => {
  createRoot((dispose) => {
    const background = createSessionBackground({
      sessionID: () => "ses_1",
      messages: () =>
        [
          {
            type: "assistant",
            id: "msg_1",
            time: { created: 1, completed: 2 },
            content: [
              tool("subagent", { description: "Inspect logs", agent: "general" }, { sessionID: "ses_child" }, 1_000),
              tool("shell", { command: "npm test" }, { shellID: "sh_1" }, 2_000),
            ],
          },
        ] as never,
      sessions: () => [{ id: "ses_live", parentID: "ses_1", title: "Live", time: { created: 3_000 } }] as never,
      status: () => "running",
      shells: () =>
        [
          {
            id: "sh_2",
            command: "sleep 60",
            status: "running",
            metadata: { sessionID: "ses_1" },
            time: { started: 4_000 },
          },
        ] as never,
    })
    expect(background.tasks().map((task) => [task.id, task.started])).toEqual([
      ["ses_child", 1_000],
      ["ses_live", 3_000],
      ["sh_1", 2_000],
      ["sh_2", 4_000],
    ])
    dispose()
  })
})

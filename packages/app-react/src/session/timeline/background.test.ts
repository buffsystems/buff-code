import { expect, test } from "bun:test"
import type { SessionMessageAssistant, SessionMessageInfo } from "@opencode/client/promise"
import { model, session } from "../../core/data/fixtures"
import { emptyData, locationKey, type DataState } from "../../core/data/state"
import { createBackgroundSelector, sessionBackground } from "./background"

const running = (id: string, name: "shell" | "subagent", metadata: Record<string, string>, input: Record<string, string>) => ({
  type: "tool" as const,
  id,
  name,
  time: { created: 1 },
  state: { status: "running" as const, input, metadata },
})

function state(messages: SessionMessageInfo[], patch: Partial<DataState["session"]> = {}): DataState {
  const base = emptyData("/repo")
  return {
    ...base,
    session: {
      ...base.session,
      info: { ses_1: session("ses_1"), ses_child: session("ses_child", { parentID: "ses_1", title: "Child" }) },
      message: { ses_1: messages },
      ...patch,
    },
  }
}

const turn = (content: SessionMessageAssistant["content"], completed?: number): SessionMessageInfo => ({
  id: "msg_a",
  type: "assistant",
  agent: "build",
  model,
  content,
  time: { created: 1, ...(completed ? { completed } : {}) },
})

test("running shell and subagent calls of the open turn can move to the background", () => {
  const result = sessionBackground(
    state([
      turn([
        running("call_shell", "shell", { shellID: "sh_1" }, { command: "sleep 9" }),
        running("call_agent", "subagent", { sessionID: "ses_child" }, { description: "Child" }),
      ]),
    ], { active: { ses_child: "running" } }),
    "ses_1",
  )
  expect(result.blocking.map((item) => item.partID)).toEqual(["call_shell", "call_agent"])
  // The blocking child is not listed again as background work.
  expect(result.tasks).toEqual([])
})

test("work already sent to the background is listed until its completion notice", () => {
  const backgrounded: SessionMessageAssistant["content"][number] = {
    type: "tool",
    id: "call_bg",
    name: "shell",
    time: { created: 1, ran: 2 },
    state: { status: "completed", input: { command: "sleep 120" }, metadata: { shellID: "sh_bg", status: "running" }, content: [{ type: "text", text: "working" }] },
  }
  const before = state([turn([backgrounded], 3)])
  expect(sessionBackground(before, "ses_1").tasks).toEqual([{ id: "sh_bg", type: "shell", label: "sleep 120", started: 2 }])
  const done = state([
    turn([backgrounded], 3),
    { id: "msg_n", type: "synthetic", text: "done", metadata: { source: "shell", shellID: "sh_bg" }, time: { created: 4 } },
  ])
  expect(sessionBackground(done, "ses_1").tasks).toEqual([])
})

test("running shells of the session's location and busy children are listed", () => {
  const base = state([], { active: { ses_child: "running" } })
  const withShell: DataState = {
    ...base,
    location: {
      [locationKey({ directory: "/repo" })]: {
        shell: {
          sh_x: {
            id: "sh_x",
            status: "running",
            command: "make",
            cwd: "/repo",
            shell: "bash",
            file: "/tmp/x",
            metadata: { sessionID: "ses_1" },
            time: { started: 5 },
            location: { directory: "/repo" },
          },
        },
      },
    },
  }
  expect(sessionBackground(withShell, "ses_1").tasks.map((task) => task.id).toSorted()).toEqual(["ses_child", "sh_x"])
})

test("a child session has no background work of its own", () => {
  expect(sessionBackground(state([], { active: { ses_child: "running" } }), "ses_child")).toEqual({ blocking: [], tasks: [] })
})

test("the selector keeps its result while unrelated state changes", () => {
  const select = createBackgroundSelector("ses_1")
  const first = state([], { active: { ses_child: "running" } })
  const value = select(first)
  expect(select({ ...first, defaultLocation: { directory: "/other" } })).toBe(value)
  expect(select({ ...first, session: { ...first.session, active: { ses_child: "running" } } })).toBe(value)
})

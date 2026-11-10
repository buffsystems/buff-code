import { describe, expect, test } from "bun:test"
import type { SessionMessageInfo } from "@opencode/client"
import { contextCapLabel, contextSwitchText, contextUsage, lastAssistantWithUsage, sessionFamily } from "../../src/util/session"

const assistant = (id: string, input: number): SessionMessageInfo => ({
  id,
  type: "assistant",
  agent: "build",
  model: { id: "model", providerID: "provider" },
  content: [],
  tokens: { input, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  time: { created: 0 },
})

describe("util.session", () => {
  test("flattens nested subagents from any session in the family", () => {
    const sessions = [
      { id: "root" },
      { id: "child-a", parentID: "root" },
      { id: "grandchild-a", parentID: "child-a" },
      { id: "great-grandchild-a", parentID: "grandchild-a" },
      { id: "grandchild-a2", parentID: "child-a" },
      { id: "child-b", parentID: "root" },
      { id: "grandchild-b", parentID: "child-b" },
    ]

    expect(sessionFamily(sessions, "great-grandchild-a")).toEqual([
      { session: sessions[1], prefix: "" },
      { session: sessions[2], prefix: "├─ " },
      { session: sessions[3], prefix: "│  └─ " },
      { session: sessions[4], prefix: "└─ " },
      { session: sessions[5], prefix: "" },
      { session: sessions[6], prefix: "└─ " },
    ])
  })

  test("tracks usage across undo and redo boundaries", () => {
    const messages = [assistant("msg_z", 10), assistant("msg_a", 30)]

    expect(lastAssistantWithUsage(messages)?.tokens.input).toBe(30)
    expect(lastAssistantWithUsage(messages, "msg_a")?.tokens.input).toBe(10)
    expect(lastAssistantWithUsage(messages, "msg_missing")).toBeUndefined()
    expect(lastAssistantWithUsage(messages)?.tokens.input).toBe(30)
  })

  test("resets usage at completed compaction until the next assistant reports it", () => {
    const compaction: SessionMessageInfo = {
      id: "msg_compaction",
      type: "compaction",
      status: "completed",
      reason: "manual",
      summary: "Current state",
      recent: "",
      time: { created: 0 },
    }
    const messages = [assistant("msg_before", 30), compaction]

    expect(lastAssistantWithUsage(messages)).toBeUndefined()

    messages.push(assistant("msg_after", 5))
    expect(lastAssistantWithUsage(messages)?.tokens.input).toBe(5)
  })
})

// Окно контекста (#837): занятость — от окна модели, урезанного потолком сессии; строка ленты.
describe("context usage against the session cap", () => {
  const assistant = (tokens: number): SessionMessageInfo =>
    ({
      id: "a1",
      type: "assistant",
      agent: "build",
      model: { id: "m", providerID: "p" },
      time: { created: 1, completed: 2 },
      content: [],
      tokens: { input: tokens, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    }) as unknown as SessionMessageInfo
  const models = [{ id: "m", providerID: "p", limit: { context: 400_000 } }] as never
  test("percent follows the cap when it is below the model's window", () => {
    expect(contextUsage([assistant(100_000)], models)).toEqual({ tokens: 100_000, percent: 25 })
    expect(contextUsage([assistant(100_000)], models, undefined, 200_000)).toEqual({ tokens: 100_000, percent: 50 })
    expect(contextUsage([assistant(100_000)], models, undefined, 800_000)).toEqual({ tokens: 100_000, percent: 25 })
  })
  test("the prompt names the cap only when it is below the model's window", () => {
    expect(contextCapLabel(200_000, 400_000)).toBe("200k")
    expect(contextCapLabel(200_000, undefined)).toBe("200k")
    expect(contextCapLabel(400_000, 400_000)).toBeUndefined()
    expect(contextCapLabel(800_000, 400_000)).toBeUndefined()
    expect(contextCapLabel(0, 400_000)).toBeUndefined()
    expect(contextCapLabel(undefined, 400_000)).toBeUndefined()
  })
  test("the timeline row names the limit now in force", () => {
    const t = (text: string, params?: Record<string, unknown>) =>
      text.replace(/\{(\w+)\}/g, (_, key: string) => String(params?.[key]))
    expect(contextSwitchText({ limit: { context: 200_000 } }, t)).toBe("Context limit: Mid-size, 200k")
    expect(contextSwitchText({}, t)).toBe("Context limit: Model maximum")
  })
})

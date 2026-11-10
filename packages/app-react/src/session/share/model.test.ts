import { describe, expect, test } from "bun:test"
import type { SessionMessageInfo } from "@opencode/client/promise"
import { createInput, defaultTitle, expiresAtFor, previews } from "./model"

const messages = [
  { id: "u1", type: "user", text: "  Привет,\n как дела?  ", time: { created: 1 } },
  {
    id: "u2",
    type: "user",
    text: "",
    files: [{ mime: "image/png", data: "", source: { type: "uri", uri: "x" } }],
    time: { created: 2 },
  },
  {
    id: "a1",
    type: "assistant",
    content: [
      { type: "reasoning", text: "хм" },
      { type: "text", text: "Хорошо." },
      { type: "text", text: "А у вас?" },
    ],
    time: { created: 3 },
  },
  {
    id: "a2",
    type: "assistant",
    content: [{ type: "tool", id: "t", name: "bash", state: { status: "running", input: {} } }],
    time: { created: 4 },
  },
  { id: "s1", type: "system", text: "служебное", time: { created: 5 } },
] as unknown as SessionMessageInfo[]

describe("share dialog model", () => {
  test("previews list prompts and answers with text, one line each; service entries stay out", () => {
    expect(previews(messages)).toEqual([
      { id: "u1", role: "user", text: "Привет, как дела?" },
      { id: "u2", role: "user", text: "📎 1" },
      { id: "a1", role: "assistant", text: "Хорошо. А у вас?" },
    ])
  })

  test("the title defaults to the session's; the expiry presets count from now", () => {
    expect(defaultTitle("  Разбор  ", "Без названия")).toBe("Разбор")
    expect(defaultTitle(undefined, "Без названия")).toBe("Без названия")
    expect(expiresAtFor("none", 1000)).toBeNull()
    expect(expiresAtFor("1h", 1000)).toBe(1000 + 3_600_000)
    expect(expiresAtFor("30d", 0)).toBe(30 * 86_400_000)
  })

  test("the form becomes the service's input; an empty title or selection is refused", () => {
    const base = {
      session: "s",
      mode: "all" as const,
      selected: new Set<string>(),
      title: " T ",
      pass: "",
      expiry: "1d" as const,
      tools: true,
      live: false,
      nowMs: 10,
    }
    expect(createInput(base)).toEqual({
      session: "s",
      title: "T",
      expiresAt: 10 + 86_400_000,
      tools: true,
      live: false,
    })
    expect(createInput({ ...base, title: " " })).toEqual({ error: "title" })
    expect(createInput({ ...base, mode: "some" })).toEqual({ error: "selection" })
    expect(createInput({ ...base, mode: "some", selected: new Set(["u1"]), pass: "pw", expiry: "none" })).toEqual({
      session: "s",
      messages: ["u1"],
      title: "T",
      pass: "pw",
      expiresAt: null,
      tools: true,
      live: false,
    })
  })
})

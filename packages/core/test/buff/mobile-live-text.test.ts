// Ответ, который ещё пишется (#969): движок хранит текст и размышления модели только целиком, по
// окончании части, а пока она идёт — рассылает фрагменты. Телефон и веб-клиент видят сессию снимками,
// поэтому растущий текст подставляется в снимок: ответ появляется по мере написания.
import { describe, expect, test } from "bun:test"
import { liveText } from "../../src/buff/mobile/live-text"

const started = (kind: "text" | "reasoning", ordinal: number) => ({
  type: `session.${kind}.started`,
  data: { sessionID: "s1", assistantMessageID: "m1", ordinal },
})
const delta = (kind: "text" | "reasoning", ordinal: number, text: string) => ({
  type: `session.${kind}.delta`,
  data: { sessionID: "s1", assistantMessageID: "m1", ordinal, delta: text },
})
const ended = (kind: "text" | "reasoning", ordinal: number) => ({
  type: `session.${kind}.ended`,
  data: { sessionID: "s1", assistantMessageID: "m1", ordinal, text: "whole" },
})
const stored = () => [
  { id: "u1", type: "user", text: "hi" },
  {
    id: "m1",
    type: "assistant",
    content: [
      { type: "reasoning", text: "" },
      { type: "text", text: "" },
      { type: "tool", id: "t1", name: "read", state: { status: "running", input: {} } },
      { type: "text", text: "" },
    ],
  },
]

describe("a part being written", () => {
  test("its text so far stands in the snapshot — by the part's kind and its place among parts of that kind", () => {
    const live = liveText()
    for (const event of [started("reasoning", 0), delta("reasoning", 0, "Дума"), delta("reasoning", 0, "ю"), started("text", 1), delta("text", 1, "Вто"), delta("text", 1, "рой")])
      live.event(event.type, event.data)
    const [user, answer] = live.apply(stored()) as any[]
    expect(user).toEqual({ id: "u1", type: "user", text: "hi" })
    expect(answer.content.map((part: any) => part.text)).toEqual(["Думаю", "", undefined, "Второй"])
    // The part still being written is marked, so a client can say «пишет ответ» / «думает».
    expect(answer.content.map((part: any) => part.streaming)).toEqual([true, undefined, undefined, true])
  })

  test("a finished part is the store's again; what the store already holds is never overwritten", () => {
    const live = liveText()
    live.event(started("text", 0).type, started("text", 0).data)
    live.event(delta("text", 0, "черновик").type, delta("text", 0, "черновик").data)
    const whole = [{ id: "m1", type: "assistant", content: [{ type: "text", text: "готовый текст" }] }]
    expect(live.apply(whole)).toEqual(whole)
    live.event(ended("text", 0).type, ended("text", 0).data)
    const messages = [{ id: "m1", type: "assistant", content: [{ type: "text", text: "" }] }]
    expect(live.apply(messages)).toEqual(messages)
  })

  test("a snapshot without parts being written comes back as it is — the same object", () => {
    const live = liveText()
    const messages = stored()
    expect(live.apply(messages)).toBe(messages)
    expect(live.event("session.renamed", { sessionID: "s1" })).toBe(false)
    expect(live.event(delta("text", 0, "x").type, delta("text", 0, "x").data)).toBe(true)
  })

  test("a step that ended or failed, and a session that went idle, leave nothing behind", () => {
    const live = liveText()
    live.event(started("text", 0).type, started("text", 0).data)
    live.event(delta("text", 0, "a").type, delta("text", 0, "a").data)
    expect(live.size()).toBe(1)
    live.event("session.step.failed", { sessionID: "s1", assistantMessageID: "m1" })
    expect(live.size()).toBe(0)
    live.event(started("text", 0).type, started("text", 0).data)
    live.event("session.execution.interrupted", { sessionID: "s1" })
    expect(live.size()).toBe(0)
  })
})

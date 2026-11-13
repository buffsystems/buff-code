import { describe, expect, test } from "bun:test"
import { sentMessages } from "../../src/buff/mobile/delta"

const m = (id: string, text: string) => ({ id, type: "assistant", content: [{ type: "text", text }] })

describe("sentMessages (#908)", () => {
  test("a phone gets only the messages that changed since it was last sent them", () => {
    const sent = sentMessages()
    expect(sent.fresh("phone", "s", [m("a", "1"), m("b", "2")])).toEqual([m("a", "1"), m("b", "2")])
    expect(sent.fresh("phone", "s", [m("a", "1"), m("b", "2 и ещё")])).toEqual([m("b", "2 и ещё")])
    expect(sent.fresh("phone", "s", [m("a", "1"), m("b", "2 и ещё")])).toEqual([])
  })

  test("each phone and each session is counted apart", () => {
    const sent = sentMessages()
    sent.fresh("one", "s", [m("a", "1")])
    expect(sent.fresh("two", "s", [m("a", "1")])).toEqual([m("a", "1")])
    expect(sent.fresh("one", "t", [m("a", "1")])).toEqual([m("a", "1")])
  })

  test("a phone that watches anew gets everything again", () => {
    const sent = sentMessages()
    sent.fresh("phone", "s", [m("a", "1")])
    sent.forget("phone", "s")
    expect(sent.fresh("phone", "s", [m("a", "1")])).toEqual([m("a", "1")])
  })
})

// Живая проверка плагина чатов (#595, #984): ядро ждёт, что клиент нарисует примеры и ответит.
import { describe, expect, test } from "bun:test"
import { BuffChatPluginTests } from "../../src/buff/chat-plugin-tests"

describe("waiting for the app to draw the examples", () => {
  test("ends as soon as every example is answered for", async () => {
    const desk = BuffChatPluginTests.make()
    const waiting = desk.wait("ses_1:call_1", ["a", "b"], 5_000)
    expect(desk.report("ses_1:call_1", "a", { ok: true, height: 120 })).toBe(true)
    expect(desk.report("ses_1:call_1", "b", { ok: false, error: "boom" })).toBe(true)
    const results = await waiting
    expect([...results]).toEqual([
      ["a", { ok: true, height: 120 }],
      ["b", { ok: false, error: "boom" }],
    ])
  })
  test("after the time is out, hands over what came", async () => {
    const desk = BuffChatPluginTests.make()
    const waiting = desk.wait("k", ["a", "b"], 20)
    desk.report("k", "a", { ok: true })
    expect([...(await waiting).keys()]).toEqual(["a"])
  })
  test("the first answer for an example stands: two windows may draw the same test", async () => {
    const desk = BuffChatPluginTests.make()
    const waiting = desk.wait("k", ["a"], 5_000)
    desk.report("k", "a", { ok: true, height: 80 })
    desk.report("k", "a", { ok: false, error: "late" })
    expect((await waiting).get("a")).toEqual({ ok: true, height: 80 })
  })
  test("an answer nobody waits for, or for an example not asked, is dropped", async () => {
    const desk = BuffChatPluginTests.make()
    expect(desk.report("nobody", "a", { ok: true })).toBe(false)
    const waiting = desk.wait("k", ["a"], 20)
    expect(desk.report("k", "zzz", { ok: true })).toBe(false)
    expect((await waiting).size).toBe(0)
    expect(desk.report("k", "a", { ok: true })).toBe(false)
  })
  // The phone and the web client read a chat in snapshots: the running call's metadata is not in
  // them, so the task is handed out here until every example is answered.
  test("a chat's pending tests name what is still to draw, without the examples' text", async () => {
    const desk = BuffChatPluginTests.make()
    const task = {
      id: "steps",
      version: "v1",
      name: "Steps",
      examples: [
        { name: "morning", block: "steps", text: "Wake\nCoffee" },
        { name: "evening", block: "steps", text: "Dinner" },
      ],
    }
    const waiting = desk.wait("ses_1:call_9", ["morning", "evening"], 5_000, task)
    expect(desk.pending("ses_1")).toEqual([
      {
        call: "call_9",
        id: "steps",
        version: "v1",
        name: "Steps",
        examples: [
          { name: "morning", block: "steps" },
          { name: "evening", block: "steps" },
        ],
      },
    ])
    expect(desk.pending("ses_2")).toEqual([])
    desk.report("ses_1:call_9", "morning", { ok: true })
    expect(desk.pending("ses_1")[0]?.examples).toEqual([{ name: "evening", block: "steps" }])
    desk.report("ses_1:call_9", "evening", { ok: true })
    await waiting
    expect(desk.pending("ses_1")).toEqual([])
  })
})

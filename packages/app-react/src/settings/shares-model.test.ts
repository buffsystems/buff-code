import { describe, expect, test } from "bun:test"
import type { BuffShare } from "@opencode/schema/buff-share"
import { expiryLabel, linkRows, stateOf } from "./shares-model"

const link = (over: Partial<BuffShare.Link> = {}): BuffShare.Link => ({
  id: "S".repeat(22),
  link: "https://buff.systems/share/" + "S".repeat(22),
  session: "s1",
  kind: "session",
  messages: 0,
  title: "Разбор",
  hasPass: false,
  expiresAt: null,
  tools: false,
  live: false,
  enabled: true,
  created: 100,
  published: true,
  sessionTitle: "Сессия",
  ...over,
})

describe("public links page model", () => {
  test("a link's state: on, switched off, expired, or waiting for the gateway", () => {
    expect(stateOf(link(), 1000)).toBe("on")
    expect(stateOf(link({ enabled: false, expiresAt: 10 }), 1000)).toBe("off")
    expect(stateOf(link({ expiresAt: 999 }), 1000)).toBe("expired")
    expect(stateOf(link({ expiresAt: 1001 }), 1000)).toBe("on")
    expect(stateOf(link({ published: false }), 1000)).toBe("pending")
  })

  test("rows come newest first with the source's title", () => {
    const rows = linkRows(
      [link({ id: "a".repeat(22), created: 1 }), link({ id: "b".repeat(22), created: 2, sessionTitle: null })],
      1000,
    )
    expect(rows.map((r) => r.id[0])).toEqual(["b", "a"])
    expect(rows[0]!.source).toBeNull()
    expect(rows[1]!.source).toBe("Сессия")
  })

  test("an expiry reads as a date; never reads as nothing", () => {
    expect(expiryLabel(null, "ru")).toBeNull()
    expect(expiryLabel(Date.UTC(2026, 10, 9, 12, 0), "en-GB")).toMatch(/9 Nov/)
  })
})

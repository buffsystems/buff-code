// Результаты (#969): файлы, отданные агентом, находятся в ленте чата — по записям `sent`.
import { describe, expect, test } from "bun:test"
import { BuffArtifacts } from "../src/buff-artifacts.js"

const menu = { file: "menu.md", name: "menu.md", mime: "text/markdown", bytes: 9, note: "Меню" }
const cat = { file: "/home/user/pictures/cat.png", name: "cat.png", mime: "image/png", bytes: 6 }

describe("the files of a message", () => {
  test("send_file keeps the record in the call; a drawing — in the nested call's row", () => {
    const message = {
      content: [
        { type: "text", text: 'here is "sent"' },
        { type: "tool", id: "t1", name: "send_file", state: { metadata: { sent: menu } } },
        {
          type: "tool",
          id: "t2",
          name: "execute",
          state: { metadata: { toolCalls: [{ tool: "github.search" }, { tool: "draw.draw_image", sent: cat }] } },
        },
        { type: "tool", id: "t3", name: "read", state: {} },
      ],
    }
    const got = BuffArtifacts.found(message)
    expect(got).toEqual([
      { part: "t1", sent: menu },
      { part: "t2", n: 1, sent: cat },
    ])
    expect(got.map((item) => BuffArtifacts.idOf("msg_1", item))).toEqual(["msg_1:t1", "msg_1:t2:1"])
  })

  test("a half-written record and a message without calls give nothing", () => {
    expect(BuffArtifacts.found({ content: [{ type: "tool", id: "t", state: { metadata: { sent: { file: "x" } } } }] })).toEqual([])
    expect(BuffArtifacts.found({})).toEqual([])
  })
})

describe("the folder filter", () => {
  test("a chat belongs to a root when it runs in it or deeper — not in a folder that only starts the same", () => {
    expect(BuffArtifacts.under("/home/user/projects/shop", ["/home/user/projects/shop"])).toBe(true)
    expect(BuffArtifacts.under("/home/user/projects/shop/site", ["/home/user/projects/shop"])).toBe(true)
    expect(BuffArtifacts.under("/home/user/projects/shop-2", ["/home/user/projects/shop"])).toBe(false)
    expect(BuffArtifacts.under(undefined, ["/home/user"])).toBe(false)
  })
})

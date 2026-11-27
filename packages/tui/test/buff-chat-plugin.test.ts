// Плагины чатов в консоли (#595, #985): блок — текстом, по сценарию плагина в пустом контексте.
import { describe, expect, test } from "bun:test"
import type { BuffChatPlugin } from "@opencode/schema/buff-chat-plugin"
import { drawnBlocks, textOf } from "../src/feature-plugins/buff/chat-plugin"

describe("a block's text by the plugin's script", () => {
  const js =
    "function text(data, options) { return data.split('\\n').map(function (l) { return l.slice(0, options.width) }).join('\\n').toUpperCase() }"
  test("the script gets the block and the width and gives lines", () => {
    expect(textOf(js, "abc\ndefgh", 3)).toBe("ABC\nDEF")
  })
  test("a script that throws, hangs, returns nothing or just echoes the block gives no text", () => {
    expect(textOf("function text() { throw new Error('x') }", "a", 80)).toBeUndefined()
    expect(textOf("function text() { for (;;) {} }", "a", 80)).toBeUndefined()
    expect(textOf("function text() { return 42 }", "a", 80)).toBeUndefined()
    expect(textOf("function text(d) { return d }", "a", 80)).toBeUndefined()
    expect(textOf("not a script", "a", 80)).toBeUndefined()
  })
  test("the script sees nothing of the console: no process, no require, no files", () => {
    const probe =
      "function text() { return [typeof process, typeof require, typeof Bun, typeof fetch, typeof globalThis.console].join(',') }"
    expect(textOf(probe, "a", 80)).toBe("undefined,undefined,undefined,undefined,undefined")
  })
})

describe("which blocks the console draws as text", () => {
  const entry = (over: Partial<BuffChatPlugin.Entry>): BuffChatPlugin.Entry => ({
    id: "charts",
    name: "Charts",
    description: "d",
    blocks: ["chart"],
    origin: "builtin",
    version: "v1",
    enabled: true,
    text: true,
    examples: [],
    ...over,
  })
  test("enabled plugins by their blocks; the script is read once per plugin, only where there is one", async () => {
    const asked: string[] = []
    const drawn = await drawnBlocks(
      async () => ({
        plugins: [
          entry({ blocks: ["chart", "plot"] }),
          entry({ id: "map", name: "Map", blocks: ["map"], text: false }),
          entry({ id: "off", blocks: ["gantt"], enabled: false }),
        ],
      }),
      async (id) => {
        asked.push(id)
        return { js: "function text() {}" }
      },
    )
    expect([...drawn.keys()]).toEqual(["chart", "plot", "map"])
    expect(drawn.get("chart")).toEqual({ name: "Charts", js: "function text() {}" })
    expect(drawn.get("map")).toEqual({ name: "Map" })
    expect(asked).toEqual(["charts"])
  })
})

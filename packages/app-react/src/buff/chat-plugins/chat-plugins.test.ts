// Chat plugins in the window (#595, #981): who draws a block, and which code blocks of the
// developer timeline get a frame.
import { describe, expect, test } from "bun:test"
import type { ChatPluginsHost } from "@buff/ui/react"
import type { BuffChatPlugin } from "@opencode/schema/buff-chat-plugin"
import { pluginGroups } from "../settings/chat-plugins"
import { blocksOf } from "./host"
import { pendingTests } from "./tester"
import { pluginSlots } from "./timeline"

const entry = (over: Partial<BuffChatPlugin.Entry> = {}): BuffChatPlugin.Entry => ({
  id: "charts",
  name: "Charts",
  description: "Draws charts",
  blocks: ["chart"],
  origin: "builtin",
  version: "v1",
  enabled: true,
  text: false,
  examples: [],
  ...over,
})

describe("who draws a block", () => {
  test("enabled, working plugins by their blocks, with the name and version a frame needs", () => {
    expect(
      blocksOf([
        entry(),
        entry({ id: "map", name: "Map", blocks: ["map", "route"], version: "v7", origin: "user" }),
        entry({ id: "off", blocks: ["gantt"], enabled: false }),
        entry({ id: "broken", blocks: ["kpi"], problem: "no view" }),
      ]),
    ).toEqual({
      chart: { id: "charts", version: "v1", name: "Charts" },
      map: { id: "map", version: "v7", name: "Map" },
      route: { id: "map", version: "v7", name: "Map" },
    })
  })
})

const host = { blocks: { chart: { id: "charts", version: "v1", name: "Charts" } } } as unknown as ChatPluginsHost

/** The timeline's code block as its Markdown controller builds it. */
function codeBlock(language: string, text: string, complete = true) {
  const block = document.createElement("div")
  block.dataset.markdownBlock = ""
  block.dataset.markdownComplete = String(complete)
  // The highlighter knows no plugin's block: it calls it text and keeps the name beside.
  block.innerHTML = `<div data-component="markdown-code" data-language="text" data-named="${language}"><pre><code></code></pre><button data-slot="markdown-copy-button"></button></div>`
  block.querySelector("code")!.textContent = text
  return block
}
const mounts = (root: HTMLElement) => root.querySelectorAll('[data-component="markdown-plugin"]')

describe("the frames of a text in the developer timeline", () => {
  test("a block a plugin draws gets a mount; the code stays in the page under it", () => {
    const root = document.createElement("div")
    root.append(codeBlock("chart", '{"a":1}'), codeBlock("js", "let a"), codeBlock("chart", '{"b":', false))
    const slots = pluginSlots(root, host)
    expect(slots.map((slot) => [slot.name, slot.text, slot.complete])).toEqual([
      ["chart", '{"a":1}', true],
      ["chart", '{"b":', false],
    ])
    expect(mounts(root)).toHaveLength(2)
    expect(slots[0]!.wrapper.dataset.plugin).toBe("true")
    expect(slots[0]!.wrapper.querySelector("pre")).not.toBeNull()
    expect(root.querySelector('[data-named="js"]')!.hasAttribute("data-plugin")).toBe(false)
  })
  test("the same block keeps its mount from one look-over to the next", () => {
    const root = document.createElement("div")
    root.append(codeBlock("chart", '{"a":'))
    const first = pluginSlots(root, host)[0]!.mount
    root.querySelector("code")!.textContent = '{"a":1}'
    const again = pluginSlots(root, host)
    expect(again[0]!.mount).toBe(first)
    expect(again[0]!.text).toBe('{"a":1}')
    expect(mounts(root)).toHaveLength(1)
  })
  test("a plugin switched off, or no plugins at all, gives the code back", () => {
    const root = document.createElement("div")
    root.append(codeBlock("chart", '{"a":1}'))
    pluginSlots(root, host)
    expect(pluginSlots(root, null)).toEqual([])
    expect(mounts(root)).toHaveLength(0)
    expect(root.querySelector('[data-component="markdown-code"]')!.hasAttribute("data-plugin")).toBe(false)
  })
  test("a block whose plugin failed stays code", () => {
    const root = document.createElement("div")
    root.append(codeBlock("chart", "nonsense"))
    const [slot] = pluginSlots(root, host)
    slot!.wrapper.dataset.plugin = "failed"
    expect(pluginSlots(root, host)).toEqual([])
    expect(mounts(root)).toHaveLength(0)
  })
})

describe("a plugin under test", () => {
  const task = {
    id: "funnel",
    version: "v2",
    name: "Funnel",
    examples: [{ name: "week", block: "funnel", text: "A: 1" }],
  }
  const part = (status: string, metadata: unknown, name = "chat_plugin_test") => ({
    type: "tool",
    id: "call_1",
    name,
    state: { status, metadata },
  })
  test("is a running chat_plugin_test call that carries the examples to draw", () => {
    expect(pendingTests([{ content: [{ type: "text" }, part("running", { pluginTest: task })] }])).toEqual([
      { call: "call_1", test: task },
    ])
  })
  test("a finished call, another tool, or a call without the examples is not", () => {
    expect(pendingTests([{ content: [part("completed", { pluginTest: task })] }])).toEqual([])
    expect(pendingTests([{ content: [part("running", { pluginTest: task }, "read")] }])).toEqual([])
    expect(pendingTests([{ content: [part("running", {})] }, { content: undefined }, {}])).toEqual([])
  })
})

describe("the settings list of chat plugins", () => {
  test("is grouped by where a plugin is kept — the person's own first — without empty groups", () => {
    const groups = pluginGroups([
      entry({ id: "charts" }),
      entry({ id: "mine", origin: "user" }),
      entry({ id: "here", origin: "local" }),
      entry({ id: "also-mine", origin: "user" }),
    ])
    expect(groups.map((group) => [group.origin, group.plugins.map((plugin) => plugin.id)])).toEqual([
      ["local", ["here"]],
      ["user", ["mine", "also-mine"]],
      ["builtin", ["charts"]],
    ])
    expect(pluginGroups([entry()]).map((group) => group.origin)).toEqual(["builtin"])
  })
})

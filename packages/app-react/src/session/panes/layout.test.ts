import { describe, expect, test } from "bun:test"
import { memoryStorage } from "../../test/storage"
import { createPanesLayout, decodeReviewPanel, diffStyleOf, moveTab, tabsOf } from "./layout"

const key = "local\u0000ZGly/ses_1"

describe("createPanesLayout", () => {
  test("keeps the Solid window's other layout fields when it writes its own", async () => {
    const storage = memoryStorage({ layout: JSON.stringify({ sidebar: { opened: true }, review: { diffStyle: "split" } }) })
    const panes = createPanesLayout(storage)
    await panes.ready
    expect(diffStyleOf(panes.layout.get())).toBe("split")
    panes.tabs(key).open("file://a.ts")
    const stored = JSON.parse(storage.items.get("layout")!)
    expect(stored.sidebar).toEqual({ opened: true })
    expect(stored.sessionTabs[key]).toEqual({ all: ["file://a.ts"], active: "file://a.ts" })
  })

  test("a preview tab is replaced by the next preview and kept by open", async () => {
    const panes = createPanesLayout(memoryStorage())
    await panes.ready
    const tabs = panes.tabs(key)
    tabs.previewTab("file://a.ts")
    tabs.previewTab("file://b.ts")
    expect(tabsOf(panes.layout.get(), key)).toEqual({ all: ["file://b.ts"], active: "file://b.ts" })
    expect(panes.preview.get()[key]).toBe("file://b.ts")
    tabs.open("file://b.ts")
    expect(panes.preview.get()[key]).toBeUndefined()
    tabs.previewTab("file://c.ts")
    expect(tabsOf(panes.layout.get(), key).all).toEqual(["file://b.ts", "file://c.ts"])
  })

  test("closing the active tab selects its neighbour", async () => {
    const panes = createPanesLayout(memoryStorage())
    await panes.ready
    const tabs = panes.tabs(key)
    tabs.open("file://a.ts")
    tabs.open("file://b.ts")
    tabs.close("file://b.ts")
    expect(tabsOf(panes.layout.get(), key)).toEqual({ all: ["file://a.ts"], active: "file://a.ts" })
  })

  test("the review sidebar width stays in its bounds", async () => {
    const panes = createPanesLayout(memoryStorage())
    await panes.ready
    panes.resizeSidebar(1000)
    expect(panes.panel.get().sidebarWidth).toBe(480)
    panes.resizeSidebar(10)
    expect(panes.panel.get().sidebarWidth).toBe(200)
  })
})

test("moveTab moves one tab to an index", () => {
  expect(moveTab(["a", "b", "c"], "a", 2)).toEqual(["b", "c", "a"])
  expect(moveTab(["a", "b", "c"], "x", 0)).toEqual(["a", "b", "c"])
})

test("decodeReviewPanel reads the stored sidebar with defaults", () => {
  expect(decodeReviewPanel(JSON.stringify({ sidebarOpened: false, sidebarWidth: 240, expandMode: "collapse" }))).toEqual({
    sidebarOpened: false,
    sidebarWidth: 240,
    expandMode: "collapse",
  })
  expect(decodeReviewPanel("[]")).toBeUndefined()
})

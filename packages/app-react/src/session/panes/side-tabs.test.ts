import { describe, expect, test } from "bun:test"
import { deriveSideTabs, fileBrowserVisible, type SideTabsInput } from "./side-tabs"

const pathFromTab = (tab: string) => (tab.startsWith("file://") ? tab.slice("file://".length) : undefined)
const input = (tabs: SideTabsInput["tabs"], patch: Partial<SideTabsInput> = {}): SideTabsInput => ({
  tabs,
  pathFromTab,
  normalizeTab: (tab) => tab,
  review: true,
  hasReview: true,
  fileBrowser: true,
  browser: false,
  ...patch,
})

describe("deriveSideTabs", () => {
  test("falls back to review when nothing is open and there are changes", () => {
    expect(deriveSideTabs(input({ all: [] })).activeTab).toBe("review")
    expect(deriveSideTabs(input({ all: [] }, { hasReview: false })).activeTab).toBe("empty")
  })

  test("the first file tab wins over context and review when the active tab is gone", () => {
    const tabs = deriveSideTabs(input({ all: ["context", "file://a.ts"], active: "file://gone.ts" }))
    expect(tabs.activeTab).toBe("file://gone.ts")
    const fallback = deriveSideTabs(input({ all: ["context", "file://a.ts"], active: "browser:1" }))
    expect(fallback.activeTab).toBe("file://a.ts")
    expect(fallback.activeFileTab).toBe("file://a.ts")
  })

  test("context and open-file are listed apart from the file tabs", () => {
    const tabs = deriveSideTabs(input({ all: ["context", "open-file", "file://a.ts", "file://a.ts"], active: "open-file" }))
    expect(tabs.contextOpen).toBe(true)
    expect(tabs.openFileOpen).toBe(true)
    expect(tabs.panelTabs).toEqual(["open-file", "file://a.ts"])
    expect(tabs.openedTabs).toEqual(["file://a.ts"])
    expect(tabs.activeTab).toBe("open-file")
    expect(tabs.closableTab).toBe("open-file")
    expect(tabs.activeFileTab).toBeUndefined()
  })

  test("browser tabs show only while a browser is attached", () => {
    expect(deriveSideTabs(input({ all: ["browser:1"] })).panelTabs).toEqual([])
    expect(deriveSideTabs(input({ all: ["browser:1"] }, { browser: true })).panelTabs).toEqual(["browser:1"])
  })

  test("review is selected only where it can show", () => {
    expect(deriveSideTabs(input({ all: [], active: "review" }, { review: false })).activeTab).toBe("empty")
    expect(deriveSideTabs(input({ all: [], active: "review" })).closableTab).toBeUndefined()
  })
})

test("the file browser hides behind review, context, browsers and side conversations", () => {
  expect(fileBrowserVisible("review")).toBe(false)
  expect(fileBrowserVisible("context")).toBe(false)
  expect(fileBrowserVisible("browser:1")).toBe(false)
  expect(fileBrowserVisible("side:ses_1")).toBe(false)
  expect(fileBrowserVisible("open-file")).toBe(true)
  expect(fileBrowserVisible("file://a.ts")).toBe(true)
})

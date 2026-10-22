import { expect, test } from "bun:test"
import { memoryStorage } from "../test/storage"
import { createSettings, DEFAULT_SETTINGS, fontFamily, readSettings, windowSettings } from "./settings-model"

test("a malformed field keeps its default while the others survive", () => {
  const settings = readSettings(
    JSON.stringify({
      general: { followUpBehavior: "queue", terminalPlacement: "nowhere" },
      appearance: { tabLayout: "horizontal" },
      keybinds: { "tab.new": "ctrl+n", broken: 3 },
    }),
  )
  expect(settings.general.followUpBehavior).toBe("queue")
  expect(settings.general.terminalPlacement).toBe("side")
  expect(settings.appearance.tabLayout).toBe("horizontal")
  expect(settings.appearance.fontSize).toBe(14)
  expect(settings.keybinds).toEqual({ "tab.new": "ctrl+n" })
  expect(readSettings("not json")).toEqual(DEFAULT_SETTINGS)
})

test("legacy reasoning and tool preferences become the timeline detail", () => {
  const settings = readSettings(
    JSON.stringify({
      general: { reasoningMode: "hidden", shellToolPartsExpanded: true, editToolPartsExpanded: false },
    }),
  )
  expect(settings.general.timelineDetail.thinking).toEqual({ placement: "hidden", details: "collapsed" })
  expect(settings.general.timelineDetail.shell).toEqual({ placement: "separate", details: "expanded" })
  expect(settings.general.timelineDetail.edit).toEqual({ placement: "grouped", details: "collapsed" })
})

test("setters write the Solid window's settings.v3 key", async () => {
  const storage = memoryStorage()
  const model = createSettings(() => storage)
  await model.ready
  model.general({ followUpBehavior: "queue" })
  model.setFont("mono", "  ")
  model.keybinds.set("tab.new", "ctrl+shift+n")
  model.keybinds.reset("missing")
  expect(model.store.get().general.followUpBehavior).toBe("queue")
  const stored = JSON.parse(storage.items.get("settings.v3") ?? "{}")
  expect(stored.general.followUpBehavior).toBe("queue")
  expect(stored.appearance.mono).toBe("")
  expect(stored.keybinds).toEqual({ "tab.new": "ctrl+shift+n" })
  model.keybinds.resetAll()
  expect(model.store.get().keybinds).toEqual({})
})

test("a custom face goes in front of the Buff stack, quoted when it needs to be", () => {
  expect(fontFamily("mono", "")).toStartWith('"Geist Mono"')
  expect(fontFamily("sans", "Fira Sans")).toStartWith('"Fira Sans", "Geist"')
  expect(fontFamily("terminal", "Hack")).toStartWith("Hack, ")
})

test("a stored timeline detail is kept, an invalid category falls back to the Compact preset", () => {
  const settings = readSettings(
    JSON.stringify({
      general: {
        timelineDetail: { shell: { placement: "hidden", details: "collapsed" }, notices: { placement: "nowhere" } },
        shellToolPartsExpanded: true,
      },
    }),
  )
  expect(settings.general.timelineDetail.shell).toEqual({ placement: "hidden", details: "collapsed" })
  expect(settings.general.timelineDetail.notices).toEqual(DEFAULT_SETTINGS.general.timelineDetail.notices)
})

test("one settings model per window storage: a change in Settings reaches every reader at once", async () => {
  const storage = memoryStorage()
  const host = () => storage
  const shown = windowSettings(host)
  expect(windowSettings(host)).toBe(shown)
  await shown.ready
  const seen: boolean[] = []
  windowSettings(host).store.subscribe(() => seen.push(windowSettings(host).store.get().general.experimentalBrowser))
  shown.general({ experimentalBrowser: true })
  expect(seen).toEqual([true])
  expect(windowSettings(() => memoryStorage())).not.toBe(shown)
})

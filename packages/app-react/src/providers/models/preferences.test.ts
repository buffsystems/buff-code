import { expect, test } from "bun:test"
import { memoryStorage } from "../../test/storage"
import { createModelPreferences } from "./preferences"

test("visibility, recent and variants persist in the Solid window's model key", async () => {
  const storage = memoryStorage({ model: JSON.stringify({ user: [], recent: [], variant: {} }) })
  const prefs = createModelPreferences(() => storage)
  await prefs.ready
  const key = { providerID: "anthropic", modelID: "sonnet" }
  prefs.setVisibility(key, false)
  prefs.setVisibility(key, true)
  prefs.pushRecent(key)
  prefs.pushRecent(key)
  prefs.setVariant(key, undefined)
  expect(prefs.visibility(key)).toBe("show")
  expect(prefs.recent()).toEqual([key])
  expect(JSON.parse(storage.items.get("model") ?? "{}")).toEqual({
    user: [{ ...key, visibility: "show" }],
    recent: [key],
    variant: { "anthropic/sonnet": "default" },
  })
})

import { expect, test } from "bun:test"
import { claimNotification } from "./coordinator"

function storage() {
  const items = new Map<string, string>()
  return {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
  } as Storage
}

test("an event is claimed once, by this renderer or by another window sharing the storage", () => {
  const shared = storage()
  const here = new Set<string>()
  expect(claimNotification("sound", "e1", here, shared)).toBe(true)
  expect(claimNotification("sound", "e1", here, shared)).toBe(false)
  expect(claimNotification("sound", "e1", new Set(), shared)).toBe(false)
  expect(claimNotification("system", "e1", new Set(), shared)).toBe(true)
})

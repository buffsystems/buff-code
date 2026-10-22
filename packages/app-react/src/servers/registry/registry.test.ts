import { expect, test } from "bun:test"
import { createServerState } from "../../core/server-state"
import { memoryStorage } from "../../test/storage"
import { createServerRegistryActions, normalizeServerUrl } from "./registry"

test("addresses get a protocol and lose trailing slashes", () => {
  expect(normalizeServerUrl(" localhost:4096/ ")).toBe("http://localhost:4096")
  expect(normalizeServerUrl("https://a.b")).toBe("https://a.b")
  expect(normalizeServerUrl("  ")).toBeUndefined()
})

test("added servers are stored once; only stored ones can be removed; an edit replaces", () => {
  const state = createServerState(memoryStorage())
  const actions = createServerRegistryActions({
    state,
    provided: [{ type: "sidecar", variant: "base", http: { url: "http://local" } }],
  })
  actions.add({ type: "http", http: { url: "remote:1/" }, displayName: "R" })
  actions.add({ type: "http", http: { url: "http://remote:1" }, displayName: "R2" })
  expect(state.store.get().list.map((item) => [item.http.url, item.displayName])).toEqual([["http://remote:1", "R2"]])
  expect(actions.canRemove("http://remote:1")).toBe(true)
  expect(actions.canRemove("sidecar")).toBe(false)
  actions.replace("http://remote:1", { type: "http", http: { url: "http://other:2" } })
  expect(state.store.get().list.map((item) => item.http.url)).toEqual(["http://other:2"])
  actions.setHidden("sidecar", true)
  expect(actions.isHidden("sidecar")).toBe(true)
})

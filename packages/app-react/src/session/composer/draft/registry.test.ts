import { expect, test } from "bun:test"
import { memoryStorage } from "../../../test/storage"
import { createDraftRegistry } from "./registry"

const host = () => {
  const namespaces = new Map<string, ReturnType<typeof memoryStorage>>()
  return {
    storage(name: string) {
      const existing = namespaces.get(name) ?? memoryStorage()
      namespaces.set(name, existing)
      return existing
    },
  }
}

test("a session keeps its open draft when it moves to another directory", () => {
  const registry = createDraftRegistry(host())
  const before = registry.get({ type: "session", scope: "local", directory: "/projects/old", sessionID: "ses_1" })
  const after = registry.get({ type: "session", scope: "local", directory: "/projects/new", sessionID: "ses_1" })
  expect(after).toBe(before)
})

test("sessions and servers keep separate drafts", () => {
  const registry = createDraftRegistry(host())
  const one = registry.get({ type: "session", scope: "local", directory: "/p", sessionID: "ses_1" })
  expect(registry.get({ type: "session", scope: "local", directory: "/p", sessionID: "ses_2" })).not.toBe(one)
  expect(registry.get({ type: "session", scope: "remote", directory: "/p", sessionID: "ses_1" })).not.toBe(one)
})

test("a reader that does not know the directory yet never hands its draft to the session", () => {
  const registry = createDraftRegistry(host())
  const unknown = registry.get({ type: "session", scope: "local", directory: "", sessionID: "ses_1" })
  const known = registry.get({ type: "session", scope: "local", directory: "/projects/a", sessionID: "ses_1" })
  expect(known).not.toBe(unknown)
})

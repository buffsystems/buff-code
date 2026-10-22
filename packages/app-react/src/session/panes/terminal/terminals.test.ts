import { describe, expect, test } from "bun:test"
import type { OpenCodeEvent } from "@opencode/client/promise"
import { fakeApi } from "../../../core/data/fake-api"
import { createEventSource } from "../../../core/events"
import { memoryStorage } from "../../../test/storage"
import { createWorkspaceTerminals, TERMINAL_STORAGE_KEY } from "./terminals"

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

function setup(routes: Parameters<typeof fakeApi>[0] = {}, stored?: unknown) {
  const fake = fakeApi(routes)
  const events = createEventSource()
  const storage = memoryStorage(stored ? { [TERMINAL_STORAGE_KEY]: JSON.stringify(stored) } : {})
  const terminals = createWorkspaceTerminals({
    api: () => fake.api,
    directory: "/repo",
    storage,
    event: events.event,
    log: () => undefined,
  })
  return { terminals, fake, events, storage }
}

describe("createWorkspaceTerminals", () => {
  test("a new terminal takes the next number, becomes active and keeps the focus request", async () => {
    let next = 0
    const { terminals, fake, storage } = setup({
      "pty.create": (input: { title: string }) => ({ data: { id: `pty_${++next}`, title: input.title } }),
    })
    terminals.create()
    expect(terminals.focusRequested("pty_1")).toBe(false)
    await settle()
    expect(terminals.state.get()).toEqual({ active: "pty_1", all: [{ id: "pty_1", title: "Terminal 1", titleNumber: 1 }] })
    expect(terminals.focusRequested("pty_1")).toBe(true)
    terminals.consumeFocus("pty_1")
    expect(terminals.focusRequested("pty_1")).toBe(false)
    terminals.create()
    await settle()
    expect(terminals.state.get().all.map((pty) => pty.title)).toEqual(["Terminal 1", "Terminal 2"])
    expect(fake.called("pty.create")[0]?.input).toEqual({ location: { directory: "/repo" }, title: "Terminal 1" })
    expect(JSON.parse(storage.items.get(TERMINAL_STORAGE_KEY)!).active).toBe("pty_2")
  })

  test("a failed create cancels its focus request", async () => {
    const { terminals } = setup({ "pty.create": () => Promise.reject(new Error("no")) })
    terminals.create()
    await settle()
    expect(terminals.focus.get()).toBeUndefined()
    expect(terminals.state.get().all).toEqual([])
  })

  test("restores the stored list and drops a PTY the server reports exited", async () => {
    const { terminals, events } = setup({}, { active: "b", all: [{ id: "a", title: "Terminal 1" }, { id: "b", title: "Terminal 2" }] })
    await settle()
    expect(terminals.state.get().active).toBe("b")
    expect(terminals.ready.get()).toBe(true)
    events.publish({ type: "pty.exited", data: { id: "b" } } as OpenCodeEvent)
    expect(terminals.state.get().active).toBe("a")
    expect(terminals.state.get().all.map((pty) => pty.id)).toEqual(["a"])
  })

  test("closing removes the PTY on the server", async () => {
    const { terminals, fake } = setup({ "pty.remove": () => undefined }, { all: [{ id: "a", title: "Terminal 1" }] })
    await settle()
    await terminals.close("a")
    expect(terminals.state.get().all).toEqual([])
    expect(fake.called("pty.remove")[0]?.input).toEqual({ ptyID: "a", location: { directory: "/repo" } })
  })

  test("a rename rolls back when the server refuses it", async () => {
    const { terminals } = setup(
      { "pty.update": () => Promise.reject(new Error("no")) },
      { all: [{ id: "a", title: "Terminal 1" }] },
    )
    await settle()
    terminals.update({ id: "a", title: "build" })
    expect(terminals.state.get().all[0]?.title).toBe("build")
    await settle()
    expect(terminals.state.get().all[0]?.title).toBe("Terminal 1")
  })

  test("a dead PTY is cloned in place", async () => {
    const { terminals } = setup(
      { "pty.create": () => ({ data: { id: "fresh", title: "Terminal 1" } }) },
      { active: "a", all: [{ id: "a", title: "Terminal 1", buffer: "old" }] },
    )
    await settle()
    await terminals.clone("a")
    expect(terminals.state.get()).toEqual({ active: "fresh", all: [{ id: "fresh", title: "Terminal 1", titleNumber: 1 }] })
  })
})

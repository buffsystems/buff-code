import { expect, test } from "bun:test"
import { createStore } from "../core/store"
import { createSessionViews, DEFAULT_SESSION_VIEW, type SessionPanes } from "./view"

function panes(initial: Record<string, SessionPanes> = {}) {
  const store = createStore(initial)
  return {
    store,
    set: (key: string, patch: SessionPanes) => store.set((all) => ({ ...all, [key]: { ...all[key], ...patch } })),
  }
}

test("a tab starts from the defaults and keeps its own changes", () => {
  const stored = panes()
  const views = createSessionViews(stored)
  views.actions("a").toggleReview()
  views.actions("a").resizeTerminal(10)
  views.actions("a").resizeSession(100)
  expect(views.read("a")).toEqual({ review: true, terminal: false, terminalHeight: 100, sessionWidth: 450 })
  expect(views.read("b")).toEqual(DEFAULT_SESSION_VIEW)
  expect(stored.store.get().a).toEqual({ review: true, terminalHeight: 100, sessionWidth: 450 })
})

test("reads the panes the Solid window stored", () => {
  const views = createSessionViews(panes({ a: { terminal: true, terminalHeight: 300 } }))
  expect(views.read("a")).toEqual({ ...DEFAULT_SESSION_VIEW, terminal: true, terminalHeight: 300 })
})

test("without a tab nothing is kept", () => {
  const stored = panes()
  createSessionViews(stored).actions(undefined).openReview()
  expect(stored.store.get()).toEqual({})
})

test("the terminal's open state is read from the store at once, for quick toggles", () => {
  const views = createSessionViews(panes())
  const actions = views.actions("a")
  actions.openTerminal()
  expect(actions.terminalOpen()).toBe(true)
  actions.closeTerminal()
  expect(actions.terminalOpen()).toBe(false)
})

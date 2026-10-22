import { expect, test } from "bun:test"
import { createMemoryHistory } from "./history"
import { matchRoute, sessionHref } from "./routes"

test("matches the window's routes", () => {
  expect(matchRoute("/")).toEqual({ name: "home" })
  expect(matchRoute("/settings")).toEqual({ name: "settings" })
  expect(matchRoute("/new-session")).toEqual({ name: "new-session" })
  expect(matchRoute(sessionHref("http://127.0.0.1:4096", "ses_1"))).toEqual({
    name: "session",
    serverKey: "http://127.0.0.1:4096",
    sessionID: "ses_1",
  })
  expect(matchRoute("/elsewhere")).toEqual({ name: "not-found", pathname: "/elsewhere" })
})

test("a server segment must be the canonical encoding of its key", () => {
  expect(matchRoute("/server/!!/session/ses_1").name).toBe("not-found")
})

test("memory history pushes, replaces and goes back", () => {
  const history = createMemoryHistory("/")
  history.navigate("/settings")
  history.navigate("/workflows", { replace: true })
  expect(history.location.get()).toEqual({ pathname: "/workflows", search: "" })
  history.back()
  expect(history.location.get().pathname).toBe("/")
  history.navigate("/new-session?directory=%2Frepo")
  expect(history.location.get()).toEqual({ pathname: "/new-session", search: "?directory=%2Frepo" })
})

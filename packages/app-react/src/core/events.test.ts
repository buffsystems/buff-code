import { expect, test } from "bun:test"
import type { OpenCodeEvent } from "@opencode/client/promise"
import { createEventSource } from "./events"

const created = (sessionID: string, directory?: string) =>
  ({
    id: `evt_${sessionID}`,
    type: "session.created",
    created: 1,
    data: { sessionID },
    ...(directory ? { location: { directory } } : {}),
  }) as OpenCodeEvent

test("on() receives only its event type; listen() receives every event", () => {
  const source = createEventSource()
  const typed: string[] = []
  const all: string[] = []
  source.event.on("session.created", (event) => typed.push(event.data.sessionID))
  source.event.listen((event) => all.push(event.type))
  source.publish(created("ses_1"))
  source.publish({ id: "evt_c", type: "server.connected", created: 1, data: {} } as OpenCodeEvent)
  expect(typed).toEqual(["ses_1"])
  expect(all).toEqual(["session.created", "server.connected"])
})

test("a location stream filters by the event's directory", () => {
  const source = createEventSource()
  const seen: string[] = []
  source.event.location("/repo").listen((event) => seen.push(event.id))
  source.publish(created("ses_1", "/repo"))
  source.publish(created("ses_2", "/other"))
  source.publish(created("ses_3"))
  expect(seen).toEqual(["evt_ses_1"])
})

test("unsubscribing and clear() stop delivery", () => {
  const source = createEventSource()
  const seen: string[] = []
  const stop = source.event.listen((event) => seen.push(event.id))
  source.event.on("session.created", (event) => seen.push(`typed:${event.id}`))
  stop()
  source.publish(created("ses_1"))
  source.clear()
  source.publish(created("ses_2"))
  expect(seen).toEqual(["typed:evt_ses_1"])
})

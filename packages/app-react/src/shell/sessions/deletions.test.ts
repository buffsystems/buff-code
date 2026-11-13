import { expect, test } from "bun:test"
import { QueryClient } from "@tanstack/react-query"
import { createEventSource } from "../../core/events"
import { event, session } from "../../core/data/fixtures"
import { followDeletions } from "./deletions"

// #922: сессия, удалённая где угодно (шапка сессии, консоль, телефон), уходит из списка сразу,
// а не при следующем чтении индекса.
test("a session deleted anywhere leaves the cached index at once", () => {
  const client = new QueryClient()
  const key = ["home-sessions", "srv"]
  client.setQueryData(key, [session("ses_1"), session("ses_2")])
  const events = createEventSource()
  const stop = followDeletions(events.event, client, key)
  events.publish(event("session.deleted", { sessionID: "ses_1" }))
  expect(client.getQueryData<{ id: string }[]>(key)?.map((item) => item.id)).toEqual(["ses_2"])
  stop()
  events.publish(event("session.deleted", { sessionID: "ses_2" }))
  expect(client.getQueryData<{ id: string }[]>(key)?.map((item) => item.id)).toEqual(["ses_2"])
})

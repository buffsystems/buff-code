import { afterEach, expect, test } from "bun:test"
import type { OpenCodeEvent } from "@opencode/client/promise"
import { createConnection, type Connection } from "./connection"
import { connected, fakeStream } from "./fake-stream"

const until = async (check: () => boolean) => {
  for (let tries = 0; tries < 200 && !check(); tries++) await new Promise((resolve) => setTimeout(resolve, 2))
  expect(check()).toBe(true)
}
const created = (id: string) => ({ id, type: "session.created", created: 0, data: { sessionID: id } }) as OpenCodeEvent

let connection: Connection | undefined
afterEach(() => connection?.dispose())

test("connects on server.connected and delivers events in flushed batches", async () => {
  const stream = fakeStream()
  const seen: string[] = []
  connection = createConnection(stream.api, { onEvent: (event) => seen.push(event.id), flushInterval: 1 })
  expect(connection.state.get().status).toBe("connecting")
  await until(() => stream.connections.length === 1)
  stream.latest()?.push(connected())
  stream.latest()?.push(created("evt_1"))
  await until(() => seen.length === 2)
  expect(seen).toEqual(["evt_connected", "evt_1"])
  expect(connection.state.get()).toEqual({ status: "connected", attempt: 0 })
})

test("reconnects after the stream ends, reporting the attempt and the error", async () => {
  const stream = fakeStream()
  connection = createConnection(stream.api, { onEvent: () => undefined, reconnectDelay: 5 })
  await until(() => stream.connections.length === 1)
  stream.latest()?.push(connected())
  await until(() => connection?.state.get().status === "connected")
  stream.latest()?.end()
  await until(() => connection?.state.get().status === "reconnecting")
  expect(connection.state.get()).toMatchObject({ attempt: 1, error: "Event stream disconnected" })
  await until(() => stream.connections.length === 2)
  stream.latest()?.push(connected("evt_again"))
  await until(() => connection?.state.get().status === "connected")
})

test("a stream that does not open with server.connected is a failed attempt", async () => {
  const stream = fakeStream()
  connection = createConnection(stream.api, { onEvent: () => undefined, reconnectDelay: 50 })
  await until(() => stream.connections.length === 1)
  stream.latest()?.push(created("evt_1"))
  await until(() => connection?.state.get().status === "reconnecting")
  expect(connection.state.get().error).toBe("Event stream did not start with server.connected")
})

test("a stalled stream is aborted by the idle watchdog", async () => {
  const stream = fakeStream()
  connection = createConnection(stream.api, { onEvent: () => undefined, idleTimeout: 10, reconnectDelay: 50 })
  await until(() => stream.connections.length === 1)
  stream.latest()?.push(connected())
  await until(() => connection?.state.get().status === "reconnecting")
  expect(connection.state.get().error).toBe("Event stream stalled")
})

test("reconnect() swaps the API before the next attempt", async () => {
  const first = fakeStream()
  const second = fakeStream()
  connection = createConnection(first.api, {
    onEvent: () => undefined,
    reconnect: async () => second.api,
    reconnectDelay: 1_000,
  })
  await until(() => first.connections.length === 1)
  first.latest()?.push(connected())
  first.latest()?.end()
  await until(() => second.connections.length === 1)
})

test("dispose() aborts the live request and stops reconnecting", async () => {
  const stream = fakeStream()
  connection = createConnection(stream.api, { onEvent: () => undefined, reconnectDelay: 1 })
  await until(() => stream.connections.length === 1)
  connection.dispose()
  expect(stream.latest()?.signal.aborted).toBe(true)
  await new Promise((resolve) => setTimeout(resolve, 20))
  expect(stream.connections.length).toBe(1)
})

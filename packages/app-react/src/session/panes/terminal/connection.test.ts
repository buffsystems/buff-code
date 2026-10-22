import { describe, expect, test } from "bun:test"
import { createPtyConnection, retryDelay, type PtySocket, type PtySocketEvents } from "./connection"

class FakeSocket implements PtySocket {
  readyState = 0
  sent: string[] = []
  closedWith: number | undefined
  listeners = new Map<string, Set<(event: never) => void>>()
  send(data: string) {
    this.sent.push(data)
  }
  close(code?: number) {
    this.closedWith = code
    this.readyState = 3
  }
  addEventListener<Type extends keyof PtySocketEvents>(type: Type, listener: (event: PtySocketEvents[Type]) => void) {
    this.listeners.set(type, (this.listeners.get(type) ?? new Set()).add(listener as (event: never) => void))
  }
  removeEventListener<Type extends keyof PtySocketEvents>(type: Type, listener: (event: PtySocketEvents[Type]) => void) {
    this.listeners.get(type)?.delete(listener as (event: never) => void)
  }
  emit(type: string, event: unknown) {
    this.listeners.get(type)?.forEach((listener) => listener(event as never))
  }
  open() {
    this.readyState = 1
    this.emit("open", {})
  }
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

function setup(options: { gone?: boolean; cursor?: number } = {}) {
  const sockets: FakeSocket[] = []
  const cursors: number[] = []
  const output: string[] = []
  const failures: unknown[] = []
  const timers: { run: () => void; ms: number }[] = []
  const opened = { count: 0 }
  const connection = createPtyConnection({
    connect: async (cursor) => {
      cursors.push(cursor)
      const socket = new FakeSocket()
      sockets.push(socket)
      return socket
    },
    gone: async () => options.gone ?? false,
    cursor: options.cursor ?? 0,
    onOpen: () => opened.count++,
    onOutput: (data) => output.push(data),
    onFail: (error) => failures.push(error),
    closedError: (code) => new Error(`closed ${code}`),
    setTimer: (run, ms) => timers.push({ run, ms }),
    clearTimer: () => undefined,
  })
  return { connection, sockets, cursors, output, failures, timers, opened }
}

describe("createPtyConnection", () => {
  test("writes output, sends input while open and tracks the cursor", async () => {
    const { connection, sockets, output, opened } = setup()
    connection.open()
    await settle()
    const socket = sockets[0]!
    connection.send("ignored")
    socket.open()
    expect(opened.count).toBe(1)
    socket.emit("message", { data: "hello" })
    connection.send("ls\r")
    expect(output).toEqual(["hello"])
    expect(socket.sent).toEqual(["ls\r"])
    expect(connection.cursor()).toBe(5)
    const frame = new Uint8Array([0, ...new TextEncoder().encode(JSON.stringify({ cursor: 42 }))])
    socket.emit("message", { data: frame.buffer })
    expect(connection.cursor()).toBe(42)
  })

  test("an abnormal close reconnects with backoff from the last cursor", async () => {
    const { connection, sockets, cursors, timers } = setup({ cursor: -1 })
    connection.open()
    await settle()
    sockets[0]!.open()
    sockets[0]!.emit("message", { data: "abc" })
    sockets[0]!.emit("close", { code: 1006 })
    expect(timers.map((timer) => timer.ms)).toEqual([250])
    timers[0]!.run()
    await settle()
    await settle()
    expect(cursors).toEqual([-1, 3])
    sockets[1]!.emit("close", { code: 1006 })
    expect(timers[1]!.ms).toBe(500)
  })

  test("a closed PTY fails once instead of reconnecting", async () => {
    const { connection, sockets, timers, failures, cursors } = setup({ gone: true })
    connection.open()
    await settle()
    sockets[0]!.emit("close", { code: 1006 })
    timers[0]!.run()
    await settle()
    expect(failures).toHaveLength(1)
    expect(cursors).toHaveLength(1)
  })

  test("a normal close and dispose stop for good", async () => {
    const { connection, sockets, timers } = setup()
    connection.open()
    await settle()
    sockets[0]!.emit("close", { code: 1000 })
    expect(timers).toHaveLength(0)
    connection.open()
    await settle()
    connection.dispose()
    expect(sockets[1]!.closedWith).toBe(1000)
  })
})

test("retryDelay doubles up to four seconds", () => {
  expect([0, 1, 2, 3, 4, 9].map(retryDelay)).toEqual([250, 500, 1000, 2000, 4000, 4000])
})

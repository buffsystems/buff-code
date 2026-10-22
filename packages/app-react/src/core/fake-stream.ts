import type { OpenCodeEvent } from "@opencode/client/promise"
import type { ConnectionApi } from "./connection"

/** A scripted event stream for tests: every subscribe() opens a connection the test drives. */
export function fakeStream() {
  const connections: ReturnType<typeof openConnection>[] = []
  const api: ConnectionApi = {
    event: {
      subscribe(input) {
        const connection = openConnection(input.signal, input.onActivity)
        connections.push(connection)
        return connection.iterable
      },
    },
  }
  return { api, connections, latest: () => connections.at(-1) }
}

function openConnection(signal: AbortSignal, onActivity?: () => void) {
  const queue: IteratorResult<OpenCodeEvent>[] = []
  const waiting: ((result: IteratorResult<OpenCodeEvent>) => void)[] = []
  const deliver = (result: IteratorResult<OpenCodeEvent>) => {
    const next = waiting.shift()
    if (next) return next(result)
    queue.push(result)
  }
  signal.addEventListener("abort", () => deliver({ done: true, value: undefined }), { once: true })
  return {
    signal,
    push(event: OpenCodeEvent) {
      onActivity?.()
      deliver({ done: false, value: event })
    },
    end: () => deliver({ done: true, value: undefined }),
    iterable: {
      [Symbol.asyncIterator]: () => ({
        next: () =>
          new Promise<IteratorResult<OpenCodeEvent>>((resolve) => {
            const ready = queue.shift()
            if (ready) return resolve(ready)
            waiting.push(resolve)
          }),
      }),
    },
  }
}

export const connected = (id = "evt_connected") =>
  ({ id, type: "server.connected", created: 0, data: {} }) as OpenCodeEvent

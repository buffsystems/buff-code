import type { OpenCodeEvent } from "@opencode/client/promise"

type EventMap = { [Type in OpenCodeEvent["type"]]: Extract<OpenCodeEvent, { type: Type }> }

export type EventStream = {
  on<Type extends OpenCodeEvent["type"]>(type: Type, handler: (event: EventMap[Type]) => void): () => void
  listen(handler: (event: OpenCodeEvent) => void): () => void
}

export type EventSource = EventStream & {
  /** The same stream, narrowed to events that carry this directory as their location. */
  location(directory: string): EventStream
}

/** One server's event bus: the connection publishes, the data layer and screens subscribe. */
export function createEventSource() {
  const listeners = new Set<(event: OpenCodeEvent) => void>()

  function stream(directory?: string): EventStream {
    const listen = (handler: (event: OpenCodeEvent) => void) => {
      const listener = (event: OpenCodeEvent) => {
        if (directory !== undefined && event.location?.directory !== directory) return
        handler(event)
      }
      listeners.add(listener)
      return () => void listeners.delete(listener)
    }
    return {
      listen,
      on: (type, handler) =>
        listen((event) => {
          if (event.type === type) handler(event as EventMap[typeof type])
        }),
    }
  }

  const event: EventSource = { ...stream(), location: (directory) => stream(directory) }
  return {
    event,
    publish: (value: OpenCodeEvent) => [...listeners].forEach((listener) => listener(value)),
    clear: () => listeners.clear(),
  }
}

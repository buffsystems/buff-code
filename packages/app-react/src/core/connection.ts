// The live event stream of one server (#584): a framework-free port of the Solid client's
// createClientConnection (packages/client/src/solid/connection.ts) — same protocol, timings and
// reconnect rules; its state is a core store and its lifetime an explicit dispose().

import type { OpenCodeEvent } from "@opencode/client/promise"
import { batch, createStore } from "./store"

export type ConnectionStatus = "connected" | "connecting" | "reconnecting"
export type ConnectionState = { status: ConnectionStatus; attempt: number; error?: string }

export type ConnectionApi = {
  readonly event: {
    subscribe(input: { signal: AbortSignal; onActivity?: () => void }): AsyncIterable<OpenCodeEvent>
  }
}

export type ConnectionOptions<Api extends ConnectionApi> = {
  readonly reconnect?: (signal: AbortSignal) => Promise<Api>
  readonly onEvent: (event: OpenCodeEvent) => void
  readonly flushInterval?: number
  readonly pageLifecycle?: boolean
  /**
   * Abort and reconnect a stream that receives no bytes for this long. The server writes a keepalive
   * comment every 15 seconds, so a quiet but healthy stream never trips this.
   */
  readonly idleTimeout?: number
  readonly connectTimeout?: number
  readonly reconnectDelay?: number
  readonly log?: (message: string, data?: Readonly<Record<string, unknown>>) => void
}

export const defaultIdleTimeout = 45_000
// Longer than one server keepalive interval: a stream that is silent this long when the page
// returns to the foreground is probably half-open after the device slept.
export const foregroundIdleThreshold = 20_000

export function createConnection<Api extends ConnectionApi>(initialApi: Api, options: ConnectionOptions<Api>) {
  const abort = new AbortController()
  const idleTimeout = options.idleTimeout ?? defaultIdleTimeout
  const connectTimeout = options.connectTimeout ?? 2_000
  const reconnectDelay = options.reconnectDelay ?? 1_000
  const state = createStore<ConnectionState>({ status: "connecting", attempt: 0 })
  const live = { api: initialApi, generation: 0, lastActivity: 0, forced: false, started: false }
  const timers = { flush: undefined as ReturnType<typeof setTimeout> | undefined }
  const requests = {
    current: undefined as AbortController | undefined,
    stream: undefined as AbortController | undefined,
  }
  const run = { current: undefined as Promise<void> | undefined }
  let pending: OpenCodeEvent[] = []

  function publish(event: OpenCodeEvent) {
    pending.push(event)
    if (timers.flush) return
    timers.flush = setTimeout(() => {
      timers.flush = undefined
      const events = pending
      pending = []
      batch(() => events.forEach(options.onEvent))
    }, options.flushInterval ?? 10)
  }

  async function connect(signal: AbortSignal, attempt: number) {
    const request = new AbortController()
    requests.current = request
    const cancel = () => request.abort(signal.reason)
    const timeout = setTimeout(() => request.abort(new Error("Timed out connecting to server")), connectTimeout)
    signal.addEventListener("abort", cancel, { once: true })
    const result = { connectedAt: undefined as number | undefined }
    // Any received bytes, including keepalive comments, push the stall deadline out. A timer whose
    // deadline passed while the page was suspended fires as soon as the page resumes.
    const watchdog = { timer: undefined as ReturnType<typeof setTimeout> | undefined }
    const touch = () => {
      live.lastActivity = Date.now()
      if (result.connectedAt === undefined) return
      clearTimeout(watchdog.timer)
      watchdog.timer = setTimeout(() => request.abort(new Error("Event stream stalled")), idleTimeout)
    }
    const ended = () =>
      request.signal.reason instanceof Error ? request.signal.reason : new Error("Event stream disconnected")

    try {
      options.log?.("event stream connecting", { attempt })
      const iterator = live.api.event.subscribe({ signal: request.signal, onActivity: touch })[Symbol.asyncIterator]()
      const first = await iterator.next()
      if (signal.aborted) return { ...result, error: undefined }
      if (first.done) return { ...result, error: ended() }
      if (first.value.type !== "server.connected")
        return { ...result, error: new Error("Event stream did not start with server.connected") }

      clearTimeout(timeout)
      result.connectedAt = Date.now()
      touch()
      options.log?.("event stream connected")
      publish(first.value)
      state.set(() => ({ status: "connected", attempt: 0 }))

      while (!signal.aborted) {
        const next = await iterator.next()
        if (signal.aborted) return { ...result, error: undefined }
        if (next.done) return { ...result, error: ended() }
        touch()
        publish(next.value)
      }
      return { ...result, error: undefined }
    } catch (error) {
      return { ...result, error }
    } finally {
      request.abort()
      if (requests.current === request) requests.current = undefined
      clearTimeout(timeout)
      clearTimeout(watchdog.timer)
      signal.removeEventListener("abort", cancel)
    }
  }

  async function runStream(active: number) {
    const current = () => !abort.signal.aborted && live.started && live.generation === active
    let attempt = 0
    while (current()) {
      state.set(() => ({ status: attempt === 0 ? "connecting" : "reconnecting", attempt }))
      const controller = new AbortController()
      requests.stream = controller
      const cancel = () => controller.abort(abort.signal.reason)
      abort.signal.addEventListener("abort", cancel)
      const result = await connect(controller.signal, attempt)
      abort.signal.removeEventListener("abort", cancel)
      if (!current()) return
      if (result.connectedAt !== undefined && Date.now() - result.connectedAt >= reconnectDelay) attempt = 0
      attempt += 1
      const error = errorMessage(result.error)
      options.log?.("event stream disconnected", { attempt, error })
      state.set(() => ({ status: "reconnecting", attempt, error }))

      if (options.reconnect) {
        const next = await options.reconnect(controller.signal).catch((cause) => {
          if (!controller.signal.aborted)
            options.log?.("server resolution failed", { attempt, error: errorMessage(cause) })
        })
        if (controller.signal.aborted || !current()) return
        if (next) {
          live.api = next
          if (attempt === 1) continue
        }
      }
      // A deliberate resync already knows the old socket is gone; reconnect without backing off.
      if (live.forced) {
        live.forced = false
        continue
      }
      await wait(reconnectDelay, controller.signal)
    }
  }

  function start() {
    if (live.started) return run.current
    live.started = true
    live.forced = false
    const active = ++live.generation
    const previous = run.current
    const next = (async () => {
      if (previous) await previous
      await runStream(active)
    })().finally(() => {
      if (run.current === next) run.current = undefined
    })
    run.current = next
    return next
  }

  function stop() {
    if (!live.started) return
    live.started = false
    live.generation += 1
    requests.stream?.abort()
    // Nothing is listening once stopped, so consumers must treat their data as stale until start() reconnects.
    state.set(() => ({ status: "connecting", attempt: 0 }))
  }

  // Drop the live request so the reconnect loop replaces it now instead of waiting for the idle watchdog.
  function resync(reason: string) {
    if (!live.started || state.get().status !== "connected") return
    options.log?.("event stream resync", { reason, idle: Date.now() - live.lastActivity })
    live.forced = true
    requests.current?.abort(new Error(reason))
  }

  const detach = options.pageLifecycle
    ? watchPage({ stop, start, resync, lastActivity: () => live.lastActivity })
    : undefined
  void start()

  return {
    state,
    resync,
    dispose() {
      detach?.()
      stop()
      abort.abort()
      clearTimeout(timers.flush)
      pending = []
    },
  }
}

export type Connection = ReturnType<typeof createConnection>

// Locking a phone or switching apps hides the document without a pagehide; the socket usually dies
// while the page is suspended, and the browser may never report that on the hung read.
function watchPage(input: {
  stop: () => void
  start: () => void
  resync: (reason: string) => void
  lastActivity: () => number
}) {
  const pagehide = () => input.stop()
  const pageshow = () => void input.start()
  const visibility = () => {
    if (document.visibilityState !== "visible") return
    if (Date.now() - input.lastActivity() < foregroundIdleThreshold) return
    input.resync("Page returned to the foreground after the event stream went quiet")
  }
  const online = () => input.resync("Network connection restored")
  window.addEventListener("pagehide", pagehide)
  window.addEventListener("pageshow", pageshow)
  window.addEventListener("online", online)
  document.addEventListener("visibilitychange", visibility)
  return () => {
    window.removeEventListener("pagehide", pagehide)
    window.removeEventListener("pageshow", pageshow)
    window.removeEventListener("online", online)
    document.removeEventListener("visibilitychange", visibility)
  }
}

function errorMessage(error: unknown) {
  if (error === undefined) return undefined
  if (error instanceof Error) return error.message
  return String(error)
}

function wait(delay: number, signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(done, delay)
    signal.addEventListener("abort", done, { once: true })
    function done() {
      clearTimeout(timer)
      signal.removeEventListener("abort", done)
      resolve()
    }
  })
}

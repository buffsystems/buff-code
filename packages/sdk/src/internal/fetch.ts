export * as OwnedFetch from "./fetch"

export function make(handler: (request: Request) => Promise<Response>, dispose: () => Promise<void>) {
  const requests = new Set<Promise<void>>()
  const shutdown = new AbortController()
  const closed = new Error("Buff Code host is closed")
  let closePromise: Promise<void> | undefined
  // Shutdown surfaces to the caller only once close() has settled. Cancelling the server side
  // stays immediate (close waits on it), but rejecting the caller's pending reads mid-close
  // would make their delivery depend on how long the runtime takes to dispose: a caller that
  // attaches its handler after `await close()` would see an unhandled rejection whenever
  // disposal happens to cross an event-loop turn.
  const surface = (reason: unknown, fail: () => void) => {
    if (reason === closed && closePromise) void closePromise.then(fail, fail)
    else fail()
  }
  const fetch = Object.assign(
    (input: RequestInfo | URL, init?: RequestInit) => {
      if (closePromise) return Promise.reject(closed)
      const source = new Request(input, init)
      if (source.signal.aborted) return Promise.reject(source.signal.reason)
      const request = new Request(source, { signal: AbortSignal.any([source.signal, shutdown.signal]) })
      const lifetime = Promise.withResolvers<void>()
      const finish = () => {
        requests.delete(lifetime.promise)
        lifetime.resolve()
      }
      requests.add(lifetime.promise)

      return rejectOnAbort(handler(request), request.signal, finish, surface).then((response) =>
        trackResponse(response, request.signal, finish, surface),
      )
    },
    { preconnect: () => undefined },
  ) satisfies typeof globalThis.fetch
  const close = () => {
    if (closePromise) return closePromise
    closePromise = Promise.resolve().then(async () => {
      shutdown.abort(closed)
      await Promise.allSettled(requests)
      await dispose()
    })
    return closePromise
  }
  return { fetch, close }
}

type Surface = (reason: unknown, fail: () => void) => void

// Settles with the handler's response, or rejects on abort or handler failure. A request
// without a response ends its lifetime (`finish`) when the handler settles — at once, not
// when the rejection surfaces, since close() waits on that lifetime.
function rejectOnAbort<A>(promise: Promise<A>, signal: AbortSignal, finish: () => void, surface: Surface): Promise<A> {
  if (signal.aborted) {
    void promise.then(finish, finish)
    return Promise.reject(signal.reason)
  }
  return new Promise((resolve, reject) => {
    const fail = (cause: unknown) => surface(cause, () => reject(cause))
    const abort = () => {
      void promise.then(finish, finish)
      fail(signal.reason)
    }
    signal.addEventListener("abort", abort, { once: true })
    promise.then(
      (value) => {
        if (signal.aborted) return
        signal.removeEventListener("abort", abort)
        resolve(value)
      },
      (cause) => {
        if (signal.aborted) return
        signal.removeEventListener("abort", abort)
        finish()
        fail(cause)
      },
    )
  })
}

function trackResponse(response: Response, signal: AbortSignal, finish: () => void, surface: Surface): Response {
  if (!response.body) {
    finish()
    return response
  }

  const reader = response.body.getReader()
  let done = false
  let abort = () => {}
  const complete = () => {
    if (done) return false
    done = true
    signal.removeEventListener("abort", abort)
    return true
  }
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      abort = () => {
        if (!complete()) return
        void reader.cancel(signal.reason).then(finish, finish)
        surface(signal.reason, () => controller.error(signal.reason))
      }
      if (signal.aborted) abort()
      else signal.addEventListener("abort", abort, { once: true })
    },
    async pull(controller) {
      try {
        const next = await reader.read()
        if (done) return
        if (!next.done) {
          controller.enqueue(next.value)
          return
        }
        if (!complete()) return
        controller.close()
        finish()
      } catch (cause) {
        if (!complete()) return
        controller.error(cause)
        finish()
      }
    },
    async cancel(reason) {
      if (!complete()) return
      try {
        await reader.cancel(reason)
      } finally {
        finish()
      }
    },
  })
  return new Response(body, response)
}

import { expect, test } from "bun:test"
import { OwnedFetch } from "../src/internal/fetch"

// A handler that honours its request's signal, like the real server: an open stream until aborted.
const streaming = (request: Request) =>
  Promise.resolve(
    new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("data: {}\n\n"))
          request.signal.addEventListener("abort", () => controller.error(request.signal.reason), { once: true })
        },
      }),
    ),
  )

// Disposal that crosses event-loop turns, as a runtime with many layers may.
const slowDispose = () => new Promise<void>((resolve) => setTimeout(() => setTimeout(resolve, 5), 5))

test("close rejects an active stream read only after close has settled", async () => {
  const transport = OwnedFetch.make(streaming, slowDispose)
  const reader = (await transport.fetch("http://buff.local/api/event")).body!.getReader()
  await reader.read()
  const order: string[] = []
  const pending = reader.read().then(
    () => order.push("resolved"),
    (error: unknown) => order.push(`rejected: ${(error as Error).message}`),
  )

  await transport.close().then(() => order.push("closed"))
  await pending
  expect(order).toEqual(["closed", "rejected: Buff Code host is closed"])
})

test("close rejects an in-flight request only after close has settled", async () => {
  const hanging = (request: Request) =>
    new Promise<Response>((_, reject) =>
      request.signal.addEventListener("abort", () => reject(request.signal.reason), { once: true }),
    )
  const transport = OwnedFetch.make(hanging, slowDispose)
  const order: string[] = []
  const pending = transport.fetch("http://buff.local/api/info").then(
    () => order.push("resolved"),
    (error: unknown) => order.push(`rejected: ${(error as Error).message}`),
  )

  await transport.close().then(() => order.push("closed"))
  await pending
  expect(order).toEqual(["closed", "rejected: Buff Code host is closed"])
})

test("a caller's own abort still rejects at once", async () => {
  const transport = OwnedFetch.make(streaming, slowDispose)
  const abort = new AbortController()
  const reader = (await transport.fetch("http://buff.local/api/event", { signal: abort.signal })).body!.getReader()
  await reader.read()
  const pending = reader.read()
  abort.abort(new Error("stop"))
  await expect(pending).rejects.toThrow("stop")
  await transport.close()
})

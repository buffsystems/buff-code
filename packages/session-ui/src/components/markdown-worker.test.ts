import { afterAll, expect, test } from "bun:test"

// The client builds its worker with `new Worker(...)`; a stand-in records what it is sent.
const created: FakeWorker[] = []
class FakeWorker {
  sent: unknown[] = []
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  constructor() {
    created.push(this)
  }
  postMessage(message: unknown) {
    this.sent.push(message)
  }
  addEventListener() {}
  removeEventListener() {}
  terminate() {}
}
const original = globalThis.Worker
globalThis.Worker = FakeWorker as unknown as typeof Worker
afterAll(() => {
  globalThis.Worker = original
})

test("warming starts one worker and its highlighter once; the first real request reuses that worker", async () => {
  const { parseMarkdown, warmMarkdownWorker } = await import("./markdown-worker")
  warmMarkdownWorker()
  warmMarkdownWorker()
  expect(created).toHaveLength(1)
  expect(created[0]!.sent).toEqual([{ type: "warm" }])

  const controller = new AbortController()
  const parsed = parseMarkdown("# Title", controller.signal)
  expect(created).toHaveLength(1)
  expect(created[0]!.sent.at(-1)).toMatchObject({ type: "parse", text: "# Title" })
  controller.abort()
  await parsed.catch(() => undefined)
})

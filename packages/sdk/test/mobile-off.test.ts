// The phone agent (#639) lives only in the managed service: an embedded host registers the
// service (phone routes need it) but never starts the agent or reaches a gateway.
import { afterEach, expect, test } from "bun:test"
import { mkdir } from "node:fs/promises"
import { join } from "node:path"
import { Effect } from "effect"
import { BuffMobileService } from "@opencode/core/buff/mobile-service"
import { tmpdir } from "../../core/test/fixture/tmpdir"
import { EmbeddedHost } from "../src/internal/host"

const original = { fetch: globalThis.fetch, WebSocket: globalThis.WebSocket }
afterEach(() => Object.assign(globalThis, original))

test("an embedded host keeps the phone agent off and the gateway untouched", async () => {
  const reached: string[] = []
  globalThis.fetch = Object.assign(
    (input: RequestInfo | URL) => {
      reached.push(input instanceof Request ? input.url : String(input))
      return Promise.reject(new Error("the embedded host must not reach the network"))
    },
    { preconnect: () => undefined },
  )
  globalThis.WebSocket = class {
    constructor(url: string | URL) {
      reached.push(String(url))
      throw new Error("the embedded host must not open sockets")
    }
  } as unknown as typeof WebSocket

  await using directory = await tmpdir("buff-mobile-off-")
  const config = join(directory.path, "config")
  await mkdir(config)
  const host = await Effect.runPromise(
    EmbeddedHost.create({
      config: { directory: config, project: false, content: "{}" },
      models: { fetch: false },
      fs: { filewatcher: false },
    }),
  )
  try {
    const mobile = await host.runtime.runPromise(Effect.service(BuffMobileService.Service))
    expect(await mobile.status()).toMatchObject({ running: false, connected: false, phones: 0 })
    expect(mobile.offers()).toEqual([])
    expect(() => mobile.offer("qr")).toThrow()
    mobile.signIn(async () => undefined)()
    await Bun.sleep(50)
  } finally {
    await host.close()
  }
  expect(reached).toEqual([])
})

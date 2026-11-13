import { expect, test } from "bun:test"
import { Effect, Logger } from "effect"
import { peerLog } from "../../src/buff/mobile/log"

// #908: the relay's words (a gateway limit, a failed connection) went to no log of the service —
// they were logged outside its context. They go to the loggers of the context they are made in.
test("the mobile link's log goes to the service's loggers", async () => {
  const logged: unknown[] = []
  const log = await Effect.runPromise(
    peerLog.pipe(
      Effect.provideService(Logger.CurrentLoggers, new Set([Logger.make((entry) => logged.push(entry.message))])),
    ),
  )
  log.warn("relay: the middleware limited this peer", { code: "pair-quota" })
  await new Promise((r) => setTimeout(r, 10))
  expect(logged.flat()).toContain("relay: the middleware limited this peer")
})

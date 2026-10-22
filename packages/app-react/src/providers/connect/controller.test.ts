import { expect, test } from "bun:test"
import type { OpenCodeClient } from "@opencode/client/promise"
import { createProviderConnection } from "./controller"

function fake(statuses: string[]) {
  const calls: string[] = []
  const read = () => ({ invalidate: () => calls.push("invalidate"), sync: async () => void calls.push("sync") })
  const api = {
    integration: {
      get: async () => ({
        data: { id: "buff", name: "Buff", methods: [{ id: "code", type: "oauth", label: "Buff" }], connections: [] },
      }),
      oauth: {
        connect: async () => ({
          data: {
            attemptID: "att",
            url: "https://cabinet",
            instructions: "Code: 1234",
            mode: "auto",
            time: { created: 0, expires: 9 },
          },
        }),
        status: async () => ({ data: { status: statuses.shift() ?? "pending", time: { created: 0, expires: 9 } } }),
        cancel: async (input: { attemptID: string }) => void calls.push(`cancel:${input.attemptID}`),
      },
    },
  }
  return {
    calls,
    api: () => api as unknown as OpenCodeClient,
    data: { location: { integration: read(), provider: read(), model: read() } },
  }
}

const options = (server: ReturnType<typeof fake>, onComplete: () => void) => ({
  api: server.api,
  data: server.data as never,
  provider: "buff",
  directory: "/repo",
  keyLabel: "API key",
  desktop: false,
  t: (text: string) => text,
  invalidCode: "Invalid code",
  onComplete,
  pollInterval: 1,
})

test("a single OAuth method starts at once and completes by polling", async () => {
  const server = fake(["pending", "complete"])
  const done = Promise.withResolvers<void>()
  const connection = createProviderConnection(options(server, done.resolve))
  await connection.load()
  await done.promise
  expect(connection.store.get().authorization?.attemptID).toBe("att")
  expect(server.calls.filter((call) => call === "invalidate")).toHaveLength(3)
  connection.dispose()
  expect(server.calls).not.toContain("cancel:att")
})

test("closing while waiting cancels the attempt on the server", async () => {
  const server = fake([])
  const connection = createProviderConnection(options(server, () => undefined))
  await connection.load()
  await new Promise((resolve) => setTimeout(resolve, 5))
  connection.dispose()
  expect(server.calls).toContain("cancel:att")
})

test("a connection disposed and loaded again (StrictMode's effect replay) still signs in", async () => {
  const server = fake(["pending", "complete"])
  const done = Promise.withResolvers<void>()
  const completed: string[] = []
  const connection = createProviderConnection(
    options(server, () => {
      completed.push("done")
      done.resolve()
    }),
  )
  const first = connection.load()
  connection.dispose()
  await Promise.all([first, connection.load()])
  await done.promise
  await new Promise((resolve) => setTimeout(resolve, 5))
  expect(connection.store.get()).toMatchObject({ loading: false, state: "complete" })
  expect(completed).toEqual(["done"])
})

import { expect, test } from "bun:test"
import { ServerAuth } from "@opencode/server/auth"
import { Effect, Option, Redacted } from "effect"

const credentials = (username: string, password = "secret") => ({ username, password: Redacted.make(password) })

// Своё имя — buff (#628); прежнее opencode сервер принимает и дальше: с ним приходят уже
// сопряжённые клиенты и клиенты прежних выпусков. Любое другое имя и неверный пароль — нет.
test("accepts buff and the legacy opencode username, nothing else", () => {
  const config = { password: Option.some("secret"), username: "buff" }
  expect(ServerAuth.authorized(credentials("buff"), config)).toBe(true)
  expect(ServerAuth.authorized(credentials("opencode"), config)).toBe(true)
  expect(ServerAuth.authorized(credentials("custom"), config)).toBe(false)
  expect(ServerAuth.authorized(credentials("buff", "wrong"), config)).toBe(false)
  expect(ServerAuth.authorized(credentials("opencode", "wrong"), config)).toBe(false)
})

test("a configured server takes buff as its own username", async () => {
  const config = await Effect.runPromise(
    ServerAuth.Config.pipe(Effect.provide(ServerAuth.Config.configLayer({ password: Option.some("secret") }))),
  )
  expect(config.username).toBe("buff")
})

// Доверие к хукам и командам проекта (#446): подтверждение привязано к содержимому.
import { expect, test } from "bun:test"
import { Effect, Scope } from "effect"
import { BuffTrust } from "../../src/buff/trust.js"

function storage() {
  const data = new Map<string, unknown>()
  return {
    data,
    api: {
      get: (key: string) => Effect.sync(() => data.get(key) as never),
      set: (key: string, value: unknown) => Effect.sync(() => void data.set(key, value)),
    },
  }
}
const run = <A>(effect: Effect.Effect<A>) => Effect.runPromise(effect)
// Каждый тест — со своим ключом: значение общее на процесс. Область держим открытой.
let serial = 0
const fresh = () => `trust-${serial++}`
const open = (store: ReturnType<typeof storage>, key: string, changed: Effect.Effect<void> = Effect.void) =>
  run(Scope.make().pipe(Effect.flatMap((scope) => Scope.provide(BuffTrust.make(store.api, key, changed), scope))))

test("nothing is trusted until confirmed", async () => {
  const trust = await open(storage(), fresh())
  expect(trust.ok("guard", "текст")).toBe(false)
})

test("a confirmation holds for exactly the content that was reviewed", async () => {
  const trust = await open(storage(), fresh())
  expect(await run(trust.confirm("guard", "текст", BuffTrust.token("текст")))).toBe(true)
  expect(trust.ok("guard", "текст")).toBe(true)
  expect(trust.ok("guard", "текст изменили")).toBe(false)
  expect(trust.ok("other", "текст")).toBe(false)
})

test("a review of an older content confirms nothing — the file changed meanwhile", async () => {
  const trust = await open(storage(), fresh())
  expect(await run(trust.confirm("guard", "новый текст", BuffTrust.token("старый текст")))).toBe(false)
  expect(trust.ok("guard", "новый текст")).toBe(false)
})

test("two checkouts of a project may hold different versions — each confirmed on its own", async () => {
  const trust = await open(storage(), fresh())
  await run(trust.confirm("guard", "версия main", BuffTrust.token("версия main")))
  await run(trust.confirm("guard", "версия ветки", BuffTrust.token("версия ветки")))
  expect(trust.ok("guard", "версия main")).toBe(true)
  expect(trust.ok("guard", "версия ветки")).toBe(true)
})

test("what is confirmed in one open directory is confirmed in every other — and each is told", async () => {
  const store = storage()
  const key = fresh()
  const told: string[] = []
  const session = await open(
    store,
    key,
    Effect.sync(() => void told.push("session")),
  )
  const settings = await open(
    store,
    key,
    Effect.sync(() => void told.push("settings")),
  )
  await run(session.confirm("guard", "текст", BuffTrust.token("текст")))
  expect(settings.ok("guard", "текст")).toBe(true)
  expect(told.toSorted()).toEqual(["session", "settings"])
})

test("trust survives a restart and can be withdrawn — for every version at once", async () => {
  const store = storage()
  const key = fresh()
  const first = await open(store, key)
  await run(first.confirm("guard", "текст", BuffTrust.token("текст")))
  BuffTrust.forget(key)
  const second = await open(store, key)
  expect(second.ok("guard", "текст")).toBe(true)
  await run(second.revoke("guard"))
  expect(second.ok("guard", "текст")).toBe(false)
  BuffTrust.forget(key)
  expect((await open(store, key)).ok("guard", "текст")).toBe(false)
})

test("what is stored is a digest, not the content", async () => {
  const store = storage()
  const key = fresh()
  const trust = await open(store, key)
  await run(trust.confirm("guard", "секретный текст", BuffTrust.token("секретный текст")))
  expect(JSON.stringify(store.data.get(key))).not.toContain("секретный")
})

// #457: человек может разрешить запускать хуки и команды проекта без проверки — знакомство и
// настройки. По умолчанию (и пока переключатель не прочитан) — проверять.
test("project hooks and commands run unchecked only when the person turned the check off", async () => {
  const trust = await open(storage(), fresh())
  const policy = storage()
  BuffTrust.forget(BuffTrust.ASK_FIRST)
  expect(trust.ok("guard", "текст")).toBe(false)
  const ask = await run(
    Scope.make().pipe(Effect.flatMap((scope) => Scope.provide(BuffTrust.askFirst(policy.api, Effect.void), scope))),
  )
  expect(ask.get()).toBe(true)
  await run(ask.set(false))
  expect(trust.ok("guard", "текст")).toBe(true)
  expect(policy.data.get(BuffTrust.ASK_FIRST)).toBe(false)
  await run(ask.set(true))
  expect(trust.ok("guard", "текст")).toBe(false)
  BuffTrust.forget(BuffTrust.ASK_FIRST)
})

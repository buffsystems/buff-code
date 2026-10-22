// Выключенное в настройках (#445, #446): одно состояние на все открытые каталоги.
import { expect, test } from "bun:test"
import { Effect, Scope } from "effect"
import { BuffDisabled } from "../../src/buff/disabled.js"

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
const run = <A>(effect: Effect.Effect<A, never, never>) => Effect.runPromise(effect)
// Область держим открытой: открывший слушает перемены, пока жив.
const open = (store: ReturnType<typeof storage>, key: string, changed: Effect.Effect<void> = Effect.void) =>
  run(Scope.make().pipe(Effect.flatMap((scope) => Scope.provide(BuffDisabled.make(store.api, key, changed), scope))))

test("what one directory switches off, another sees at once — and is told to re-read", async () => {
  const store = storage()
  const told: string[] = []
  const first = await open(
    store,
    "t1",
    Effect.sync(() => void told.push("first")),
  )
  const second = await open(
    store,
    "t1",
    Effect.sync(() => void told.push("second")),
  )
  await run(first.set("notes", false))
  expect(second.has("notes")).toBe(true)
  expect(told.toSorted()).toEqual(["first", "second"])
  await run(second.set("notes", true))
  expect(first.has("notes")).toBe(false)
})

test("the choice is stored and survives a restart", async () => {
  const store = storage()
  await run((await open(store, "t2")).set("b", false))
  expect(store.data.get("t2")).toEqual(["b"])
  BuffDisabled.forget("t2")
  expect((await open(store, "t2")).has("b")).toBe(true)
})

test("different lists do not mix", async () => {
  const store = storage()
  await run((await open(store, "t3")).set("x", false))
  expect((await open(store, "t4")).has("x")).toBe(false)
})

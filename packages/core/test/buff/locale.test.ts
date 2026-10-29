// Язык Buff (#472): один на окно, консоль и ядро; хранится у пользователя.
import { expect, test } from "bun:test"
import { Effect, Scope } from "effect"
import { BuffLocale } from "../../src/buff/locale.js"
import { BuffShared } from "../../src/buff/shared.js"

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
const open = (store: ReturnType<typeof storage>, changed: Effect.Effect<void> = Effect.void) =>
  run(Scope.make().pipe(Effect.flatMap((scope) => Scope.provide(BuffLocale.open(store.api, changed), scope))))

const LANG_KEYS = ["LANGUAGE", "LC_ALL", "LC_MESSAGES", "LANG"] as const
async function withLanguage<A>(lang: string | undefined, body: () => Promise<A>) {
  const saved = LANG_KEYS.map((key) => [key, process.env[key]] as const)
  for (const key of LANG_KEYS) delete process.env[key]
  if (lang) process.env.LANG = lang
  try {
    return await body()
  } finally {
    for (const [key, value] of saved)
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
  }
}

test("until a language is chosen it is the system's, Russian when it is neither", () =>
  withLanguage("de_DE.UTF-8", async () => {
    BuffShared.forget(BuffLocale.KEY)
    const locale = await open(storage())
    expect(locale.get()).toBe("ru")
    expect(BuffLocale.current()).toBe("ru")
    expect(BuffLocale.t("Name the group.")).toBe("Назовите группу.")
  }))

test("an English system speaks English until a language is chosen (#713)", () =>
  withLanguage("en_US.UTF-8", async () => {
    BuffShared.forget(BuffLocale.KEY)
    expect((await open(storage())).get()).toBe("en")
    expect(BuffLocale.current()).toBe("en")
    expect(BuffLocale.t("Name the group.")).toBe("Name the group.")
  }))

test("a chosen language is seen everywhere at once and survives a restart", async () => {
  BuffShared.forget(BuffLocale.KEY)
  const store = storage()
  const told: string[] = []
  const first = await open(store, Effect.sync(() => void told.push("first")))
  await open(store, Effect.sync(() => void told.push("second")))
  await run(first.set("en"))
  expect(BuffLocale.current()).toBe("en")
  expect(BuffLocale.t("Name the group.")).toBe("Name the group.")
  expect(told.toSorted()).toEqual(["first", "second"])
  BuffShared.forget(BuffLocale.KEY)
  expect((await open(store)).get()).toBe("en")
})

test("a stored value that is not a language reads as the default", async () => {
  BuffShared.forget(BuffLocale.KEY)
  const store = storage()
  store.data.set(BuffLocale.KEY, "de")
  expect((await open(store)).get()).toBe("ru")
})

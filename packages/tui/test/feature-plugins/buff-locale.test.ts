// Язык консоли (#472) берётся у службы: один вопрос при старте и смена по событию `changed`.
// `follow` общий для слота приложения и режима mini (`buff run`), где слоты плагинов не монтируются.
import { afterEach, expect, test } from "bun:test"
import type { BuffLocale } from "@opencode/schema/buff-locale"
import { follow, t, type LocaleClient } from "../../src/feature-plugins/buff/locale"

type Locale = BuffLocale.Locale

// Поддельная служба: ответ на `get` и очередь событий `changed`, которую тест наполняет сам.
function fakeClient(initial: Promise<Locale>) {
  const asked: string[] = []
  const pending: Locale[] = []
  let wake: (() => void) | undefined
  const client: LocaleClient = {
    rpc(definition) {
      asked.push(definition.id)
      return {
        get: () => initial,
        events: {
          subscribe: (_name, options) => ({
            async *[Symbol.asyncIterator]() {
              while (!options.signal.aborted) {
                const next = pending.shift()
                if (next) {
                  yield { data: { locale: next } }
                  continue
                }
                await new Promise<void>((resolve) => {
                  wake = resolve
                  options.signal.addEventListener("abort", () => resolve(), { once: true })
                })
              }
            },
          }),
        },
      }
    },
  }
  const emit = (locale: Locale) => {
    pending.push(locale)
    wake?.()
  }
  return { client, asked, emit }
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

// Язык — общий для модуля сигнал: после каждого теста возвращаем русский по умолчанию.
afterEach(async () => {
  const stop = new AbortController()
  follow(fakeClient(Promise.resolve("ru")).client, stop.signal)
  await settle()
  stop.abort()
})

test("asks the service once at start and applies its language", async () => {
  const stop = new AbortController()
  const fake = fakeClient(Promise.resolve("en"))
  expect(t("Cancel")).toBe("Отмена")
  follow(fake.client, stop.signal)
  await settle()
  expect(fake.asked).toEqual(["buff.locale"])
  expect(t("Cancel")).toBe("Cancel")
  stop.abort()
})

test("follows every change until stopped", async () => {
  const stop = new AbortController()
  const fake = fakeClient(Promise.resolve("ru"))
  follow(fake.client, stop.signal)
  await settle()
  fake.emit("en")
  await settle()
  expect(t("Cancel")).toBe("Cancel")
  fake.emit("ru")
  await settle()
  expect(t("Cancel")).toBe("Отмена")
  stop.abort()
  fake.emit("en")
  await settle()
  expect(t("Cancel")).toBe("Отмена")
})

test("an unreachable service leaves the default language", async () => {
  const stop = new AbortController()
  follow(fakeClient(Promise.reject(new Error("offline"))).client, stop.signal)
  await settle()
  expect(t("Cancel")).toBe("Отмена")
  stop.abort()
})

test("an answer that arrives after stop is ignored", async () => {
  const stop = new AbortController()
  let answer: (locale: Locale) => void = () => undefined
  follow(fakeClient(new Promise<Locale>((resolve) => (answer = resolve))).client, stop.signal)
  stop.abort()
  answer("en")
  await settle()
  expect(t("Cancel")).toBe("Отмена")
})

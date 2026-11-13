import { describe, expect, test } from "bun:test"
import { BuffMobile } from "../src/buff-mobile.js"

describe("сессия с телефона", () => {
  test("пометка в метаданных — имя телефона; чужие и пустые метаданные — не с телефона", () => {
    expect(BuffMobile.phoneOrigin({ origin: "phone", device: "Pixel" })).toEqual({ device: "Pixel" })
    expect(BuffMobile.phoneOrigin({ origin: "phone" })).toEqual({})
    expect(BuffMobile.phoneOrigin({ origin: "window" })).toBeNull()
    expect(BuffMobile.phoneOrigin(undefined)).toBeNull()
  })
})

describe("приложение Buff для телефона", () => {
  test("ссылки на магазины и APK — страницы сайта шлюза, они знают текущие адреса", () => {
    expect(BuffMobile.appLinks("buff.systems")).toEqual([
      { store: "app-store", name: "App Store", url: "https://buff.systems/mobile/app-store" },
      { store: "google-play", name: "Google Play", url: "https://buff.systems/mobile/google-play" },
      { store: "rustore", name: "RuStore", url: "https://buff.systems/mobile/rustore" },
      { store: "apk", name: "APK", url: "https://buff.systems/mobile/android-apk" },
    ])
    expect(BuffMobile.appLinks("dev.buff.systems")[0]?.url).toBe("https://dev.buff.systems/mobile/app-store")
  })
})

// #918: a pair's traffic in words for the console — the size in its largest unit, the reset time.
describe("resetsAt", () => {
  test("the gateway's UTC day ends at local midnight UTC of the next day, said in local time", () => {
    const local = new Date(Date.UTC(2026, 10, 13)).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })
    expect(BuffMobile.resetsAt("2026-11-12", "en-US")).toBe(local)
  })
})

describe("usageLine", () => {
  const t = (text: string, vars?: Record<string, string | number>) =>
    text.replace(/\{(\w+)\}/g, (_, k: string) => String(vars?.[k] ?? ""))
  const at = (ms: number) => new Date(ms).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })
  test("the traffic of the limit and when it resets", () => {
    expect(
      BuffMobile.usageLine({ bytes: 340 * 1024 ** 2, limit: 2 * 1024 ** 3, day: "2026-11-12", exhausted: false }, t, "en-US"),
    ).toBe(`340 MB of 2 GB today, resets at ${at(Date.UTC(2026, 10, 13))}`)
  })
  test("a pair that ran out says until when", () => {
    expect(BuffMobile.usageLine({ bytes: 9, limit: 9, day: "2026-11-12", exhausted: true }, t, "en-US")).toBe(
      `daily traffic used up until ${at(Date.UTC(2026, 10, 13))}`,
    )
  })
})

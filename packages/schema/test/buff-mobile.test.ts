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
      { store: "appgallery", name: "AppGallery", url: "https://buff.systems/mobile/appgallery" },
      { store: "apk", name: "APK", url: "https://buff.systems/mobile/android-apk" },
    ])
    expect(BuffMobile.appLinks("dev.buff.systems")[0]?.url).toBe("https://dev.buff.systems/mobile/app-store")
  })
})

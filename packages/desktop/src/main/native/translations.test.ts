// Buff (#472): системные диалоги Buff в главном процессе — на языке окна.
import { expect, test } from "bun:test"
import { DESKTOP_NATIVE_ENGLISH } from "@opencode/app/i18n/desktop-native"
import { buffNativeText, setNativeTranslations } from "./translations"

test("строка Buff в системном диалоге — на языке окна; до сообщения окна — русский", () => {
  expect(buffNativeText("Organization certificate")).toBe("Сертификат организации")
  setNativeTranslations({ locale: "en", messages: { ...DESKTOP_NATIVE_ENGLISH } })
  expect(buffNativeText("Organization certificate")).toBe("Organization certificate")
  setNativeTranslations({ locale: "ru", messages: { ...DESKTOP_NATIVE_ENGLISH } })
  expect(buffNativeText("Certificate")).toBe("Сертификат")
})

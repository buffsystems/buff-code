import {
  DESKTOP_NATIVE_ENGLISH,
  DESKTOP_NATIVE_KEYS,
  formatDesktopNativeMessage,
  type DesktopNativeBundle,
  type DesktopNativeKey,
} from "@opencode/app/i18n/desktop-native"
import { BuffI18n } from "@opencode/schema/buff-i18n"

let bundle: DesktopNativeBundle = { locale: "en", messages: { ...DESKTOP_NATIVE_ENGLISH } }
// Buff (#472): язык строк Buff — язык окна; пока окно его не сообщило — русский.
let buffLocale: BuffI18n.Locale = BuffI18n.DEFAULT_LOCALE

export function setNativeTranslations(next: DesktopNativeBundle) {
  buffLocale = BuffI18n.locale(next.locale)
  if (
    next.locale === bundle.locale &&
    DESKTOP_NATIVE_KEYS.every((key) => next.messages[key] === bundle.messages[key])
  ) {
    return false
  }
  bundle = next
  return true
}

export function nativeT(key: DesktopNativeKey, params?: Record<string, string | number>) {
  return formatDesktopNativeMessage(bundle.messages[key], params)
}

/** Строка Buff в системном диалоге главного процесса — на языке окна (#472). */
export function buffNativeText(text: string): string {
  return BuffI18n.t(buffLocale, text)
}

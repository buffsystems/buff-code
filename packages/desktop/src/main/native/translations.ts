import {
  DESKTOP_NATIVE_ENGLISH,
  DESKTOP_NATIVE_KEYS,
  formatDesktopNativeMessage,
  type DesktopNativeBundle,
  type DesktopNativeKey,
} from "@opencode/app/i18n/desktop-native"
import { BuffI18n } from "@opencode/schema/buff-i18n"
import { BuffLinks } from "@opencode/schema/buff-links"

let bundle: DesktopNativeBundle = { locale: "en", messages: { ...DESKTOP_NATIVE_ENGLISH } }
// Buff (#472, #713): язык строк Buff — язык окна; пока окно его не сообщило — язык ОС.
let buffLocale: BuffI18n.Locale = BuffI18n.DEFAULT_LOCALE

/** Языки ОС (app.getPreferredSystemLanguages) — до того, как окно сообщит свой. */
export function adoptSystemLanguages(languages: readonly string[]) {
  buffLocale = BuffI18n.systemLocale(languages)
}

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

/** Адрес из меню — страница сайта на языке окна (#720). */
export function buffNativeHref(href: string): string {
  return BuffLinks.localized(href, buffLocale)
}

/** Строка Buff в системном диалоге главного процесса — на языке окна (#472). */
export function buffNativeText(text: string): string {
  return BuffI18n.t(buffLocale, text)
}

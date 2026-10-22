import { BuffI18n } from "@opencode/schema/buff-i18n"
import { useLanguage } from "@/runtime/i18n/language"

/**
 * Перевод строк Buff в окне (#472) — по языку окна и реактивно: экран меняется сразу при смене
 * языка. Строка в коде — по-английски, русский — из общего каталога (`schema/src/buff-i18n/`).
 */
export function useBuffText() {
  const language = useLanguage()
  const locale = () => BuffI18n.locale(language.locale())
  return {
    locale,
    t: (text: string, params?: BuffI18n.Params) => BuffI18n.t(locale(), text, params),
    n: (count: number, forms: string, params?: BuffI18n.Params) => BuffI18n.n(locale(), count, forms, params),
  }
}

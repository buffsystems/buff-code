import { BuffI18n } from "@opencode/schema/buff-i18n"

type DiffsText = (text: string, count?: number) => string

/**
 * Подписи просмотра изменений (#470): библиотека диффов пишет их сама по-английски; наш патч
 * (`patches/@pierre%2Fdiffs@*.patch`) спрашивает перевод здесь — на языке окна в момент отрисовки.
 */
export function installDiffsText(locale: () => BuffI18n.Locale): void {
  const translate: DiffsText = (text, count) =>
    count === undefined ? BuffI18n.t(locale(), text) : BuffI18n.n(locale(), count, text)
  ;(globalThis as { __buffDiffsText?: DiffsText }).__buffDiffsText = translate
}

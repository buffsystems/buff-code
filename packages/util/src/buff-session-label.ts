import { displayLabel, isFallbackTitle } from "./session-title-fallback.js"

/**
 * Подпись сессии для человека (#470), одна для окна и консоли: пока модель не придумала
 * название, у сессии служебное «New session - <время>» — показываем «Новая сессия»
 * (или «Сессия субагента») на языке интерфейса, без метки времени.
 */
export function buffSessionLabel(
  info: { readonly title?: string; readonly parentID?: string },
  t: (text: string) => string,
): string {
  const label = displayLabel(info)
  return isFallbackTitle(info.title) ? t(label) : label
}

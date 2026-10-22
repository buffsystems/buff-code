export * as BuffQuestion from "./buff-question.js"

import { BuffI18n } from "./buff-i18n.js"

/**
 * Вариант ответа на вопрос агента (#470). Описание инструмента велит модели дописывать
 * «(Recommended)» к рекомендуемому варианту — по-английски при любом языке человека.
 * Показываем метку на языке Buff; значение ответа для модели остаётся прежним.
 */
const MARK = /\s*\(recommended\)\s*$/i

export function optionLabel(label: string, t: BuffI18n.T = BuffI18n.english): string {
  if (!MARK.test(label)) return label
  return t("{label} (recommended)", { label: label.replace(MARK, "") })
}

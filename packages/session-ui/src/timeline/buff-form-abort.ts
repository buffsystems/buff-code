/**
 * Вопрос или план без ответа (#470): форму закрыли или Buff Code закрылся, пока она ждала.
 * Это не сбой инструмента — в ленте спокойная строка вместо карточки ошибки. Строки — английские
 * ключи каталога Buff.
 */
const FORM_TOOLS: Readonly<Record<string, string>> = {
  question: "Questions dismissed",
  plan_exit: "Plan closed without an answer",
}

export function formAbortNote(tool: string, error: string): string | undefined {
  const dismissed = FORM_TOOLS[tool]
  if (!dismissed) return undefined
  if (error.includes("location shut down")) return "Interrupted: Buff Code was closed"
  if (error.includes("dismissed this question")) return dismissed
  return undefined
}

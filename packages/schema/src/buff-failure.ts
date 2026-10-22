/**
 * Причина отказа словами службы (#458) — общая для консольного интерфейса и команд. Клиент службы отклоняет запрос не всегда объектом
 * Error: отказ входа приходит как `{ _tag, message }`, а иногда завёрнут в `cause.body`.
 * Проверка «это Error?» такие отказы теряла — человек видел только «Вход не удался».
 */
const text = (value: unknown): string | undefined =>
  typeof value === "object" &&
  value !== null &&
  "message" in value &&
  typeof value.message === "string" &&
  value.message
    ? value.message
    : undefined

export function failureMessage(cause: unknown, fallback: string): string {
  if (cause instanceof Error && typeof cause.cause === "object" && cause.cause !== null && "body" in cause.cause)
    return text(cause.cause.body) ?? text(cause) ?? fallback
  return text(cause) ?? fallback
}

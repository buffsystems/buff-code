import { turnFailure, type TurnError } from "@opencode/schema/buff-turn-failure"
import { t } from "./locale"

/**
 * Ошибка хода в консоли (#458): причина — теми же словами, что в окне, а действие — командой,
 * которой его делают здесь.
 */
const AGAIN = "↑ — put the message back into the input"
const FIX = {
  "sign-in": "/connect — sign in again",
  "choose-context": "/org — choose the organization and project",
  "top-up": "/balance — balance and the cabinet address",
  "replace-key": "/connect — replace the provider key",
  "connect-provider": "/connect — connect the provider",
} as const

/** `provider` — имя провайдера для людей (#562); без него — его идентификатор. */
export function consoleTurnFailure(
  error: TurnError,
  providerID: string,
  provider?: string,
): { text: string; hint: string } {
  const failure = turnFailure(error, providerID, t, provider)
  return { text: failure.text, hint: failure.action ? `${t(FIX[failure.action])} · ${t(AGAIN)}` : t(AGAIN) }
}

/**
 * Упал ли ход этого сообщения до первого шага модели: за сообщением идёт отметка о неудаче, а
 * ответа между ними нет. Лента окна считает так же (`session-ui/src/timeline/projection.ts`).
 */
export function failedBeforeAnswer(
  messages: readonly { readonly id: string; readonly type: string; readonly outcome?: string }[],
  userMessageID: string,
): boolean {
  const from = messages.findIndex((message) => message.id === userMessageID)
  if (from === -1) return false
  for (const message of messages.slice(from + 1)) {
    if (message.type === "assistant" || message.type === "user" || message.type === "shell") return false
    if (message.type === "idle") return message.outcome === "failed"
  }
  return false
}

/** Отказы, на которые уже ответили новым ключом (#562): они больше не ведут /connect и не метят запись. */
const settled = new Set<string>()

export function settleKeyFailure(messageID: string) {
  settled.add(messageID)
}

/**
 * Чей ключ чинить (#562): провайдер последнего хода, если ход упал на ключе (`rejected`) или на
 * маршруте к модели. Тогда /connect открывает сразу его, а отклонённая запись помечается.
 */
export function keyFailure(
  messages: readonly {
    readonly id: string
    readonly type: string
    readonly model?: { readonly providerID: string }
    readonly error?: TurnError
  }[],
): { providerID: string; rejected: boolean; messageID: string } | undefined {
  const last = messages.findLast((message) => message.type === "assistant")
  if (!last?.error || !last.model || settled.has(last.id)) return undefined
  const action = turnFailure(last.error, last.model.providerID, t).action
  if (action !== "replace-key" && action !== "connect-provider") return undefined
  return { providerID: last.model.providerID, rejected: action === "replace-key", messageID: last.id }
}

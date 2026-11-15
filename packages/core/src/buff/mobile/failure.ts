// Buff (#929): отказ хода для телефона — уже человеческими словами, на обоих языках. Окно и консоль
// толкуют ошибку сами (`turnFailure`), телефон же получал сырое `error.message` на языке машины.
// Слова те же, что у окна; язык выбирает телефон — свой.
import { Schema } from "effect"
import { BuffGoal } from "@opencode/schema/buff-goal"
import { BuffI18n } from "@opencode/schema/buff-i18n"
import { turnFailure, type TurnError, type TurnFailure } from "@opencode/schema/buff-turn-failure"

/** Отказ словами для телефона: без `files` — у телефона свой путь для файлов. */
export type Explained = Omit<TurnFailure, "files">
export interface Failure {
  readonly ru: Explained
  readonly en: Explained
}

const LOCALES = ["ru", "en"] as const

/** Упавший ход: ошибка, провайдер хода и — у отметки цели — номер итерации, которую он начал. */
export interface FailedTurn {
  readonly error: TurnError
  readonly providerID: string
  readonly iteration?: number
}

/**
 * Отказ хода на обоих языках; `provider` — имя провайдера для людей, без него — его id. У отметки
 * итерации цели текст — вся отметка: «Итерация N: <причина>».
 */
export function explain(turn: FailedTurn, provider?: string): Failure {
  const [ru, en] = LOCALES.map((lang) => {
    const t: BuffI18n.T = (text, params) => BuffI18n.t(lang, text, params)
    const { files: _files, ...rest } = turnFailure(turn.error, turn.providerID, t, provider ?? turn.providerID)
    return turn.iteration === undefined
      ? rest
      : { ...rest, text: t("Iteration {iteration}: {reason}", { iteration: turn.iteration, reason: rest.text }) }
  })
  return { ru: ru!, en: en! }
}

interface Stored {
  readonly type?: unknown
  readonly error?: TurnError
  readonly model?: { readonly providerID?: string }
  readonly metadata?: { readonly source?: unknown; readonly iteration?: unknown; readonly cause?: unknown }
}

const decodeCause = Schema.decodeUnknownOption(BuffGoal.Cause)

/**
 * Упавший ход, о котором говорит сообщение: ответ модели с ошибкой (прерванный человеком — не
 * отказ) или отметка итерации цели, начатой после упавшего хода.
 */
export function failedTurn(message: unknown): FailedTurn | undefined {
  const m = message as Stored | null
  if (m?.type === "assistant")
    return m.error && m.error.type !== "aborted" ? { error: m.error, providerID: m.model?.providerID ?? "" } : undefined
  if (m?.type !== "synthetic" || m.metadata?.source !== "buff-goal" || typeof m.metadata.iteration !== "number")
    return undefined
  const cause = decodeCause(m.metadata.cause)
  return cause._tag === "Some" ? { ...cause.value, iteration: m.metadata.iteration } : undefined
}

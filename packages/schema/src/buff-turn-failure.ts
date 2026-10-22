import { BuffI18n } from "./buff-i18n.js"

/**
 * Ошибка хода словами, по которым понятно, что делать (#458). Служба сохраняет отказ модели
 * как пришёл: «not a member of», «fetch failed». Для своих моделей Buff Code знает, что за
 * ним стоит, и говорит это — одинаково в окне и в консоли. Сырой отказ остаётся в подробностях.
 */
export interface TurnError {
  readonly type: string
  readonly message: string
  readonly status?: number
}

export interface TurnFailure {
  /** Что показать человеку. */
  readonly text: string
  /** Действие, которое исправляет причину, если оно есть. */
  readonly action?: "sign-in" | "choose-context" | "top-up" | "replace-key" | "connect-provider"
  /** Отказ как пришёл — для «Подробности» и для письма в поддержку. */
  readonly details: string
}

const BUFF = "buff"
/** Ход упал до первого шага модели: в истории нет ответа, только отметка о неудаче. */
export const TURN_FAILED = "turn-failed"
const NOT_MEMBER = /^not a member of\s*(.*)$/

function details(error: TurnError, t: BuffI18n.T): string {
  return [
    t("Type: {type}", { type: error.type }),
    ...(error.status === undefined ? [] : [t("Response code: {status}", { status: error.status })]),
    t("Message: {message}", { message: error.message }),
  ].join("\n")
}

function reading(error: TurnError, t: BuffI18n.T): Pick<TurnFailure, "text" | "action"> {
  const member = NOT_MEMBER.exec(error.message.trim())
  if (member)
    return member[1]
      ? {
          text: t("You have no access to the organization {org}. Choose another organization or contact the administrator.", {
            org: member[1],
          }),
          action: "choose-context",
        }
      : {
          text: t("No Buff organization and project are chosen for this folder. Choose the context and try again."),
          action: "choose-context",
        }
  if (error.type === TURN_FAILED)
    return {
      text: t(
        "The request did not reach the model: it is not available in this folder. Choose the Buff context and a model, then try again.",
      ),
      action: "choose-context",
    }
  // Баланс организации исчерпан (#455): бэкенд отвечает 402.
  if (error.status === 402)
    return {
      text: t("The organization has run out of funds. Top up the balance in the Buff cabinet and try again."),
      action: "top-up",
    }
  if (error.status === 401)
    return { text: t("The Buff sign-in is no longer valid: {message}", { message: error.message }), action: "sign-in" }
  if (error.type === "provider.transport")
    return { text: t("No connection to the company connector. Check the network and try again.") }
  return { text: error.message }
}

/**
 * Отказ своего провайдера (#562): с первых слов видно, чья это проблема — провайдера, Buff Code
 * или входа в Buff, — и что сделать. Слова провайдера не толкуются, а цитируются.
 */
function ownReading(error: TurnError, provider: string, t: BuffI18n.T): Pick<TurnFailure, "text" | "action"> {
  const said = error.message.trim().replace(/\.$/, "")
  if (!said) return { text: "" }
  const quoted = error.status === undefined ? said : t("response {status}: {message}", { status: error.status, message: said })
  const words = { provider, said: quoted }
  if (error.type === "provider.auth" || error.status === 401 || error.status === 403)
    return {
      text: t(
        "{provider} rejected the key ({said}). The problem is the provider key, not Buff Code and not the Buff Systems sign-in. Check that the key is for model requests (for OpenRouter — an API Key, not a Management Key) and replace it.",
        words,
      ),
      action: "replace-key",
    }
  if (error.type === "provider.quota" || error.status === 402)
    return {
      text: t(
        "Your {provider} account has run out of funds or quota ({said}). Top it up with the provider or choose another model.",
        words,
      ),
    }
  if (error.type === "provider.rate-limit" || error.status === 429)
    return { text: t("{provider} limited the request rate ({said}). Wait and retry.", words) }
  if (error.status === 404)
    return { text: t("{provider} does not know this model ({said}). Choose another model.", words) }
  if (error.type === "provider.transport")
    return {
      text: t("{provider} is unreachable: no connection to its address ({said}). Check the network and the provider address.", words),
    }
  if (error.type === "provider.internal" || (error.status !== undefined && error.status >= 500))
    return { text: t("Failure on the {provider} side ({said}). Retry later.", words) }
  if (error.type === "provider.content-filter")
    return { text: t("{provider} declined the request by its content filter ({said}).", words) }
  if (error.type === "provider.no-route" || error.type === "provider.unknown")
    return {
      text: t("Buff Code cannot reach the {provider} model ({said}). Connect the provider or choose another model.", words),
      action: "connect-provider",
    }
  if (error.type.startsWith("provider.")) return { text: t("{provider} rejected the request ({said}).", words) }
  return { text: t("Error in Buff Code ({said}). Copy the details and send them to support.", words) }
}

/** `provider` — имя провайдера для людей; без него — его идентификатор. */
export function turnFailure(
  error: TurnError,
  providerID: string,
  t: BuffI18n.T = BuffI18n.english,
  provider: string = providerID,
): TurnFailure {
  const read = providerID === BUFF ? reading(error, t) : ownReading(error, provider, t)
  return {
    ...read,
    text: read.text.trim() || t("The model did not answer. Repeat the request."),
    details: details(error, t),
  }
}

/** Шаг модели, насколько его нужно знать, чтобы понять, что ответа нет. */
export interface AnswerStep {
  readonly content: readonly unknown[]
  readonly finish?: string
  readonly error?: unknown
  readonly time: { readonly created?: number; readonly completed?: number }
}

/**
 * Законченный шаг без единого блока ответа: ни текста, ни размышлений, ни вызовов
 * инструментов. Раньше под таким сообщением не было ничего. (Лента окна считает так же —
 * `session-ui/src/timeline/projection.ts`: тот пакет от этого не зависит.)
 */
export function isEmptyAnswer(step: AnswerStep): boolean {
  if (step.error || step.content.length > 0 || step.time.completed === undefined) return false
  return !!step.finish && step.finish !== "tool-calls"
}

/** Пустой ответ как отказ хода — чтобы показать его теми же словами и с теми же действиями. */
export const EMPTY_ANSWER: TurnError = { type: "empty-answer", message: "" }

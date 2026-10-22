import { buffSessionLabel } from "@opencode/util/buff-session-label"
import { NEW_SESSION_TAB_TITLE } from "../../context/session-tabs-model"
import { t } from "./locale-state"

/**
 * Подпись сессии в консоли (#470): служебное «New session - <время>» и запомненная подпись
 * новой вкладки — «Новая сессия» на языке консоли.
 */
export function sessionLabel(title: string): string
export function sessionLabel(title: string | undefined): string | undefined
export function sessionLabel(title: string | undefined): string | undefined {
  if (title === undefined) return undefined
  return title === NEW_SESSION_TAB_TITLE ? t(title) : buffSessionLabel({ title }, t)
}
